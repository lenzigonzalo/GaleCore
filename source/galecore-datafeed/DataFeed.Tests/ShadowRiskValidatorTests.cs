using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Tests;

/// <summary>
/// Congela las reglas de hard risk del runtime SHADOW.
/// </summary>
public class ShadowRiskValidatorTests
{
    private static StrategySpec TestSpec() => new()
    {
        Structure = new SpecStructure
        {
            AllowedStrategies = new List<string> { "put_credit_spread" },
            ForbiddenStrategies = new List<string> { "naked_short" },
            DefaultStructure = "put_credit_spread",
            SelectionMethod = "FIXED"
        },
        RiskLimits = new SpecRiskLimits
        {
            MaxConcurrentPositions = 1,
            MaxRiskPerTradePct = 5.0
        },
        DataQuality = new SpecDataQuality { MaxQuoteAgeSeconds = 15 }
    };

    private static TradeCandidate ValidCandidate() => new()
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
            new() { Side = "SELL", Type = "PUT", Strike = 520, Bid = 1.50, Ask = 1.70, Delta = -0.16 },
            new() { Side = "BUY", Type = "PUT", Strike = 515, Bid = 0.70, Ask = 0.90 }
        },
        Snapshot = new MarketSnapshot { UnderlyingPrice = 545, AsOf = DateTime.UtcNow, OldestQuoteAt = DateTime.UtcNow }
    };

    [Fact]
    public void ValidCandidate_Passes()
    {
        var result = ShadowRiskValidator.Validate(ValidCandidate(), TestSpec(), 0, 10_000);
        Assert.True(result.IsValid, string.Join("; ", result.Errors));
    }

    [Fact]
    public void NakedShort_NotPlatformForbidden_OnlySpecDecides()
    {
        var candidate = ValidCandidate() with { Structure = "naked_short" };
        var result = ShadowRiskValidator.Validate(candidate, TestSpec(), 0, 10_000);
        Assert.False(result.IsValid);
        Assert.DoesNotContain(result.Errors, e => e.Contains("platform-forbidden"));
        Assert.Contains(result.Errors, e => e.Contains("not in spec"));
    }

    [Fact]
    public void StructureNotInAllowed_Rejected()
    {
        var candidate = ValidCandidate() with { Structure = "iron_condor" };
        var result = ShadowRiskValidator.Validate(candidate, TestSpec(), 0, 10_000);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("not in spec"));
    }

    [Fact]
    public void MaxPositionsReached_Rejected()
    {
        var result = ShadowRiskValidator.Validate(ValidCandidate(), TestSpec(), 1, 10_000);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("Max concurrent positions"));
    }

    [Fact]
    public void RiskExceedsPercentage_Rejected()
    {
        // 5% of 5000 = 250, candidate risk = 415
        var result = ShadowRiskValidator.Validate(ValidCandidate(), TestSpec(), 0, 5_000);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("exceeds") && e.Contains("5%"));
    }

    [Fact]
    public void RiskWithinPercentage_Passes()
    {
        // 5% of 10000 = 500, candidate risk = 415
        var result = ShadowRiskValidator.Validate(ValidCandidate(), TestSpec(), 0, 10_000);
        Assert.True(result.IsValid);
    }

    [Fact]
    public void NoLegs_Rejected()
    {
        var candidate = ValidCandidate() with { Legs = new List<CandidateLeg>() };
        var result = ShadowRiskValidator.Validate(candidate, TestSpec(), 0, 10_000);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("no legs"));
    }

    [Fact]
    public void ZeroCredit_CreditSpread_Rejected()
    {
        var candidate = ValidCandidate() with { Credit = 0 };
        var result = ShadowRiskValidator.Validate(candidate, TestSpec(), 0, 10_000);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("positive credit"));
    }

    [Fact]
    public void ZeroMaxRisk_Rejected()
    {
        var candidate = ValidCandidate() with { MaxRisk = 0 };
        var result = ShadowRiskValidator.Validate(candidate, TestSpec(), 0, 10_000);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("MaxRisk must be positive"));
    }

    [Fact]
    public void NullNetLiq_SkipsPercentageCheck()
    {
        var result = ShadowRiskValidator.Validate(ValidCandidate(), TestSpec(), 0, null);
        Assert.True(result.IsValid);
    }

    [Fact]
    public void MaxLossPerTradeUsd_Rejected()
    {
        var spec = TestSpec() with
        {
            RiskLimits = new SpecRiskLimits { MaxLossPerTradeUsd = 200 }
        };
        var result = ShadowRiskValidator.Validate(ValidCandidate(), spec, 0, 10_000);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("max_loss_per_trade_usd"));
    }

    // ── GC-0002 R1-M1: frescura con la hora del proveedor ──

    private static readonly DateTime Now = new(2026, 9, 24, 15, 0, 0, DateTimeKind.Utc);

    private static TradeCandidate QuotedAt(DateTime? at) =>
        ValidCandidate() with { Snapshot = new MarketSnapshot { UnderlyingPrice = 545, AsOf = Now, OldestQuoteAt = at } };

    [Fact]
    public void StaleQuote_Rejected_EvenIfTheSnapshotWasBuiltNow()
    {
        var result = ShadowRiskValidator.Validate(QuotedAt(Now.AddSeconds(-151)), TestSpec(), 0, null, Now);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("dato viejo"));
    }

    [Fact]
    public void FreshQuote_Passes()
    {
        Assert.True(ShadowRiskValidator.Validate(QuotedAt(Now.AddSeconds(-20)), TestSpec(), 0, null, Now).IsValid);
    }

    [Fact]
    public void FutureQuoteTime_Rejected()
    {
        var result = ShadowRiskValidator.Validate(QuotedAt(Now.AddMinutes(2)), TestSpec(), 0, null, Now);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("futuro"));
    }

    [Fact]
    public void UnknownQuoteTime_IsRejected()
    {
        // Sin hora del proveedor la cotización no sirve (WS-0062 inc.1).
        var result = ShadowRiskValidator.Validate(QuotedAt(null), TestSpec(), 0, null, Now);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("sin hora"));
    }
}
