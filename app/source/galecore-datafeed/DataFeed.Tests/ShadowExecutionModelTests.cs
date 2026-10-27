using System.Text.Json.Nodes;
using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Tests;

/// <summary>
/// WS-0062 inc.2 — modelo de ejecución de la spec: fill natural por defecto (compra al ask, venta al bid), mid, mid con
/// deslizamiento; costos declarados en entrada y salida; P&amp;L bruto y neto. Que mid sin costos reproduce los
/// resultados de antes lo prueban los tests existentes, que usan Spec() con fill mid.
/// </summary>
public class ShadowExecutionModelTests
{
    private static readonly DateTime Now = ShadowRuntimeEngineTests.Now;

    private static SpecExecution Exec(string fill = "natural", double? slip = null, ExecutionCosts? costs = null) =>
        new() { Fill = fill, SlippagePctOfSpread = slip, Costs = costs };

    private static StrategySpec Condor(SpecExecution? execution) =>
        CreditSpreadCandidateBuilderTests.SpecFor(RuntimeStructures.IronCondor) with { Execution = execution };

    // ── Contrato y validador ────────────────────────────────────────

    [Fact]
    public void SpecWithoutExecutionBlock_IsNatural_WithoutDeclaredCosts()
    {
        var spec = ShadowRuntimeEngineTests.NaturalSpec();
        Assert.Null(spec.Execution);
        var terms = ExecutionTerms.From(spec);
        Assert.Equal("natural", terms.Fill);
        Assert.False(terms.CostsDeclared);
        Assert.Equal(1.0, terms.AdverseFraction);
        Assert.True(StrategySpecValidator.Validate(spec).IsValid);
    }

    [Fact]
    public void ExecutionBlock_LoadsFromSnakeCaseJson()
    {
        var node = JsonNode.Parse(ShadowRuntimeEngineTests.SpecJson())!.AsObject();
        node["execution"] = JsonNode.Parse(
            "{ \"fill\": \"mid_slippage\", \"slippage_pct_of_spread\": 40, " +
            "\"costs\": { \"per_contract_usd\": 0.65, \"per_share_usd\": 0.005, \"per_order_usd\": 1 } }");
        var r = StrategySpecLoader.LoadFromJson(node.ToJsonString());

        Assert.True(r.Success, string.Join("; ", r.Errors));
        var terms = ExecutionTerms.From(r.Spec!);
        Assert.Equal(("mid_slippage", 40.0, 0.65, 0.005, 1.0, true),
            (terms.Fill, terms.SlippagePctOfSpread, terms.PerContractUsd, terms.PerShareUsd, terms.PerOrderUsd, terms.CostsDeclared));
        Assert.Equal(0.4, terms.AdverseFraction);
    }

    [Fact]
    public void ExecutionBlock_UnknownField_IsRejected()
    {
        var node = JsonNode.Parse(ShadowRuntimeEngineTests.SpecJson())!.AsObject();
        node["execution"] = JsonNode.Parse("{ \"fill\": \"mid\", \"comision\": 1 }");
        Assert.False(StrategySpecLoader.LoadFromJson(node.ToJsonString()).Success);
    }

    [Theory]
    [InlineData("natural", null, true)]
    [InlineData("mid", null, true)]
    [InlineData("mid_slippage", 0.0, true)]
    [InlineData("mid_slippage", 100.0, true)]
    [InlineData("mid_slippage", null, false)]    // falta el %
    [InlineData("mid_slippage", 100.1, false)]
    [InlineData("mid_slippage", -1.0, false)]
    [InlineData("natural", 50.0, false)]         // % sin deslizamiento
    [InlineData("vwap", null, false)]
    public void Validator_ChecksFillAndSlippage(string fill, double? slip, bool valid)
    {
        var spec = ShadowRuntimeEngineTests.NaturalSpec() with { Execution = Exec(fill, slip) };
        Assert.Equal(valid, StrategySpecValidator.Validate(spec).IsValid);
    }

    [Theory]
    [InlineData(0.65, 0.005, 1.0, true)]
    [InlineData(-0.01, null, null, false)]
    [InlineData(null, -1.0, null, false)]
    [InlineData(null, null, 5000.0, false)]
    public void Validator_ChecksCostRanges(double? perContract, double? perShare, double? perOrder, bool valid)
    {
        var costs = new ExecutionCosts { PerContractUsd = perContract, PerShareUsd = perShare, PerOrderUsd = perOrder };
        var spec = ShadowRuntimeEngineTests.NaturalSpec() with { Execution = Exec(costs: costs) };
        Assert.Equal(valid, StrategySpecValidator.Validate(spec).IsValid);
    }

