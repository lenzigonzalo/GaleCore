using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Tests;

/// <summary>WS-0033 — panel de rendimiento: casos conocidos, muestra chica, sin cerradas, datos faltantes.</summary>
public class ShadowPanelTests
{
    private static readonly DateTime T0 = new(2026, 9, 1, 14, 0, 0, DateTimeKind.Utc);

    private static readonly DeterministicExits Exits = new()
    {
        TakeProfit = new TakeProfitExit { PctOfCredit = 50 },
        StopLoss = new StopLossExit { PctOfCredit = 200 },
    };

    private static ShadowPosition Closed(double credit, double debit, string reason, int day,
        EntryContext? entry = null, ExitContext? exit = null) => new()
    {
        PositionId = Guid.NewGuid().ToString(), Status = "CLOSED", Symbol = "SPY", EntryCredit = credit, ExitDebit = debit,
        RealizedPnl = Math.Round((credit - debit) * 100, 2), ExitReason = reason, MaxRisk = 456, Width = 5,
        EntryAt = T0, ExitAt = T0.AddDays(day), EntryDte = 40, EntryContext = entry, ExitContext = exit,
    };

    private static ShadowPosition Open() => new()
    {
        PositionId = Guid.NewGuid().ToString(), Status = "OPEN", Symbol = "SPY", EntryCredit = 0.44, MaxRisk = 456,
        Width = 5, EntryAt = T0, EntryDte = 40,
    };

    private static SpecVersionRecord Version(string version, params ShadowPosition[] positions) => new()
    {
        ContentHash = $"sha256:a:{version}", SpecName = "a", SpecVersion = version, Positions = positions.ToList(),
    };

    private static PanelReport Panel(PanelOptions? o, DateTime now, params SpecVersionRecord[] vs) =>
        ShadowPanel.Compute("a", vs, vs.ToDictionary(v => v.ContentHash, _ => Exits), o ?? new PanelOptions(), now);

    // +22, −106, +22, +22 (días 1..4)
    private static SpecVersionRecord Known() => Version("1",
        Closed(0.44, 0.22, "TAKE_PROFIT", 1), Closed(0.44, 1.50, "STOP_LOSS", 2),
        Closed(0.44, 0.22, "TAKE_PROFIT", 3), Closed(0.44, 0.22, "TAKE_PROFIT", 4));

    [Fact]
    public void NoClosedTrades_EverythingIsNullWithAReason_NotZero()
    {
        var rep = Panel(null, T0.AddDays(5), Version("1", Open()));

        Assert.Equal(0, rep.TradesClosed);
        Assert.Equal(1, rep.TradesOpen);
        Assert.Empty(rep.Curve);
        foreach (var m in new[] { rep.RealizedPnl, rep.MaxDrawdown, rep.WinRate, rep.AvgWin, rep.AvgLoss, rep.ProfitFactor,
                     rep.Expectancy, rep.Sharpe, rep.Sortino, rep.AvgDaysHeld, rep.WorstTrade, rep.LossStreak })
        {
            Assert.Null(m.Value);
            Assert.False(string.IsNullOrEmpty(m.Reason));
        }
        Assert.Contains(rep.Notes, n => n.Contains("Sin operaciones cerradas"));
        Assert.Null(rep.Execution.AvgCrossingCost.Value);
        Assert.NotNull(rep.Regime.Reason);
    }

    [Fact]
    public void KnownCase_MetricsMatchByHand()
    {
        var rep = Panel(null, T0.AddDays(10), Known());

        Assert.Equal(4, rep.TradesClosed);
        Assert.Equal(-40, rep.RealizedPnl.Value);
        Assert.Equal(0.75, rep.WinRate.Value);
        Assert.Equal(22, rep.AvgWin.Value);
        Assert.Equal(-106, rep.AvgLoss.Value);
        Assert.Equal(0.62, rep.ProfitFactor.Value);   // 66 / 106
        Assert.Equal(-10, rep.Expectancy.Value);
        Assert.Equal(-106, rep.WorstTrade.Value);
        Assert.Equal(1, rep.LossStreak.Value);
        Assert.Equal(106, rep.MaxDrawdown.Value);     // acumulado 22 → −84
        Assert.Equal(new[] { 22.0, -84, -62, -40 }, rep.Curve.Select(c => c.Cumulative));
        Assert.Equal(2.5, rep.AvgDaysHeld.Value);
        Assert.True(rep.SmallSample);
        Assert.Contains(rep.Notes, n => n.Contains("Muestra chica"));
    }

    [Fact]
    public void SmallSample_SharpeAndSortinoAreNotReported()
    {
        var rep = Panel(null, T0.AddDays(10), Known());

        Assert.Null(rep.Sharpe.Value);
        Assert.Contains("muestra chica", rep.Sharpe.Reason);
        Assert.Null(rep.Sortino.Value);
    }

