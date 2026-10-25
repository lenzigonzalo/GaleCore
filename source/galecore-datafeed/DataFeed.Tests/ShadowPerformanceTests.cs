using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Tests;

/// <summary>P1-03 — performance por estrategia, versión y regla; cartera contra capital; revisión por operación.</summary>
public class ShadowPerformanceTests
{
    private static readonly DateTime T0 = new(2026, 9, 1, 14, 0, 0, DateTimeKind.Utc);

    private static readonly DeterministicExits Exits = new()
    {
        TakeProfit = new TakeProfitExit { PctOfCredit = 50 },
        StopLoss = new StopLossExit { PctOfCredit = 200 },
        TimeExit = new TimeExit { MaxDte = 21 },
    };

    private static ShadowPosition Closed(double credit, double debit, string reason, int day, double maxRisk = 456) => new()
    {
        PositionId = Guid.NewGuid().ToString(), Status = "CLOSED", Symbol = "SPY", EntryCredit = credit, ExitDebit = debit,
        RealizedPnl = Math.Round((credit - debit) * 100, 2), ExitReason = reason, MaxRisk = maxRisk, Width = 5,
        EntryAt = T0, ExitAt = T0.AddDays(day), EntryDte = 40,
    };

    private static SpecVersionRecord Version(string name, string version, params ShadowPosition[] positions) => new()
    {
        ContentHash = $"sha256:{name}:{version}", SpecName = name, SpecVersion = version, Positions = positions.ToList(),
    };

    private static Dictionary<string, DeterministicExits> AllExits(params SpecVersionRecord[] rs) =>
        rs.ToDictionary(r => r.ContentHash, _ => Exits);

    [Fact]
    public void Empty_WhatDoesNotExistIsNull()
    {
        var rep = ShadowPerformance.Compute(new[] { Version("a", "1") }, new Dictionary<string, DeterministicExits>(), 10000, T0);

        Assert.Equal(0, rep.Portfolio.PositionsClosed);
        Assert.Null(rep.Portfolio.RealizedPnl);
        Assert.Null(rep.Portfolio.TotalReturnPct);
        Assert.Null(rep.Portfolio.AnnualizedReturnPct);
        Assert.Empty(rep.Trades);
        Assert.Null(rep.Versions.Single().WinRate);
    }

    [Fact]
    public void Trade_IsReviewedAgainstThePlanOfItsRule()
    {
        // Crédito 0.44: TP planeado = +22, SL planeado = −88. El SL cerró a 1.50 (−106): 18 peor que lo planeado.
        var v = Version("a", "1", Closed(0.44, 0.22, "TAKE_PROFIT", 10), Closed(0.44, 1.50, "STOP_LOSS", 20));
        var rep = ShadowPerformance.Compute(new[] { v }, AllExits(v), 10000, T0.AddDays(30));

        var sl = rep.Trades.First();                       // la más reciente primero
        Assert.Equal("STOP_LOSS", sl.ExitReason);
        Assert.Equal(-88, sl.Plan!.StopLossPnl);
        Assert.Equal(22, sl.Plan.TakeProfitPnl);
        Assert.Equal(21, sl.Plan.TimeExitDte);
        Assert.Equal(-106, sl.RealizedPnl);
        Assert.Equal(-18, sl.GapToPlan);
        Assert.Equal(20, sl.DaysHeld);
        Assert.Equal(-23.2, sl.PnlPctOfMaxRisk);

        var tp = rep.Trades.Last();
        Assert.Equal(0, tp.GapToPlan);
        Assert.Equal(50, tp.PnlPctOfCredit);
    }

    [Fact]
    public void CreditPlan_WithNContracts_ScalesLikeTheRealizedPnl()
    {
        // 3 contratos, crédito 0.44: TP planeado = 3 × 22, SL = 3 × −88. El SL cerró a 1.50: −318 realizado, 54 peor que lo planeado.
        ShadowPosition Three(double debit, string reason, int day)
        {
            return Closed(0.44, debit, reason, day) with
            {
                Legs = new List<ShadowLeg> { new() { Side = "SELL", Type = "PUT", Quantity = 3 }, new() { Side = "BUY", Type = "PUT", Quantity = 3 } },
                RealizedPnl = Math.Round((0.44 - debit) * 300, 2),
            };
        }
        var v = Version("a", "1", Three(0.22, "TAKE_PROFIT", 10), Three(1.50, "STOP_LOSS", 20));
        var rep = ShadowPerformance.Compute(new[] { v }, AllExits(v), 10000, T0.AddDays(30));

        var sl = rep.Trades.First();
        Assert.Equal(-264, sl.Plan!.StopLossPnl);
        Assert.Equal(66, sl.Plan.TakeProfitPnl);
        Assert.Equal(-318, sl.RealizedPnl);
        Assert.Equal(-54, sl.GapToPlan);
        Assert.Equal(0, rep.Trades.Last().GapToPlan);
        Assert.Equal(-54, rep.Strategies.Single().ByExitRule.Single(x => x.Rule == "STOP_LOSS").AvgGapToPlan);
    }

