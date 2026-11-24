using System.Globalization;
using DataFeed.Infrastructure.Providers.Tastytrade;
using DataFeed.Application.App.Shared;
using MediatR;
using Newtonsoft.Json.Linq;

namespace DataFeed.Application.App.Market;

/// <summary>
/// El día de un símbolo para el encabezado de Mercado (WS-0036): último, cierre anterior, variación, volumen, máximo y
/// mínimo, de las velas diarias de DXLink. El socket sólo trae precio y bid/ask; esto completa lo que faltaba.
/// </summary>
public class MarketSummaryRequest : IRequest<MarketSummaryResponse>
{
    public string Symbol { get; set; } = "";
}

public class MarketSummaryResponse
{
    public string Symbol { get; set; } = "";
    public double? Last { get; set; }
    public double? PrevClose { get; set; }
    public double? Change { get; set; }
    public double? ChangePct { get; set; }
    public double? Volume { get; set; }
    public double? High { get; set; }
    public double? Low { get; set; }
    /// <summary>Fecha de la vela del día (la sesión a la que corresponden volumen, máximo y mínimo).</summary>
    public string? SessionDate { get; set; }
    /// <summary>La sesión regular está abierta ahora (lunes a viernes 09:30–16:00 ET con vela del día).</summary>
    public bool SessionOpen { get; set; }
    /// <summary>Fuera de la sesión regular: último precio de horario extendido y su variación contra el cierre de la vela diaria.</summary>
    public double? ExtendedLast { get; set; }
    public double? ExtendedChange { get; set; }
    public double? ExtendedChangePct { get; set; }
    public DateTimeOffset? ExtendedAt { get; set; }
    /// <summary>"premarket" o "afterhours".</summary>
    public string? ExtendedSession { get; set; }
}

public class MarketSummaryHandler(IDxLinkStreamingService streaming) : IRequestHandler<MarketSummaryRequest, MarketSummaryResponse>
{
    public async Task<MarketSummaryResponse> Handle(MarketSummaryRequest request, CancellationToken ct)
    {
        var symbol = (request.Symbol ?? "").Trim().ToUpperInvariant();
        if (symbol.Length == 0 || symbol.Length > 24) throw new DataFeed.Application.Shared.ValidationException("Símbolo inválido.");
        var key = symbol + "{=d}";
        var from = new DateTimeOffset(DateTime.UtcNow.Date.AddDays(-10)).ToUnixTimeMilliseconds();
        // Velas de 5m de las últimas 2 h (`{=5m}` incluye horario extendido): alcanza para el último precio fuera de hora y
        // el snapshot llega rápido (20 h tardaban ~6 s y el pedido se cortaba). Sin operaciones extendidas recientes, no hay dato.
        var extKey = symbol + "{=5m}";
        var now = DateTimeOffset.UtcNow;
        var extFrom = now.AddHours(-2).ToUnixTimeMilliseconds();
        var candles = await streaming.RequestSnapshotAsync(new[] { (key, "Candle", (long?)from), (extKey, "Candle", (long?)extFrom) },
            isSymbolComplete: item => (((int?)item["eventFlags"] ?? 0) & 0x18) != 0, timeout: TimeSpan.FromSeconds(8), cancellationToken: ct);
        // Se compara por prefijo por si DXLink devuelve el símbolo de la vela con otros atributos.
        List<Day> Parse(string prefix) => candles.Where(c => ((string?)c["eventSymbol"])?.StartsWith(prefix, StringComparison.Ordinal) == true)
            .Select(c => new Day((long?)c["time"] ?? 0, Num(c["close"]), Num(c["high"]), Num(c["low"]), Num(c["volume"])))
            .Where(d => d.Time > 0 && d.Close is > 0).GroupBy(d => d.Time).Select(g => g.Last()).OrderBy(d => d.Time).ToList();
        return MarketSummaryMath.Build(symbol, Parse(key), Parse(extKey), now);
    }

