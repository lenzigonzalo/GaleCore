using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Tests;

/// <summary>
/// Congela el comportamiento del evaluador genérico de gates.
/// Cubre: todos los operadores, on_fail, on_no_data, BETWEEN, overall pass/fail.
/// </summary>
public class GenericGateEvaluatorTests
{
    private static GateDefinition Gate(string id, string op, double? value = null, double? min = null, double? max = null,
        string onFail = "NO_TRADE", string onNoData = "BLOCK") => new()
    {
        Id = id,
        Label = id,
        MetricRef = $"metric:{id}",
        Operator = op,
        Threshold = new GateThreshold { Value = value, Min = min, Max = max },
        OnFail = onFail,
        OnNoData = onNoData
    };

    // ── Operadores ──

    [Theory]
    [InlineData("LT", 30, 25, true)]
    [InlineData("LT", 30, 30, false)]
    [InlineData("LT", 30, 35, false)]
    [InlineData("LTE", 30, 30, true)]
    [InlineData("LTE", 30, 31, false)]
    [InlineData("GT", 0, 1, true)]
    [InlineData("GT", 0, 0, false)]
    [InlineData("GT", 0, -1, false)]
    [InlineData("GTE", 0, 0, true)]
    [InlineData("GTE", 0, -1, false)]
    [InlineData("EQ", 10, 10, true)]
    [InlineData("EQ", 10, 10.5, false)]
    [InlineData("NEQ", 10, 11, true)]
    [InlineData("NEQ", 10, 10, false)]
    public void Operator_EvaluatesCorrectly(string op, double threshold, double value, bool expected)
    {
        var result = GenericGateEvaluator.EvaluateOperator(op, value, new GateThreshold { Value = threshold });
        Assert.Equal(expected, result);
    }

    [Theory]
    [InlineData(10, 20, 15, true)]
    [InlineData(10, 20, 10, true)]
    [InlineData(10, 20, 20, true)]
    [InlineData(10, 20, 9, false)]
    [InlineData(10, 20, 21, false)]
    public void Between_EvaluatesCorrectly(double min, double max, double value, bool expected)
    {
        var result = GenericGateEvaluator.EvaluateOperator("BETWEEN", value, new GateThreshold { Min = min, Max = max });
        Assert.Equal(expected, result);
    }

    // ── Gate individual ──

    [Fact]
    public void Gate_Pass()
    {
        var gate = Gate("vix", "LT", 30);
        var metrics = new Dictionary<string, double?> { ["metric:vix"] = 25.0 };
        var result = GenericGateEvaluator.EvaluateGate(gate, metrics);
        Assert.Equal("PASS", result.Status);
        Assert.Equal(25.0, result.Value);
    }

    [Fact]
    public void Gate_Fail()
    {
        var gate = Gate("vix", "LT", 30);
        var metrics = new Dictionary<string, double?> { ["metric:vix"] = 35.0 };
        var result = GenericGateEvaluator.EvaluateGate(gate, metrics);
        Assert.Equal("FAIL", result.Status);
    }

    [Fact]
    public void Gate_NoData_MetricMissing()
    {
        var gate = Gate("vix", "LT", 30);
        var metrics = new Dictionary<string, double?>();
        var result = GenericGateEvaluator.EvaluateGate(gate, metrics);
        Assert.Equal("NO_DATA", result.Status);
    }

    [Fact]
    public void Gate_NoData_MetricNull()
    {
        var gate = Gate("vix", "LT", 30);
        var metrics = new Dictionary<string, double?> { ["metric:vix"] = null };
        var result = GenericGateEvaluator.EvaluateGate(gate, metrics);
        Assert.Equal("NO_DATA", result.Status);
    }

    // ── Evaluación de capa completa ──