    [Fact]
    public void Ratios_WithEnoughSample_MatchByHand()
    {
        // Retornos por operación (% del riesgo máx.): 4.8, −23.2, 4.8, 4.8 → media −2.2, desvío 14, a la baja 11.6.
        var rep = Panel(new PanelOptions { MinSampleForRatios = 4 }, T0.AddDays(10), Known());

        Assert.Equal(-0.16, rep.Sharpe.Value);
        Assert.Equal(-0.19, rep.Sortino.Value);
    }

    [Fact]
    public void NoLosses_ProfitFactorAndSortinoSayWhy()
    {
        var v = Version("1", Closed(0.44, 0.22, "TAKE_PROFIT", 1), Closed(0.44, 0.22, "TAKE_PROFIT", 2));
        var rep = Panel(new PanelOptions { MinSampleForRatios = 2 }, T0.AddDays(5), v);

        Assert.Null(rep.ProfitFactor.Value);
        Assert.Contains("sin pérdidas", rep.ProfitFactor.Reason);
        Assert.Null(rep.AvgLoss.Value);
        Assert.Null(rep.Sortino.Value);
        Assert.Equal(1, rep.WinRate.Value);
    }

    [Fact]
    public void LossStreak_IsTheLongestRun()
    {
        var v = Version("1", Closed(0.44, 1.0, "STOP_LOSS", 1), Closed(0.44, 1.0, "STOP_LOSS", 2),
            Closed(0.44, 0.22, "TAKE_PROFIT", 3), Closed(0.44, 1.0, "STOP_LOSS", 4));
        Assert.Equal(2, Panel(null, T0.AddDays(9), v).LossStreak.Value);
    }

    [Fact]
    public void Filters_ByVersionAndByPeriod()
    {
        var v1 = Known();
        var v2 = Version("2", Closed(0.44, 0.22, "TAKE_PROFIT", 6));

        var byVersion = Panel(new PanelOptions { Version = "2" }, T0.AddDays(10), v1, v2);
        Assert.Equal(1, byVersion.TradesClosed);
        Assert.Equal(new[] { "2" }, byVersion.ByVersion.Select(g => g.Key));

        var window = Panel(new PanelOptions { From = T0.AddDays(3), To = T0.AddDays(5) }, T0.AddDays(10), v1, v2);
        Assert.Equal(2, window.TradesClosed);        // las de los días 3 y 4
        Assert.Equal(44, window.RealizedPnl.Value);

        var all = Panel(null, T0.AddDays(10), v1, v2);
        Assert.Equal(new[] { "1", "2" }, all.ByVersion.Select(g => g.Key));
    }

    [Fact]
    public void ByExitRule_ShowsCountsAndGapToPlan()
    {
        var rep = Panel(null, T0.AddDays(10), Known());

        var sl = rep.ByExitRule.Single(g => g.Key == "STOP_LOSS");
        Assert.Equal(1, sl.Trades);
        Assert.Equal(-18, sl.AvgGapToPlan);          // −106 contra el SL planeado de −88
        Assert.Equal(3, rep.ByExitRule.Single(g => g.Key == "TAKE_PROFIT").Trades);
    }

    private static EntryContext Entry(double vix, double? ivRank, double gex) => new()
    {
        Vix = vix, IvRank = ivRank,
        Gates = new() { new GateResult { GateId = "gex_non_negative", Status = "PASS", Value = gex } },
        Legs = new()
        {
            new LegQuoteSnapshot { Side = "SELL", Type = "PUT", Strike = 720, Bid = 0.9, Ask = 1.0 },
            new LegQuoteSnapshot { Side = "BUY", Type = "PUT", Strike = 715, Bid = 0.4, Ask = 0.5 },
        },
    };

    private static ExitContext Exit() => new()
    {
        CapturedAt = T0,
        Legs = new()
        {
            new LegQuoteSnapshot { Side = "SELL", Type = "PUT", Strike = 720, Bid = 0.9, Ask = 1.0 },
            new LegQuoteSnapshot { Side = "BUY", Type = "PUT", Strike = 715, Bid = 0.4, Ask = 0.5 },
        },
    };

