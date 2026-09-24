using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Tests;

/// <summary>
/// Congela el comportamiento del fill simulado y los exits determinísticos.
/// </summary>
public class ShadowFillSimulatorTests
{
    private static TradeCandidate TestCandidate() => new()
    {
        CandidateId = "c-1",
        InstanceId = "i-1",
        Symbol = "SPY",
        Structure = "put_credit_spread",
        Credit = 0.85,
        MaxRisk = 415,
        Width = 5,
        Dte = 35,
        DeltaShort = -0.16,
        Legs = new List<CandidateLeg>
        {
            new() { Side = "SELL", Type = "PUT", Strike = 520, Bid = 1.50, Ask = 1.70, Delta = -0.16, Expiration = "2026-10-17" },
            new() { Side = "BUY", Type = "PUT", Strike = 515, Bid = 0.70, Ask = 0.90, Expiration = "2026-10-17" }
        },
        Snapshot = new MarketSnapshot { UnderlyingPrice = 545, AsOf = DateTime.UtcNow }
    };

    // ── Mid price ──

    [Fact]
    public void MidPrice_BidAsk_Average()
    {
        var leg = new CandidateLeg { Bid = 1.50, Ask = 1.70 };
        Assert.Equal(1.60, ShadowFillSimulator.ComputeMidPrice(leg));
    }

    [Fact]
    public void MidPrice_NoBidAsk_Zero()
    {
        var leg = new CandidateLeg();
        Assert.Equal(0, ShadowFillSimulator.ComputeMidPrice(leg));
    }

    [Fact]
    public void MidPrice_Rounded()
    {
        var leg = new CandidateLeg { Bid = 1.33, Ask = 1.34 };
        Assert.Equal(1.34, ShadowFillSimulator.ComputeMidPrice(leg)); // (1.33+1.34)/2 = 1.335 → 1.34
    }

    // ── Fill ──

    [Fact]
    public void Fill_CreatesOpenPosition()
    {
        var now = DateTime.UtcNow;
        var pos = ShadowFillSimulator.Fill(TestCandidate(), now);

        Assert.Equal("OPEN", pos.Status);
        Assert.Equal("SPY", pos.Symbol);
        Assert.Equal("put_credit_spread", pos.Structure);
        Assert.Equal(0.85, pos.EntryCredit);
        Assert.Equal(415, pos.MaxRisk);
        Assert.Equal(5, pos.Width);
        Assert.Equal(35, pos.EntryDte);
        Assert.Equal(now, pos.EntryAt);
        Assert.Equal(2, pos.Legs.Count);
        Assert.NotEmpty(pos.PositionId);
    }

    [Fact]
    public void Fill_LegsMidPrices()
    {
        var pos = ShadowFillSimulator.Fill(TestCandidate(), DateTime.UtcNow);
        Assert.Equal(1.60, pos.Legs[0].EntryPrice); // (1.50+1.70)/2
        Assert.Equal(0.80, pos.Legs[1].EntryPrice); // (0.70+0.90)/2
    }

    [Fact]
    public void Fill_Deterministic_SameInputSameOutput()
    {
        var now = new DateTime(2026, 9, 13, 12, 0, 0, DateTimeKind.Utc);
        var candidate = TestCandidate();
        var pos1 = ShadowFillSimulator.Fill(candidate, now);
        var pos2 = ShadowFillSimulator.Fill(candidate, now);

        // Prices and structure are identical (ids differ by design)
        Assert.Equal(pos1.EntryCredit, pos2.EntryCredit);
        Assert.Equal(pos1.Legs[0].EntryPrice, pos2.Legs[0].EntryPrice);
        Assert.Equal(pos1.Legs[1].EntryPrice, pos2.Legs[1].EntryPrice);
    }

    // ── Exit evaluation ──

    [Fact]
    public void Exit_TakeProfit_50pctCredit()
    {
        var exits = new DeterministicExits
        {
            TakeProfit = new TakeProfitExit { PctOfCredit = 50 }
        };
        var pos = ShadowFillSimulator.Fill(TestCandidate(), DateTime.UtcNow);

        // Credit = 0.85. 50% take profit → close when spread value <= 0.425
        var reason = ShadowFillSimulator.EvaluateExits(pos, exits, currentSpreadValue: 0.40, currentDte: 30);
        Assert.Equal("TAKE_PROFIT", reason);
    }

