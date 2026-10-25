using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;
using static DataFeed.Tests.ShadowRuntimeEngineTests;

namespace DataFeed.Tests;

/// <summary>
/// WS-0062 inc.10 — N contratos por posición de opciones según sizing: FIXED y RISK_BASED con el tope de siempre, sin tope o sin lugar para
/// uno no entra (con motivo), costos / P&amp;L / pérdida máxima / liquidación ×N, y una posición anterior sin cantidad vale lo de siempre.
/// </summary>
[Collection("RuntimeStaticCaches")]
public class ShadowSizingTests
{
    private static StrategySpec With(string method, int? fixedContracts = null, double? capital = null, double? riskPct = null, double? maxLossUsd = null,
        double? openPct = null, double? betPct = null)
    {
        var spec = Spec();
        return spec with
        {
            CandidateConstruction = spec.CandidateConstruction with { Sizing = new SizingConfig { Method = method, FixedContracts = fixedContracts } },
            RiskLimits = spec.RiskLimits with
            {
                SimulatedCapitalUsd = capital, MaxRiskPerTradePct = riskPct, MaxLossPerTradeUsd = maxLossUsd, MaxOpenRiskPct = openPct, MaxBetPct = betPct,
            },
        };
    }

    // ── La fórmula ───────────────────────────────────────────────────────────

    [Fact]
    public void Fixed3_ScalesTheMaxLoss_AndPutsTheQuantityOnEveryLeg()
    {
        var (sized, reason) = ShadowSizing.Apply(With("FIXED", 3), RealCandidate(), null);

        Assert.Null(reason);
        Assert.Equal(1245, sized!.MaxRisk);                    // 415 × 3
        Assert.All(sized.Legs, l => Assert.Equal(3, l.Quantity));
        Assert.Equal((0.85, 5.0), (sized.Credit, sized.Width));   // precios y ancho: por contrato
    }

    [Fact]
    public void Fixed3_CostsPnlAndMaxLossAreTimes3()
    {
        var terms = new ExecutionTerms { Fill = ExecutionTerms.Mid, PerContractUsd = 0.65, PerOrderUsd = 1, CostsDeclared = true };
        var one = ShadowFillSimulator.Fill(ShadowSizing.Apply(With("FIXED", 1), RealCandidate(), null).Candidate!, Now, terms);
        var three = ShadowFillSimulator.Fill(ShadowSizing.Apply(With("FIXED", 3), RealCandidate(), null).Candidate!, Now, terms);

        Assert.Equal(3, ShadowFillSimulator.Contracts(three));
        Assert.Equal(1245, three.MaxRisk);
        Assert.Equal(2.3, ShadowFillSimulator.OrderCost(one, terms));      // 2 patas × 0,65 + 1 por orden
        Assert.Equal(4.9, ShadowFillSimulator.OrderCost(three, terms));    // 6 contratos × 0,65 + 1 por orden (la orden no cambia)
        Assert.Equal(105.0, ShadowFillSimulator.GrossPnl(three, 0.5));     // (0,85 − 0,50) × 100 × 3
        Assert.Equal(95.2, ShadowFillSimulator.Pnl(three, 0.5));           // 105 − 2 × 4,90
        Assert.Equal(9.8, ShadowFillSimulator.Costs(three));
        Assert.Equal(35.0, ShadowFillSimulator.GrossPnl(one, 0.5));
    }

    [Theory]
    [InlineData(10_000.0, 9.0, null, 10_000.0, 2)]    // 9 % de 10.000 = 900 → 900 / 415 = 2,16
    [InlineData(10_000.0, 9.0, 850.0, 10_000.0, 2)]   // el menor de 900 y 850 → 2,05
    [InlineData(10_000.0, 9.0, 800.0, 10_000.0, 1)]   // 800 → 1,93
    [InlineData(10_000.0, 9.0, null, 5_000.0, 1)]     // equity 5.000 (pérdidas realizadas): 450 → 1,08
    [InlineData(null, null, 1_000.0, null, 2)]  // sólo USD fijo: no necesita capital
    public void RiskBased_IsTheCapOverTheMaxLossOfOneContract(double? capital, double? pct, double? maxLoss, double? equity, int expected)
    {
        var (sized, reason) = ShadowSizing.Apply(With("RISK_BASED", capital: capital, riskPct: pct, maxLossUsd: maxLoss), RealCandidate(), equity);

        Assert.Null(reason);
        Assert.Equal(expected, sized!.Legs[0].Quantity);
        Assert.Equal(415 * expected, sized.MaxRisk);
    }

