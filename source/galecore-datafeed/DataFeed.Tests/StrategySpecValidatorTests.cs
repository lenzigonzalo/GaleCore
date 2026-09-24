using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Tests;

/// <summary>
/// Congela las reglas de validación de StrategySpec (P0 §5.5).
/// Cada test es un caso positivo o negativo explícito.
/// </summary>
public class StrategySpecValidatorTests
{
    private static StrategySpec ValidSpec() => new()
    {
        StrategySpecVersion = "1.0.0",
        CanonicalizationVersion = "jcs-1",
        Identity = new SpecIdentity
        {
            Id = "550e8400-e29b-41d4-a716-446655440000",
            Name = "test_spec",
            DisplayName = "Test",
            Version = "1.0.0",
            Author = new SpecAuthor { Type = "HUMAN" },
            CreatedAt = new DateTime(2026, 9, 13, 0, 0, 0, DateTimeKind.Utc)
        },
        DeploymentConstraints = new DeploymentConstraints
        {
            EligibleModes = new List<string> { "SHADOW" },
            RequiresHumanApprovalFor = new List<string> { "LIVE" }
        },
        Universe = new SpecUniverse
        {
            Mode = "WHITELIST",
            Symbols = new List<string> { "SPY" },
            InstrumentTypes = new List<string> { "EQUITY_OPTION" }
        },
        Structure = new SpecStructure
        {
            AllowedStrategies = new List<string> { "put_credit_spread" },
            ForbiddenStrategies = new List<string> { "naked_short" },
            DefaultStructure = "put_credit_spread",
            SelectionMethod = "FIXED"
        },
        EntryFilters = new EntryFilters
        {
            GateLayer = new GateLayer
            {
                PassRule = "ALL",
                OnFail = "NO_TRADE",
                Gates = new List<GateDefinition>
                {
                    new()
                    {
                        Id = "vix_absolute",
                        Label = "VIX < 30",
                        MetricRef = "capability:market_data.quote.VIX.price",
                        Operator = "LT",
                        Threshold = new GateThreshold { Value = 30 },
                        OnFail = "NO_TRADE",
                        OnNoData = "BLOCK"
                    }
                }
            }
        },
        RiskLimits = new SpecRiskLimits { MaxConcurrentPositions = 1, MaxRiskPerTradePct = 5.0 },
        Operational = new SpecOperational(),
        Metadata = new SpecMetadata { SchemaVersion = "1.0.0" }
    };

    [Fact]
    public void ValidSpec_Passes()
    {
        var result = StrategySpecValidator.Validate(ValidSpec());
        Assert.True(result.IsValid, string.Join("; ", result.Errors));
        Assert.Empty(result.Errors);
    }