    [Fact]
    public void AllGatesPass_OverallPass()
    {
        var gates = new List<GateDefinition>
        {
            Gate("vix", "LT", 30),
            Gate("gex", "GTE", 0)
        };
        var metrics = new Dictionary<string, double?>
        {
            ["metric:vix"] = 20.0,
            ["metric:gex"] = 100.0
        };

        var result = GenericGateEvaluator.Evaluate(gates, "ALL", "NO_TRADE", metrics, "inst-1", "SPY");

        Assert.True(result.OverallPass);
        Assert.Equal(2, result.GateResults.Count);
        Assert.All(result.GateResults, g => Assert.Equal("PASS", g.Status));
    }

    [Fact]
    public void OneGateFails_NoTrade_OverallFail()
    {
        var gates = new List<GateDefinition>
        {
            Gate("vix", "LT", 30, onFail: "NO_TRADE"),
            Gate("gex", "GTE", 0, onFail: "NO_TRADE")
        };
        var metrics = new Dictionary<string, double?>
        {
            ["metric:vix"] = 35.0,  // FAIL
            ["metric:gex"] = 100.0  // PASS
        };

        var result = GenericGateEvaluator.Evaluate(gates, "ALL", "NO_TRADE", metrics, "inst-1", "SPY");

        Assert.False(result.OverallPass);
        Assert.Equal("FAIL", result.GateResults[0].Status);
        Assert.Equal("PASS", result.GateResults[1].Status);
    }

    [Fact]
    public void OneGateFails_InformOnly_OverallStillPass()
    {
        var gates = new List<GateDefinition>
        {
            Gate("vix", "LT", 30, onFail: "INFORM_ONLY"),
            Gate("gex", "GTE", 0, onFail: "NO_TRADE")
        };
        var metrics = new Dictionary<string, double?>
        {
            ["metric:vix"] = 35.0,  // FAIL but INFORM_ONLY
            ["metric:gex"] = 100.0  // PASS
        };

        var result = GenericGateEvaluator.Evaluate(gates, "ALL", "NO_TRADE", metrics, "inst-1", "SPY");

        Assert.True(result.OverallPass);
        Assert.Equal("FAIL", result.GateResults[0].Status);
    }

    [Fact]
    public void NoData_Block_OverallFail()
    {
        var gates = new List<GateDefinition>
        {
            Gate("vix", "LT", 30, onNoData: "BLOCK")
        };
        var metrics = new Dictionary<string, double?>();

        var result = GenericGateEvaluator.Evaluate(gates, "ALL", "NO_TRADE", metrics, "inst-1", "SPY");

        Assert.False(result.OverallPass);
        Assert.Equal("NO_DATA", result.GateResults[0].Status);
    }

    [Fact]
    public void NoData_Pass_OverallStillPass()
    {
        var gates = new List<GateDefinition>
        {
            Gate("vix", "LT", 30, onNoData: "PASS")
        };
        var metrics = new Dictionary<string, double?>();

        var result = GenericGateEvaluator.Evaluate(gates, "ALL", "NO_TRADE", metrics, "inst-1", "SPY");

        Assert.True(result.OverallPass);
    }

    [Fact]
    public void EmptyGates_OverallPass()
    {
        var result = GenericGateEvaluator.Evaluate(
            new List<GateDefinition>(), "ALL", "NO_TRADE",
            new Dictionary<string, double?>(), "inst-1", "SPY");

        Assert.True(result.OverallPass);
        Assert.Empty(result.GateResults);
    }

    [Fact]
    public void EvaluationResult_HasMetadata()
    {
        var gates = new List<GateDefinition> { Gate("vix", "LT", 30) };
        var metrics = new Dictionary<string, double?> { ["metric:vix"] = 20.0 };

        var result = GenericGateEvaluator.Evaluate(gates, "ALL", "NO_TRADE", metrics, "inst-1", "SPY");

        Assert.Equal("inst-1", result.InstanceId);
        Assert.Equal("SPY", result.Symbol);
        Assert.NotEmpty(result.EvaluationId);
        Assert.True(result.EvaluatedAt > DateTime.MinValue);
    }
}
