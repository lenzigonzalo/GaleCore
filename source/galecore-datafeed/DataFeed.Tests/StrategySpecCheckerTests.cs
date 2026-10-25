using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Tests;

/// <summary>WS-0062 inc.8a: POST /App/Runtime/Specs/Check y el mapa de lo que el runtime ejecuta.</summary>
public class StrategySpecCheckerTests
{
    private static string Sandwich() => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "sandwich_spec.json"));

    [Fact]
    public void SandwichFixture_IsValid_WithExpectedExecutedPaths()
    {
        var r = StrategySpecChecker.Check(Sandwich());

        Assert.True(r.Valid, string.Join("; ", r.Errors));
        Assert.Empty(r.Errors);
        Assert.StartsWith("sha256:", r.ContentHash);
        foreach (var p in new[]
                 {
                     "candidate_construction.legs[0].strike_selection", "candidate_construction.legs[3].strike_selection",
                     "candidate_construction.constraints.min_credit", "candidate_construction.constraints.min_dte",
                     "entry_filters.gate_layer.event_gates", "entry_filters.gate_layer.gates[0].threshold.metric_ref",
                     "exits.deterministic.time_exit.at", "exits.deterministic.take_profit", "exits.deterministic.stop_loss",
                     "execution.fill", "execution.costs",
                     "risk_limits.simulated_capital_usd", "risk_limits.reserve_pct", "risk_limits.max_open_risk_pct",
                     "risk_limits.max_bet_pct", "risk_limits.max_risk_per_trade_pct", "risk_limits.loss_brakes",
                     "operational.entry_window", "operational.trade_limits", "operational.session_hours",
                 })
            Assert.Contains(p, r.ExecutedPaths);
        // Lo que la spec no declara no aparece: ni max_debit, ni metric_exit, ni event_exits, ni slippage.
        foreach (var p in new[] { "candidate_construction.constraints.max_debit", "exits.deterministic.metric_exit", "exits.deterministic.event_exits",
                                  "execution.slippage_pct_of_spread", "exits.deterministic.time_exit.days_after_entry" })
            Assert.DoesNotContain(p, r.ExecutedPaths);
        Assert.Contains("exits.deterministic.defensive_roll", r.InertPaths);
        Assert.Contains("operational.currency", r.InertPaths);
        Assert.DoesNotContain(r.InertPaths, p => r.ExecutedPaths.Contains(p));
        Assert.Contains(r.Catalog.EventTypes, t => t.Type == "FOMC" && !t.PerSymbol && t.Precision == "time");
        Assert.Contains("capability:compute.ema.{SYMBOL}.{n}", r.Catalog.MetricPatterns);
        Assert.Contains("custom_options", r.Catalog.Structures);
        Assert.Contains("OFFSET_FROM_LEG", r.Catalog.LegSelectors);
        Assert.Equal(new[] { "natural", "mid", "mid_slippage" }, r.Catalog.FillModels);
    }

    [Fact]
    public void Hash_EqualsTheOneTheSpecsListUses()
    {
        var json = Sandwich();
        var loaded = StrategySpecLoader.LoadFromJson(json);

        Assert.Equal(loaded.ContentHash, StrategySpecChecker.Check(json).ContentHash);
        Assert.Equal(StrategySpecHasher.ComputeHash(json), loaded.Spec!.ContentHash);
    }

    [Fact]
    public void InvalidSpec_GivesSameErrorsAsDeploy_AndNoPaths()
    {
        var node = JsonNode.Parse(Sandwich())!;
        node["operational"]!["entry_window"]!["days"] = 3;                                                  // campo desconocido
        node["entry_filters"]!["gate_layer"]!["event_gates"]![0]!["type"] = "ALIEN_CONJUNCTION";            // tipo desconocido
        var bad = node.ToJsonString();

        var r = StrategySpecChecker.Check(bad);
        var deploy = StrategySpecLoader.LoadFromJson(bad);

        Assert.False(r.Valid);
        Assert.Equal(deploy.Errors, r.Errors);
        Assert.Null(r.ContentHash);
        Assert.Empty(r.ExecutedPaths);
        Assert.Contains(r.Errors, e => e.Contains("days"));

        var node2 = JsonNode.Parse(Sandwich())!;
        node2["entry_filters"]!["gate_layer"]!["event_gates"]![0]!["type"] = "ALIEN_CONJUNCTION";
        var r2 = StrategySpecChecker.Check(node2.ToJsonString());
        Assert.False(r2.Valid);
        Assert.Contains(r2.Errors, e => e.Contains("ALIEN_CONJUNCTION") && e.Contains("no data source"));
        Assert.Equal(StrategySpecLoader.LoadFromJson(node2.ToJsonString()).Errors, r2.Errors);
    }

    [Fact]
    public void ResponseJson_IsSnakeCase()
    {
        var doc = JsonDocument.Parse(JsonSerializer.Serialize(StrategySpecChecker.Check(Sandwich()), StrategySpecChecker.Json));
        var root = doc.RootElement;

        Assert.True(root.GetProperty("valid").GetBoolean());
        Assert.Equal(JsonValueKind.Array, root.GetProperty("executed_paths").ValueKind);
        Assert.Equal(JsonValueKind.Array, root.GetProperty("inert_paths").ValueKind);
        Assert.Equal(JsonValueKind.String, root.GetProperty("content_hash").ValueKind);
        var catalog = root.GetProperty("catalog");
        Assert.True(catalog.GetProperty("event_types")[0].TryGetProperty("per_symbol", out _));
        foreach (var k in new[] { "metric_patterns", "structures", "leg_selectors", "fill_models" })
            Assert.Equal(JsonValueKind.Array, catalog.GetProperty(k).ValueKind);
    }

    [Fact]
    public void ControllerRoute_IsPostRuntimeSpecsCheck_AndOnlyReadsAndChecks()
    {
        // DataFeed.Api no se referencia desde los tests (ver el csproj): se lee el fuente del controller.
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "DataFeed.Api", "Controllers", "AppController.cs"))) dir = dir.Parent;
        var src = File.ReadAllText(Path.Combine(dir!.FullName, "DataFeed.Api", "Controllers", "AppController.cs"));
        var at = src.IndexOf("[HttpPost(\"Runtime/Specs/Check\")]", StringComparison.Ordinal);

        Assert.True(at > 0, "falta la ruta POST Runtime/Specs/Check");
        var body = src[at..src.IndexOf("[HttpGet(\"Runtime/Structures\")]", at, StringComparison.Ordinal)];
        Assert.Contains("StrategySpecChecker.Check(", body);
        Assert.Contains("BadRequest", body);
        Assert.DoesNotContain("_runtimeStore", body);
        Assert.DoesNotContain("Mediator", body);
    }
}

