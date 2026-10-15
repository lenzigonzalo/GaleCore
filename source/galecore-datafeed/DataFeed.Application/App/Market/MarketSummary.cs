using System.Globalization;
using DataFeed.Infrastructure.Providers.Tastytrade;
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
}

public class MarketSummaryHandler(IDxLinkStreamingService streaming) : IRequestHandler<MarketSummaryRequest, MarketSummaryResponse>
{
    public async Task<MarketSummaryResponse> Handle(MarketSummaryRequest request, CancellationToken ct)
    {
        var symbol = (request.Symbol ?? "").Trim().ToUpperInvariant();
        if (symbol.Length == 0 || symbol.Length > 24) throw new DataFeed.Application.Shared.ValidationException("Símbolo inválido.");
        var key = symbol + "{=d}";
        var from = new DateTimeOffset(DateTime.UtcNow.Date.AddDays(-10)).ToUnixTimeMilliseconds();
        var candles = await streaming.RequestSnapshotAsync(new[] { (key, "Candle", (long?)from) },
            isSymbolComplete: item => (((int?)item["eventFlags"] ?? 0) & 0x18) != 0, timeout: TimeSpan.FromSeconds(8), cancellationToken: ct);
        var days = candles.Where(c => (string?)c["eventSymbol"] == key)
            .Select(c => new Day((long?)c["time"] ?? 0, Num(c["close"]), Num(c["high"]), Num(c["low"]), Num(c["volume"])))
            .Where(d => d.Time > 0 && d.Close is > 0).GroupBy(d => d.Time).Select(g => g.Last()).OrderBy(d => d.Time).ToList();
        return MarketSummaryMath.Build(symbol, days);
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
    public static MarketSummaryResponse Build(string symbol, IReadOnlyList<Day> days)
    {
        var r = new MarketSummaryResponse { Symbol = symbol };
        if (days.Count == 0) return r;
        var today = days[^1];
        r.Last = today.Close; r.High = today.High; r.Low = today.Low; r.Volume = today.Volume;
        r.SessionDate = DateTimeOffset.FromUnixTimeMilliseconds(today.Time).UtcDateTime.ToString("yyyy-MM-dd");
        if (days.Count > 1 && days[^2].Close is > 0 && today.Close != null)
        {
            r.PrevClose = days[^2].Close;
            r.Change = Math.Round(today.Close.Value - r.PrevClose!.Value, 2);
            r.ChangePct = Math.Round((today.Close.Value / r.PrevClose.Value - 1) * 100, 2);
        }
        return r;
    }
}