    [Fact]
    public void MissingIdentityId_Fails()
    {
        var spec = ValidSpec() with { Identity = ValidSpec().Identity with { Id = "" } };
        var result = StrategySpecValidator.Validate(spec);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("identity.id"));
    }

    [Fact]
    public void MissingIdentityName_Fails()
    {
        var spec = ValidSpec() with { Identity = ValidSpec().Identity with { Name = "" } };
        var result = StrategySpecValidator.Validate(spec);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("identity.name"));
    }

    [Fact]
    public void InvalidAuthorType_Fails()
    {
        var spec = ValidSpec() with
        {
            Identity = ValidSpec().Identity with
            {
                Author = new SpecAuthor { Type = "BOT" }
            }
        };
        var result = StrategySpecValidator.Validate(spec);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("identity.author.type"));
    }

    [Fact]
    public void EmptyEligibleModes_Fails()
    {
        var spec = ValidSpec() with
        {
            DeploymentConstraints = new DeploymentConstraints { EligibleModes = new List<string>() }
        };
        var result = StrategySpecValidator.Validate(spec);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("eligible_modes"));
    }

    [Fact]
    public void InvalidMode_Fails()
    {
        var spec = ValidSpec() with
        {
            DeploymentConstraints = new DeploymentConstraints
            {
                EligibleModes = new List<string> { "DEMO" }
            }
        };
        var result = StrategySpecValidator.Validate(spec);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("DEMO"));
    }

    [Fact]
    public void WhitelistEmptySymbols_Fails()
    {
        var spec = ValidSpec() with
        {
            Universe = new SpecUniverse { Mode = "WHITELIST", Symbols = new List<string>() }
        };
        var result = StrategySpecValidator.Validate(spec);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("universe.symbols"));
    }

    [Fact]
    public void AllowedForbiddenOverlap_Fails()
    {
        var spec = ValidSpec() with
        {
            Structure = new SpecStructure
            {
                AllowedStrategies = new List<string> { "put_credit_spread", "iron_condor" },
                ForbiddenStrategies = new List<string> { "iron_condor" },
                DefaultStructure = "put_credit_spread",
                SelectionMethod = "FIXED"
            }
        };
        var result = StrategySpecValidator.Validate(spec);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("overlap") && e.Contains("iron_condor"));
    }

    [Fact]
    public void PlatformForbiddenStrategy_Rejected()
    {
        var spec = ValidSpec() with
        {
            Structure = new SpecStructure
            {
                AllowedStrategies = new List<string> { "naked_short" },
                ForbiddenStrategies = new List<string>(),
                DefaultStructure = "naked_short",
                SelectionMethod = "FIXED"
            }
        };
        var result = StrategySpecValidator.Validate(spec);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("platform-forbidden"));
    }

    [Fact]
    public void DefaultStructureNotInAllowed_Fails()
    {
        var spec = ValidSpec() with
        {
            Structure = new SpecStructure
            {
                AllowedStrategies = new List<string> { "put_credit_spread" },
                ForbiddenStrategies = new List<string>(),
                DefaultStructure = "iron_condor",
                SelectionMethod = "FIXED"
            }
        };
        var result = StrategySpecValidator.Validate(spec);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("default_structure must be in allowed_strategies"));
    }

    [Fact]
    public void DuplicateGateId_Fails()
    {
        var gate = new GateDefinition
        {
            Id = "vix",
            Label = "VIX",
            MetricRef = "capability:market_data.quote.VIX.price",
            Operator = "LT",
            Threshold = new GateThreshold { Value = 30 },
            OnFail = "NO_TRADE",
            OnNoData = "BLOCK"
        };
        var spec = ValidSpec() with
        {
            EntryFilters = new EntryFilters
            {
                GateLayer = new GateLayer
                {
                    Gates = new List<GateDefinition> { gate, gate }
                }
            }
        };
        var result = StrategySpecValidator.Validate(spec);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("duplicate gate id"));
    }

    [Fact]
    public void BetweenOperator_RequiresMinMax()
    {
        var spec = ValidSpec() with
        {
            EntryFilters = new EntryFilters
            {
                GateLayer = new GateLayer
                {
                    Gates = new List<GateDefinition>
                    {
                        new()
                        {
                            Id = "range_gate",
                            Label = "Range",
                            MetricRef = "capability:something",
                            Operator = "BETWEEN",
                            Threshold = new GateThreshold { Value = 10 },
                            OnFail = "NO_TRADE",
                            OnNoData = "BLOCK"
                        }
                    }
                }
            }
        };
        var result = StrategySpecValidator.Validate(spec);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("BETWEEN requires"));
    }

    [Fact]
    public void NegativeRiskPerTrade_Fails()
    {
        var spec = ValidSpec() with
        {
            RiskLimits = new SpecRiskLimits { MaxRiskPerTradePct = -1.0 }
        };
        var result = StrategySpecValidator.Validate(spec);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("max_risk_per_trade_pct must be positive"));
    }

    [Fact]
    public void NullRiskLimits_ValidIfOptional()
    {
        var spec = ValidSpec() with
        {
            RiskLimits = new SpecRiskLimits()
        };
        var result = StrategySpecValidator.Validate(spec);
        Assert.True(result.IsValid, string.Join("; ", result.Errors));
    }
}