    [Fact]
    public void Exit_TakeProfit_NotYet()
    {
        var exits = new DeterministicExits
        {
            TakeProfit = new TakeProfitExit { PctOfCredit = 50 }
        };
        var pos = ShadowFillSimulator.Fill(TestCandidate(), DateTime.UtcNow);

        var reason = ShadowFillSimulator.EvaluateExits(pos, exits, currentSpreadValue: 0.60, currentDte: 30);
        Assert.Null(reason);
    }

    [Fact]
    public void Exit_StopLoss_200pctCredit()
    {
        var exits = new DeterministicExits
        {
            StopLoss = new StopLossExit { PctOfCredit = 200 }
        };
        var pos = ShadowFillSimulator.Fill(TestCandidate(), DateTime.UtcNow);

        // Credit = 0.85. 200% stop → loss >= 1.70 → spread value >= 0.85 + 1.70 = 2.55
        var reason = ShadowFillSimulator.EvaluateExits(pos, exits, currentSpreadValue: 2.60, currentDte: 30);
        Assert.Equal("STOP_LOSS", reason);
    }

    [Fact]
    public void Exit_TimeExit_DteBelowThreshold()
    {
        var exits = new DeterministicExits
        {
            TimeExit = new TimeExit { MaxDte = 7 }
        };
        var pos = ShadowFillSimulator.Fill(TestCandidate(), DateTime.UtcNow);

        var reason = ShadowFillSimulator.EvaluateExits(pos, exits, currentSpreadValue: 0.60, currentDte: 5);
        Assert.Equal("TIME_EXIT", reason);
    }

    [Fact]
    public void Exit_StopLoss_TakesPrecedence_OverTakeProfit()
    {
        var exits = new DeterministicExits
        {
            TakeProfit = new TakeProfitExit { PctOfCredit = 50 },
            StopLoss = new StopLossExit { PctOfCredit = 200 },
            TimeExit = new TimeExit { MaxDte = 7 }
        };
        var pos = ShadowFillSimulator.Fill(TestCandidate(), DateTime.UtcNow);

        // Both stop and take trigger
        var reason = ShadowFillSimulator.EvaluateExits(pos, exits, currentSpreadValue: 3.00, currentDte: 5);
        Assert.Equal("STOP_LOSS", reason);
    }

    [Fact]
    public void Exit_ClosedPosition_NoExit()
    {
        var exits = new DeterministicExits
        {
            TakeProfit = new TakeProfitExit { PctOfCredit = 50 }
        };
        var pos = ShadowFillSimulator.Fill(TestCandidate(), DateTime.UtcNow);
        pos = ShadowFillSimulator.Close(pos, 0.40, "TAKE_PROFIT", DateTime.UtcNow);

        var reason = ShadowFillSimulator.EvaluateExits(pos, exits, currentSpreadValue: 0.10, currentDte: 5);
        Assert.Null(reason);
    }

    // ── Close ──

    [Fact]
    public void Close_SetsFieldsCorrectly()
    {
        var pos = ShadowFillSimulator.Fill(TestCandidate(), DateTime.UtcNow);
        var now = DateTime.UtcNow;
        var closed = ShadowFillSimulator.Close(pos, exitDebit: 0.40, reason: "TAKE_PROFIT", now: now);

        Assert.Equal("CLOSED", closed.Status);
        Assert.Equal(0.40, closed.ExitDebit);
        Assert.Equal("TAKE_PROFIT", closed.ExitReason);
        Assert.Equal(now, closed.ExitAt);
        Assert.NotNull(closed.RealizedPnl);
        Assert.Null(closed.UnrealizedPnl);

        // P&L = (credit - debit) * 100 = (0.85 - 0.40) * 100 = 45
        Assert.Equal(45.0, closed.RealizedPnl!.Value, precision: 2);
    }

    [Fact]
    public void Close_LossScenario()
    {
        var pos = ShadowFillSimulator.Fill(TestCandidate(), DateTime.UtcNow);
        var closed = ShadowFillSimulator.Close(pos, exitDebit: 2.50, reason: "STOP_LOSS", now: DateTime.UtcNow);

        // P&L = (0.85 - 2.50) * 100 = -165
        Assert.Equal(-165.0, closed.RealizedPnl);
    }
}
