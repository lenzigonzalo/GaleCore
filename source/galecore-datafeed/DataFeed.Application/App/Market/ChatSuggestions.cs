using System.Globalization;
using DataFeed.Application.App.Shared;
using DataFeed.Application.Data.Fed.FomcMeetings;
using DataFeed.Application.Data.Fred.ReleaseDates;
using DataFeed.Infrastructure.Providers.Tastytrade;
using MediatR;
using Newtonsoft.Json.Linq;

namespace DataFeed.Application.App.Market;

/// <summary>
/// Sugerencias del chat nuevo (WS-0039): hasta cuatro temas del momento (lo que más se mueve del mercado y la agenda
/// de hoy y mañana), cada uno con su número, la serie intradía para un grafiquito y una pregunta para arrancar el chat.
/// Reglas fijas, sin modelo: el Monitor sólo las muestra.
/// </summary>
public class ChatSuggestionsRequest : IRequest<ChatSuggestionsResponse> { }

public class ChatSuggestionsResponse
{
    public List<ChatSuggestion> Items { get; set; } = new();
    /// <summary>Lo que no se pudo leer (sin cotización, agenda caída): una tarjeta que falta no es «nada que contar».</summary>
    public List<string> Missing { get; set; } = new();
}

public class ChatSuggestion
{
    public string Id { get; set; } = "";
    /// <summary><c>move</c> (un subyacente o el VIX que se mueve) o <c>event</c> (dato o Fed de hoy o mañana).</summary>
    public string Kind { get; set; } = "";
    public string Title { get; set; } = "";
    /// <summary>El número de la tarjeta ya formateado («−1,24 %», «Mañana»).</summary>
    public string Value { get; set; } = "";
    /// <summary><c>up</c>, <c>down</c> o <c>neutral</c>: color del número y del grafiquito.</summary>
    public string Tone { get; set; } = "neutral";
    /// <summary>Cierres intradía de la última sesión, en orden; vacío en los eventos.</summary>
    public List<double> Series { get; set; } = new();
    /// <summary>De cuándo es el dato: «hoy», «cierre del 15/10» o la fecha del evento.</summary>
    public string AsOf { get; set; } = "";
    public string Question { get; set; } = "";
}

public record SuggestionQuote(string Symbol, string Name, double? ChangePct, DateOnly? Session, IReadOnlyList<double> Series);
public record SuggestionEvent(DateOnly Date, string Name);

public class ChatSuggestionsHandler(IDxLinkStreamingService streaming, IMediator mediator) : IRequestHandler<ChatSuggestionsRequest, ChatSuggestionsResponse>
{
    private static readonly (string Symbol, string Name)[] Universe =
        { ("SPY", "SPY"), ("QQQ", "QQQ"), ("IWM", "IWM"), ("TLT", "TLT"), ("VIX", "VIX") };
    // Empleo, IPC, IPP, PBI, ingreso personal (PCE) y ventas minoristas, como la agenda de Inicio.
    private static readonly string MacroReleases = EventCatalog.FredReleaseIdsCsv;
    private static readonly TimeSpan CalendarWait = TimeSpan.FromSeconds(6);

    public async Task<ChatSuggestionsResponse> Handle(ChatSuggestionsRequest request, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(CascadeUtils.TodayEt());
        var missing = new List<string>();
        var eventsTask = EventsAsync(today, missing, ct);
        var quotes = await QuotesAsync(missing, ct);
        var events = await eventsTask;
        return new ChatSuggestionsResponse { Items = ChatSuggestionsRules.Build(quotes, events, today), Missing = missing };
    }

