using System.Text.Json;
using System.Text.Json.Nodes;
using DataFeed.Application.App.Runtime;

namespace DataFeed.Tests;

/// <summary>
/// Congela el contrato del PCS-SPY StrategySpec JSON: carga, valida y verifica las reglas de negocio.
/// Mismo patrón que RpfRulesJsonTests y GexRulesJsonTests.
/// </summary>
public class RuntimeSpecJsonTests
{
    private static string FilesDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, "DataFeed.Api", "Files");
            if (Directory.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        throw new DirectoryNotFoundException(
            "No se encontro DataFeed.Api/Files subiendo desde " + AppContext.BaseDirectory);
    }

    private static string SpecPath() => Path.Combine(FilesDir(), "Runtime", "shadow_runtime_test_v1.json");

    private static JsonObject SpecJson()
        => JsonNode.Parse(File.ReadAllText(SpecPath()))!.AsObject();

    // ── Archivo existe y parsea ──

    [Fact]
    public void TestSpec_FileExists()
    {
        Assert.True(File.Exists(SpecPath()), $"shadow_runtime_test_v1.json not found at {SpecPath()}");
    }

    [Fact]
    public void TestSpec_ValidJson()
    {
        var json = File.ReadAllText(SpecPath());
        var node = JsonNode.Parse(json);
        Assert.NotNull(node);
    }

    // ── Loader valida y hashea ──

    [Fact]
    public void TestSpec_LoaderSucceeds()
    {
        var result = StrategySpecLoader.LoadFromFile(SpecPath());
        Assert.True(result.Success, $"Loader failed: {string.Join("; ", result.Errors)}");
        Assert.NotNull(result.Spec);
        Assert.NotNull(result.ContentHash);
        Assert.StartsWith("sha256:", result.ContentHash);
    }

    [Fact]
    public void TestSpec_HashIsDeterministic()
    {
        var result1 = StrategySpecLoader.LoadFromFile(SpecPath());
        var result2 = StrategySpecLoader.LoadFromFile(SpecPath());
        Assert.Equal(result1.ContentHash, result2.ContentHash);
    }

    // ── Identity ──

    [Fact]
    public void TestSpec_IdentityIsCorrect()
    {
        var spec = SpecJson();
        var identity = spec["identity"]!.AsObject();
        Assert.Equal("shadow_runtime_test_v1", identity["name"]!.GetValue<string>());
        Assert.Contains("no es una estrategia", identity["display_name"]!.GetValue<string>());
        Assert.Equal("1.0.0", identity["version"]!.GetValue<string>());
        Assert.Equal("HUMAN", identity["author"]!["type"]!.GetValue<string>());
    }

    // ── Deployment constraints ──

    [Fact]
    public void TestSpec_OnlyShadowEligible()
    {
        var spec = SpecJson();
        var modes = spec["deployment_constraints"]!["eligible_modes"]!.AsArray();
        Assert.Single(modes);
        Assert.Equal("SHADOW", modes[0]!.GetValue<string>());
    }

    // ── Universe ──

    [Fact]
    public void TestSpec_UniverseIsSpy()
    {
        var spec = SpecJson();
        var symbols = spec["universe"]!["symbols"]!.AsArray();
        Assert.Single(symbols);
        Assert.Equal("SPY", symbols[0]!.GetValue<string>());
        Assert.Equal("WHITELIST", spec["universe"]!["mode"]!.GetValue<string>());
    }

    // ── Structure ──

    [Fact]
    public void TestSpec_OnlyPutCreditSpread()
    {
        var spec = SpecJson();
        var structure = spec["structure"]!.AsObject();
        var allowed = structure["allowed_strategies"]!.AsArray();
        Assert.Single(allowed);
        Assert.Equal("put_credit_spread", allowed[0]!.GetValue<string>());
        Assert.Equal("put_credit_spread", structure["default_structure"]!.GetValue<string>());
        Assert.Equal("FIXED", structure["selection_method"]!.GetValue<string>());
    }

    [Fact]
    public void TestSpec_ForbidsNakedShort()
    {
        var spec = SpecJson();
        var forbidden = spec["structure"]!["forbidden_strategies"]!.AsArray()
            .Select(n => n!.GetValue<string>()).ToList();
        Assert.Contains("naked_short", forbidden);
        Assert.Contains("ratio_spread", forbidden);
        Assert.Contains("long_directional", forbidden);
    }

    // ── Entry filters ──

    [Fact]
    public void TestSpec_HasVixAndGexGates()
    {
        var spec = SpecJson();
        var gates = spec["entry_filters"]!["gate_layer"]!["gates"]!.AsArray();
        Assert.Equal(2, gates.Count);

        var vix = gates.First(g => g!["id"]!.GetValue<string>() == "vix_absolute")!;
        Assert.Equal("LT", vix["operator"]!.GetValue<string>());
        Assert.Equal(30, vix["threshold"]!["value"]!.GetValue<int>());

        var gex = gates.First(g => g!["id"]!.GetValue<string>() == "gex_non_negative")!;
        Assert.Equal("GTE", gex["operator"]!.GetValue<string>());
        Assert.Equal(0, gex["threshold"]!["value"]!.GetValue<int>());
    }

    // ── Candidate construction — test defaults ──

    [Fact]
    public void TestSpec_CandidateConstructionDefaults()
    {
        var spec = SpecJson();
        var cc = spec["candidate_construction"]!.AsObject();
        var legs = cc["legs"]!.AsArray();
        Assert.Equal(2, legs.Count);

        var shortLeg = legs.First(l => l!["side"]!.GetValue<string>() == "SELL")!;
        Assert.Equal("PUT", shortLeg["type"]!.GetValue<string>());
        Assert.Equal(-0.16, shortLeg["strike_selection"]!["target_delta"]!.GetValue<double>());
        Assert.Equal(0.04, shortLeg["strike_selection"]!["delta_tolerance"]!.GetValue<double>());

        var longLeg = legs.First(l => l!["side"]!.GetValue<string>() == "BUY")!;
        Assert.Equal("PUT", longLeg["type"]!.GetValue<string>());
        Assert.Equal(5.0, longLeg["strike_selection"]!["width"]!.GetValue<double>());

        var constraints = cc["constraints"]!.AsObject();
        Assert.Equal(30, constraints["min_dte"]!.GetValue<int>());
        Assert.Equal(50, constraints["max_dte"]!.GetValue<int>());
    }

    // ── Exits ──

    [Fact]
    public void TestSpec_ExitDefaults()
    {
        var spec = SpecJson();
        var exits = spec["exits"]!["deterministic"]!.AsObject();
        Assert.Equal(50.0, exits["take_profit"]!["pct_of_credit"]!.GetValue<double>());
        Assert.Equal(200.0, exits["stop_loss"]!["pct_of_credit"]!.GetValue<double>());
        Assert.Equal(7, exits["time_exit"]!["max_dte"]!.GetValue<int>());
        Assert.False(exits["defensive_roll"]!["enabled"]!.GetValue<bool>());
    }

    // ── Risk limits ──

    [Fact]
    public void TestSpec_RiskLimits()
    {
        var spec = SpecJson();
        var risk = spec["risk_limits"]!.AsObject();
        Assert.Equal(1, risk["max_concurrent_positions"]!.GetValue<int>());
        Assert.Equal(5.0, risk["max_risk_per_trade_pct"]!.GetValue<double>());
    }
}
