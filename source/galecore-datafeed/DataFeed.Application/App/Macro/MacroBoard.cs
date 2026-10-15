using System.Collections.Concurrent;
using System.Globalization;
using DataFeed.Infrastructure.Providers.Tastytrade;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using MediatR;
using Newtonsoft.Json.Linq;

namespace DataFeed.Application.App.Macro;

/// <summary>
/// Macro como el panel de mercados de un bróker (WS-0036, ok del owner 15/10): una franja con seis números y una tabla
/// por clase de activo con último, hoy, 1 semana, 1 mes y la serie del último mes para el mini gráfico. Los futuros
/// salen de Tastytrade (contrato vigente) y DXLink; tasas, crédito y volatilidad, del snapshot Macro (Tesoro, FRED,
/// CBOE). Todo calculado acá; el Monitor sólo lo muestra.
/// </summary>
public class MacroBoardRequest : IRequest<MacroBoardResponse> { }

public class MacroBoardResponse
{
    public DateTime AsOf { get; set; }
    public List<BoardRow> Strip { get; set; } = new();
    public List<BoardGroup> Groups { get; set; } = new();
    public BoardCurve? Curve { get; set; }
    public List<BoardEvent> Events { get; set; } = new();
    /// <summary>Lo que no se pudo leer; se declara, no se inventa.</summary>
    public List<string> Missing { get; set; } = new();
}

public class BoardGroup
{
    public string Name { get; set; } = "";
    public List<BoardRow> Rows { get; set; } = new();
}

public class BoardRow
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    /// <summary>Símbolo a mostrar: el contrato vigente en futuros (/ESZ26), la serie en el resto.</summary>
    public string Symbol { get; set; } = "";
    /// <summary>Unidad del último valor: "pts", "%", "pb", "USD".</summary>
    public string Unit { get; set; } = "";
    /// <summary>Unidad de los cambios: "%" (precios) o "pb" / "pts" (tasas y volatilidad).</summary>
    public string ChangeUnit { get; set; } = "";
    public double? Last { get; set; }
    public double? ChangeDay { get; set; }
    public double? ChangeWeek { get; set; }
    public double? ChangeMonth { get; set; }
    /// <summary>Fecha del último dato (las series diarias de FRED y el Tesoro llegan con un día o más de atraso).</summary>
    public string? AsOf { get; set; }
    public string Source { get; set; } = "";
    /// <summary>El último mes (22 datos): mini gráfico de la fila y gráfico del detalle.</summary>
    public List<BoardPoint> Spark { get; set; } = new();
}

public record BoardPoint(string Date, double Value);

public class BoardCurve
{
    public string Date { get; set; } = "";
    public List<BoardCurvePoint> Points { get; set; } = new();
}

public record BoardCurvePoint(string Tenor, double Value);
public record BoardEvent(string Date, string Name);