    private async Task<List<SuggestionQuote>> QuotesAsync(List<string> missing, CancellationToken ct)
    {
        var fromDaily = new DateTimeOffset(DateTime.UtcNow.Date.AddDays(-10)).ToUnixTimeMilliseconds();
        var fromIntraday = new DateTimeOffset(DateTime.UtcNow.Date.AddDays(-5)).ToUnixTimeMilliseconds();
        var subs = Universe.SelectMany(u => new[] { (u.Symbol + "{=d}", "Candle", (long?)fromDaily), (u.Symbol + "{=15m}", "Candle", (long?)fromIntraday) }).ToArray();
        IReadOnlyList<JObject> candles;
        try
        {
            candles = await streaming.RequestSnapshotAsync(subs,
                isSymbolComplete: item => (((int?)item["eventFlags"] ?? 0) & 0x18) != 0, timeout: TimeSpan.FromSeconds(8), cancellationToken: ct);
        }
        catch (Exception) { missing.Add("Cotizaciones (Tastytrade): no respondieron."); return new(); }

        List<(long Time, double Close)> Rows(string key) => candles.Where(c => (string?)c["eventSymbol"] == key)
            .Select(c => ((long?)c["time"] ?? 0, Num(c["close"]) ?? 0)).Where(r => r.Item1 > 0 && r.Item2 > 0)
            .GroupBy(r => r.Item1).Select(g => g.Last()).OrderBy(r => r.Item1).ToList();

        var quotes = new List<SuggestionQuote>();
        foreach (var (symbol, name) in Universe)
        {
            var days = Rows(symbol + "{=d}");
            if (days.Count < 2) { missing.Add(name + ": sin velas diarias."); continue; }
            // La vela diaria viene fechada a medianoche UTC del día de la sesión (como en el resumen de Mercado).
            var session = DateOnly.FromDateTime(DateTimeOffset.FromUnixTimeMilliseconds(days[^1].Time).UtcDateTime);
            var pct = Math.Round((days[^1].Close / days[^2].Close - 1) * 100, 2);
            var series = Rows(symbol + "{=15m}").Where(r => EtDate(r.Time) == session && CascadeUtils.IsRegularSessionEt(DateTimeOffset.FromUnixTimeMilliseconds(r.Time))).Select(r => r.Close).ToList();
            quotes.Add(new SuggestionQuote(symbol, name, pct, session, series));
        }
        return quotes;
    }

    private async Task<List<SuggestionEvent>> EventsAsync(DateOnly today, List<string> missing, CancellationToken ct)
    {
        var from = today.ToDateTime(TimeOnly.MinValue);
        var releases = mediator.Send(new FredReleaseDatesRequest { From = from, To = from.AddDays(1), ReleaseIds = MacroReleases }, ct);
        var fomc = mediator.Send(new FomcMeetingsRequest { Years = today.Year.ToString() }, ct);
        var all = Task.WhenAll(releases, fomc);
        if (await Task.WhenAny(all, Task.Delay(CalendarWait, ct)) != all || all.IsFaulted)
        {
            missing.Add("Agenda de datos de EE. UU. y de la Fed: no respondió a tiempo.");
            return new();
        }
        var events = releases.Result.Data.Select(r => new SuggestionEvent(DateOnly.Parse(r.Date[..10]), ChatSuggestionsRules.ReleaseName(r.ReleaseId, r.ReleaseName))).ToList();
        events.AddRange(fomc.Result.Data.Where(m => m.End >= today).Select(m => new SuggestionEvent(m.End, "FOMC")));
        return events;
    }

    private static DateOnly EtDate(long ms) => DateOnly.FromDateTime(CascadeUtils.TodayEt(DateTimeOffset.FromUnixTimeMilliseconds(ms)));

    private static double? Num(JToken? t)
    {
        if (t == null) return null;
        if (t.Type is JTokenType.Float or JTokenType.Integer) { var v = t.Value<double>(); return double.IsFinite(v) ? v : null; }
        return double.TryParse((string?)t, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) && double.IsFinite(d) ? d : null;
    }
}

public static class ChatSuggestionsRules
{
    private static readonly CultureInfo Es = CultureInfo.GetCultureInfo("es-AR");
    /// <summary>Desde acá un movimiento es tema: 1 % en un ETF, 5 % en el VIX (se mueve unas cinco veces más).</summary>
    public const double MoveThresholdPct = 1.0, VixThresholdPct = 5.0;