    private static double? Num(JToken? t)
    {
        if (t == null) return null;
        if (t.Type is JTokenType.Float or JTokenType.Integer) { var v = t.Value<double>(); return double.IsFinite(v) ? v : null; }
        return double.TryParse((string?)t, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) && double.IsFinite(d) ? d : null;
    }
}

public record Day(long Time, double? Close, double? High, double? Low, double? Volume);

public static class MarketSummaryMath
{
    /// <summary>Puro: con las velas diarias en orden, la última es la sesión de hoy y la anterior da el cierre previo.</summary>
    public static MarketSummaryResponse Build(string symbol, IReadOnlyList<Day> days, IReadOnlyList<Day>? extended = null, DateTimeOffset? now = null)
    {
        var r = new MarketSummaryResponse { Symbol = symbol };
        if (days.Count == 0) return r;
        var at = now ?? DateTimeOffset.UtcNow;
        var today = days[^1];
        r.Last = today.Close; r.High = today.High; r.Low = today.Low; r.Volume = today.Volume;
        r.SessionDate = DateTimeOffset.FromUnixTimeMilliseconds(today.Time).UtcDateTime.ToString("yyyy-MM-dd");
        if (days.Count > 1 && days[^2].Close is > 0 && today.Close != null)
        {
            r.PrevClose = days[^2].Close;
            r.Change = Math.Round(today.Close.Value - r.PrevClose!.Value, 2);
            r.ChangePct = Math.Round((today.Close.Value / r.PrevClose.Value - 1) * 100, 2);
        }
        ApplyExtended(r, today, extended, at);
        return r;
    }

    /// <summary>Sesión abierta (día hábil, 09:30–16:00 ET y la última vela diaria es de hoy) y, si no, el último trade de horario extendido posterior al cierre.</summary>
    private static void ApplyExtended(MarketSummaryResponse r, Day today, IReadOnlyList<Day>? extended, DateTimeOffset now)
    {
        var zone = PremarketMath.EasternZone;
        var local = TimeZoneInfo.ConvertTime(now, zone);
        var sessionDay = DateTimeOffset.FromUnixTimeMilliseconds(today.Time).UtcDateTime.Date;
        // Los medios días de NYSE (p. ej. el viernes después de Acción de Gracias) cierran a las 13:00.
        var closeTime = NyseCalendar.Kind(DateOnly.FromDateTime(sessionDay)) == NyseDay.EarlyClose ? NyseCalendar.EarlyCloseTime : TimeSpan.FromHours(16);
        r.SessionOpen = local.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday) &&
            local.TimeOfDay >= TimeSpan.FromHours(9.5) && local.TimeOfDay < closeTime && local.Date == sessionDay;
        if (r.SessionOpen || extended == null || today.Close is not > 0) return;
        var closeAt = DateTime.SpecifyKind(sessionDay.Add(closeTime), DateTimeKind.Unspecified);
        var closeUtc = new DateTimeOffset(closeAt, zone.GetUtcOffset(closeAt));
        Day? best = null;
        foreach (var c in extended)
        {
            if (c.Close is not > 0 || c.Volume is <= 0) continue;
            var start = DateTimeOffset.FromUnixTimeMilliseconds(c.Time);
            if (start < closeUtc || start > now) continue;
            if (best == null || c.Time > best.Time) best = c;
        }
        if (best == null) return;
        var stamp = DateTimeOffset.FromUnixTimeMilliseconds(best.Time);
        var bestLocal = TimeZoneInfo.ConvertTime(stamp, zone);
        r.ExtendedLast = best.Close;
        r.ExtendedAt = stamp;
        r.ExtendedSession = bestLocal.Date == sessionDay && bestLocal.TimeOfDay >= closeTime ? "afterhours" : "premarket";
        r.ExtendedChange = Math.Round(best.Close!.Value - today.Close.Value, 2);
        r.ExtendedChangePct = Math.Round((best.Close.Value / today.Close.Value - 1) * 100, 2);
    }
}