    [Fact]
    public void RiskBased_SameFormulaAsTheCapitalAllocation()
    {
        // AllocateOne y el runtime comparten tope y piso: 900 / 415 = 2.
        Assert.Equal(900.0, ShadowCapital.PerTradeCapUsd(900, null));
        Assert.Equal(850.0, ShadowCapital.PerTradeCapUsd(900, 850));
        Assert.Equal(850.0, ShadowCapital.PerTradeCapUsd(null, 850));
        Assert.Null(ShadowCapital.PerTradeCapUsd(null, null));
        Assert.Null(ShadowCapital.PerTradeCapUsd(null, 0));
        Assert.Equal(2, ShadowCapital.ContractsWithin(900, 415));
        Assert.Equal(0, ShadowCapital.ContractsWithin(400, 415));
    }

    [Fact]
    public void RiskBased_CapBelowOneContract_DoesNotEnter_WithReason()
    {
        var (sized, reason) = ShadowSizing.Apply(With("RISK_BASED", maxLossUsd: 400), RealCandidate(), null);

        Assert.Null(sized);
        Assert.Contains("ni un contrato entra", reason);
        Assert.Contains("415", reason);
    }

    [Theory]
    [InlineData(null, null, null)]       // sin nada declarado
    [InlineData(null, 5.0, null)]        // % sin capital: no hay contra qué medir
    [InlineData(10_000.0, null, null)]   // capital sin % ni USD: no se inventa un tope
    public void RiskBased_WithoutACap_DoesNotEnter_WithReason(double? capital, double? pct, double? maxLoss)
    {
        var (sized, reason) = ShadowSizing.Apply(With("RISK_BASED", capital: capital, riskPct: pct, maxLossUsd: maxLoss), RealCandidate(), capital);

        Assert.Null(sized);
        Assert.Contains("sin tope por operación calculable", reason);
    }

    [Fact]
    public void Kelly_FixedWithoutContracts_AndLongEquity_AreHandledExplicitly()
    {
        Assert.Contains("no se ejecuta con opciones", ShadowSizing.Apply(With("KELLY"), RealCandidate(), null).Reason);
        Assert.Contains("fixed_contracts", ShadowSizing.Apply(With("FIXED"), RealCandidate(), null).Reason);
        var stock = RealCandidate() with { Structure = RuntimeStructures.LongEquity };
        Assert.Same(stock, ShadowSizing.Apply(With("FIXED", 5), stock, null).Candidate);   // las acciones ya traen su cantidad
    }

    // ── El validador de la spec ──────────────────────────────────────────────

    [Fact]
    public void Validator_Sizing_KellyFixedWithoutContractsAndRiskBasedWithoutCap_AreRejected()
    {
        Assert.Contains(StrategySpecValidator.Validate(With("KELLY")).Errors, e => e.Contains("KELLY is not executed"));
        Assert.Contains(StrategySpecValidator.Validate(With("FIXED")).Errors, e => e.Contains("fixed_contracts must be > 0"));
        Assert.Contains(StrategySpecValidator.Validate(With("RISK_BASED")).Errors, e => e.Contains("RISK_BASED needs"));
        Assert.Contains(StrategySpecValidator.Validate(With("RISK_BASED", riskPct: 5)).Errors, e => e.Contains("RISK_BASED needs"));

        foreach (var ok in new[] { With("FIXED", 3), With("RISK_BASED", maxLossUsd: 500), With("RISK_BASED", capital: 10_000, riskPct: 5) })
            Assert.True(StrategySpecValidator.Validate(ok).IsValid, string.Join("; ", StrategySpecValidator.Validate(ok).Errors));
    }

