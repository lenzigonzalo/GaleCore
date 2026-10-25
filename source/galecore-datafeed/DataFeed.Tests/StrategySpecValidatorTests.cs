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
        CandidateConstruction = new CandidateConstruction
        {
            Legs = new List<LegTemplate>
            {
                new() { Side = "SELL", Type = "PUT", StrikeSelection = new LegStrikeSelection { Method = "DELTA", TargetDelta = -0.16, DeltaTolerance = 0.04 } },
                new() { Side = "BUY", Type = "PUT", StrikeSelection = new LegStrikeSelection { Method = "FIXED_WIDTH", Width = 5 } },
            }
        },
        RiskLimits = new SpecRiskLimits { MaxConcurrentPositions = 1, MaxRiskPerTradePct = 5.0, SimulatedCapitalUsd = 10_000 },
        Operational = new SpecOperational(),
        Metadata = new SpecMetadata { SchemaVersion = "1.0.0" }
    };

    private static LegTemplate CallLeg(string side, double? delta = 0.16, string? method = null) => side == "SELL"
        ? new() { Side = "SELL", Type = "CALL", StrikeSelection = new LegStrikeSelection { Method = method ?? "DELTA", TargetDelta = delta, DeltaTolerance = 0.04 } }
        : new() { Side = "BUY", Type = "CALL", StrikeSelection = new LegStrikeSelection { Method = method ?? "FIXED_WIDTH", Width = 5 } };

    private static StrategySpec WithStructure(string structure, params LegTemplate[] extraLegs)
    {
        var spec = ValidSpec();
        var legs = (structure == RuntimeStructures.CallCreditSpread ? new List<LegTemplate>() : spec.CandidateConstruction.Legs.ToList())
            .Concat(extraLegs).ToList();
        return spec with
        {
            Structure = spec.Structure with { AllowedStrategies = new() { structure }, DefaultStructure = structure },
            CandidateConstruction = spec.CandidateConstruction with { Legs = legs },
        };
    }

    // ── P1-07: sólo lo que el runtime construye ──

    [Fact]
    public void CallCreditSpread_And_IronCondor_WithTheirLegs_Pass()
    {
        Assert.True(StrategySpecValidator.Validate(WithStructure(RuntimeStructures.CallCreditSpread, CallLeg("SELL"), CallLeg("BUY"))).IsValid);
        Assert.True(StrategySpecValidator.Validate(WithStructure(RuntimeStructures.IronCondor, CallLeg("SELL"), CallLeg("BUY"))).IsValid);
    }

    [Fact]
    public void StructureTheRuntimeDoesNotBuild_IsRejected()
    {
        var result = StrategySpecValidator.Validate(WithStructure("butterfly"));
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("'butterfly' is not built by the runtime"));
    }

    [Fact]
    public void ALegTheStructureDoesNotUse_IsRejected_NotIgnored()
    {
        // Un PCS con patas de call: antes el constructor las ignoraba y la spec corría como PCS.
        var result = StrategySpecValidator.Validate(WithStructure(RuntimeStructures.PutCreditSpread, CallLeg("SELL"), CallLeg("BUY")));
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("must be exactly SELL PUT, BUY PUT"));
    }

    [Fact]
    public void IronCondor_WithoutTheCallSide_IsRejected()
    {
        var result = StrategySpecValidator.Validate(WithStructure(RuntimeStructures.IronCondor));
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("SELL PUT, BUY PUT, SELL CALL, BUY CALL"));
    }

    [Theory]
    [InlineData("PERCENTAGE_OTM", null)]
    [InlineData(null, -0.16)]   // delta de call negativo: el constructor nunca encontraría la pata
    public void UnknownMethod_OrWrongDeltaSign_IsRejected(string? method, double? delta)
    {
        var result = StrategySpecValidator.Validate(
            WithStructure(RuntimeStructures.CallCreditSpread, CallLeg("SELL", delta ?? 0.16, method), CallLeg("BUY")));
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains(method != null ? "method must be DELTA" : "target_delta must be positive"));
    }

    [Fact]
    public void ValidSpec_Passes()
    {
        var result = StrategySpecValidator.Validate(ValidSpec());
        Assert.True(result.IsValid, string.Join("; ", result.Errors));
        Assert.Empty(result.Errors);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public void NonPositiveMinMinutesBetweenEntries_Fails(int minutes)
    {
        var spec = ValidSpec() with { RiskLimits = ValidSpec().RiskLimits with { MinMinutesBetweenEntries = minutes } };
        var result = StrategySpecValidator.Validate(spec);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("risk_limits.min_minutes_between_entries"));
    }

    [Fact]
    public void MinMinutesBetweenEntries_LoadsFromSnakeCaseJson_AndPasses()
    {
        var json = ShadowRuntimeEngineTests.SpecJson()
            .Replace("\"max_concurrent_positions\": 1", "\"max_concurrent_positions\": 10, \"min_minutes_between_entries\": 1440");
        var loaded = StrategySpecLoader.LoadFromJson(json);
        Assert.True(loaded.Success, string.Join("; ", loaded.Errors));
        Assert.Equal(1440, loaded.Spec!.RiskLimits.MinMinutesBetweenEntries);
        Assert.True(StrategySpecValidator.Validate(loaded.Spec).IsValid);
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
    public void NoPlatformForbiddenStrategies()
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
        Assert.DoesNotContain(result.Errors, e => e.Contains("platform-forbidden"));
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
    public void AllowedStrategyTheRuntimeDoesNotBuild_Fails()
    {
        var spec = ValidSpec() with
        {
            Structure = ValidSpec().Structure with { AllowedStrategies = new List<string> { "put_credit_spread", "jade_lizard" } }
        };
        var result = StrategySpecValidator.Validate(spec);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("allowed_strategies contains 'jade_lizard'"));
    }

    [Theory]
    [InlineData("RULE_BASED")]
    [InlineData("AI_RECOMMENDED")]
    public void SelectionMethodOtherThanFixed_Fails_TheRuntimeHasNoSelector(string method)
    {
        var spec = ValidSpec() with { Structure = ValidSpec().Structure with { SelectionMethod = method } };
        var result = StrategySpecValidator.Validate(spec);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("selection_method must be FIXED"));
    }

    [Theory]
    [InlineData(0.0)]
    [InlineData(-0.5)]
    public void NonPositiveMinCredit_Fails(double minCredit)
    {
        var spec = ValidSpec();
        spec = spec with
        {
            CandidateConstruction = spec.CandidateConstruction with
            {
                Constraints = spec.CandidateConstruction.Constraints with { MinCredit = minCredit },
            },
        };
        var result = StrategySpecValidator.Validate(spec);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("min_credit must be positive"));
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

    // ── P1-07: el loader rechaza lo que no conoce (bug #6 del traspaso) ──

    [Theory]
    [InlineData("\"max_concurrent_positions\": 1", "\"max_concurrent_positions\": 1, \"max_daily_loss_usd\": 300")]   // anidado
    [InlineData("\"canonicalization_version\"", "\"roll_rules\": {\"enabled\": true}, \"canonicalization_version\"")]   // raíz
    public void UnknownField_RejectsTheSpec_InsteadOfIgnoringIt(string find, string replaceWith)
    {
        var json = ShadowRuntimeEngineTests.SpecJson();
        Assert.Contains(find, json);

        var loaded = StrategySpecLoader.LoadFromJson(json.Replace(find, replaceWith));

        Assert.False(loaded.Success);
        Assert.Null(loaded.ContentHash);
        Assert.Contains(loaded.Errors, e => e.Contains("JSON parse error"));
    }

    [Theory]
    [InlineData("shadow_runtime_test_v1")]
    [InlineData("shadow_runtime_test_v2")]
    [InlineData("spy_prima_varianza_30_45d")]
    public void TheSpecsInTheRepo_StillLoad(string name)
    {
        var path = Path.Combine(Path.GetDirectoryName(ShadowRuntimeEngineTests.SpecPath())!, name + ".json");
        var loaded = StrategySpecLoader.LoadFromFile(path);
        Assert.True(loaded.Success, string.Join("; ", loaded.Errors));
    }
}
