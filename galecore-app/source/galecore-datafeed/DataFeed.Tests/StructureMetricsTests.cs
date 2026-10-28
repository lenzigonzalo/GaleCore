using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Tests;

/// <summary>WS-0062 inc.7 — métricas y panel correctos para cualquier estructura: base del %, monto sin signo, bruto/neto, liquidación pendiente.</summary>
public class StructureMetricsTests
{
    private static readonly DateTime T0 = new(2026, 10, 5, 14, 0, 0, DateTimeKind.Utc);

    private static ShadowLeg Leg(string side, string type, double strike) =>
        new() { Side = side, Type = type, Strike = strike, Expiration = "2026-11-20", EntryPrice = 1 };

    private static EntryContext WithCosts() => new() { Execution = new ExecutionTerms { PerOrderUsd = 1, CostsDeclared = true } };

    // Débito de 4 patas (custom_options): paga 2.50 por spread, sale a 3.50 → +100 bruto, 98 neto (2 órdenes de 1 USD).
    private static ShadowPosition DebitFourLegs() => new()
    {
        PositionId = "d1", Status = "CLOSED", Symbol = "SPY", Structure = "custom_options",
        Legs = new() { Leg("BUY", "PUT", 600), Leg("SELL", "PUT", 590), Leg("BUY", "CALL", 640), Leg("SELL", "CALL", 650) },
        EntryCredit = -2.5, ExitDebit = -3.5, RealizedPnl = 98, ExitReason = "TAKE_PROFIT", MaxRisk = 250,
        EntryAt = T0, ExitAt = T0.AddDays(3), EntryDte = 30, EntryContext = WithCosts(),
    };

    // Iron condor 0DTE: cobra 1.20, vence sin valor → +120; sólo paga la orden de entrada.
    private static ShadowPosition CondorZeroDte() => new()
    {
        PositionId = "c1", Status = "CLOSED", Symbol = "SPX", Structure = "iron_condor",
        Legs = new() { Leg("SELL", "PUT", 5800), Leg("BUY", "PUT", 5790), Leg("SELL", "CALL", 5900), Leg("BUY", "CALL", 5910) },
        EntryCredit = 1.2, ExitDebit = 0, RealizedPnl = 119, ExitReason = "EXPIRATION", MaxRisk = 880,
        EntryAt = T0, ExitAt = T0.AddHours(6), EntryDte = 0, EntryContext = WithCosts(),
    };

    private static ShadowPosition LongStock() => new()
    {
        PositionId = "s1", Status = "CLOSED", Symbol = "AAPL", Structure = "long_equity",
        Legs = new() { new ShadowLeg { Side = "BUY", Type = "STOCK", EntryPrice = 50, Quantity = 10 } },
        EntryCredit = -50, ExitDebit = -52.5, RealizedPnl = 25, ExitReason = "TAKE_PROFIT", MaxRisk = 500,
        EntryAt = T0, ExitAt = T0.AddDays(2),
    };

    private static ShadowPosition Pending() => new()
    {
        PositionId = "p1", Status = "OPEN", Symbol = "SPX", Structure = "iron_condor",
        Legs = new() { Leg("SELL", "PUT", 5800), Leg("BUY", "PUT", 5790) },
        EntryCredit = 1.2, MaxRisk = 880, EntryAt = T0, EntryDte = 0, UnrealizedPnl = 30,
        ValuationProblems = new() { $"{Expiry.PendingText}: sin cierre oficial de SPX del 2026-10-05" },
    };

    private static PanelReport Panel(params ShadowPosition[] positions)
    {
        var rec = new SpecVersionRecord { ContentHash = "h", SpecName = "s", SpecVersion = "1", Positions = positions.ToList() };
        return ShadowPanel.Compute("s", new[] { rec }, new Dictionary<string, DeterministicExits> { ["h"] = new() },
            new PanelOptions(), T0.AddDays(10));
    }