    public static string ReleaseName(int id, string fallback) => id switch
    {
        50 => "Empleo de EE. UU.", 10 => "Inflación (IPC)", 46 => "Precios mayoristas (IPP)",
        53 => "PBI", 54 => "Ingreso y gasto personal (PCE)", 9 => "Ventas minoristas", _ => fallback,
    };

    /// <summary>
    /// Puro: los eventos de hoy y mañana, y los movimientos que pasan el umbral, ordenados por cuánto pesan; si quedan
    /// lugares, se completan con lo que más se movió, para que el chat nuevo siempre ofrezca algo real para preguntar.
    /// </summary>
    public static List<ChatSuggestion> Build(IReadOnlyList<SuggestionQuote> quotes, IReadOnlyList<SuggestionEvent> events, DateOnly today, int max = 4)
    {
        var scored = new List<(double Score, ChatSuggestion Item)>();
        foreach (var e in events.Where(e => e.Date == today || e.Date == today.AddDays(1)).GroupBy(e => (e.Date, e.Name)).Select(g => g.First()))
        {
            var when = e.Date == today ? "Hoy" : "Mañana";
            var weight = e.Name == "FOMC" || e.Name.StartsWith("Inflación") || e.Name.StartsWith("Empleo") ? 3.0 : 1.5;
            scored.Add((weight + (e.Date == today ? 0.5 : 0), new ChatSuggestion
            {
                Id = "event-" + e.Date.ToString("yyyyMMdd") + "-" + e.Name, Kind = "event", Title = e.Name, Value = when,
                AsOf = e.Date.ToString("dd/MM", Es),
                Question = e.Name == "FOMC" ? $"¿Cómo puede mover al mercado y a mis posiciones la Fed ({when.ToLowerInvariant()})?"
                    : $"¿Qué espera el mercado del dato de {e.Name} ({when.ToLowerInvariant()}) y cómo me puede pegar?",
            }));
        }
        foreach (var q in quotes.Where(q => q.ChangePct != null))
        {
            var pct = q.ChangePct!.Value;
            var threshold = q.Symbol == "VIX" ? VixThresholdPct : MoveThresholdPct;
            var hot = Math.Abs(pct) >= threshold;
            var asOf = q.Session == today ? "hoy" : q.Session is { } s ? "cierre del " + s.ToString("dd/MM", Es) : "";
            var verb = Math.Abs(pct) < 0.05 ? "sin cambios" : pct > 0 ? "sube" : "baja";
            scored.Add(((hot ? 2 : 0) + Math.Abs(pct) / threshold, new ChatSuggestion
            {
                Id = "move-" + q.Symbol, Kind = "move", Title = q.Name + " " + verb, Value = Pct(pct),
                Tone = Math.Abs(pct) < 0.05 ? "neutral" : (pct > 0) == (q.Symbol != "VIX") ? "up" : "down",
                Series = q.Series.ToList(), AsOf = asOf,
                Question = q.Symbol == "VIX"
                    ? (pct >= 0 ? "El VIX está subiendo: ¿qué está pasando y conviene vender prima con esta volatilidad?" : "El VIX está bajando: ¿qué cambia para vender prima?")
                    : hot ? $"{q.Name} {verb} {Math.Abs(pct).ToString("0.00", Es)} % {(q.Session == today ? "hoy" : "en la última rueda")}: ayudame a entender qué está pasando."
                    : $"¿Cómo viene {q.Name} {(q.Session == today ? "hoy" : "en la última rueda")} y qué lo está moviendo?",
            }));
        }
        return scored.OrderByDescending(s => s.Score).Take(max).Select(s => s.Item).ToList();
    }

    private static string Pct(double v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.Abs(v).ToString("0.00", Es) + " %";
}