public class MacroBoardHandler(IMediator mediator, Microsoft.Extensions.Configuration.IConfiguration config, ITastytradeOAuth auth,
    IHttpClientFactory client, IDxLinkStreamingService streaming)
    : IRequestHandler<MacroBoardRequest, MacroBoardResponse>
{
    private record Future(string Code, string Name);
    private record Series(string Id, string Name);

    // Grupos en el orden del panel. Futuros por código de producto de Tastytrade.
    private static readonly (string Group, Future[] Futures, Series[] Series)[] Layout =
    {
        ("Índices", new[] { new Future("ES", "S&P 500"), new Future("NQ", "Nasdaq 100"), new Future("RTY", "Russell 2000"), new Future("YM", "Dow Jones") }, Array.Empty<Series>()),
        ("Tasas", Array.Empty<Future>(), new[] { new Series("UST2", "Tesoro 2 años"), new Series("UST10", "Tesoro 10 años"), new Series("UST30", "Tesoro 30 años"),
            new Series("DFII10", "Tasa real 10 años"), new Series("T10YIE", "Breakeven 10 años"), new Series("SLOPE2_10", "Pendiente 2–10") }),
        ("Crédito", Array.Empty<Future>(), new[] { new Series("BAMLH0A0HYM2", "Spread high yield"), new Series("BAMLC0A0CM", "Spread grado de inversión") }),
        ("Monedas", new[] { new Future("6E", "Euro"), new Future("6J", "Yen"), new Future("6B", "Libra") }, Array.Empty<Series>()),
        ("Commodities", new[] { new Future("GC", "Oro"), new Future("SI", "Plata"), new Future("HG", "Cobre"), new Future("CL", "Petróleo WTI"),
            new Future("NG", "Gas natural"), new Future("ZS", "Soja"), new Future("ZC", "Maíz"), new Future("ZW", "Trigo") }, Array.Empty<Series>()),
        ("Volatilidad", new[] { new Future("VX", "VIX futuro") }, new[] { new Series("VIX", "VIX"), new Series("VVIX", "VVIX"), new Series("SKEW", "SKEW") }),
    };
    private static readonly string[] StripIds = { "ES", "UST10", Dollar, "GC", "CL", "VIX" };
    // Tastytrade no lista el índice dólar (/DX es de ICE): se usa el índice amplio de la Fed (FRED, diario).
    private const string Dollar = "DTWEXBGS";

    private static readonly ConcurrentDictionary<string, (DateTime At, FutureItem Item)> Contracts = new();
    private static (DateTime At, MacroBoardResponse Board)? _last;
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly TimeSpan BoardTtl = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan ContractTtl = TimeSpan.FromHours(6);

    public async Task<MacroBoardResponse> Handle(MacroBoardRequest request, CancellationToken ct)
    {
        if (_last is { } c && DateTime.UtcNow - c.At < BoardTtl) return c.Board;
        await Gate.WaitAsync(ct);
        try
        {
            if (_last is { } again && DateTime.UtcNow - again.At < BoardTtl) return again.Board;
            var board = await BuildAsync(ct);
            _last = (DateTime.UtcNow, board);
            return board;
        }
        finally { Gate.Release(); }
    }

    private async Task<MacroBoardResponse> BuildAsync(CancellationToken ct)
    {
        var missing = new List<string>();
        var snapshotTask = mediator.Send(new MacroSnapshotRequest(), ct);
        var dollarTask = DollarAsync(missing, ct);
        var futures = await FuturesAsync(missing, ct);
        var snapshot = await snapshotTask;
        var dollar = await dollarTask;
        foreach (var s in snapshot.SourceStatuses.Where(s => s.Status != "available"))
            missing.Add($"{s.Id}: {(s.Status == "source-error" ? "la fuente falló" : "sin datos")}{(s.AsOf != null ? $" (último dato {s.AsOf})" : "")}.");

        var definitions = snapshot.SeriesDefinitions.ToDictionary(d => d.Id);
        var response = new MacroBoardResponse { AsOf = DateTime.UtcNow, Missing = missing };
        foreach (var (group, futs, series) in Layout)
        {
            var rows = new List<BoardRow>();
            rows.AddRange(futs.Select(f => futures.TryGetValue(f.Code, out var row) ? row
                : new BoardRow { Id = f.Code, Name = f.Name, Symbol = "/" + f.Code, Unit = "pts", ChangeUnit = "%", Source = "tastytrade" }));
            foreach (var s in series)
            {
                var unit = definitions.TryGetValue(s.Id, out var d) ? d.Unit : "";
                var points = snapshot.Observations.Where(o => o.SeriesId == s.Id && o.Value != null)
                    .OrderBy(o => o.ObservationTime, StringComparer.Ordinal)
                    .Select(o => (o.ObservationTime, (double)o.Value!.Value)).ToList();
                rows.Add(MacroBoardMath.Row(s.Id, s.Name, s.Id, unit, unit == "%" ? "pb" : unit == "pb" ? "pb" : "pts",
                    unit == "%" ? 100 : 1, points, definitions.TryGetValue(s.Id, out var def) ? def.Source : ""));
            }
            if (group == "Monedas") rows.Insert(0, dollar);
            response.Groups.Add(new BoardGroup { Name = group, Rows = rows });
        }
        var all = response.Groups.SelectMany(g => g.Rows).ToDictionary(r => r.Id);
        response.Strip = StripIds.Where(all.ContainsKey).Select(id => all[id]).ToList();
        response.Curve = MacroBoardMath.Curve(snapshot.Observations);
        response.Events = snapshot.Events.Select(e => new BoardEvent(e.Date, e.Name)).ToList();
        foreach (var r in all.Values.Where(r => r.Last == null && r.Source == "tastytrade"))
            missing.Add($"{r.Name} ({r.Symbol}): Tastytrade no devolvió el contrato o su historia.");
        return response;
    }

    private async Task<BoardRow> DollarAsync(List<string> missing, CancellationToken ct)
    {
        var points = new List<(string, double)>();
        try
        {
            var r = await mediator.Send(new DataFeed.Application.Data.Fred.Series.FredSeriesRequest
                { SeriesId = Dollar, From = DateTime.UtcNow.Date.AddDays(-60), To = DateTime.UtcNow }, ct);
            points.AddRange(r.Data.Observations.Where(o => o.Value != null).OrderBy(o => o.Date, StringComparer.Ordinal)
                .Select(o => (o.Date, (double)o.Value!.Value)));
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            missing.Add("Índice dólar (FRED DTWEXBGS): no respondió.");
        }
        return MacroBoardMath.Row(Dollar, "Dólar amplio (Fed)", Dollar, "índice", "%", 0, points, "fred");
    }

    /// <summary>Contrato vigente de cada futuro (marca <c>active-month</c> de Tastytrade) y sus velas diarias de ~45 días.</summary>
    private async Task<Dictionary<string, BoardRow>> FuturesAsync(List<string> missing, CancellationToken ct)
    {
        var all = Layout.SelectMany(l => l.Futures).ToList();
        var stale = all.Where(f => !Contracts.TryGetValue(f.Code, out var c) || DateTime.UtcNow - c.At > ContractTtl).Select(f => f.Code).ToList();
        if (stale.Count > 0)
        {
            try
            {
                var listed = (await new TastytradeApiProvider(config, auth, client).GetFuturesAsync(stale, ct))?.Data?.Items ?? new();
                foreach (var code in stale)
                {
                    var pick = FuturesMath.ActiveContract(listed.Where(i => i.ProductCode == code), DateOnly.FromDateTime(DateTime.UtcNow));
                    if (pick != null) Contracts[code] = (DateTime.UtcNow, pick);
                }
            }
            catch (Exception) when (!ct.IsCancellationRequested)
            {
                missing.Add("Contratos de futuros (Tastytrade): no respondió; se usan los últimos conocidos.");
            }
        }

        var active = all.Where(f => Contracts.ContainsKey(f.Code))
            .Select(f => (f, item: Contracts[f.Code].Item)).Where(x => !string.IsNullOrEmpty(x.item.StreamerSymbol)).ToList();
        var from = new DateTimeOffset(DateTime.UtcNow.Date.AddDays(-45)).ToUnixTimeMilliseconds();
        var candles = new List<JObject>();
        if (active.Count > 0)
        {
            try
            {
                var items = await streaming.RequestSnapshotAsync(
                    active.Select(x => (x.item.StreamerSymbol! + "{=d}", "Candle", (long?)from)).ToList(),
                    isSymbolComplete: item => (((int?)item["eventFlags"] ?? 0) & 0x18) != 0,
                    timeout: TimeSpan.FromSeconds(15), cancellationToken: ct);
                candles.AddRange(items);
            }
            catch (Exception) when (!ct.IsCancellationRequested)
            {
                missing.Add("Velas diarias de futuros (DXLink): no respondieron a tiempo.");
            }
        }

        var rows = new Dictionary<string, BoardRow>();
        foreach (var (f, item) in active)
        {
            var key = item.StreamerSymbol + "{=d}";
            var points = candles.Where(c => (string?)c["eventSymbol"] == key)
                .Select(c => (Time: (long?)c["time"] ?? 0, Close: ToDouble(c["close"])))
                .Where(p => p.Time > 0 && p.Close is > 0)
                .GroupBy(p => p.Time).Select(g => g.Last()).OrderBy(p => p.Time)
                .Select(p => (DateTimeOffset.FromUnixTimeMilliseconds(p.Time).UtcDateTime.ToString("yyyy-MM-dd"), p.Close!.Value)).ToList();
            // El VIX futuro se lee como el VIX: en puntos, no en %.
            rows[f.Code] = f.Code == "VX" ? MacroBoardMath.Row(f.Code, f.Name, item.Symbol, "pts", "pts", 1, points, "tastytrade")
                : MacroBoardMath.Row(f.Code, f.Name, item.Symbol, "pts", "%", 0, points, "tastytrade");
        }
        return rows;
    }

    private static double? ToDouble(JToken? t)
    {
        if (t == null) return null;
        if (t.Type is JTokenType.Float or JTokenType.Integer) { var v = t.Value<double>(); return double.IsFinite(v) ? v : null; }
        return double.TryParse((string?)t, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) && double.IsFinite(d) ? d : null;
    }
}