    // ── Precio de cada pata ─────────────────────────────────────────

    [Fact]
    public async Task IronCondor_Natural_CreditIsBidsSoldMinusAsksBought()
    {
        // Puts 720 vendida 4.10/4.30, 715 comprada 3.40/3.60; calls 810 vendida 2.00/2.20, 815 comprada 1.40/1.60.
        var result = await CreditSpreadCandidateBuilderTests.Build(CreditSpreadCandidateBuilderTests.WithCallQuotes(), Condor(null));

        var c = Assert.IsType<TradeCandidate>(result.Candidate);
        Assert.Equal(0.9, c.Credit);                 // (4.10 + 2.00) − (3.60 + 1.60); al mid era 1.30
        Assert.Equal(410, c.MaxRisk);                // (5 − 0.90) × 100

        var pos = ShadowFillSimulator.Fill(c, Now);  // sin terms = natural
        Assert.Equal(new[] { 4.10, 3.60, 2.00, 1.60 }, pos.Legs.Select(l => l.EntryPrice));
        Assert.Equal(0.9, pos.EntryCredit);
        Assert.Equal("natural", ShadowFillSimulator.TermsOf(pos).Fill);
    }

    [Fact]
    public async Task IronCondor_MidSlippage_MovesFromMidTowardTheUnfavorableSide()
    {
        var spec = Condor(Exec("mid_slippage", 50));
        var result = await CreditSpreadCandidateBuilderTests.Build(CreditSpreadCandidateBuilderTests.WithCallQuotes(), spec);

        var c = Assert.IsType<TradeCandidate>(result.Candidate);
        // 50 % del medio spread (0.10) = 0.05 en contra por pata: vendidas −0.05, compradas +0.05.
        Assert.Equal(1.1, c.Credit);                 // mid 1.30 − 4 × 0.05
        var pos = ShadowFillSimulator.Fill(c, Now, ExecutionTerms.From(spec));
        Assert.Equal(new[] { 4.15, 3.55, 2.05, 1.55 }, pos.Legs.Select(l => l.EntryPrice));
    }

    [Fact]
    public void LegPrice_ZeroAndFullSlippage_AreMidAndNatural()
    {
        Assert.Equal(1.6, ShadowFillSimulator.LegPrice(1.5, 1.7, buying: true, new ExecutionTerms { Fill = "mid_slippage", SlippagePctOfSpread = 0 }, 4));
        Assert.Equal(1.7, ShadowFillSimulator.LegPrice(1.5, 1.7, buying: true, new ExecutionTerms { Fill = "mid_slippage", SlippagePctOfSpread = 100 }, 4));
        Assert.Equal(1.5, ShadowFillSimulator.LegPrice(1.5, 1.7, buying: false, new ExecutionTerms(), 4));
    }

    // ── Costos y P&L bruto / neto ───────────────────────────────────

    [Fact]
    public async Task Costs_FourLegs_AreChargedOnEntryAndOnExit()
    {
        var spec = Condor(Exec(costs: new ExecutionCosts { PerContractUsd = 0.65, PerOrderUsd = 1.0 }));
        var c = (await CreditSpreadCandidateBuilderTests.Build(CreditSpreadCandidateBuilderTests.WithCallQuotes(), spec)).Candidate!;
        var pos = ShadowFillSimulator.Fill(c, Now, ExecutionTerms.From(spec));

        // Una orden: 4 patas × 1 contrato × 0.65 + 1.00 = 3.60; entrada + salida = 7.20.
        Assert.Equal(3.6, ShadowFillSimulator.OrderCost(pos, ShadowFillSimulator.TermsOf(pos)));
        Assert.Equal(7.2, ShadowFillSimulator.Costs(pos));
        Assert.True(ShadowFillSimulator.TermsOf(pos).CostsDeclared);

        // Abierta valuada: bruto (0.90 − 0.50) × 100 = 40; neto = 40 − 7.20 (incluye lo que costaría salir).
        Assert.Equal(40.0, ShadowFillSimulator.GrossPnl(pos, 0.50));
        Assert.Equal(32.8, ShadowFillSimulator.Pnl(pos, 0.50));

        var closed = ShadowFillSimulator.Close(pos, 0.50, "TAKE_PROFIT", Now.AddDays(1));
        Assert.Equal(32.8, closed.RealizedPnl);
        Assert.Equal(40.0, ShadowFillSimulator.GrossOf(closed));
    }

