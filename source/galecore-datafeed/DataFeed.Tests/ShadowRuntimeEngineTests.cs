using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Tests;

/// <summary>
/// GC-0002 — el runtime SHADOW decide sólo con datos reales. Un proveedor falso controla qué datos
/// "existen"; los tests verifican que un dato faltante bloquea y queda registrado, y que nunca se
/// inventa una métrica, un candidato ni un precio.
/// </summary>
[Collection("RuntimeStaticCaches")]
public class ShadowRuntimeEngineTests
{
    internal const string VixRef = "capability:market_data.trade.VIX.price";
    internal const string GexRef = "capability:compute.gamma_exposure.SPY.net_gex";
    internal static readonly DateTime Now = new(2026, 9, 24, 15, 0, 0, DateTimeKind.Utc); // 11:00 ET

    internal sealed class FakeData : IRuntimeMarketData
    {
        public Dictionary<string, double?> Metrics = new() { [VixRef] = 15.2, [GexRef] = 120.0 };
        public bool ThrowOnMetrics;
        public Func<CandidateBuildResult>? Build;
        /// <summary>Como Build, pero con la instancia que se evalúa (varias instancias, P1-07).</summary>
        public Func<StrategyInstance, CandidateBuildResult>? BuildFor;
        public bool ThrowOnBuild;
        public int BuildCalls;
        public Dictionary<string, LegQuote?> Quotes = new();

        public Task<Dictionary<string, double?>> ResolveMetricsAsync(
            IEnumerable<string> metricRefs, DateTime nowUtc, TimeSpan? maxAge, CancellationToken ct)
        {
            if (ThrowOnMetrics) throw new InvalidOperationException("proveedor caído");
            return Task.FromResult(metricRefs.ToDictionary(r => r, r => Metrics.GetValueOrDefault(r)));
        }

        public Task<CandidateBuildResult> BuildCandidateAsync(
            StrategyInstance instance, StrategySpec spec, string symbol, double? vixPrice, DateTime nowUtc,
            CancellationToken ct)
        {
            BuildCalls++;
            if (ThrowOnBuild) throw new InvalidOperationException("cadena caída");
            var built = BuildFor?.Invoke(instance) ?? Build?.Invoke() ?? CandidateBuildResult.Rejected("sin candidato");
            // El candidato de prueba trae la cotización de "ahora" (sin hora el riesgo lo rechaza, WS-0062 inc.1).
            if (built.Candidate is { Snapshot.OldestQuoteAt: null } c)
                built = built with { Candidate = c with { Snapshot = c.Snapshot with { OldestQuoteAt = nowUtc } } };
            return Task.FromResult(built);
        }

        public Task<LegQuote?> GetQuoteAsync(string streamerSymbol, CancellationToken ct)
            => Task.FromResult(Quotes.GetValueOrDefault(streamerSymbol));
    }