    // ── El runtime ───────────────────────────────────────────────────────────

    private static async Task<(string Outcome, ShadowRuntimeStore Store)> Enter(StrategySpec spec)
    {
        var (store, instance) = NewRuntime();
        var data = new FakeData { Build = () => CandidateBuildResult.Built(RealCandidate()) };
        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, spec, "SPY", Now, default);
        return (outcome, store);
    }

    [Fact]
    public async Task Entry_Fixed3_OpensWithThreeContractsOnEveryLeg()
    {
        var (outcome, store) = await Enter(With("FIXED", 3));

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, outcome);
        var p = Assert.Single(store.AllPositions());
        Assert.Equal(1245, p.MaxRisk);
        Assert.All(p.Legs, l => Assert.Equal(3, l.Quantity));
        Assert.Equal(3, store.GetEvents("i-1").Single(e => e.EventType == "POSITION_OPENED").Payload["contracts"]);
    }

    [Fact]
    public async Task Entry_RiskBasedWithoutCap_IsADiscard_NoPosition()
    {
        var (outcome, store) = await Enter(With("RISK_BASED"));

        Assert.Equal(ShadowRuntimeEngine.Outcomes.RiskLimit, outcome);
        Assert.Empty(store.AllPositions());
        var skipped = store.GetEvents("i-1").Single(e => e.EventType == "ENTRY_SKIPPED");
        Assert.Equal("sizing", skipped.Payload["limit"]);
        Assert.Contains("sin tope por operación calculable", (string)skipped.Payload["reason"]!);
        Assert.Contains("ENTRY_SKIPPED", ShadowMetrics.DiscardEventTypes);   // cuenta como descarte en las métricas
    }

    [Fact]
    public async Task Entry_BetCapAndRiskBudget_MeasureTheLossOfAllTheContracts()
    {
        // Capital 10.000, riesgo abierto máximo 10 % = 1.000, tope por apuesta 100 % de eso: un contrato (415) entra, tres (1.245) no.
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, (await Enter(With("FIXED", 1, capital: 10_000, openPct: 10, betPct: 100))).Outcome);

        var (outcome, store) = await Enter(With("FIXED", 3, capital: 10_000, openPct: 10, betPct: 100));

        Assert.Equal(ShadowRuntimeEngine.Outcomes.RiskLimit, outcome);
        Assert.Empty(store.AllPositions());
        Assert.Equal("max_bet", store.GetEvents("i-1").Single(e => e.EventType == "ENTRY_SKIPPED").Payload["limit"]);
    }

    [Fact]
    public async Task Entry_Fixed3_PerTradeUsdCapRejectsTheTotalLoss()
    {
        // max_loss_per_trade_usd 1.000: un contrato (415) entra, tres (1.245) los rechaza el riesgo duro.
        var (outcome, store) = await Enter(With("FIXED", 3, maxLossUsd: 1_000));

        Assert.Equal(ShadowRuntimeEngine.Outcomes.RiskRejected, outcome);
        Assert.Empty(store.AllPositions());
    }

    // ── Liquidación al vencimiento ×N ────────────────────────────────────────

    private sealed class CloseData : IRuntimeMarketData
    {
        public double Close;
        public Task<Dictionary<string, double?>> ResolveMetricsAsync(IEnumerable<string> r, DateTime n, TimeSpan? m, CancellationToken ct)
            => Task.FromResult(r.ToDictionary(x => x, _ => (double?)null));
        public Task<CandidateBuildResult> BuildCandidateAsync(StrategyInstance i, StrategySpec s, string sym, double? v, DateTime n, CancellationToken ct)
            => Task.FromResult(CandidateBuildResult.Rejected("n/a"));
        public Task<LegQuote?> GetQuoteAsync(string s, CancellationToken ct) => Task.FromResult<LegQuote?>(null);
        public Task<double?> GetOfficialCloseAsync(string symbol, DateTime d, CancellationToken ct) => Task.FromResult<double?>(Close);
    }

    private static ShadowPosition Spread(int? quantity) => new()
    {
        PositionId = "p-1", InstanceId = "i-1", Symbol = "SPX", Structure = RuntimeStructures.PutCreditSpread, Status = "OPEN",
        EntryCredit = 2.00, Width = 5, MaxRisk = 300, EntryDte = 0, EntryAt = Now,
        Legs = new()
        {
            new() { Side = "SELL", Type = "PUT", Strike = 100, Expiration = "2026-09-24", OccSymbol = "SPXW  260924P00100000", StreamerSymbol = ".SPXW260924P100", Quantity = quantity },
            new() { Side = "BUY", Type = "PUT", Strike = 95, Expiration = "2026-09-24", OccSymbol = "SPXW  260924P00095000", StreamerSymbol = ".SPXW260924P95", Quantity = quantity },
        },
        EntryContext = new EntryContext { Execution = new ExecutionTerms { Fill = ExecutionTerms.Mid, PerContractUsd = 1, CostsDeclared = true } },
    };

    [Theory]
    [InlineData(3, 120.0, 594.0)]     // vence fuera del dinero: (2 − 0) × 100 × 3 = 600, menos la orden de entrada (6 contratos × 1)
    [InlineData(3, 97.0, -306.0)]     // débito 3: (2 − 3) × 100 × 3 = −300 − 6
    [InlineData(null, 120.0, 198.0)]  // posición anterior sin cantidad: 1 contrato, igual que antes (200 − 2)
    [InlineData(null, 97.0, -102.0)]
    public async Task Expiration_SettlesTimesTheContracts_OldPositionsAsOne(int? quantity, double close, double net)
    {
        var (store, _) = NewRuntime();
        var pos = Spread(quantity);
        store.AddPosition(pos);
        var after = new DateTime(2026, 9, 24, 20, 30, 0, DateTimeKind.Utc);   // 16:30 ET

        var outcome = await ShadowRuntimeEngine.ValuePositionAsync(store, new CloseData { Close = close }, pos, Spec().Exits.Deterministic, after, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed, outcome);
        Assert.Equal(net, store.GetPosition("p-1")!.RealizedPnl);
    }

    [Fact]
    public void LegsText_ShowsTheContractsOnlyWhenThereIsMoreThanOne()
    {
        Assert.Equal("SELL PUT 100 2026-09-24 / BUY PUT 95 2026-09-24", ShadowPerformance.LegsText(Spread(null)));
        Assert.Equal("SELL PUT 100 2026-09-24 / BUY PUT 95 2026-09-24", ShadowPerformance.LegsText(Spread(1)));
        Assert.Equal("SELL 3 PUT 100 2026-09-24 / BUY 3 PUT 95 2026-09-24", ShadowPerformance.LegsText(Spread(3)));
    }

    [Fact]
    public void CapitalAllocation_UsesTheRiskOfOneContract_FromPositionsWithSeveralContracts()
    {
        var terms = new StrategyTerms
        {
            SpecName = "a", SpecVersion = "1", Symbol = "SPY", Structure = "put_credit_spread", Width = 5, MinDte = 30, MaxDte = 50,
            Observed = new() { Spread(3) with { MaxRisk = 1245, Width = 5, EntryDte = 35 }, Spread(null) with { MaxRisk = 415, Width = 5, EntryDte = 35 } },
        };
        var plan = ShadowCapital.Allocate(new[] { terms }, new CapitalLimits { Capital = 10_000, MaxRiskPerTradePct = 9, MaxOpenRiskPct = 50, MaxBetPct = 100 }, Now);

        var a = Assert.Single(plan.Strategies);
        Assert.Equal(415, a.RiskPerContract);        // 1.245 / 3 y 415 / 1
        Assert.Equal(2, a.ContractsPerPosition);     // 900 / 415
    }
}
