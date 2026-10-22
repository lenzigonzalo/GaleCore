using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Tests;

/// <summary>WS-0036 — pestaña «Datos»: de dónde sale cada dato de una estrategia y qué vio en su última evaluación.</summary>
public class StrategyDataTests
{
    private static readonly DateTime Now = new(2026, 10, 14, 20, 0, 0, DateTimeKind.Utc);

    private static StrategySpec Spec(params GateDefinition[] gates) => new()
    {
        Identity = new SpecIdentity { Name = "a", Version = "1.0.1" },
        EntryFilters = new EntryFilters { GateLayer = new GateLayer { Gates = gates.ToList() } },
        CandidateConstruction = new CandidateConstruction { Legs = new List<LegTemplate> { new() } },
    };

    [Theory]
    [InlineData("capability:market_data.trade.VIX.price", "market_data.trade")]
    [InlineData("capability:compute.gamma_exposure.SPY.net_gex", "compute.gamma_exposure")]
    [InlineData("compute.iv_rank.SPY", "compute.iv_rank")]
    [InlineData("capability:otra.cosa", null)]
    public void CapabilityOf_TakesTheCatalogEntry(string metricRef, string? expected) =>
        Assert.Equal(expected, StrategyData.CapabilityOf(metricRef));

    [Fact]
    public void Build_ListsLegDataAndGates_WithWhatTheLastEvaluationSaw()
    {
        var spec = Spec(
            new GateDefinition { Id = "G1", Label = "VIX < 25", MetricRef = "capability:market_data.trade.VIX.price" },
            new GateDefinition { Id = "G2", Label = "IV Rank ≥ 30", MetricRef = "capability:compute.iv_rank.SPY.value" },
            new GateDefinition { Id = "G3", Label = "Algo nuevo", MetricRef = "capability:otra.cosa" });
        var eval = new EvaluationResult
        {
            EvaluatedAt = Now.AddMinutes(-5),
            GateResults = new List<GateResult>
            {
                new() { GateId = "G1", Status = "PASS", Value = 17.2 },
                new() { GateId = "G2", Status = "NO_DATA" },
            },
        };

        var rep = StrategyData.Build(spec, eval, Now);

        Assert.Equal("a", rep.Spec);
        Assert.Equal("1.0.1", rep.Version);
        Assert.Equal(Now.AddMinutes(-5), rep.LastEvaluationAt);
        Assert.Equal(6, rep.Items.Count); // 3 de las patas + 3 gates
        Assert.Contains(rep.Items, i => i.Capability == "market_data.quote" && i.GateId == null && i.LastStatus == null);

        var vix = rep.Items.Single(i => i.GateId == "G1");
        Assert.Equal("Tastytrade (DXLink)", vix.Source);
        Assert.Equal("del momento", vix.Kind);
        Assert.Equal(17.2, vix.LastValue);
        Assert.Equal("PASS", vix.LastStatus);
        Assert.Equal(Now.AddMinutes(-5), vix.LastAt);

        var ivr = rep.Items.Single(i => i.GateId == "G2");
        Assert.Equal("NO_DATA", ivr.LastStatus);
        Assert.Null(ivr.LastValue);
        Assert.Contains("IV Percentile", ivr.Note);

        var unknown = rep.Items.Single(i => i.GateId == "G3");
        Assert.Equal("sin catálogo", unknown.Source);
        Assert.Null(unknown.LastAt);
    }

    [Fact]
    public void Build_WithoutEvaluation_HasNoLastValues()
    {
        var rep = StrategyData.Build(Spec(new GateDefinition { Id = "G1", Label = "VIX", MetricRef = "capability:market_data.trade.VIX.price" }), null, Now);
        Assert.Null(rep.LastEvaluationAt);
        Assert.All(rep.Items, i => Assert.Null(i.LastAt));
        Assert.False(string.IsNullOrEmpty(rep.Storage));
    }

    [Fact]
    public void Every_catalog_entry_names_its_endpoint_and_only_the_skew_is_stored()
    {
        Assert.All(StrategyData.Catalog, kv => Assert.StartsWith("/", kv.Value.Endpoint));
        Assert.Equal(new[] { "compute.put_skew" }, StrategyData.Catalog.Where(kv => kv.Value.StoredBy != null).Select(kv => kv.Key));
        var rep = StrategyData.Build(Spec(new GateDefinition { Id = "G1", Label = "VIX", MetricRef = "capability:market_data.trade.VIX.price" }), null, Now);
        Assert.All(rep.Items, i => Assert.False(string.IsNullOrEmpty(i.Frequency)));
        Assert.Equal("/Data/Tastytrade/MarketData/Trade", rep.Items.Single(i => i.GateId == "G1").Endpoint);
    }
}
