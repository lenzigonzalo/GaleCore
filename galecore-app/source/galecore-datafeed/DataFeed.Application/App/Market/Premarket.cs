using System.Globalization;
using DataFeed.Infrastructure.Providers.Tastytrade;
using MediatR;
using Newtonsoft.Json.Linq;

namespace DataFeed.Application.App.Market;

public class PremarketRequest : IRequest<IReadOnlyList<PremarketQuote>>
{
    public string Symbols { get; set; } = "";
}

public class PremarketQuote
{
    public string Symbol { get; set; } = "";
    public double? Price { get; set; }
    public double? PreviousClose { get; set; }
    public string? PreviousCloseDate { get; set; }
    public double? ChangePercent { get; set; }
    public DateTimeOffset? Timestamp { get; set; }
    public string? SessionDate { get; set; }
    public string Session { get; set; } = "unavailable";
    public string Source { get; set; } = "DXLink TimeAndSale (ETH)/Summary";
    public string Freshness { get; set; } = "unavailable";
    public string? Reason { get; set; }
}

/// <summary>
/// Caché corta por símbolo del resultado de premarket. Sin trade ETH el snapshot de TimeAndSale nunca "completa"
/// y cada pedido esperaba el timeout entero; con la caché el watchlist (y pedidos repetidos o simultáneos) no
/// vuelve a esperar por símbolos ya consultados. Singleton en DI.
/// </summary>
public class PremarketCache(TimeSpan? ttl = null, TimeProvider? time = null)
{
    private readonly TimeSpan _ttl = ttl ?? TimeSpan.FromSeconds(30);
    private readonly TimeProvider _time = time ?? TimeProvider.System;
    private readonly Dictionary<string, (DateTimeOffset At, PremarketQuote Quote)> _items = new();
    private readonly object _lock = new();

    /// <summary>Un solo pedido a la fuente a la vez: el segundo ya encuentra lo que trajo el primero.</summary>
    public SemaphoreSlim Gate { get; } = new(1, 1);

    public bool TryGet(string symbol, out PremarketQuote quote)
    {
        lock (_lock)
        {
            if (_items.TryGetValue(symbol, out var hit) && _time.GetUtcNow() - hit.At < _ttl) { quote = hit.Quote; return true; }
            quote = null!;
            return false;
        }
    }

    public void Set(PremarketQuote quote)
    {
        lock (_lock)
        {
            var now = _time.GetUtcNow();
            foreach (var old in _items.Where(i => now - i.Value.At >= _ttl).Select(i => i.Key).ToArray()) _items.Remove(old);
            _items[quote.Symbol] = (now, quote);
        }
    }
}

public class PremarketHandler(IDxLinkStreamingService streaming, PremarketCache? cache = null) : IRequestHandler<PremarketRequest, IReadOnlyList<PremarketQuote>>
{
    // Ventana corta: Summary llega en cuanto se suscribe; TimeAndSale sólo completa si hubo un trade ETH.
    public static readonly TimeSpan SnapshotTimeout = TimeSpan.FromSeconds(3);
    private readonly PremarketCache _cache = cache ?? new PremarketCache();

    public async Task<IReadOnlyList<PremarketQuote>> Handle(PremarketRequest request, CancellationToken ct)
    {
        var symbols = (request.Symbols ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => s.ToUpperInvariant()).Distinct().ToArray();
        if (symbols.Length is 0 or > 30 || symbols.Any(s => s.Length > 24 || s.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '.' && c != '/' && c != '-')))
            throw new DataFeed.Application.Shared.ValidationException("Entre 1 y 30 símbolos válidos requeridos.");
        await _cache.Gate.WaitAsync(ct);
        try
        {
            var missing = symbols.Where(s => !_cache.TryGet(s, out _)).ToArray();
            if (missing.Length > 0)
            {
                var subscriptions = missing.SelectMany(s => new[] { (s, "TimeAndSale", (long?)null), (s, "Summary", (long?)null) }).ToArray();
                var events = await streaming.RequestSnapshotAsync(subscriptions,
                    e => (string?)e["eventType"] != "TimeAndSale" || PremarketMath.IsEligibleSale(e), SnapshotTimeout, ct);
                ct.ThrowIfCancellationRequested();
                var now = DateTimeOffset.UtcNow;
                foreach (var s in missing)
                    _cache.Set(PremarketMath.FromSales(s,
                        events.Where(e => (string?)e["eventSymbol"] == s && (string?)e["eventType"] == "TimeAndSale"),
                        events.LastOrDefault(e => (string?)e["eventSymbol"] == s && (string?)e["eventType"] == "Summary"), now));
            }
            return symbols.Select(s => _cache.TryGet(s, out var q) ? q : new PremarketQuote { Symbol = s, Reason = "missing_extended_hours" }).ToArray();
        }
        finally { _cache.Gate.Release(); }
    }
}