    [Fact]
    public void RegimeAndExecution_UseTheSavedContext_AndCountTheTradesWithout()
    {
        var v = Version("1",
            Closed(0.44, 0.22, "TAKE_PROFIT", 1, Entry(14, 20, 50), Exit()),     // +22
            Closed(0.44, 1.50, "STOP_LOSS", 2, Entry(25, 70, -10), Exit()),       // −106
            Closed(0.44, 0.22, "TAKE_PROFIT", 3));                                // sin contexto
        var rep = Panel(null, T0.AddDays(10), v);

        Assert.Equal(1, rep.Regime.TradesWithoutContext);
        Assert.Equal(new[] { "1 · VIX < 15", "3 · VIX 20–30" }, rep.Regime.ByVix.Select(g => g.Key));
        Assert.Equal(1.0, rep.Regime.ByVix[0].WinRate);
        Assert.Equal(-106, rep.Regime.ByVix[1].RealizedPnl);
        Assert.Equal(new[] { "1 · IV Rank < 30", "3 · IV Rank ≥ 60" }, rep.Regime.ByIvRank.Select(g => g.Key));
        Assert.Equal(new[] { "GEX < 0", "GEX ≥ 0" }, rep.Regime.ByGamma.Select(g => g.Key));

        // Medio spread por pata: (0.1 + 0.1) / 2 al entrar + 0.1 al salir = 0.2 → 20 USD por operación.
        Assert.Equal(2, rep.Execution.TradesMeasured);
        Assert.Equal(1, rep.Execution.TradesWithoutQuotes);
        Assert.Equal(20, rep.Execution.AvgCrossingCost.Value);
        Assert.Equal(40, rep.Execution.TotalCrossingCost.Value);
        Assert.Equal(-84, rep.Execution.RealizedMeasured.Value);
        Assert.Equal(-124, rep.Execution.RealizedAfterCrossing.Value);
        Assert.Equal(0.5, rep.Execution.WinRateAfterCrossing.Value);   // +22−20 sigue ganando; −106−20 no
        Assert.Contains("comisiones", rep.Execution.NotIncluded);
    }

    [Fact]
    public void Regime_TradesWithoutGexGateOrQuotes_AreNotAssignedNorInvented()
    {
        var ctx = new EntryContext { Vix = 18, Gates = new(), Legs = new() };
        var rep = Panel(null, T0.AddDays(10), Version("1", Closed(0.44, 0.22, "TAKE_PROFIT", 1, ctx)));

        Assert.Single(rep.Regime.ByVix);
        Assert.Empty(rep.Regime.ByIvRank);            // sin IV Rank en el contexto
        Assert.Empty(rep.Regime.ByGamma);             // la spec no tiene gate de GEX
        Assert.Equal(0, rep.Execution.TradesMeasured);
    }

    [Fact]
    public void References_AreComparedOnlyWhenTheyArrive()
    {
        // 73 días: 4.5 % anual → 0.9 % del período. Realizado +22 sobre 10.000 → 0.22 %.
        var v = Version("1", Closed(0.44, 0.22, "TAKE_PROFIT", 10));
        var rep = Panel(new PanelOptions { ReferenceCapital = 10000, CashRatePct = 4.5 }, T0.AddDays(73), v);

        Assert.Equal(73, rep.References.PeriodDays);
        Assert.Equal(0.22, rep.References.StrategyReturnPct.Value);
        Assert.Equal(0.9, rep.References.CashReturnPct.Value);
        Assert.Equal(-0.68, rep.References.ExcessVsCashPct.Value);
        Assert.Null(rep.References.BondReturnPct.Value);
        Assert.Contains("bono a 10 años", rep.References.BondReturnPct.Reason);
        Assert.Null(rep.References.ExcessVsBondPct.Value);
        Assert.Contains("objetivo", rep.References.TargetReturnPct.Reason);
    }

    [Fact]
    public void References_WithoutCapital_StrategyReturnIsNull()
    {
        var rep = Panel(new PanelOptions { CashRatePct = 4.5 }, T0.AddDays(73), Known());
        Assert.Null(rep.References.StrategyReturnPct.Value);
        Assert.Contains("capital", rep.References.StrategyReturnPct.Reason);
    }

    [Fact]
    public void Hypothesis_IsMeasuredAgainstItsCriterion_OrSaysItIsMissing()
    {
        var no = Panel(null, T0.AddDays(10), Known());
        Assert.Null(no.Hypothesis.SampleReached);
        Assert.NotNull(no.Hypothesis.Reason);

        var notYet = Panel(new PanelOptions { HypothesisMinTrades = 30, HypothesisMinDays = 60 }, T0.AddDays(10), Known());
        Assert.Equal(4, notYet.Hypothesis.TradesClosed);
        Assert.Equal(10, notYet.Hypothesis.DaysElapsed);
        Assert.False(notYet.Hypothesis.SampleReached);

        var enough = Panel(new PanelOptions { HypothesisMinTrades = 4, HypothesisMinDays = 10 }, T0.AddDays(10), Known());
        Assert.True(enough.Hypothesis.SampleReached);
    }

