using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Tests;

/// <summary>WS-0061 inc.3 — cómo se lee long_equity en el panel SHADOW y en capital; los spreads no cambian.</summary>
public class LongEquityPanelTests
{
    private static readonly DateTime T0 = new(2026, 10, 1, 14, 0, 0, DateTimeKind.Utc);

    private static LegQuoteSnapshot Quote(double bid, double ask) =>
        new() { Side = "BUY", Type = "STOCK", Bid = bid, Ask = ask };

    private static ShadowPosition Stock(string id, string status, string? reason = null) => new()
    {
        PositionId = id, Status = status, Symbol = "AAPL", Structure = "long_equity",
        Legs = new() { new ShadowLeg { Side = "BUY", Type = "STOCK", EntryPrice = 270, Quantity = 10 } },
        EntryCredit = -270, MaxRisk = 2700, Width = 0, EntryDte = 0, EntryAt = T0,
        ExitDebit = status == "CLOSED" ? -265 : null, ExitAt = status == "CLOSED" ? T0.AddDays(5) : null,
        ExitReason = reason, RealizedPnl = status == "CLOSED" ? -50 : null,
        LastSpreadValue = status == "OPEN" ? -272 : null, UnrealizedPnl = status == "OPEN" ? 20 : null,
        EntryContext = new EntryContext { Legs = new() { Quote(269.9, 270.1) } },
        ExitContext = status == "CLOSED" ? new ExitContext { Dte = null, Legs = new() { Quote(264.9, 265.1) } } : null,
    };

    private static SpecVersionRecord Rec(params ShadowPosition[] ps) =>
        new() { ContentHash = "h", SpecName = "aapl", SpecVersion = "1", Positions = ps.ToList() };

    private static PanelReport Panel(params ShadowPosition[] ps) => ShadowPanel.Compute("aapl", new[] { Rec(ps) },
        new Dictionary<string, DeterministicExits>(), new PanelOptions(), T0.AddDays(10));

    [Fact]
    public void LegsText_ReadsAsBuyTenAapl_AndOptionsKeepTheirFormat()
    {
        Assert.Equal("BUY 10 AAPL", ShadowPerformance.LegsText(Stock("a", "OPEN")));
        var pcs = new ShadowPosition
        {
            Symbol = "SPY", Structure = "put_credit_spread",
            Legs = new() { new ShadowLeg { Side = "SELL", Type = "PUT", Strike = 580, Expiration = "2026-11-20" },
                           new ShadowLeg { Side = "BUY", Type = "PUT", Strike = 575, Expiration = "2026-11-20" } },
        };
        Assert.Equal("SELL PUT 580 2026-11-20 / BUY PUT 575 2026-11-20", ShadowPerformance.LegsText(pcs));
    }

    [Fact]
    public void OpenRow_ExposesPricePerShareSharesAndCost_WithoutDteOrWidth()
    {
        var row = Assert.Single(Panel(Stock("a", "OPEN")).OpenPositions);
        Assert.Equal("BUY 10 AAPL", row.Legs);
        Assert.Equal((10, 270.0, 272.0, 2700.0), (row.Shares, row.EntryPrice, row.LastPrice, row.Cost));
        Assert.Equal(-270, row.EntryCredit);          // el contrato histórico no cambia
        Assert.Null(row.EntryDte);
        Assert.Null(row.CurrentDte);
    }

    [Fact]
    public void ClosedRow_ExposesEntryAndExitPrice_PositiveAndNoDte()
    {
        var panel = Panel(Stock("a", "CLOSED", "METRIC_EXIT"));
        var row = Assert.Single(panel.ClosedTrades);
        Assert.Equal((10, 270.0, 265.0, 2700.0), (row.Shares, row.EntryPrice, row.ExitPrice, row.Cost));
        Assert.Equal((-270.0, -265.0), (row.EntryCredit, (double)row.ExitDebit!));
        Assert.Null(row.ExitDte);
        Assert.Equal("BUY 10 AAPL", row.Legs);
    }

    [Fact]
    public void ExecutionCost_UsesSharesAsMultiplier()
    {
        // Medio spread de 0,2 = 0,1 por acción en la entrada y 0,1 en la salida → 0,2 × 10 acciones = 2 USD (no 20).
        var panel = Panel(Stock("a", "CLOSED", "METRIC_EXIT"));
        Assert.Equal(1, panel.Execution.TradesMeasured);
        Assert.Equal(2.0, panel.Execution.TotalCrossingCost.Value);
    }

    [Fact]
    public void ExecutionCost_ForSpreadsStaysTimes100()
    {
        var pcs = Stock("s", "CLOSED", "TAKE_PROFIT") with
        {
            Structure = "put_credit_spread",
            Legs = new() { new ShadowLeg { Side = "SELL", Type = "PUT", Strike = 580, Expiration = "2026-11-20" } },
            EntryDte = 30,
        };
        var panel = Panel(pcs);
        Assert.Equal(20.0, panel.Execution.TotalCrossingCost.Value);
    }

    [Fact]
    public void Summaries_CountMetricExitByName_NotAsOther()
    {
        var recs = new[] { Rec(Stock("a", "CLOSED", "METRIC_EXIT"), Stock("b", "CLOSED", "TIME_EXIT")) };
        var s = Assert.Single(ShadowPanel.Summaries(recs, new Dictionary<string, DeterministicExits>(), T0.AddDays(10)));
        Assert.Equal((1, 1, 0, 0), (s.MetricExits, s.OtherExits, s.TakeProfitExits, s.StopLossExits));
    }

    [Fact]
    public void Capital_EquityHasItsOwnReading_AndSpreadsAreUntouched()
    {
        Assert.Equal("bullish", ShadowCapital.Direction("long_equity"));
        Assert.Equal("unknown", ShadowCapital.Direction("otra"));

        var terms = new StrategyTerms
        {
            SpecName = "aapl", SpecVersion = "1", Symbol = "AAPL", Structure = "long_equity",
            Observed = new() { Stock("a", "OPEN") },
        };
        var limits = new CapitalLimits { Capital = 10000, ReservePct = 10, MaxRiskPerTradePct = 5, MaxOpenRiskPct = 50, MaxBetPct = 30 };
        var plan = ShadowCapital.Allocate(new[] { terms }, limits, T0);
        var a = Assert.Single(plan.Strategies);
        Assert.Equal("equity_not_applicable", a.BindingLimit);
        Assert.False(a.Fits);
        Assert.Null(a.AvgCredit);
        Assert.Null(a.RiskPerContract);
        Assert.Empty(plan.Ladder);

        var exposure = ShadowCapital.Exposure(new[] { Rec(Stock("a", "OPEN")) }, limits, T0);
        Assert.Equal(2700, exposure.OpenMaxRisk);
        Assert.Equal("AAPL bullish ?", Assert.Single(exposure.Bets).Key);
    }
}