public static class FuturesMath
{
    /// <summary>
    /// El contrato que opera el mercado hoy: el que Tastytrade marca <c>active-month</c>; si ninguno, el más cercano sin
    /// vencer. Así el panel pasa solo al siguiente cuando el volumen rolea.
    /// </summary>
    public static FutureItem? ActiveContract(IEnumerable<FutureItem> contracts, DateOnly today)
    {
        var live = contracts.Where(c => !DateOnly.TryParse(c.ExpirationDate, CultureInfo.InvariantCulture, out var e) || e >= today).ToList();
        return live.FirstOrDefault(c => c.ActiveMonth)
            ?? live.OrderBy(c => DateOnly.TryParse(c.ExpirationDate, CultureInfo.InvariantCulture, out var e) ? e : DateOnly.MaxValue).FirstOrDefault();
    }
}

public static class MacroBoardMath
{
    /// <summary>
    /// Una fila con la serie diaria (fecha, valor) en orden. Hoy = contra el dato anterior; 1 semana = 5 datos atrás;
    /// 1 mes = 21 datos atrás. <paramref name="scale"/> 0 = cambio en %; si no, diferencia × escala (100: de % a pb).
    /// </summary>
    public static BoardRow Row(string id, string name, string symbol, string unit, string changeUnit, double scale,
        IReadOnlyList<(string Date, double Value)> points, string source)
    {
        double? Change(int back)
        {
            if (points.Count <= back) return null;
            var last = points[^1].Value; var prev = points[^(back + 1)].Value;
            if (scale == 0) return prev == 0 ? null : Math.Round((last / prev - 1) * 100, 2);
            return Math.Round((last - prev) * scale, 2);
        }
        return new BoardRow
        {
            Id = id, Name = name, Symbol = symbol, Unit = unit,
            ChangeUnit = changeUnit, Source = source,
            Last = points.Count > 0 ? Math.Round(points[^1].Value, 6) : null,
            AsOf = points.Count > 0 ? points[^1].Date : null,
            ChangeDay = Change(1), ChangeWeek = Change(5), ChangeMonth = Change(21),
            Spark = points.TakeLast(22).Select(p => new BoardPoint(p.Date, Math.Round(p.Value, 6))).ToList(),
        };
    }

    public static BoardCurve? Curve(IEnumerable<MacroObservation> observations)
    {
        var tenors = new[] { ("UST2", "2 años"), ("UST5", "5 años"), ("UST10", "10 años"), ("UST30", "30 años") };
        var rows = observations.Where(o => o.Value != null && tenors.Any(t => t.Item1 == o.SeriesId)).ToList();
        var date = rows.Select(o => o.ObservationTime).Distinct().OrderByDescending(d => d, StringComparer.Ordinal)
            .FirstOrDefault(d => tenors.All(t => rows.Any(o => o.SeriesId == t.Item1 && o.ObservationTime == d)));
        if (date == null) return null;
        return new BoardCurve
        {
            Date = date,
            Points = tenors.Select(t => new BoardCurvePoint(t.Item2, (double)rows.First(o => o.SeriesId == t.Item1 && o.ObservationTime == date).Value!.Value)).ToList(),
        };
    }
}