public static class PremarketMath
{
    private static readonly TimeZoneInfo Eastern = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");

    // Trade retains the regular-session last price even while ETH volume updates.
    // TimeAndSale provides actual ETH executions; cancellations replace the same index.
    public static bool IsEligibleSale(JObject sale) => (string?)sale["eventType"] == "TimeAndSale" &&
        sale["index"]?.Type == JTokenType.Integer && (int?)sale["eventFlags"] == 0 &&
        sale["extendedTradingHours"]?.Type == JTokenType.Boolean && sale.Value<bool>("extendedTradingHours") &&
        sale["validTick"]?.Type == JTokenType.Boolean && sale.Value<bool>("validTick") &&
        sale["spreadLeg"]?.Type == JTokenType.Boolean && !sale.Value<bool>("spreadLeg") &&
        (string?)sale["type"] is "NEW" or "CORRECTION";

    public static JObject? LatestSale(IEnumerable<JObject> sales) => sales
        .GroupBy(e => (long?)e["index"]).Select(g => g.Last()).Where(IsEligibleSale)
        .OrderByDescending(e => Number(e["time"]) ?? 0).FirstOrDefault();

    public static PremarketQuote FromSales(string symbol, IEnumerable<JObject> sales, JObject? summary, DateTimeOffset now)
    {
        var items = sales.ToArray();
        var quote = Build(symbol, LatestSale(items), summary, now);
        if (quote.Price == null && items.Any(e => (string?)e["type"] is "CANCEL" or "CORRECTION" || (((int?)e["eventFlags"] ?? 0) & 2) != 0))
            quote.Reason = "execution_revised";
        return quote;
    }

    public static PremarketQuote Build(string symbol, JObject? trade, JObject? summary, DateTimeOffset now)
    {
        var result = new PremarketQuote { Symbol = symbol, Reason = "missing_extended_hours" };
        if (trade == null || !IsEligibleSale(trade)) return result;
        var price = Number(trade?["price"]);
        var time = Number(trade?["time"]);
        if (price is not > 0 || time is not > 0 || time > DateTimeOffset.MaxValue.ToUnixTimeMilliseconds()) return result;
        var stamp = DateTimeOffset.FromUnixTimeMilliseconds((long)time.Value);
        var local = TimeZoneInfo.ConvertTime(stamp, Eastern);
        var today = TimeZoneInfo.ConvertTime(now, Eastern);
        if (stamp > now.AddMinutes(1) || local.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday ||
            local.TimeOfDay < TimeSpan.FromHours(4) || local.TimeOfDay >= TimeSpan.FromHours(9.5))
        {
            result.Reason = "not_premarket_trade";
            return result;
        }
        result.Price = price;
        result.Timestamp = stamp;
        result.Session = "premarket";
        result.SessionDate = local.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        result.Freshness = local.Date == today.Date && today.TimeOfDay < TimeSpan.FromHours(9.5) &&
            now - stamp <= TimeSpan.FromMinutes(15) ? "fresh" : "stale";
        // A reference is usable only when Summary identifies the same trading date.
        // A daily candle's previous bar can be two sessions back before the open.
        var expectedDay = (local.Date - DateTime.UnixEpoch.Date).Days;
        var summaryDay = Number(summary?["dayId"]);
        var previousDay = Number(summary?["prevDayId"]);
        var previousClose = Number(summary?["prevDayClosePrice"]);
        if (summaryDay != expectedDay || previousDay == null || previousDay >= expectedDay ||
            previousDay < expectedDay - 7 || previousClose is not > 0)
        {
            result.Reason = "missing_previous_regular_close";
            return result;
        }
        result.PreviousClose = previousClose;
        result.PreviousCloseDate = DateTime.UnixEpoch.AddDays(previousDay.Value).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        result.ChangePercent = Math.Round((price.Value / previousClose.Value - 1) * 100, 2);
        result.Reason = result.Freshness == "stale" ? "stale_premarket" : null;
        return result;
    }

    private static double? Number(JToken? token) => double.TryParse(
        token?.Type is JTokenType.Integer or JTokenType.Float ? token.ToString(Newtonsoft.Json.Formatting.None) : token?.ToString(), NumberStyles.Float,
        CultureInfo.InvariantCulture, out var number) && double.IsFinite(number) ? number : null;
}
