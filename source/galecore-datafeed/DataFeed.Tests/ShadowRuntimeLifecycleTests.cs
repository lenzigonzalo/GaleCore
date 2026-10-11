using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Application.Data.Tastytrade.OptionChains;
using static DataFeed.Tests.ShadowRuntimeEngineTests;

namespace DataFeed.Tests;

/// <summary>
/// WS-0024 (P1-PPb) — el runtime por sus ticks, con reloj y datos controlados: una instancia parada no entra y
/// su monitor sale por X2 o X3 sin esperar fechas reales; parar y volver a desplegar conserva la gestión, la
/// exposición y los límites; un iron condor entra con sus cuatro patas por el tick de entrada; sin patas, el monitor
/// registra VALUATION_NO_DATA y no evalúa salidas. Specs y cadenas de prueba: nada de esto es una estrategia.
/// </summary>
public class ShadowRuntimeLifecycleTests
{
    // RealCandidate vence el 30/10/2026; la spec de prueba sale por tiempo con DTE ≤ 7 (X3) y por objetivo al 50 % (X2).
    private static readonly DateTime OneWeekLater = new(2026, 10, 1, 15, 0, 0, DateTimeKind.Utc);    // jueves 11:00 ET, DTE 29
    private static readonly DateTime TimeExitDay = new(2026, 10, 23, 15, 0, 0, DateTimeKind.Utc);    // viernes 11:00 ET, DTE 7

