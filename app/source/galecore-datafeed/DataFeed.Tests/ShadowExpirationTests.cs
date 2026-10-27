using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Application.Data.Tastytrade.MarketDataCandle;

namespace DataFeed.Tests;

/// <summary>
/// WS-0062 inc.3 — vencimiento y liquidación: intrínseco con el cierre oficial del día, sólo la orden de entrada,
/// «pendiente de liquidar» sin cierre, nada antes de las 16:00 NY, acciones no vencen.
/// </summary>
[Collection("RuntimeStaticCaches")]
public class ShadowExpirationTests
{
    private static readonly DateTime After = new(2026, 9, 24, 20, 30, 0, DateTimeKind.Utc);   // 16:30 ET (EDT)
    private static readonly DateTime Before = new(2026, 9, 24, 19, 59, 0, DateTimeKind.Utc);  // 15:59 ET
    private static readonly DateTime ExpDate = new(2026, 9, 24);

    private sealed class CloseData : IRuntimeMarketData
    {
        public double? Close;
        public bool Throws;
        public int CloseCalls, QuoteCalls;
        public Task<Dictionary<string, double?>> ResolveMetricsAsync(IEnumerable<string> r, DateTime n, TimeSpan? m, CancellationToken ct)
            => Task.FromResult(r.ToDictionary(x => x, _ => (double?)null));
        public Task<CandidateBuildResult> BuildCandidateAsync(StrategyInstance i, StrategySpec s, string sym, double? v, DateTime n, CancellationToken ct)
            => Task.FromResult(CandidateBuildResult.Rejected("n/a"));
        public Task<LegQuote?> GetQuoteAsync(string s, CancellationToken ct) { QuoteCalls++; return Task.FromResult<LegQuote?>(new LegQuote(1, 1.1, After)); }
        public Task<double?> GetOfficialCloseAsync(string symbol, DateTime d, CancellationToken ct)
        {
            CloseCalls++;
            if (Throws) throw new InvalidOperationException("velas caídas");
            return Task.FromResult(Close);
        }
    }

    private static ShadowLeg Leg(string side, string type, double strike, string occRoot = "SPXW") => new()
    {
        Side = side, Type = type, Strike = strike, Expiration = "2026-09-24",
        OccSymbol = occRoot.PadRight(6) + "260924" + type[0] + ((int)(strike * 1000)).ToString("D8"),
        StreamerSymbol = "." + occRoot + "260924" + type[0] + strike,
    };

    private static ShadowPosition Condor(string root = "SPXW") => new()
    {
        PositionId = "p-1", InstanceId = "i-1", Symbol = "SPX", Structure = RuntimeStructures.IronCondor, Status = "OPEN",
        EntryCredit = 2.00, Width = 5, MaxRisk = 300, EntryDte = 0, EntryAt = Before.AddHours(-5),
        Legs = new() { Leg("SELL", "PUT", 100, root), Leg("BUY", "PUT", 95, root), Leg("SELL", "CALL", 110, root), Leg("BUY", "CALL", 115, root) },
        EntryContext = new EntryContext { Execution = new ExecutionTerms { Fill = ExecutionTerms.Mid, PerContractUsd = 1, CostsDeclared = true } },
    };

    private static async Task<(ShadowRuntimeStore Store, string Outcome)> Run(ShadowPosition pos, CloseData data, DateTime now)
    {
        var (store, _) = ShadowRuntimeEngineTests.NewRuntime();
        store.AddPosition(pos);
        var outcome = await ShadowRuntimeEngine.ValuePositionAsync(
            store, data, pos, ShadowRuntimeEngineTests.Spec().Exits.Deterministic, now, default);
        return (store, outcome);
    }