    [Fact]
    public void DebitFourLegs_PercentIsOnCost_AmountIsPositive_AndGrossBeatsNet()
    {
        var trade = Panel(DebitFourLegs()).ClosedTrades.Single();

        Assert.Equal("debit", trade.EntryKind);
        Assert.Equal(2.5, trade.EntryAmount);                 // sin signo: la pantalla dice «Costo 2,50»
        Assert.Null(trade.PnlPctOfCredit);
        Assert.Equal(39.2, trade.PnlPctOfCost);               // 98 / 250
        Assert.Equal(39.2, trade.PnlPctOfMaxRisk);            // riesgo = lo pagado
        Assert.Equal(98, trade.RealizedPnl);
        Assert.Equal(100, trade.GrossPnl);
        Assert.Equal(2, trade.Costs);
        Assert.True(trade.CostsDeclared);
    }

    [Fact]
    public void ZeroDteCondorSettledAtExpiration_IsCreditBased_AndPaysOnlyTheEntryOrder()
    {
        var trade = Panel(CondorZeroDte()).ClosedTrades.Single();

        Assert.Equal("credit", trade.EntryKind);
        Assert.Equal(1.2, trade.EntryAmount);
        Assert.Equal(99.2, trade.PnlPctOfCredit);             // 119 / 120
        Assert.Null(trade.PnlPctOfCost);
        Assert.Equal("EXPIRATION", trade.ExitReason);
        Assert.Equal(120, trade.GrossPnl);
        Assert.Equal(1, trade.Costs);
    }

    [Fact]
    public void LongStock_PercentIsOnCost_NeverOnCredit()
    {
        var trade = Panel(LongStock()).ClosedTrades.Single();

        Assert.Equal("debit", trade.EntryKind);
        Assert.Equal(50, trade.EntryAmount);
        Assert.Null(trade.PnlPctOfCredit);
        Assert.Equal(5, trade.PnlPctOfCost);                  // 25 / (50 × 10)
        Assert.Equal(500, trade.Cost);
    }

    [Fact]
    public void AggregatesIncludeCosts_AndExposeGrossAndTotalCosts()
    {
        var rep = Panel(DebitFourLegs(), CondorZeroDte());

        Assert.Equal(217, rep.RealizedPnl.Value);             // 98 + 119
        Assert.Equal(220, rep.RealizedGrossPnl.Value);
        Assert.Equal(3, rep.TotalCosts.Value);
        Assert.True(rep.CostsDeclared);
    }

    [Fact]
    public void WithoutDeclaredCosts_NetEqualsGross_AndFlagIsFalse()
    {
        var rep = Panel(LongStock());

        Assert.False(rep.CostsDeclared);
        Assert.Equal(rep.RealizedPnl.Value, rep.RealizedGrossPnl.Value);
        Assert.Equal(0, rep.TotalCosts.Value);
    }

    [Fact]
    public void PendingSettlement_IsFlagged_AndHasNoPnl()
    {
        var rep = Panel(Pending());

        var row = Assert.Single(rep.OpenPositions);
        Assert.True(row.PendingSettlement);
        Assert.Null(row.UnrealizedPnl);
        Assert.Null(row.PnlPctOfCredit);
        Assert.Null(row.PnlPctOfMaxRisk);
        Assert.Null(rep.UnrealizedPnl.Value);
        Assert.Equal(1, rep.TradesOpen);
        Assert.True(ShadowPerformance.IsPendingSettlement(Pending()));
    }

    [Fact]
    public void OpenPosition_ComesWithItsPercentages_FromTheBack()
    {
        var open = Pending() with { ValuationProblems = null, UnrealizedPnl = 30 };
        var row = Panel(open).OpenPositions.Single();

        Assert.False(row.PendingSettlement);
        Assert.Equal(25, row.PnlPctOfCredit);                 // 30 / 120
        Assert.Equal(3.4, row.PnlPctOfMaxRisk);               // 30 / 880
        Assert.Null(row.PnlPctOfCost);
    }
}