/// <summary>Si se agrega un campo al contrato sin clasificarlo (ejecutado o inerte) en StrategySpecExecutionMap, falla acá.</summary>
public class StrategySpecExecutionMapTests
{
    private static readonly JsonNamingPolicy Snake = JsonNamingPolicy.SnakeCaseLower;

    /// <summary>Hojas del contrato en forma normalizada (snake_case, [] por lista de records).</summary>
    private static IEnumerable<string> ContractLeaves(Type type, string prefix = "")
    {
        foreach (var prop in type.GetProperties(BindingFlags.Public | BindingFlags.Instance).Where(p => p.Name != "EqualityContract"))
        {
            var path = (prefix.Length == 0 ? "" : prefix + ".") + Snake.ConvertName(prop.Name);
            var t = Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType;
            if (t.IsGenericType && t.GetGenericTypeDefinition() == typeof(List<>) && IsRecord(t.GetGenericArguments()[0]))
                foreach (var leaf in ContractLeaves(t.GetGenericArguments()[0], path + "[]")) yield return leaf;
            else if (IsRecord(t))
                foreach (var leaf in ContractLeaves(t, path)) yield return leaf;
            else
                yield return path;
        }
    }

    private static bool IsRecord(Type t) => t.IsClass && t.Namespace == typeof(StrategySpec).Namespace;

    [Fact]
    public void EveryContractField_IsClassifiedAsExecutedOrInert()
    {
        var unclassified = ContractLeaves(typeof(StrategySpec))
            .Where(leaf => StrategySpecExecutionMap.Find(leaf) == null).ToList();

        Assert.True(unclassified.Count == 0,
            "Campos del contrato sin clasificar en StrategySpecExecutionMap (¿los ejecuta el runtime o son inertes?): " + string.Join(", ", unclassified));
    }

    [Fact]
    public void EveryMapEntry_StillExistsInTheContract()
    {
        var leaves = ContractLeaves(typeof(StrategySpec)).ToList();
        var stale = StrategySpecExecutionMap.Entries.Keys
            .Where(key => !leaves.Any(l => StrategySpecExecutionMap.Covers(key, l))).ToList();

        Assert.True(stale.Count == 0, "Entradas del mapa que ya no existen en el contrato: " + string.Join(", ", stale));
    }

    [Fact]
    public void Find_PrefersTheMostSpecificEntry()
    {
        Assert.Equal(StrategySpecExecutionMap.Kind.Executed, StrategySpecExecutionMap.Find("risk_limits.loss_brakes[].period")!.Value.Kind);
        Assert.Equal("exits.deterministic.metric_exit.threshold.metric_ref",
            StrategySpecExecutionMap.Find("exits.deterministic.metric_exit.threshold.metric_ref")!.Value.Key);
        Assert.Equal("exits.deterministic.metric_exit", StrategySpecExecutionMap.Find("exits.deterministic.metric_exit.operator")!.Value.Key);
        Assert.Null(StrategySpecExecutionMap.Find("nope.nothing"));
    }
}