    [Theory]
    [InlineData(105.0, 0.0, 196.0)]     // dentro de las vendidas: ganancia máxima (200 − 4 de entrada)
    [InlineData(120.0, 5.0, -304.0)]    // fuera de un ala: pérdida máxima (−300 − 4)
    [InlineData(80.0, 5.0, -304.0)]
    [InlineData(111.0, 1.0, 96.0)]      // entre la vendida y la comprada: parcial (100 − 4)
    public async Task Expired_SettlesAtIntrinsic_ChargingOnlyTheEntryOrder(double close, double debit, double net)
    {
        var data = new CloseData { Close = close };

        var (store, outcome) = await Run(Condor(), data, After);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed, outcome);
        var p = store.GetPosition("p-1")!;
        Assert.Equal("CLOSED", p.Status);
        Assert.Equal("EXPIRATION", p.ExitReason);
        Assert.Equal(debit, p.ExitDebit);
        Assert.Equal(net, p.RealizedPnl);
        Assert.Equal(4.00, ShadowFillSimulator.Costs(p));                 // sólo la entrada
        Assert.Equal(net + 4.00, ShadowFillSimulator.GrossOf(p));
        Assert.Equal(0, data.QuoteCalls);                                   // no se miran cotizaciones de opciones vencidas
        Assert.Contains(store.GetEvents("i-1"), e => e.EventType == "POSITION_CLOSED" && (string)e.Payload["exit_reason"]! == "EXPIRATION");
    }

    [Fact]
    public async Task NoCloseOfTheDay_StaysOpen_PendingSettlement_NoPnl_NoQuotes()
    {
        var data = new CloseData { Close = null };

        var (store, outcome) = await Run(Condor(), data, After);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.NoData, outcome);
        var p = store.GetPosition("p-1")!;
        Assert.Equal("OPEN", p.Status);
        Assert.Null(p.RealizedPnl);
        Assert.Null(p.UnrealizedPnl);
        Assert.Contains("pendiente de liquidar", Assert.Single(p.ValuationProblems!));
        Assert.Equal(0, data.QuoteCalls);
    }

    [Fact]
    public async Task CloseProviderThrows_StaysPending()
    {
        var (store, outcome) = await Run(Condor(), new CloseData { Throws = true }, After);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.NoData, outcome);
        Assert.Equal("OPEN", store.GetPosition("p-1")!.Status);
        Assert.Contains("velas caídas", store.GetPosition("p-1")!.ValuationProblems![0]);
    }

    [Fact]
    public async Task AmSettledRoot_StaysPending_WithoutAskingForTheClose()
    {
        var data = new CloseData { Close = 105 };

        var (store, outcome) = await Run(Condor("SPX"), data, After);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.NoData, outcome);
        Assert.Equal("OPEN", store.GetPosition("p-1")!.Status);
        Assert.Contains("AM", store.GetPosition("p-1")!.ValuationProblems![0]);
        Assert.Equal(0, data.CloseCalls);
    }

    [Fact]
    public async Task Before1615NewYork_DoesNotSettle_From1615_Does()
    {
        var data = new CloseData { Close = 105 };
        var (store, _) = await Run(Condor(), data, Before);
        Assert.NotEqual("EXPIRATION", store.GetPosition("p-1")!.ExitReason);

        (store, _) = await Run(Condor(), data, new DateTime(2026, 9, 24, 20, 10, 0, DateTimeKind.Utc));   // 16:10 ET
        Assert.NotEqual("EXPIRATION", store.GetPosition("p-1")!.ExitReason);
        Assert.Equal(0, data.CloseCalls);

        (store, _) = await Run(Condor(), data, new DateTime(2026, 9, 24, 20, 15, 0, DateTimeKind.Utc));   // 16:15 ET
        Assert.Equal("EXPIRATION", store.GetPosition("p-1")!.ExitReason);
    }

    [Fact]
    public void LongEquity_DoesNotExpire()
    {
        var pos = new ShadowPosition
        {
            PositionId = "p-1", InstanceId = "i-1", Symbol = "AAPL", Structure = RuntimeStructures.LongEquity, Status = "OPEN",
            Legs = new() { new ShadowLeg { Side = "BUY", Type = "STOCK", Strike = 0, Expiration = "2026-09-24", Quantity = 10 } },
        };
        Assert.Null(Expiry.SettlementDue(pos, After));
    }

    [Fact]
    public void OfficialClose_OnlyTheCandleOfThatDate()
    {
        static long Ms(DateTime d) => new DateTimeOffset(d, TimeSpan.Zero).ToUnixTimeMilliseconds();
        var candles = new List<CandleData>
        {
            new() { Time = Ms(new DateTime(2026, 9, 23, 4, 0, 0, DateTimeKind.Utc)), Close = 99 },
            new() { Time = Ms(new DateTime(2026, 9, 24, 4, 0, 0, DateTimeKind.Utc)), Close = 105.5 },
        };
        Assert.Equal(105.5, OfficialClose.FromCandles(candles, ExpDate));
        Assert.Null(OfficialClose.FromCandles(candles, new DateTime(2026, 9, 25)));          // no se usa la del día anterior
        Assert.Null(OfficialClose.FromCandles(new List<CandleData> { new() { Time = Ms(ExpDate), Close = 0 } }, ExpDate));   // nunca 0
        Assert.Null(OfficialClose.FromCandles(null, ExpDate));
    }
}