    [Fact]
    public void OpenRisk_AgainstLimits_OnlyWithLimits()
    {
        var v = Version("1", Open());
        var without = Panel(null, T0.AddDays(1), v);
        Assert.Null(without.OpenRiskVsLimits);
        Assert.NotNull(without.OpenRiskVsLimitsReason);
        Assert.Equal(456, without.OpenMaxRisk);

        var limits = new CapitalLimits { Capital = 10000, ReservePct = 20, MaxRiskPerTradePct = 3, MaxOpenRiskPct = 10, MaxBetPct = 50 };
        var with = Panel(new PanelOptions { Limits = limits }, T0.AddDays(1), v);
        Assert.NotNull(with.OpenRiskVsLimits);
        Assert.Contains(with.OpenRiskVsLimits!, c => c.Limit == "open_risk" && c.Used == 456 && c.Max == 1000 && c.Ok);
        Assert.Contains(with.OpenRiskVsLimits!, c => c.Limit.StartsWith("per_trade:") && !c.Ok);   // 456 > 300
    }

    [Fact]
    public void OtherStrategies_AreNeverMixedIn()
    {
        var other = new SpecVersionRecord
        {
            ContentHash = "sha256:b:1", SpecName = "b", SpecVersion = "1",
            Positions = new() { Closed(0.44, 1.5, "STOP_LOSS", 1) },
        };
        var rep = ShadowPanel.Compute("a", new[] { Known(), other }, new Dictionary<string, DeterministicExits>(), new PanelOptions(), T0.AddDays(10));
        Assert.Equal(4, rep.TradesClosed);
        Assert.Equal("SHADOW", rep.Mode);
    }

    // WS-0036 — calendario, abiertas y cerradas para el panel del front.

    [Fact]
    public void Daily_GroupsByExitDayInNewYork_AndFollowsThePeriod()
    {
        // 01:30 UTC del 3/9 son las 21:30 ET del 2/9: cuenta para el 2/9, junto con la salida de ese día.
        var late = Closed(0.44, 0.22, "TAKE_PROFIT", 0) with { ExitAt = new DateTime(2026, 9, 3, 1, 30, 0, DateTimeKind.Utc) };
        var rep = Panel(null, T0.AddDays(10), Version("1",
            Closed(0.44, 0.22, "TAKE_PROFIT", 1), late, Closed(0.44, 1.50, "STOP_LOSS", 3)));

        Assert.Equal(new[] { "2026-09-02", "2026-09-04" }, rep.Daily.Select(d => d.Date));
        Assert.Equal(44, rep.Daily[0].Pnl);
        Assert.Equal(2, rep.Daily[0].Trades);
        Assert.Equal(-106, rep.Daily[1].Pnl);

        var period = Panel(new PanelOptions { From = T0.AddDays(2.5) }, T0.AddDays(10), Version("1",
            Closed(0.44, 0.22, "TAKE_PROFIT", 1), Closed(0.44, 1.50, "STOP_LOSS", 3)));
        Assert.Single(period.Daily);
        Assert.Equal("2026-09-04", period.Daily[0].Date);
    }

    [Fact]
    public void OpenAndClosed_AreListedWithTheirVersion_AndFollowTheVersionFilter()
    {
        var v1 = Version("1", Closed(0.44, 0.22, "TAKE_PROFIT", 1), Closed(0.44, 1.50, "STOP_LOSS", 3), Open());
        var v2 = Version("2", Closed(0.44, 0.22, "TAKE_PROFIT", 2), Open() with { UnrealizedPnl = 12, CurrentDte = 30 });

        var all = Panel(null, T0.AddDays(10), v1, v2);
        Assert.Equal(2, all.OpenPositions.Count);
        Assert.Equal(new[] { "STOP_LOSS", "TAKE_PROFIT", "TAKE_PROFIT" }, all.ClosedTrades.Select(t => t.ExitReason));
        Assert.Equal(new[] { "1", "2", "1" }, all.ClosedTrades.Select(t => t.Version));
        Assert.Equal(-106, all.ClosedTrades[0].RealizedPnl);
        Assert.Equal(3, all.ClosedTrades[0].DaysHeld);

        var only2 = Panel(new PanelOptions { Version = "2" }, T0.AddDays(10), v1, v2);
        var open = Assert.Single(only2.OpenPositions);
        Assert.Equal("2", open.Version);
        Assert.Equal(12, open.UnrealizedPnl);
        Assert.Equal(30, open.CurrentDte);
        Assert.Single(only2.ClosedTrades);
        Assert.Single(only2.Daily);
    }

    [Fact]
    public void NoClosedTrades_DailyAndClosedAreEmpty()
    {
        var rep = Panel(null, T0.AddDays(5), Version("1", Open()));
        Assert.Empty(rep.Daily);
        Assert.Empty(rep.ClosedTrades);
        Assert.Single(rep.OpenPositions);
    }
}