    [Fact]
    public async Task Costs_Shares_UsePerShare_AndNaturalCrossesTheSpread()
    {
        var spec = LongEquityTests.NaturalEquitySpec() with { Execution = Exec(costs: new ExecutionCosts { PerShareUsd = 0.005, PerOrderUsd = 1.0 }) };
        Assert.True(StrategySpecValidator.Validate(spec).IsValid);
        var built = await LongEquityCandidateBuilder.BuildAsync(
            (_, _) => Task.FromResult<LegQuote?>(new LegQuote(269.90, 270.10, Now)), ShadowRuntimeEngineTests.NewRuntime().Instance, spec, "AAPL", Now, default);
        var c = built.Candidate!;
        Assert.Equal(-270.10, c.Credit);             // compra al ask
        Assert.Equal(2701.0, c.MaxRisk);

        var pos = ShadowFillSimulator.Fill(c, Now, ExecutionTerms.From(spec));
        Assert.Equal(270.10, pos.Legs.Single().EntryPrice);
        // Por orden: 10 acciones × 0.005 + 1.00 = 1.05; entrada + salida = 2.10.
        Assert.Equal(2.1, ShadowFillSimulator.Costs(pos));

        // Vender al bid 274.90: bruto (274.90 − 270.10) × 10 = 48.00; neto 45.90.
        var closed = ShadowFillSimulator.Close(pos, -274.90, "METRIC_EXIT", Now.AddDays(1));
        Assert.Equal(45.9, closed.RealizedPnl);
        Assert.Equal(48.0, ShadowFillSimulator.GrossOf(closed));
    }

    [Fact]
    public void NoDeclaredCosts_NetEqualsGross_AndSaysSo()
    {
        var pos = ShadowFillSimulator.Fill(ShadowRuntimeEngineTests.RealCandidate(), Now);   // natural, sin costos
        Assert.False(ShadowFillSimulator.TermsOf(pos).CostsDeclared);
        Assert.Equal(0.0, ShadowFillSimulator.Costs(pos));
        var closed = ShadowFillSimulator.Close(pos, 0.40, "TAKE_PROFIT", Now);
        Assert.Equal(closed.RealizedPnl, ShadowFillSimulator.GrossOf(closed));

        var m = ShadowMetrics.Compute(new SpecVersionRecord { Positions = new() { closed } });
        Assert.False(m.CostsDeclared);
        Assert.Equal(m.RealizedPnl, m.RealizedGrossPnl);
        Assert.Equal(0.0, m.RealizedCosts);
    }

    [Fact]
    public void Metrics_AreNet_AndExposeGrossAndCosts()
    {
        var spec = ShadowRuntimeEngineTests.NaturalSpec() with { Execution = Exec(costs: new ExecutionCosts { PerContractUsd = 0.65 }) };
        var pos = ShadowFillSimulator.Fill(ShadowRuntimeEngineTests.RealCandidate(), Now, ExecutionTerms.From(spec));
        var closed = ShadowFillSimulator.Close(pos, 0.35, "TAKE_PROFIT", Now);   // bruto 50; costos 2 órdenes × 2 patas × 0.65 = 2.60

        var m = ShadowMetrics.Compute(new SpecVersionRecord { Positions = new() { closed } });

        Assert.Equal(47.4, m.RealizedPnl);
        Assert.Equal(50.0, m.RealizedGrossPnl);
        Assert.Equal(2.6, m.RealizedCosts);
        Assert.True(m.CostsDeclared);
        Assert.Equal(1.0, m.WinRate);
    }

    // ── TP / SL con precios al natural ──────────────────────────────