    internal static string SpecPath()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "DataFeed.Api", "Files", "Runtime")))
            dir = dir.Parent;
        return Path.Combine(dir!.FullName, "DataFeed.Api", "Files", "Runtime", "shadow_runtime_test_v1.json");
    }

    internal static string SpecJson() => File.ReadAllText(SpecPath());

    /// <summary>
    /// La spec de prueba tal como está en el archivo, pero con fill al MID (WS-0062 inc.2): las specs sin bloque execution
    /// llenan al natural, y los tests de abajo fueron escritos con precios al medio (también prueban que mid sin costos
    /// reproduce los resultados de antes). El natural se prueba en ShadowExecutionModelTests con <see cref="NaturalSpec"/>.
    /// </summary>
    internal static StrategySpec Spec() => NaturalSpec() with { Execution = new SpecExecution { Fill = "mid" } };

    /// <summary>La spec de prueba tal cual el archivo: sin bloque execution, o sea fill natural.</summary>
    internal static StrategySpec NaturalSpec()
    {
        var result = StrategySpecLoader.LoadFromFile(SpecPath());
        Assert.True(result.Success, string.Join("; ", result.Errors));
        return result.Spec!;
    }

    internal static (ShadowRuntimeStore Store, StrategyInstance Instance) NewRuntime()
    {
        var store = new ShadowRuntimeStore();
        var instance = new StrategyInstance
        {
            InstanceId = "i-1", DeploymentId = "d-1", SpecName = "shadow_runtime_test_v1",
            LifecycleState = "RUNNING", SchedulerState = "IDLE", Mode = "SHADOW", CreatedAt = Now, UpdatedAt = Now,
        };
        store.SetInstance(instance.InstanceId, instance);
        return (store, instance);
    }

    internal static TradeCandidate RealCandidate() => new()
    {
        CandidateId = "c-1", InstanceId = "i-1", Symbol = "SPY", Structure = "put_credit_spread",
        Credit = 0.85, MaxRisk = 415, Width = 5, Dte = 35, DeltaShort = -0.16,
        Legs = new List<CandidateLeg>
        {
            new() { Side = "SELL", Type = "PUT", Strike = 720, Expiration = "2026-10-30", StreamerSymbol = ".SPY261030P720",
                    Bid = 1.50, Ask = 1.70, Delta = -0.16 },
            new() { Side = "BUY", Type = "PUT", Strike = 715, Expiration = "2026-10-30", StreamerSymbol = ".SPY261030P715",
                    Bid = 0.70, Ask = 0.90 },
        },
        Snapshot = new MarketSnapshot { UnderlyingPrice = 767.7, Vix = 15.2, AsOf = DateTime.UtcNow },
        CreatedAt = Now,
    };

    private static List<string> EventTypes(ShadowRuntimeStore store) =>
        store.GetEvents("i-1").Select(e => e.EventType).ToList();

    // ── AC-01: sin métricas inventadas ─────────────────────────────

    [Fact]
    public async Task MetricsProviderDown_BlocksEntry_AndNeverBuildsCandidate()
    {
        var (store, instance) = NewRuntime();
        var data = new FakeData { ThrowOnMetrics = true };

        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, Spec(), "SPY", Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.GatesNotPassed, outcome);
        Assert.Equal(0, data.BuildCalls);
        Assert.Empty(store.AllPositions());
        Assert.Contains("METRICS_UNAVAILABLE", EventTypes(store));
        Assert.All(store.GetEvaluations("i-1").Single().GateResults, g => Assert.Equal("NO_DATA", g.Status));
    }

    [Fact]
    public async Task OneMetricMissing_IsNoData_AndBlocks()
    {
        var (store, instance) = NewRuntime();
        var data = new FakeData();
        data.Metrics[GexRef] = null;

        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, Spec(), "SPY", Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.GatesNotPassed, outcome);
        Assert.Equal(0, data.BuildCalls);
        var noData = store.GetEvents("i-1").Single(e => e.EventType == "METRICS_NO_DATA");
        Assert.Equal(new List<string> { GexRef }, noData.Payload["metric_refs"]);
        Assert.Contains("GATES_NOT_PASSED", EventTypes(store));
    }

    [Fact]
    public async Task GateFails_WithRealValue_IsRecordedWithTheValue()
    {
        var (store, instance) = NewRuntime();
        var data = new FakeData();
        data.Metrics[VixRef] = 34.0;

        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, Spec(), "SPY", Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.GatesNotPassed, outcome);
        var vix = store.GetEvaluations("i-1").Single().GateResults.Single(g => g.GateId == "vix_absolute");
        Assert.Equal("FAIL", vix.Status);
        Assert.Equal(34.0, vix.Value);
    }

    // ── AC-02: sin candidato inventado ─────────────────────────────

    [Fact]
    public async Task BuilderRejects_NoPosition_AndReasonIsRecorded()
    {
        var (store, instance) = NewRuntime();
        var data = new FakeData { Build = () => CandidateBuildResult.Rejected("sin cotización utilizable para la pata vendida") };

        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, Spec(), "SPY", Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.NoCandidate, outcome);
        Assert.Empty(store.AllPositions());
        var ev = store.GetEvents("i-1").Single(e => e.EventType == "CANDIDATE_NOT_VIABLE");
        Assert.Equal("sin cotización utilizable para la pata vendida", ev.Payload["reason"]);
    }

    [Fact]
    public async Task BuilderThrows_NoPosition()
    {
        var (store, instance) = NewRuntime();
        var data = new FakeData { ThrowOnBuild = true };

        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, Spec(), "SPY", Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.NoCandidate, outcome);
        Assert.Empty(store.AllPositions());
        Assert.Contains("CANDIDATE_NOT_VIABLE", EventTypes(store));
    }

    [Fact]
    public async Task CandidateWithoutLegQuote_NeverBecomesAPosition()
    {
        var (store, instance) = NewRuntime();
        var bad = RealCandidate() with
        {
            Legs = RealCandidate().Legs.Select((l, i) => i == 1 ? l with { Bid = null, Ask = null } : l).ToList()
        };
        var data = new FakeData { Build = () => CandidateBuildResult.Built(bad) };

        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, Spec(), "SPY", Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.NoCandidate, outcome);
        Assert.Empty(store.AllPositions());
    }

    [Fact]
    public async Task RealData_OpensPosition_WithStreamerSymbols_AndFullTrace()
    {
        var (store, instance) = NewRuntime();
        var data = new FakeData { Build = () => CandidateBuildResult.Built(RealCandidate()) };

        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, Spec(), "SPY", Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, outcome);
        var pos = Assert.Single(store.AllPositions());
        Assert.Equal(new[] { ".SPY261030P720", ".SPY261030P715" }, pos.Legs.Select(l => l.StreamerSymbol));
        Assert.Equal(new[] { "EVALUATION_COMPLETED", "CANDIDATE_CREATED", "POSITION_OPENED" }, EventTypes(store));
        Assert.DoesNotContain(store.GetEvents("i-1"), e => e.Payload.Keys.Any(k => k.StartsWith("real_")));
    }

    [Fact]
    public async Task OpenedPosition_KeepsEntryContext_GateValuesAndLegQuotes()
    {
        var (store, instance) = NewRuntime();
        var candidate = RealCandidate();
        var data = new FakeData { Build = () => CandidateBuildResult.Built(candidate) };

        await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, Spec(), "SPY", Now, default);

        var ctx = Assert.Single(store.AllPositions()).EntryContext;
        Assert.NotNull(ctx);
        Assert.Equal(store.GetEvaluations("i-1").Single().EvaluationId, ctx!.EvaluationId);
        Assert.NotEmpty(ctx.Gates);
        Assert.All(ctx.Gates, g => Assert.NotNull(g.Value));
        Assert.Equal(candidate.Snapshot.Vix, ctx.Vix);
        Assert.Equal(candidate.Snapshot.UnderlyingPrice, ctx.UnderlyingPrice);
        Assert.Equal(candidate.Legs.Select(l => (l.Bid, l.Ask)), ctx.Legs.Select(l => (l.Bid, l.Ask)));
        Assert.Null(store.AllPositions().Single().ExitContext);
    }

    [Fact]
    public async Task MaxPositionsReached_SkipsWithReason()
    {
        var (store, instance) = NewRuntime();
        var data = new FakeData { Build = () => CandidateBuildResult.Built(RealCandidate()) };
        await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, Spec(), "SPY", Now, default);

        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, Spec(), "SPY", Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.MaxPositions, outcome);
        Assert.Single(store.AllPositions());
        Assert.Contains("ENTRY_SKIPPED", EventTypes(store));
    }

    // ── GC-0005: espaciado entre entradas ──────────────────────────

    internal static StrategySpec SpacedSpec(int maxPositions = 10, int? minMinutes = 1440)
    {
        var spec = Spec();
        return spec with { RiskLimits = spec.RiskLimits with { MaxConcurrentPositions = maxPositions, MinMinutesBetweenEntries = minMinutes } };
    }

    private static FakeData FreshCandidates() => new()
    {
        Build = () => CandidateBuildResult.Built(RealCandidate() with { CandidateId = Guid.NewGuid().ToString() }),
    };

    [Fact]
    public async Task Spacing_SecondEntryTooSoon_SkipsWithReasonAndNextAllowedTime()
    {
        var (store, instance) = NewRuntime();
        var data = FreshCandidates();
        await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, SpacedSpec(), "SPY", Now, default);

        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, SpacedSpec(), "SPY", Now.AddMinutes(90), default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.TooSoon, outcome);
        Assert.Single(store.AllPositions());
        Assert.Equal(1, data.BuildCalls);   // ni siquiera pide la cadena
        var skipped = store.GetEvents("i-1").Last(e => e.EventType == "ENTRY_SKIPPED");
        Assert.Contains("espaciado entre entradas", (string)skipped.Payload["reason"]!);
        Assert.Equal(Now.AddMinutes(1440).ToString("o"), skipped.Payload["next_entry_allowed_at"]);
    }

    [Fact]
    public async Task Spacing_AfterTheInterval_EntersAgain_BuildingALadder()
    {
        var (store, instance) = NewRuntime();
        var data = FreshCandidates();

        for (int day = 0; day < 3; day++)
            Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, await ShadowRuntimeEngine.EvaluateEntryAsync(
                store, data, instance, SpacedSpec(), "SPY", Now.AddMinutes(1440 * day), default));

        Assert.Equal(3, store.OpenPositionCount("i-1"));
    }

    [Fact]
    public async Task Spacing_ExactlyAtTheLimit_Enters()
    {
        var (store, instance) = NewRuntime();
        var data = FreshCandidates();
        await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, SpacedSpec(minMinutes: 60), "SPY", Now, default);

        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, SpacedSpec(minMinutes: 60), "SPY", Now.AddMinutes(60), default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, outcome);
    }

    [Fact]
    public async Task Spacing_CountsClosedPositions_AQuickCloseDoesNotAllowAnotherEntrySameDay()
    {
        var (store, instance) = NewRuntime();
        var data = FreshCandidates();
        await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, SpacedSpec(), "SPY", Now, default);
        var pos = store.AllPositions().Single();
        store.UpdatePosition(pos with { Status = "CLOSED", ExitAt = Now.AddMinutes(30) });

        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, SpacedSpec(), "SPY", Now.AddMinutes(120), default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.TooSoon, outcome);
        Assert.Equal(0, store.OpenPositionCount("i-1"));
    }

    [Fact]
    public async Task Spacing_OnlyTheInstanceOwnEntriesCount()
    {
        var (store, instance) = NewRuntime();
        var data = FreshCandidates();
        store.AddPosition(ShadowFillSimulator.Fill(RealCandidate() with { InstanceId = "otra", CandidateId = "c-otra" }, Now, ShadowFillSimulatorTests.MidTerms));

        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, SpacedSpec(), "SPY", Now.AddMinutes(5), default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, outcome);
    }

    [Fact]
    public async Task Spacing_WithoutTheField_BehavesAsBefore()
    {
        var (store, instance) = NewRuntime();
        var data = FreshCandidates();
        await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, SpacedSpec(minMinutes: null), "SPY", Now, default);

        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, SpacedSpec(minMinutes: null), "SPY", Now.AddMinutes(1), default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, outcome);
        Assert.Equal(2, store.OpenPositionCount("i-1"));
    }

    [Fact]
    public async Task Spacing_MaxPositionsIsCheckedFirst()
    {
        var (store, instance) = NewRuntime();
        var data = FreshCandidates();
        await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, SpacedSpec(maxPositions: 1), "SPY", Now, default);

        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, SpacedSpec(maxPositions: 1), "SPY", Now.AddMinutes(5), default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.MaxPositions, outcome);
    }

    // ── AC-05: historial de evaluaciones ───────────────────────────

    [Fact]
    public async Task EveryEvaluationIsKept_NotOnlyTheLast()
    {
        var (store, instance) = NewRuntime();
        var data = new FakeData();
        data.Metrics[VixRef] = 40.0;
        for (int i = 0; i < 3; i++)
            await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, Spec(), "SPY", Now.AddMinutes(i), default);

        Assert.Equal(3, store.GetEvaluations("i-1").Count);
    }

    // ── AC-03: valuación real ──────────────────────────────────────

    private static async Task<(ShadowRuntimeStore, ShadowPosition, FakeData)> OpenPosition()
    {
        var (store, instance) = NewRuntime();
        var data = new FakeData { Build = () => CandidateBuildResult.Built(RealCandidate()) };
        await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, Spec(), "SPY", Now, default);
        return (store, store.AllPositions().Single(), data);
    }

    [Fact]
    public async Task Valuation_UsesRealLegMids()
    {
        var (store, pos, data) = await OpenPosition();
        data.Quotes[".SPY261030P720"] = new LegQuote(1.20, 1.30, Now);
        data.Quotes[".SPY261030P715"] = new LegQuote(0.60, 0.70, Now);

        var outcome = await ShadowRuntimeEngine.ValuePositionAsync(store, data, pos, Spec().Exits.Deterministic, Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, outcome);
        var valued = store.GetPosition(pos.PositionId)!;
        Assert.Equal(0.6, valued.LastSpreadValue);          // 1.25 − 0.65
        Assert.Equal(25.0, valued.UnrealizedPnl);           // (0.85 − 0.60) × 100
        Assert.Equal(36, valued.CurrentDte);                // 24/09 → 30/10 en fecha ET
    }

    [Fact]
    public async Task Valuation_TakeProfitWithRealPrices_Closes()
    {
        var (store, pos, data) = await OpenPosition();
        data.Quotes[".SPY261030P720"] = new LegQuote(0.50, 0.60, Now);
        data.Quotes[".SPY261030P715"] = new LegQuote(0.20, 0.30, Now);

        var outcome = await ShadowRuntimeEngine.ValuePositionAsync(store, data, pos, Spec().Exits.Deterministic, Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed, outcome);
        var closed = store.GetPosition(pos.PositionId)!;
        Assert.Equal("TAKE_PROFIT", closed.ExitReason);
        Assert.Equal(0.3, closed.ExitDebit);
        // Las cotizaciones de cada pata al cerrar quedan guardadas (calidad de ejecución, WS-0033).
        Assert.NotNull(closed.ExitContext);
        Assert.Equal(Now, closed.ExitContext!.CapturedAt);
        Assert.Contains(closed.ExitContext.Legs, l => l.Strike == 720 && l.Bid == 0.50 && l.Ask == 0.60);
        Assert.Contains(closed.ExitContext.Legs, l => l.Strike == 715 && l.Bid == 0.20 && l.Ask == 0.30);
    }

    [Fact]
    public async Task Valuation_MissingQuote_IsNoData_AndNeverEvaluatesExits()
    {
        var (store, pos, data) = await OpenPosition();
        // Precio que dispararía take profit en una pata; la otra no tiene cotización.
        data.Quotes[".SPY261030P720"] = new LegQuote(0.10, 0.20, Now);

        var outcome = await ShadowRuntimeEngine.ValuePositionAsync(store, data, pos, Spec().Exits.Deterministic, Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.NoData, outcome);
        var same = store.GetPosition(pos.PositionId)!;
        Assert.Equal("OPEN", same.Status);
        Assert.Null(same.LastSpreadValue);
        Assert.Contains("VALUATION_NO_DATA", EventTypes(store));
    }

    [Theory]
    [InlineData(0.0, 20.0)]   // cotización de apertura sin mercado: mid 10 → débito −9,35 (caso IWM 19/10)
    [InlineData(9.0, 11.0)]
    public async Task Valuation_DebitOutsideZeroToWidth_IsNoData_AndNeverCloses(double longBid, double longAsk)
    {
        var (store, pos, data) = await OpenPosition();
        data.Quotes[".SPY261030P720"] = new LegQuote(0.10, 0.20, Now);
        data.Quotes[".SPY261030P715"] = new LegQuote(longBid, longAsk, Now);

        var outcome = await ShadowRuntimeEngine.ValuePositionAsync(store, data, pos, Spec().Exits.Deterministic, Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.NoData, outcome);
        var same = store.GetPosition(pos.PositionId)!;
        Assert.Equal("OPEN", same.Status);
        Assert.Null(same.ExitDebit);
        Assert.Null(same.LastSpreadValue);
        Assert.Contains(same.ValuationProblems!, p => p.Contains("fuera de [0, 5]"));
        Assert.Contains("VALUATION_NO_DATA", EventTypes(store));
    }

    [Fact]
    public async Task Valuation_DoesNotDependOnTimeElapsed()
    {
        // Antes: un decaimiento lineal con el tiempo movía el P&L sin mercado. Ahora sin precio no hay valor.
        var (store, pos, data) = await OpenPosition();
        var outcome = await ShadowRuntimeEngine.ValuePositionAsync(
            store, data, pos, Spec().Exits.Deterministic, Now.AddDays(20), default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.NoData, outcome);
        Assert.Null(store.GetPosition(pos.PositionId)!.UnrealizedPnl);
    }

    [Fact]
    public async Task Valuation_NoDataEvent_OnlyWhenTheProblemChanges()
    {
        var (store, pos, data) = await OpenPosition();
        for (int i = 0; i < 3; i++)
            await ShadowRuntimeEngine.ValuePositionAsync(
                store, data, store.GetPosition(pos.PositionId)!, Spec().Exits.Deterministic, Now.AddSeconds(30 * i), default);

        Assert.Single(store.GetEvents("i-1"), e => e.EventType == "VALUATION_NO_DATA");
        Assert.NotNull(store.GetPosition(pos.PositionId)!.ValuationProblems);

        // Vuelve el precio: se valúa y el problema se limpia; si vuelve a faltar, hay un evento nuevo.
        data.Quotes[".SPY261030P720"] = new LegQuote(1.20, 1.30, Now);
        data.Quotes[".SPY261030P715"] = new LegQuote(0.60, 0.70, Now);
        await ShadowRuntimeEngine.ValuePositionAsync(
            store, data, store.GetPosition(pos.PositionId)!, Spec().Exits.Deterministic, Now, default);
        Assert.Null(store.GetPosition(pos.PositionId)!.ValuationProblems);
        data.Quotes.Clear();
        await ShadowRuntimeEngine.ValuePositionAsync(
            store, data, store.GetPosition(pos.PositionId)!, Spec().Exits.Deterministic, Now, default);
        Assert.Equal(2, store.GetEvents("i-1").Count(e => e.EventType == "VALUATION_NO_DATA"));
    }

    [Fact]
    public async Task Valuation_UnknownLegSide_IsAProblem_NotABuy()
    {
        var (store, pos, data) = await OpenPosition();
        var odd = pos with { Legs = pos.Legs.Select((l, i) => i == 1 ? l with { Side = "HOLD" } : l).ToList() };
        store.UpdatePosition(odd);
        data.Quotes[".SPY261030P720"] = new LegQuote(0.10, 0.20, Now);
        data.Quotes[".SPY261030P715"] = new LegQuote(0.05, 0.10, Now);

        var outcome = await ShadowRuntimeEngine.ValuePositionAsync(store, data, odd, Spec().Exits.Deterministic, Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.NoData, outcome);
        Assert.Equal("OPEN", store.GetPosition(pos.PositionId)!.Status);
        Assert.Contains(store.GetPosition(pos.PositionId)!.ValuationProblems!, p => p.Contains("lado de pata desconocido"));
    }

    [Fact]
    public async Task Valuation_WithoutExits_ValuesButNeverCloses()
    {
        var (store, pos, data) = await OpenPosition();
        data.Quotes[".SPY261030P720"] = new LegQuote(0.50, 0.60, Now);   // take profit si se evaluara
        data.Quotes[".SPY261030P715"] = new LegQuote(0.20, 0.30, Now);

        var outcome = await ShadowRuntimeEngine.ValuePositionAsync(
            store, data, pos, Spec().Exits.Deterministic, Now, default, evaluateExits: false);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, outcome);
        var same = store.GetPosition(pos.PositionId)!;
        Assert.Equal("OPEN", same.Status);
        Assert.Equal(0.3, same.LastSpreadValue);
    }

    [Fact]
    public async Task Valuation_StaleLegQuote_IsNoData_AndNeverCloses()
    {
        var (store, pos, data) = await OpenPosition();
        // Precios que dispararían take profit, pero una pata cotiza hace 10 minutos.
        data.Quotes[".SPY261030P720"] = new LegQuote(0.50, 0.60, Now.AddMinutes(-10));
        data.Quotes[".SPY261030P715"] = new LegQuote(0.20, 0.30, Now);

        var outcome = await ShadowRuntimeEngine.ValuePositionAsync(
            store, data, pos, Spec().Exits.Deterministic, Now, default, maxQuoteAge: DataFreshness.MaxAge(Spec()));

        Assert.Equal(ShadowRuntimeEngine.Outcomes.NoData, outcome);
        var same = store.GetPosition(pos.PositionId)!;
        Assert.Equal("OPEN", same.Status);
        Assert.Contains(same.ValuationProblems!, p => p.Contains("dato viejo"));
    }

    [Fact]
    public async Task Valuation_LegQuoteWithoutTime_IsNoData_AndNeverCloses()
    {
        var (store, pos, data) = await OpenPosition();
        data.Quotes[".SPY261030P720"] = new LegQuote(0.50, 0.60, null);   // take profit si se aceptara
        data.Quotes[".SPY261030P715"] = new LegQuote(0.20, 0.30, Now);

        var outcome = await ShadowRuntimeEngine.ValuePositionAsync(
            store, data, pos, Spec().Exits.Deterministic, Now, default, maxQuoteAge: DataFreshness.MaxAge(Spec()));

        Assert.Equal(ShadowRuntimeEngine.Outcomes.NoData, outcome);
        var same = store.GetPosition(pos.PositionId)!;
        Assert.Equal("OPEN", same.Status);
        Assert.Contains(same.ValuationProblems!, p => p.Contains("sin hora"));
    }

    [Fact]
    public async Task Entry_SwitchTurnedOffWhileBuilding_NoPosition()
    {
        var (store, instance) = NewRuntime();
        bool enabled = true;
        var data = new FakeData { Build = () => { enabled = false; return CandidateBuildResult.Built(RealCandidate()); } };

        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(
            store, data, instance, Spec(), "SPY", Now, default, canOpen: () => enabled);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Paused, outcome);
        Assert.Empty(store.AllPositions());
        Assert.Contains("ENTRY_ABORTED", EventTypes(store));
    }

    [Fact]
    public void Store_TryAddPosition_RespectsCanOpen()
    {
        var store = new ShadowRuntimeStore();
        Assert.False(store.TryAddPosition(new ShadowPosition { PositionId = "p-1", Status = "OPEN" }, () => false));
        Assert.Empty(store.AllPositions());
        Assert.True(store.TryAddPosition(new ShadowPosition { PositionId = "p-2", Status = "OPEN" }, () => true));
        Assert.Single(store.AllPositions());
    }

    [Fact]
    public async Task Store_SwitchChangeAndPositionCommit_AreSerialized()
    {
        // Mientras el switch se está apagando (dentro del lock), un registro concurrente espera y
        // después ve el switch apagado: no hay posición registrada "después" del OFF.
        var store = new ShadowRuntimeStore();
        bool enabled = true;
        using var insideGate = new SemaphoreSlim(0);
        using var release = new SemaphoreSlim(0);
        var limit = TimeSpan.FromSeconds(10);
        var switcher = Task.Run(() => store.UnderCommitGate(() =>
        {
            insideGate.Release();
            if (!release.Wait(limit)) throw new TimeoutException("el test no liberó el lock");
            enabled = false;
        }));
        Assert.True(await insideGate.WaitAsync(limit));
        var committer = Task.Run(() => store.TryAddPosition(new ShadowPosition { PositionId = "p", Status = "OPEN" }, () => enabled));
        Assert.NotSame(committer, await Task.WhenAny(committer, Task.Delay(200)));   // bloqueado por el lock
        release.Release();
        await switcher.WaitAsync(limit);
        Assert.False(await committer.WaitAsync(limit));
        Assert.Empty(store.AllPositions());
    }

    [Fact]
    public void QuoteRules_RejectNonFinite()
    {
        Assert.False(QuoteRules.IsUsable(1.0, double.PositiveInfinity));
        Assert.False(QuoteRules.IsUsable(double.PositiveInfinity, double.PositiveInfinity));
        Assert.False(QuoteRules.IsUsable(double.NaN, 1.0));
        Assert.True(QuoteRules.IsUsable(0, 0.05));
    }

    [Fact]
    public void Freshness_StaleFutureUnknown()
    {
        var max = TimeSpan.FromSeconds(150);
        Assert.Null(DataFreshness.Problem(Now.AddSeconds(-149), Now, max));
        Assert.Contains("viejo", DataFreshness.Problem(Now.AddSeconds(-151), Now, max));
        Assert.Contains("futuro", DataFreshness.Problem(Now.AddSeconds(30), Now, max));
        Assert.Contains("sin hora", DataFreshness.Problem(null, Now, max));   // sin hora ya no pasa (WS-0062 inc.1)
    }

    [Fact]
    public void QuoteTime_TakesNewestOfBidAskThenEventTime()
    {
        long ms(DateTime d) => new DateTimeOffset(d, TimeSpan.Zero).ToUnixTimeMilliseconds();
        var older = Now.AddSeconds(-40);
        var newer = Now.AddSeconds(-10);
        Assert.Equal(newer, DataFreshness.QuoteTime(ms(older), ms(newer), 0));
        Assert.Equal(newer, DataFreshness.QuoteTime(ms(newer), ms(older), ms(Now)));   // bid/ask mandan sobre EventTime
        Assert.Equal(newer, DataFreshness.QuoteTime(ms(newer), 0, 0));                  // sólo bid
        Assert.Equal(newer, DataFreshness.QuoteTime(0, ms(newer), 0));                  // sólo ask
        Assert.Equal(older, DataFreshness.QuoteTime(0, 0, ms(older)));                  // sólo EventTime
        Assert.Null(DataFreshness.QuoteTime(0, 0, 0));                                  // ninguna
    }

    [Fact]
    public void MetricResolver_QuotePrice_NoTimeOldOrFutureIsBlocked()
    {
        long ms(DateTime d) => new DateTimeOffset(d, TimeSpan.Zero).ToUnixTimeMilliseconds();
        var max = TimeSpan.FromSeconds(150);
        DataFeed.Application.Data.Tastytrade.MarketDataQuote.QuoteEvent Q(long bt, long at, long et = 0) =>
            new() { BidPrice = 10, AskPrice = 10.2, BidTime = bt, AskTime = at, EventTime = et };
        Assert.NotNull(MetricResolver.UsableQuotePrice(Q(ms(Now.AddSeconds(-5)), ms(Now.AddSeconds(-3))), Now, max));
        Assert.Null(MetricResolver.UsableQuotePrice(Q(0, 0), Now, max));                                       // sin hora
        Assert.NotNull(MetricResolver.UsableQuotePrice(Q(ms(Now.AddSeconds(-500)), ms(Now.AddSeconds(-3))), Now, max)); // un lado quieto no la invalida
        Assert.Null(MetricResolver.UsableQuotePrice(Q(ms(Now.AddSeconds(-500)), ms(Now.AddSeconds(-400))), Now, max)); // los dos viejos sí
        Assert.Null(MetricResolver.UsableQuotePrice(Q(ms(Now.AddSeconds(60)), ms(Now.AddSeconds(60))), Now, max));  // futura
    }

    [Fact]
    public async Task Evaluation_UsesTheRuntimeClock()
    {
        var (store, instance) = NewRuntime();
        await ShadowRuntimeEngine.EvaluateEntryAsync(store, new FakeData(), instance, Spec(), "SPY", Now, default);
        Assert.Equal(Now, store.GetEvaluations("i-1").Single().EvaluatedAt);
    }

    [Fact]
    public void CurrentDte_IsCountedInMarketDate()
    {
        var pos = new ShadowPosition { Legs = new() { new ShadowLeg { Expiration = "2026-10-16" } } };
        // 02:00 UTC del 24/09 es todavía 23/09 en Nueva York.
        Assert.Equal(23, ShadowRuntimeEngine.CurrentDte(pos, new DateTime(2026, 9, 24, 2, 0, 0, DateTimeKind.Utc)));
        Assert.Null(ShadowRuntimeEngine.CurrentDte(new ShadowPosition(), Now));
    }

    // ── AC-04: apagar no borra ─────────────────────────────────────

    [Fact]
    public void Store_HasNoWayToWipeTheState()
    {
        Assert.Null(typeof(ShadowRuntimeStore).GetMethod("Clear"));
    }

    [Fact]
    public void Store_EventCap_NeverEvictsLifecycleEvents()
    {
        var store = new ShadowRuntimeStore();
        store.AddEvent(new OperationalEvent { EventId = "open", InstanceId = "i-1", EventType = "POSITION_OPENED" });
        for (int i = 0; i < ShadowRuntimeStore.MaxEventsPerInstance + 10; i++)
            store.AddEvent(new OperationalEvent { EventId = $"n{i}", InstanceId = "i-1", EventType = "EVALUATION_COMPLETED" });

        var events = store.GetEvents("i-1");
        Assert.Equal(ShadowRuntimeStore.MaxEventsPerInstance, events.Count);
        Assert.Equal("open", events.First().EventId);
        Assert.DoesNotContain(events, e => e.EventId == "n0");
    }

    [Fact]
    public void Store_EvaluationHistory_IsBounded()
    {
        var store = new ShadowRuntimeStore();
        for (int i = 0; i < ShadowRuntimeStore.MaxEvaluationsPerInstance + 5; i++)
            store.AddEvaluation(new EvaluationResult { EvaluationId = $"e{i}", InstanceId = "i-1" });
        var history = store.GetEvaluations("i-1");
        Assert.Equal(ShadowRuntimeStore.MaxEvaluationsPerInstance, history.Count);
        Assert.Equal("e5", history.First().EvaluationId);
    }

    // ── P1-07: un iron condor sin crédito no se abre (el riesgo duro no depende del nombre "credit") ──

    [Theory]
    [InlineData(0.0)]
    [InlineData(-0.30)]
    public async Task IronCondor_WithoutCredit_IsRejected_NeverOpened(double credit)
    {
        var (store, instance) = NewRuntime();
        var ic = RealCandidate() with { Structure = "iron_condor", Credit = credit };
        var spec = Spec() with { Structure = Spec().Structure with { AllowedStrategies = new() { "iron_condor" }, DefaultStructure = "iron_condor" } };
        var data = new FakeData { Build = () => CandidateBuildResult.Built(ic) };

        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, spec, "SPY", Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.RiskRejected, outcome);
        Assert.Empty(store.AllPositions());
    }

    // ── P1-07: un iron condor se valúa y se cierra con sus cuatro patas ──

    [Fact]
    public async Task IronCondor_ValuedWithAllFourLegs_AndTakesProfitOnTheCombinedCredit()
    {
        var (store, instance) = NewRuntime();
        var ic = RealCandidate() with
        {
            Structure = "iron_condor", Credit = 1.40, MaxRisk = 360,
            Legs = RealCandidate().Legs.Concat(new List<CandidateLeg>
            {
                new() { Side = "SELL", Type = "CALL", Strike = 810, Expiration = "2026-10-30", StreamerSymbol = ".SPY261030C810", Bid = 1.10, Ask = 1.30, Delta = 0.16 },
                new() { Side = "BUY", Type = "CALL", Strike = 815, Expiration = "2026-10-30", StreamerSymbol = ".SPY261030C815", Bid = 0.50, Ask = 0.70 },
            }).ToList(),
        };
        var spec = Spec() with { Structure = Spec().Structure with { AllowedStrategies = new() { "iron_condor" }, DefaultStructure = "iron_condor" } };
        var data = new FakeData { Build = () => CandidateBuildResult.Built(ic) };
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, spec, "SPY", Now, default));
        var pos = store.AllPositions().Single();
        Assert.Equal(4, pos.Legs.Count);

        data.Quotes[".SPY261030P720"] = new LegQuote(0.50, 0.60, Now);
        data.Quotes[".SPY261030P715"] = new LegQuote(0.20, 0.30, Now);
        data.Quotes[".SPY261030C810"] = new LegQuote(0.40, 0.50, Now);
        data.Quotes[".SPY261030C815"] = new LegQuote(0.10, 0.20, Now);
        var outcome = await ShadowRuntimeEngine.ValuePositionAsync(store, data, pos, spec.Exits.Deterministic, Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed, outcome);
        var closed = store.GetPosition(pos.PositionId)!;
        Assert.Equal(0.6, closed.ExitDebit);       // (0.55 − 0.25) + (0.45 − 0.15)
        Assert.Equal(80.0, closed.RealizedPnl);    // (1.40 − 0.60) × 100
        Assert.Equal("TAKE_PROFIT", closed.ExitReason);
    }
}