    private static (ShadowRuntimeStore Store, FakeData Data, ShadowPosition Position) OpenedThenStopped()
    {
        var (store, _) = NewRuntime();
        store.RegisterSpec("shadow_runtime_test_v1", Spec());
        var data = new FakeData { Build = () => CandidateBuildResult.Built(RealCandidate()) };
        var opened = ShadowRuntimeTick.RunEntryTickAsync(store, data, () => true, Now, default).Result;
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, opened["i-1:SPY"]);
        Assert.Equal(StopResult.KindStopped, store.Stop("i-1", Event("i-1", "INSTANCE_STOPPED", Now.AddMinutes(5))).Kind);
        return (store, data, store.AllPositions().Single());
    }

    private static OperationalEvent Event(string instanceId, string type, DateTime at) => new()
    {
        EventId = Guid.NewGuid().ToString(), InstanceId = instanceId, EventType = type, Timestamp = at,
    };

    /// <summary>Cotizaciones de las dos patas del PCS a la hora del tick (frescas para la spec).</summary>
    private static void QuotePcs(FakeData data, DateTime at, double shortMid, double longMid)
    {
        data.Quotes[".SPY261030P720"] = new LegQuote(shortMid - 0.05, shortMid + 0.05, at);
        data.Quotes[".SPY261030P715"] = new LegQuote(longMid - 0.05, longMid + 0.05, at);
    }

    // ── 1. Instancia detenida: no entra; el monitor sigue y sale por X2 o X3 ──

    [Theory]
    [InlineData("TIME_EXIT", 1.00, 0.40)]     // en el día de X3 el spread vale 0,60: ni objetivo ni stop, sale por tiempo
    [InlineData("TAKE_PROFIT", 0.55, 0.25)]   // una semana después vale 0,30 ≤ 50 % del crédito: X2
    public async Task StoppedInstance_NeverEnters_MonitorKeepsValuing_AndExits(string exitReason, double shortMid, double longMid)
    {
        var (store, data, pos) = OpenedThenStopped();
        var exitAt = exitReason == "TIME_EXIT" ? TimeExitDay : OneWeekLater;

        // En sesión, con candidato disponible: la instancia parada no se evalúa ni vuelve a RUNNING.
        var entry = await ShadowRuntimeTick.RunEntryTickAsync(store, data, () => true, exitAt, default);
        Assert.Empty(entry);
        Assert.Equal(1, data.BuildCalls);
        Assert.Single(store.AllPositions());
        Assert.Equal("STOPPED", store.GetInstance("i-1")!.LifecycleState);

        // Antes de la salida: valúa y no cierra (al día siguiente el spread vale 0,60: sin X1, X2 ni X3).
        var dayAfter = Now.AddDays(1);
        QuotePcs(data, dayAfter, 1.00, 0.40);
        var valued = await ShadowRuntimeTick.RunMonitorTickAsync(store, data, dayAfter, default);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, valued[pos.PositionId]);
        Assert.Equal(35, store.GetPosition(pos.PositionId)!.CurrentDte);

        // Con el reloj adelantado: sale por la regla que corresponde.
        QuotePcs(data, exitAt, shortMid, longMid);
        var monitor = await ShadowRuntimeTick.RunMonitorTickAsync(store, data, exitAt, default);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed, monitor[pos.PositionId]);
        var closed = store.GetPosition(pos.PositionId)!;
        Assert.Equal(exitReason, closed.ExitReason);
        Assert.Equal(exitAt, closed.ExitAt);
        Assert.Contains(store.GetEvents("i-1"), e => e.EventType == "POSITION_CLOSED" && (string?)e.Payload["exit_reason"] == exitReason);
    }

    // ── 2. Stop + nuevo Deploy: gestión, exposición, límites y traza ──

    [Fact]
    public async Task StopAndRedeploy_OldPositionsStayManaged_CountForExposureAndLimits_AndAreTraced()
    {
        var (store, data, oldPos) = OpenedThenStopped();
        var newInstance = new StrategyInstance
        {
            InstanceId = "i-2", DeploymentId = "d-2", SpecName = "shadow_runtime_test_v1",
            LifecycleState = "RUNNING", SchedulerState = "IDLE", Mode = "SHADOW", CreatedAt = Now.AddMinutes(10), UpdatedAt = Now.AddMinutes(10),
        };
        var created = Event("i-2", "INSTANCE_CREATED", Now.AddMinutes(10));

        var deployed = store.DeployOrGetRunning(new StrategyDeployment { DeploymentId = "d-2" }, newInstance, created);

        // Es otra instancia, no la vieja reanudada: la vieja sigue parada y la nueva la nombra.
        Assert.Equal(DeployResult.KindCreated, deployed.Kind);
        Assert.Equal("STOPPED", store.GetInstance("i-1")!.LifecycleState);
        Assert.Equal(new[] { "i-2" }, store.RunningInstances().Select(i => i.InstanceId));
        var trace = Assert.Single(store.GetEvents("i-2"), e => e.EventType == "INSTANCE_CREATED");
        Assert.Equal(new List<string> { "i-1" }, trace.Payload["previous_instances"]);
        Assert.Contains(store.GetEvents("i-1"), e => e.EventType == "INSTANCE_STOPPED");

        // La exposición agregada sigue contando la posición de la instancia vieja.
        var limits = new CapitalLimits { Capital = 10_000, ReservePct = 20, MaxRiskPerTradePct = 5, MaxOpenRiskPct = 30, MaxBetPct = 50 };
        var record = new SpecVersionRecord { SpecName = "shadow_runtime_test_v1", Instances = 2, Positions = store.AllPositions().ToList() };
        var exposure = ShadowCapital.Exposure(new[] { record }, limits, Now.AddDays(1));
        Assert.Equal(1, exposure.PositionsOpen);
        Assert.Equal(oldPos.MaxRisk, exposure.OpenMaxRisk);

        // Límites: con máximo 1, la posición que dejó la vieja ocupa el lugar de la nueva.
        var blocked = await ShadowRuntimeTick.RunEntryTickAsync(store, data, () => true, Now.AddDays(1), default);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.MaxPositions, blocked["i-2:SPY"]);
        Assert.Contains(store.GetEvents("i-2"), e => e.EventType == "ENTRY_SKIPPED" && ((string)e.Payload["reason"]!).Contains("(1/1)"));

        // La gestión de la vieja sigue: su monitor la cierra (X2), y recién ahí la nueva puede entrar.
        QuotePcs(data, OneWeekLater, 0.55, 0.25);
        var monitor = await ShadowRuntimeTick.RunMonitorTickAsync(store, data, OneWeekLater, default);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed, monitor[oldPos.PositionId]);
        Assert.Equal("i-1", store.GetPosition(oldPos.PositionId)!.InstanceId);

        data.Build = () => CandidateBuildResult.Built(RealCandidate() with { InstanceId = "i-2", CandidateId = "c-2" });
        var reopened = await ShadowRuntimeTick.RunEntryTickAsync(store, data, () => true, OneWeekLater.AddMinutes(1), default);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, reopened["i-2:SPY"]);
        Assert.Equal("i-2", store.OpenPositions().Single().InstanceId);
    }

    [Fact]
    public async Task StopAndRedeploy_SpacingCountsTheOldInstancesLastEntry()
    {
        var (store, data, _) = OpenedThenStopped();
        var spaced = SpacedSpec(maxPositions: 10, minMinutes: 1440);
        store.RegisterSpec("shadow_runtime_test_v1", spaced);
        store.DeployOrGetRunning(new StrategyDeployment { DeploymentId = "d-2" },
            new StrategyInstance { InstanceId = "i-2", SpecName = "shadow_runtime_test_v1", LifecycleState = "RUNNING", CreatedAt = Now.AddMinutes(10) },
            Event("i-2", "INSTANCE_CREATED", Now.AddMinutes(10)));

        var tooSoon = await ShadowRuntimeTick.RunEntryTickAsync(store, data, () => true, Now.AddHours(2), default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.TooSoon, tooSoon["i-2:SPY"]);
    }

    [Fact]
    public async Task RunningInstancesOfTheSameStrategy_KeepTheirOwnLimit()
    {
        // Lo que se hereda es lo de las paradas; dos RUNNING (P1-07) no se suman entre sí.
        var (store, _) = NewRuntime();
        store.RegisterSpec("shadow_runtime_test_v1", Spec());
        store.SetInstance("i-2", store.GetInstance("i-1")! with { InstanceId = "i-2", CreatedAt = Now.AddMinutes(1) });
        var data = new FakeData { BuildFor = i => CandidateBuildResult.Built(RealCandidate() with { InstanceId = i.InstanceId }) };

        var tick = await ShadowRuntimeTick.RunEntryTickAsync(store, data, () => true, Now, default);

        Assert.All(tick.Values, o => Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, o));
        Assert.Equal(new HashSet<string> { "i-1" }, store.LimitScope(store.GetInstance("i-1")!));
    }

    // ── 3. Iron condor por el tick de entrada, con una cadena fija (T3) ──

    /// <summary>Cadena fija: vencimientos, griegas del 03/11 (40 DTE) y cotizaciones de las cuatro patas.</summary>
    private sealed class ChainData : IRuntimeMarketData, IPcsMarketSource
    {
        public Dictionary<string, double?> Metrics = new() { [VixRef] = 15.2, [GexRef] = 120.0 };
        public Dictionary<string, LegQuote?> Quotes = new()
        {
            [".SPY261103P720"] = new LegQuote(4.10, 4.30, Now.AddSeconds(-3)),
            [".SPY261103P715"] = new LegQuote(3.40, 3.60, Now.AddSeconds(-8)),
            [".SPY261103C810"] = new LegQuote(2.00, 2.20, Now.AddSeconds(-2)),
            [".SPY261103C815"] = new LegQuote(1.40, 1.60, Now.AddSeconds(-4)),
        };

        public Task<Dictionary<string, double?>> ResolveMetricsAsync(
            IEnumerable<string> metricRefs, DateTime nowUtc, TimeSpan? maxAge, CancellationToken ct)
            => Task.FromResult(metricRefs.ToDictionary(r => r, r => Metrics.GetValueOrDefault(r)));

        public Task<CandidateBuildResult> BuildCandidateAsync(
            StrategyInstance instance, StrategySpec spec, string symbol, double? vixPrice, DateTime nowUtc, CancellationToken ct)
            => new CreditSpreadCandidateBuilder(this).BuildAsync(instance, spec, symbol, vixPrice, nowUtc, ct);

        public Task<List<Expiration>?> GetExpirationsAsync(string symbol, CancellationToken ct) => Task.FromResult<List<Expiration>?>(new()
        {
            new() { ExpirationDate = "2026-10-16", ExpirationType = "Regular" },   // 22 DTE
            new() { ExpirationDate = "2026-11-03", ExpirationType = "Weekly" },    // 40 DTE: el del centro del rango
            new() { ExpirationDate = "2026-11-20", ExpirationType = "Regular" },   // 57 DTE
        });

        public Task<GammaExposureResponse?> GetGammaExposureAsync(GammaExposureRequest request, CancellationToken ct)
            => Task.FromResult<GammaExposureResponse?>(new()
            {
                Symbol = "SPY", Spot = 767.7, Expiration = "2026-11-03", DTE = 40, ExpirationType = "Weekly", SymbolsWithGreeks = 7,
                Strikes = new()
                {
                    new() { Strike = 725, PutDelta = -0.20, PutStreamerSymbol = ".SPY261103P725", PutOI = 10 },
                    new() { Strike = 720, PutDelta = -0.17, PutStreamerSymbol = ".SPY261103P720", PutOI = 10 },
                    new() { Strike = 715, PutDelta = -0.14, PutStreamerSymbol = ".SPY261103P715", PutOI = 10 },
                    new() { Strike = 805, CallDelta = 0.20, CallStreamerSymbol = ".SPY261103C805", CallOI = 10 },
                    new() { Strike = 810, CallDelta = 0.16, CallStreamerSymbol = ".SPY261103C810", CallOI = 10 },
                    new() { Strike = 815, CallDelta = 0.13, CallStreamerSymbol = ".SPY261103C815", CallOI = 10 },
                },
            });

        public Task<LegQuote?> GetQuoteAsync(string streamerSymbol, CancellationToken ct)
            => Task.FromResult(Quotes.GetValueOrDefault(streamerSymbol));
    }

    /// <summary>La spec de prueba con default_structure iron_condor: el lado put de siempre más uno call (δ 0,16, ancho 5).</summary>
    private static StrategySpec IronCondorTestSpec()
    {
        var spec = Spec();
        var legs = spec.CandidateConstruction.Legs.Concat(new List<LegTemplate>
        {
            new() { Side = "SELL", Type = "CALL", StrikeSelection = new LegStrikeSelection { Method = "DELTA", TargetDelta = 0.16, DeltaTolerance = 0.04 } },
            new() { Side = "BUY", Type = "CALL", StrikeSelection = new LegStrikeSelection { Method = "FIXED_WIDTH", Width = 5 } },
        }).ToList();
        return spec with
        {
            Structure = spec.Structure with { AllowedStrategies = new() { "iron_condor" }, DefaultStructure = "iron_condor" },
            CandidateConstruction = spec.CandidateConstruction with { Legs = legs },
        };
    }

    [Fact]
    public async Task IronCondor_EntersThroughTheTick_WithFourLegsInTwoSpreads()
    {
        var (store, _) = NewRuntime();
        store.RegisterSpec("shadow_runtime_test_v1", IronCondorTestSpec());
        var data = new ChainData();

        var outcomes = await ShadowRuntimeTick.RunEntryTickAsync(store, data, () => true, Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, outcomes["i-1:SPY"]);
        var pos = store.AllPositions().Single();
        Assert.Equal("iron_condor", pos.Structure);

        // Cuatro patas, una de cada (sin campo de cantidad: un contrato por pata), en dos spreads del mismo ancho.
        Assert.Equal(4, pos.Legs.Count);
        var spreads = pos.Legs.GroupBy(l => l.Type).ToDictionary(g => g.Key, g => g.ToDictionary(l => l.Side, l => l.Strike));
        Assert.Equal(new Dictionary<string, double> { ["SELL"] = 720, ["BUY"] = 715 }, spreads["PUT"]);
        Assert.Equal(new Dictionary<string, double> { ["SELL"] = 810, ["BUY"] = 815 }, spreads["CALL"]);
        Assert.All(pos.Legs, l => Assert.Equal("2026-11-03", l.Expiration));

        // Crédito de los dos lados al mid; riesgo del lado más ancho (sólo uno puede perder a la vez).
        Assert.Equal(1.3, pos.EntryCredit, 10);   // (4.20 − 3.50) + (2.10 − 1.50)
        Assert.Equal(370, pos.MaxRisk, 10);       // (5 − 1.30) × 100
        Assert.Equal(5, pos.Width);
        Assert.Equal(40, pos.EntryDte);

        // La evaluación queda regla por regla.
        var eval = store.GetEvaluations("i-1").Single();
        Assert.True(eval.OverallPass);
        Assert.Equal(new[] { ("vix_absolute", "PASS"), ("gex_non_negative", "PASS") }, eval.GateResults.Select(g => (g.GateId, g.Status)));
        var completed = store.GetEvents("i-1").Single(e => e.EventType == "EVALUATION_COMPLETED");
        Assert.Equal(2, ((System.Collections.ICollection)completed.Payload["gates"]!).Count);
    }

    [Fact]
    public async Task IronCondor_StoppedInstance_DoesNotEnterAgain_MonitorValuesAllFourLegs()
    {
        var (store, _) = NewRuntime();
        var spec = IronCondorTestSpec() with { RiskLimits = Spec().RiskLimits with { MaxConcurrentPositions = 5 } };
        store.RegisterSpec("shadow_runtime_test_v1", spec);
        var data = new ChainData();
        await ShadowRuntimeTick.RunEntryTickAsync(store, data, () => true, Now, default);
        store.Stop("i-1", Event("i-1", "INSTANCE_STOPPED", Now.AddMinutes(1)));

        var entry = await ShadowRuntimeTick.RunEntryTickAsync(store, data, () => true, Now.AddMinutes(2), default);
        var monitor = await ShadowRuntimeTick.RunMonitorTickAsync(store, data, Now, default);

        Assert.Empty(entry);
        var pos = store.AllPositions().Single();
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, monitor[pos.PositionId]);
        Assert.Equal(1.3, store.GetPosition(pos.PositionId)!.LastSpreadValue!.Value, 10);   // las cuatro patas, a los mismos mids
    }

    // ── 4. Caída de datos (T2): sin patas no hay salida ──

    [Fact]
    public async Task DataOutage_NoLegQuotes_RecordsNoData_AndNeverEvaluatesExits()
    {
        var (store, data, pos) = OpenedThenStopped();
        data.Quotes.Clear();   // la fuente no devuelve ninguna pata

        // En el día de X3: con datos saldría por tiempo; sin datos no se evalúa ninguna salida.
        var monitor = await ShadowRuntimeTick.RunMonitorTickAsync(store, data, TimeExitDay, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.NoData, monitor[pos.PositionId]);
        var same = store.GetPosition(pos.PositionId)!;
        Assert.Equal("OPEN", same.Status);
        Assert.Null(same.ExitReason);
        Assert.Null(same.LastValuedAt);
        Assert.Equal(2, same.ValuationProblems!.Count);
        var ev = Assert.Single(store.GetEvents("i-1"), e => e.EventType == "VALUATION_NO_DATA");
        Assert.Equal(pos.PositionId, ev.Payload["position_id"]);
        Assert.DoesNotContain(store.GetEvents("i-1"), e => e.EventType == "POSITION_CLOSED");
    }
}