    private static async Task<(ShadowRuntimeStore, ShadowPosition, ShadowRuntimeEngineTests.FakeData)> OpenNatural()
    {
        var (store, instance) = ShadowRuntimeEngineTests.NewRuntime();
        var data = new ShadowRuntimeEngineTests.FakeData { Build = () => CandidateBuildResult.Built(ShadowRuntimeEngineTests.RealCandidate()) };
        await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, ShadowRuntimeEngineTests.NaturalSpec(), "SPY", Now, default);
        var pos = store.AllPositions().Single();
        Assert.Equal("natural", ShadowFillSimulator.TermsOf(pos).Fill);
        Assert.Equal(new[] { 1.50, 0.90 }, pos.Legs.Select(l => l.EntryPrice));   // vendida al bid, comprada al ask
        return (store, pos, data);
    }

    [Fact]
    public async Task TakeProfit_NaturalPrices_DoNotTriggerWhereTheMidWould()
    {
        var (store, pos, data) = await OpenNatural();
        var exits = ShadowRuntimeEngineTests.NaturalSpec().Exits.Deterministic;
        // Crédito 0.85 → TP 50 % cuando el débito ≤ 0.425. Al mid: 0.60 − 0.25 = 0.35 (dispararía). Natural: 0.70 − 0.20 = 0.50.
        data.Quotes[".SPY261030P720"] = new LegQuote(0.50, 0.70, Now);
        data.Quotes[".SPY261030P715"] = new LegQuote(0.20, 0.30, Now);

        var outcome = await ShadowRuntimeEngine.ValuePositionAsync(store, data, pos, exits, Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, outcome);
        Assert.Equal(0.5, store.GetPosition(pos.PositionId)!.LastSpreadValue);
        Assert.Equal(35.0, store.GetPosition(pos.PositionId)!.UnrealizedPnl);    // (0.85 − 0.50) × 100

        // Con el ask de la vendida en 0.60 el débito natural es 0.40 ≤ 0.425: cierra al take profit con P&L al natural.
        data.Quotes[".SPY261030P720"] = new LegQuote(0.50, 0.60, Now);
        outcome = await ShadowRuntimeEngine.ValuePositionAsync(store, data, store.GetPosition(pos.PositionId)!, exits, Now, default);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed, outcome);
        var closed = store.GetPosition(pos.PositionId)!;
        Assert.Equal("TAKE_PROFIT", closed.ExitReason);
        Assert.Equal(0.4, closed.ExitDebit);
        Assert.Equal(45.0, closed.RealizedPnl);
    }

    [Fact]
    public async Task StopLoss_NaturalPrices_TriggerWhereTheMidWouldNot()
    {
        var (store, pos, data) = await OpenNatural();
        // SL 200 %: pérdida ≥ 1.70 → débito ≥ 2.55. Al mid: 2.50 − 0.05 = 2.45 (no). Natural: 2.60 − 0.00 = 2.60 (sí).
        data.Quotes[".SPY261030P720"] = new LegQuote(2.40, 2.60, Now);
        data.Quotes[".SPY261030P715"] = new LegQuote(0.00, 0.10, Now);

        var outcome = await ShadowRuntimeEngine.ValuePositionAsync(
            store, data, pos, ShadowRuntimeEngineTests.NaturalSpec().Exits.Deterministic, Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed, outcome);
        var closed = store.GetPosition(pos.PositionId)!;
        Assert.Equal("STOP_LOSS", closed.ExitReason);
        Assert.Equal(2.6, closed.ExitDebit);
        Assert.Equal(-175.0, closed.RealizedPnl);
    }

    [Fact]
    public async Task PositionsFromBeforeThisChange_KeepTheirMidTerms()
    {
        var (store, _) = ShadowRuntimeEngineTests.NewRuntime();
        var legacy = ShadowFillSimulator.Fill(ShadowRuntimeEngineTests.RealCandidate(), Now, ShadowFillSimulatorTests.MidTerms) with { EntryContext = null };
        Assert.Equal(ExecutionTerms.Legacy, ShadowFillSimulator.TermsOf(legacy));
        store.AddPosition(legacy);
        var data = new ShadowRuntimeEngineTests.FakeData();
        data.Quotes[".SPY261030P720"] = new LegQuote(1.20, 1.30, Now);
        data.Quotes[".SPY261030P715"] = new LegQuote(0.60, 0.70, Now);

        await ShadowRuntimeEngine.ValuePositionAsync(store, data, legacy, ShadowRuntimeEngineTests.NaturalSpec().Exits.Deterministic, Now, default);

        Assert.Equal(0.6, store.GetPosition(legacy.PositionId)!.LastSpreadValue);   // al mid, como entró
    }
}
