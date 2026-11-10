using DataFeed.Application.App.Market;
using DataFeed.Infrastructure.Providers.Tastytrade;
using Newtonsoft.Json.Linq;

namespace DataFeed.Tests;

public class PremarketTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-30T12:00:00Z");
    private static JObject Trade(string timestamp = "2026-10-30T11:58:00Z", double price = 99) => new()
    {
        ["eventType"] = "TradeETH", ["eventSymbol"] = "SPY",
        ["price"] = price, ["time"] = DateTimeOffset.Parse(timestamp).ToUnixTimeMilliseconds(),
    };
    private static JObject Summary() => new()
    {
        ["dayId"] = (Now.Date - DateTime.UnixEpoch.Date).Days,
        ["prevDayId"] = (Now.Date - DateTime.UnixEpoch.Date).Days - 1,
        ["prevDayClosePrice"] = 100,
    };

    [Fact]
    public void Fresh_premarket_uses_dated_previous_regular_close()
    {
        var quote = PremarketMath.Build("SPY", Trade(), Summary(), Now);
        Assert.Equal(99, quote.Price);
        Assert.Equal(100, quote.PreviousClose);
        Assert.Equal("2026-10-29", quote.PreviousCloseDate);
        Assert.Equal(-1, quote.ChangePercent);
        Assert.Equal("premarket", quote.Session);
        Assert.Equal("2026-10-30", quote.SessionDate);
        Assert.Equal("fresh", quote.Freshness);
        Assert.Null(quote.Reason);
    }

    [Fact]
    public void Fractional_prices_are_independent_of_machine_culture()
    {
        var quote = PremarketMath.Build("SPY", Trade(price: 99.25), Summary(), Now);
        Assert.Equal(99.25, quote.Price);
        Assert.Equal(-0.75, quote.ChangePercent);
    }

    [Fact]
    public void Missing_event_and_missing_reference_never_imply_zero()
    {
        var missing = PremarketMath.Build("SPY", null, Summary(), Now);
        Assert.Null(missing.Price);
        Assert.Null(missing.ChangePercent);
        Assert.Equal("unavailable", missing.Session);
        var noClose = PremarketMath.Build("SPY", Trade(), null, Now);
        Assert.Equal(99, noClose.Price);
        Assert.Null(noClose.ChangePercent);
        Assert.Equal("missing_previous_regular_close", noClose.Reason);
        var yesterday = Summary();
        yesterday["dayId"] = yesterday.Value<int>("dayId") - 1;
        Assert.Null(PremarketMath.Build("SPY", Trade(), yesterday, Now).ChangePercent);
    }

    [Theory]
    [InlineData("2026-10-30T12:01:01Z")]
    [InlineData("2026-10-30T13:30:00Z")]
    [InlineData("2026-10-30T07:59:59Z")]
    [InlineData("2026-10-31T12:00:00Z")]
    public void Future_regular_overnight_and_weekend_events_are_unavailable(string timestamp)
    {
        Assert.Null(PremarketMath.Build("SPY", Trade(timestamp), Summary(), Now).Price);
    }

    [Fact]
    public void Older_event_and_market_open_are_stale()
    {
        Assert.Equal("stale", PremarketMath.Build("SPY", Trade("2026-10-30T11:44:59Z"), Summary(), Now).Freshness);
        Assert.Equal("stale", PremarketMath.Build("SPY", Trade(), Summary(), Now.AddHours(2)).Freshness);
        Assert.Equal("stale", PremarketMath.Build("SPY", Trade(), Summary(), Now.AddDays(3)).Freshness);
    }

    [Theory]
    [InlineData("2026-10-30T08:00:00Z", "2026-10-30T08:00:01Z")]
    [InlineData("2026-11-02T09:00:00Z", "2026-11-02T09:00:01Z")]
    public void Premarket_open_uses_eastern_daylight_saving_time(string timestamp, string now)
    {
        var quote = PremarketMath.Build("SPY", Trade(timestamp), null, DateTimeOffset.Parse(now));
        Assert.Equal("premarket", quote.Session);
        Assert.Equal("fresh", quote.Freshness);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    public void Invalid_prices_are_unavailable(double price)
    {
        Assert.Null(PremarketMath.Build("SPY", Trade(price: price), Summary(), Now).Price);
    }

    [Fact]
    public async Task Handler_batches_distinct_symbols_and_ignores_regular_trades()
    {
        var feed = new SnapshotFeed();
        var response = await new PremarketHandler(feed).Handle(new PremarketRequest { Symbols = " spy,SPY, googl " }, default);
        Assert.Equal(new[] { "SPY", "GOOGL" }, response.Select(q => q.Symbol));
        Assert.Equal(4, feed.Subscriptions.Count);
        Assert.All(feed.Subscriptions, s => Assert.Contains(s.EventType, new[] { "Candle", "Summary" }));
        Assert.All(response, q => Assert.Null(q.Price));
    }

    [Fact]
    public async Task Handler_uses_short_window_and_cache_avoids_repeating_the_wait()
    {
        var feed = new SnapshotFeed();
        var cache = new PremarketCache();
        var handler = new PremarketHandler(feed, cache);
        await handler.Handle(new PremarketRequest { Symbols = "SPY,QQQ" }, default);
        Assert.Equal(PremarketHandler.SnapshotTimeout, feed.LastTimeout);
        Assert.True(PremarketHandler.SnapshotTimeout <= TimeSpan.FromSeconds(4));
        Assert.Equal(1, feed.Calls);
        await handler.Handle(new PremarketRequest { Symbols = "QQQ,SPY" }, default);
        Assert.Equal(1, feed.Calls);
        await handler.Handle(new PremarketRequest { Symbols = "SPY,IWM" }, default);
        Assert.Equal(2, feed.Calls);
        Assert.Equal(new[] { "IWM{=1m,tho=false}", "IWM" }, feed.Subscriptions.Select(s => s.Symbol));
    }

    [Fact]
    public async Task Cache_expires_after_ttl_and_concurrent_requests_share_one_fetch()
    {
        var feed = new SnapshotFeed();
        var time = new ManualTime();
        var handler = new PremarketHandler(feed, new PremarketCache(TimeSpan.FromSeconds(30), time));
        await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => handler.Handle(new PremarketRequest { Symbols = "SPY" }, default)));
        Assert.Equal(1, feed.Calls);
        time.Now = time.Now.AddSeconds(31);
        await handler.Handle(new PremarketRequest { Symbols = "SPY" }, default);
        Assert.Equal(2, feed.Calls);
    }

    private sealed class ManualTime : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 11, 3, 12, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    [Theory]
    [InlineData("")]
    [InlineData("SPY{=d}")]
    [InlineData("SPY,INVALID SYMBOL")]
    public async Task Invalid_symbols_do_not_contact_source(string symbols)
    {
        var feed = new SnapshotFeed();
        await Assert.ThrowsAsync<DataFeed.Application.Shared.ValidationException>(() =>
            new PremarketHandler(feed).Handle(new PremarketRequest { Symbols = symbols }, default));
        Assert.Empty(feed.Subscriptions);
    }

    [Fact]
    public void Eth_trade_computes_change_against_dated_reference()
    {
        var sale = Trade("2026-10-30T13:11:35.916Z", 761.03);
        var summary = Summary(); summary["prevDayClosePrice"] = 769.36;
        var quote = PremarketMath.Build("SPY", sale, summary, DateTimeOffset.Parse("2026-10-30T13:11:36Z"));
        Assert.Equal(761.03, quote.Price);
        Assert.Equal(-1.08, quote.ChangePercent);
        Assert.Equal("fresh", quote.Freshness);
    }

    [Fact]
    public void Previous_friday_close_is_usable_on_monday_but_missing_reference_stays_null()
    {
        var monday = DateTimeOffset.Parse("2026-11-02T13:00:00Z");
        var reference = new JObject { ["dayId"] = 20759, ["prevDayId"] = 20756, ["prevDayClosePrice"] = 100 };
        var quote = PremarketMath.Build("SPY", Trade("2026-11-02T12:58:00Z"), reference, monday);
        Assert.Equal("2026-10-30", quote.PreviousCloseDate);
        Assert.Equal(-1, quote.ChangePercent);
        reference["prevDayClosePrice"] = "NaN";
        Assert.Null(PremarketMath.Build("SPY", Trade("2026-11-02T12:58:00Z"), reference, monday).ChangePercent);
    }

    private static JObject Candle(string ts, double close, double? volume = 10) => new()
    {
        ["eventType"] = "Candle", ["eventSymbol"] = "SPY{=m,tho=false}", ["eventFlags"] = 0,
        ["time"] = DateTimeOffset.Parse(ts).ToUnixTimeMilliseconds(), ["close"] = close, ["volume"] = volume,
    };

    [Fact]
    public void Latest_candle_with_volume_in_window_is_used()
    {
        var c = PremarketMath.LatestCandle([Candle("2026-10-30T11:50:00Z", 98), Candle("2026-10-30T11:57:00Z", 99),
            Candle("2026-10-30T11:58:00Z", 99.5, 0), Candle("2026-10-30T13:40:00Z", 120), Candle("2026-10-29T11:57:00Z", 50)], Now);
        Assert.Equal(99, c!.Value<double>("price"));
        Assert.Null(PremarketMath.LatestCandle([Candle("2026-10-30T11:58:00Z", 99, 0)], Now));
    }

    [Fact]
    public async Task Handler_builds_quotes_from_candle_and_summary_and_completes_on_snapshot_end()
    {
        var sum = new JObject(Summary()) { ["eventType"] = "Summary", ["eventSymbol"] = "SPY" };
        var feed = new SnapshotFeed { Events = [Candle("2026-10-30T11:57:00Z", 99), sum] };
        var q = (await new PremarketHandler(feed, new PremarketCache(null, new FixedNow())).Handle(new PremarketRequest { Symbols = "SPY" }, default)).Single();
        Assert.Equal(99, q.Price);
        Assert.Equal("DXLink Candle 1m ETH/Summary", q.Source);
        Assert.Contains(feed.Subscriptions, s => s.Symbol == "SPY{=1m,tho=false}" && s.EventType == "Candle" && s.FromTime > 0);
        Assert.False(feed.Complete!(Candle("2026-10-30T11:57:00Z", 99)));
        Assert.True(feed.Complete!(new JObject { ["eventType"] = "Candle", ["eventFlags"] = 0x8 }));
        Assert.True(feed.Complete!(sum));
    }

    private sealed class FixedNow : TimeProvider { public override DateTimeOffset GetUtcNow() => Now; }

    private sealed class SnapshotFeed : IDxLinkStreamingService
    {
        public IReadOnlyList<(string Symbol, string EventType, long? FromTime)> Subscriptions { get; private set; } = [];
        public TimeSpan LastTimeout { get; private set; }
        public int Calls { get; private set; }
        public IReadOnlyList<JObject>? Events { get; init; }
        public Func<JObject, bool>? Complete { get; private set; }
        public Task<IReadOnlyList<JObject>> RequestSnapshotAsync(IReadOnlyList<(string Symbol, string EventType, long? FromTime)> subs,
            Func<JObject, bool> isSymbolComplete, TimeSpan timeout, CancellationToken cancellationToken)
        {
            Complete = isSymbolComplete; Subscriptions = subs; LastTimeout = timeout; Calls++;
            if (Events != null) return Task.FromResult(Events);
            return Task.FromResult<IReadOnlyList<JObject>>([new JObject { ["eventSymbol"] = "SPY", ["eventType"] = "Trade", ["price"] = 500 }]);
        }
        public Task SubscribeAsync(string symbol, string[] eventTypes) => throw new NotSupportedException();
        public Task UnsubscribeAsync(string symbol, string[] eventTypes) => throw new NotSupportedException();
        public Task SubscribeBatchAsync(IEnumerable<string> symbols, string[] eventTypes) => throw new NotSupportedException();
        public Task UnsubscribeBatchAsync(IEnumerable<string> symbols, string[] eventTypes) => throw new NotSupportedException();
    }
}