    [Fact]
    public void Attribution_ByExitRule_AndByStrategyAcrossVersions()
    {
        var v1 = Version("a", "1", Closed(0.44, 0.22, "TAKE_PROFIT", 5));
        var v2 = Version("a", "2", Closed(0.40, 0.20, "TAKE_PROFIT", 6), Closed(0.40, 0.60, "TIME_EXIT", 7));
        var rep = ShadowPerformance.Compute(new[] { v1, v2 }, AllExits(v1, v2), null, T0.AddDays(10));

        var strategy = rep.Strategies.Single();
        Assert.Null(strategy.SpecVersion);
        Assert.Equal(3, strategy.PositionsClosed);
        Assert.Equal(22, strategy.RealizedPnl);
        var byRule = strategy.ByExitRule.ToDictionary(r => r.Rule);
        Assert.Equal(2, byRule["TAKE_PROFIT"].Count);
        Assert.Equal(42, byRule["TAKE_PROFIT"].RealizedPnl);
        Assert.Equal(0, byRule["TAKE_PROFIT"].AvgGapToPlan);
        Assert.Null(byRule["TIME_EXIT"].AvgGapToPlan);    // el tiempo no tiene un nivel de P&L planeado

        Assert.Equal(2, rep.Versions.Count);
        Assert.Equal(2, rep.Versions[1].PositionsClosed);
    }

    [Fact]
    public void Portfolio_AgainstReferenceCapital()
    {
        var open = new ShadowPosition { PositionId = "o", Status = "OPEN", UnrealizedPnl = 10, MaxRisk = 400, EntryAt = T0 };
        var v = Version("a", "1", Closed(0.44, 0.22, "TAKE_PROFIT", 10), open);
        var rep = ShadowPerformance.Compute(new[] { v }, AllExits(v), 10000, T0.AddDays(73));

        Assert.Equal(1, rep.Portfolio.PositionsClosed);
        Assert.Equal(1, rep.Portfolio.PositionsOpen);
        Assert.Equal(400, rep.Portfolio.OpenMaxRisk);
        Assert.Equal(0.22, rep.Portfolio.RealizedReturnPct);
        Assert.Equal(0.32, rep.Portfolio.TotalReturnPct);
        Assert.Equal(1.6, rep.Portfolio.AnnualizedReturnPct);  // 0.32 × 365 / 73
    }

    [Fact]
    public void From_GivesTheWindow_AndCutsTheTrades_ButNotTheAccumulatedPortfolio()
    {
        var v = Version("a", "1", Closed(0.44, 0.22, "TAKE_PROFIT", 2), Closed(0.44, 1.50, "STOP_LOSS", 9),
            Closed(0.40, 0.20, "TAKE_PROFIT", 10));
        var rep = ShadowPerformance.Compute(new[] { v }, AllExits(v), 10000, T0.AddDays(12), from: T0.AddDays(7));

        Assert.Equal(T0.AddDays(7), rep.From);
        Assert.Equal(2, rep.Window!.PositionsClosed);
        Assert.Equal(-86, rep.Window.RealizedPnl);            // −106 + 20
        Assert.Equal(2, rep.Window.ByExitRule.Count);
        Assert.Equal(2, rep.Trades.Count);
        Assert.Equal(3, rep.Portfolio.PositionsClosed);         // la cartera sigue siendo el acumulado
        Assert.Null(ShadowPerformance.Compute(new[] { v }, AllExits(v), null, T0).Window);
    }

    [Fact]
    public void WithoutSpec_TheTradeHasNoPlan_ButIsStillReviewed()
    {
        var v = Version("a", "1", Closed(0.44, 0.22, "TAKE_PROFIT", 10));
        var t = ShadowPerformance.Compute(new[] { v }, new Dictionary<string, DeterministicExits>(), null, T0).Trades.Single();

        Assert.Null(t.Plan);
        Assert.Null(t.GapToPlan);
        Assert.Equal(22, t.RealizedPnl);
    }
}
