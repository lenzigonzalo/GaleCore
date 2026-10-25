using System.Text.Json.Nodes;
using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Application.Data.Fed.FomcMeetings;
using DataFeed.Application.Data.Fred.ReleaseDates;
using DataFeed.Application.Data.Tastytrade.MarketMetricsVolatility;
using DataFeed.Application.Data.Tastytrade.MarketDataCandle;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers;
using DataFeed.Infrastructure.Providers.Fed;
using MediatR;
using Microsoft.Extensions.Logging.Abstractions;
using static DataFeed.Tests.ShadowRuntimeEngineTests;

namespace DataFeed.Tests;

/// <summary>
/// WS-0062 inc.5 — métrica contra métrica (EMA/SMA), ventana de entrada, tope de entradas por día, blackout del FOMC,
/// salida por hora, take profit / stop loss de débito (% del costo) y validación de los campos nuevos.
/// </summary>
public class ShadowInc5Tests
{
    private static readonly DateTime D1745 = new(2026, 9, 24, 17, 45, 0, DateTimeKind.Utc);   // 13:45 ET (EDT, jueves)

    // ── Métrica contra métrica ───────────────────────────────────────

    private static GateDefinition Gate(string metric, string op, GateThreshold t, string onNoData = "BLOCK") => new()
    {
        Id = "g", MetricRef = metric, Operator = op, Threshold = t, OnFail = "NO_TRADE", OnNoData = onNoData,
    };

    [Fact]
    public void Gate_MetricVsMetric_ComparesBothValues_AndNoDataIfEitherIsMissing()
    {
        var gate = Gate("a", "GT", new GateThreshold { MetricRef = "b" });
        Assert.Equal("PASS", GenericGateEvaluator.EvaluateGate(gate, new() { ["a"] = 5, ["b"] = 4 }).Status);
        Assert.Equal("FAIL", GenericGateEvaluator.EvaluateGate(gate, new() { ["a"] = 4, ["b"] = 4 }).Status);
        var noB = GenericGateEvaluator.EvaluateGate(gate, new() { ["a"] = 5, ["b"] = null });
        Assert.Equal("NO_DATA", noB.Status);
        Assert.Equal("NO_DATA", GenericGateEvaluator.EvaluateGate(gate, new() { ["a"] = null, ["b"] = 4 }).Status);
        Assert.Equal("NO_DATA", GenericGateEvaluator.EvaluateGate(gate, new() { ["a"] = 5 }).Status);   // b ni siquiera resuelta

        var layer = GenericGateEvaluator.Evaluate(new() { gate }, "ALL", "NO_TRADE", new() { ["a"] = 5, ["b"] = null }, "i", "SPY");
        Assert.False(layer.OverallPass);   // on_no_data BLOCK
        var pass = GenericGateEvaluator.Evaluate(new() { Gate("a", "GT", new GateThreshold { MetricRef = "b" }, "PASS") }, "ALL", "NO_TRADE",
            new() { ["a"] = 5, ["b"] = null }, "i", "SPY");
        Assert.True(pass.OverallPass);     // on_no_data PASS aplica si falta cualquiera
    }

    [Fact]
    public async Task Entry_RequestsTheThresholdMetricToo_AndDecidesWithBoth()
    {
        const string a = "capability:compute.ema.AAPL.20", b = "capability:compute.ema.AAPL.50";
        var spec = Spec() with
        {
            EntryFilters = new EntryFilters
            {
                GateLayer = new GateLayer { Gates = new() { Gate(a, "GT", new GateThreshold { MetricRef = b }) } },
            },
        };
        var (store, instance) = NewRuntime();
        var data = new RecordingData { Metrics = new() { [a] = 105.0, [b] = 100.0 }, Build = () => CandidateBuildResult.Built(RealCandidate()) };
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, spec, "SPY", Now, default));
        Assert.Contains(b, data.Asked);

        var (store2, instance2) = NewRuntime();
        data.Metrics[b] = 110.0;
        Assert.Equal(ShadowRuntimeEngine.Outcomes.GatesNotPassed, await ShadowRuntimeEngine.EvaluateEntryAsync(store2, data, instance2, spec, "SPY", Now, default));
    }

    private sealed class RecordingData : FakeDataBase
    {
        public List<string> Asked = new();
        public override Task<Dictionary<string, double?>> ResolveMetricsAsync(IEnumerable<string> r, DateTime n, TimeSpan? m, CancellationToken ct)
        {
            var list = r.ToList();
            Asked.AddRange(list);
            return Task.FromResult(list.ToDictionary(x => x, x => Metrics.GetValueOrDefault(x)));
        }
    }

    /// <summary>FakeData con ResolveMetricsAsync sobreescribible.</summary>
    private abstract class FakeDataBase : IRuntimeMarketData
    {
        public Dictionary<string, double?> Metrics = new();
        public Func<CandidateBuildResult>? Build;
        public Dictionary<string, LegQuote?> Quotes = new();
        public IEventCalendar? Events { get; set; }
        public abstract Task<Dictionary<string, double?>> ResolveMetricsAsync(IEnumerable<string> r, DateTime n, TimeSpan? m, CancellationToken ct);
        public Task<CandidateBuildResult> BuildCandidateAsync(StrategyInstance i, StrategySpec s, string sym, double? vix, DateTime now, CancellationToken ct)
        {
            var built = Build!();
            if (built.Candidate is { Snapshot.OldestQuoteAt: null } c)
                built = built with { Candidate = c with { Snapshot = c.Snapshot with { OldestQuoteAt = now } } };
            return Task.FromResult(built);
        }
        public Task<LegQuote?> GetQuoteAsync(string s, CancellationToken ct) => Task.FromResult(Quotes.GetValueOrDefault(s));
    }

    private static List<CandleData> Candles(int count, Func<int, double> close) =>
        Enumerable.Range(0, count).Select(i => new CandleData
        {
            Close = close(i),
            Time = new DateTimeOffset(Now.AddDays(-1).AddDays(-(count - 1 - i))).ToUnixTimeMilliseconds(),
        }).ToList();

    [Fact]
    public void EmaFastGtEmaSlow_GivesTheSameDecisionAsEmaSpreadGtZero()
    {
        var series = new Func<int, double>[]
        {
            i => 100 + i, i => 300 - i, i => 100, i => 100 + 10 * Math.Sin(i / 5.0), i => i < 60 ? 150 - i : 90 + (i - 60) * 2,
            i => i == 119 ? 110 : 100, i => 100 + (i % 7) - (i % 3),
        };
        foreach (var f in series)
        {
            var candles = Candles(140, f);
            var spread = MetricResolver.UsableEmaSpread(candles, 20, 50, Now);
            var fast = MetricResolver.UsableEma(candles, 20, Now);
            var slow = MetricResolver.UsableEma(candles, 50, Now);
            Assert.NotNull(spread); Assert.NotNull(fast); Assert.NotNull(slow);
            Assert.Equal(spread!.Value, fast!.Value - slow!.Value, 9);

            var viaSpread = GenericGateEvaluator.EvaluateGate(
                Gate("s", "GT", new GateThreshold { Value = 0 }), new() { ["s"] = spread }).Status;
            var viaMetrics = GenericGateEvaluator.EvaluateGate(
                Gate("f", "GT", new GateThreshold { MetricRef = "sl" }), new() { ["f"] = fast, ["sl"] = slow }).Status;
            Assert.Equal(viaSpread, viaMetrics);
        }
    }

    [Fact]
    public void Sma_IsTheAverageOfTheLastClosesAndNullWithoutHistory()
    {
        var candles = Candles(60, i => i + 1);   // cierres 1..60
        Assert.Equal((51 + 60) / 2.0 * 10 / 10, MetricResolver.UsableSma(candles, 10, Now)!.Value, 9);
        Assert.Null(MetricResolver.UsableSma(Candles(19, i => i + 1), 10, Now));        // < n×2
        Assert.Null(MetricResolver.UsableEma(Candles(19, i => i + 1), 10, Now));
        Assert.Null(MetricResolver.UsableEma(null, 10, Now));
        Assert.Null(MetricResolver.UsableEma(candles, 0, Now));
    }

    private sealed class CountingCandleMediator : IMediator
    {
        public List<CandleData>? Data;
        public int Calls;
        public Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken ct = default)
        {
            Calls++;
            object resp = new MarketDataCandleResponse { data = Data! };
            return Task.FromResult((TResponse)resp);
        }
        public Task Send<TRequest>(TRequest request, CancellationToken ct = default) where TRequest : IRequest => throw new NotSupportedException();
        public Task<object?> Send(object request, CancellationToken ct = default) => throw new NotSupportedException();
        public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamRequest<TResponse> request, CancellationToken ct = default) => throw new NotSupportedException();
        public IAsyncEnumerable<object?> CreateStream(object request, CancellationToken ct = default) => throw new NotSupportedException();
        public Task Publish(object notification, CancellationToken ct = default) => throw new NotSupportedException();
        public Task Publish<TNotification>(TNotification notification, CancellationToken ct = default) where TNotification : INotification => throw new NotSupportedException();
    }

    [Fact]
    public async Task Resolver_EmaAndSma_ShareTheCandleFetchWithEmaSpread()
    {
        MetricResolver.ClearDailyCandleCache();
        var mediator = new CountingCandleMediator { Data = Candles(140, i => 100 + i) };
        var resolver = new MetricResolver(mediator, NullLogger.Instance);
        var refs = new[]
        {
            "capability:compute.ema.AAPL.20", "capability:compute.ema.AAPL.50", "capability:compute.sma.AAPL.50",
            "capability:compute.ema_spread.AAPL.20.50",
        };
        var r = await resolver.ResolveAsync(refs, default, Now);
        Assert.All(refs, k => Assert.NotNull(r[k]));
        // ema 20 pide 250 días; ema 50, sma 50 y ema_spread 20/50 comparten el pedido de 300 días: 2 pedidos, no 4.
        Assert.Equal(2, mediator.Calls);
        Assert.Equal(r[refs[0]]!.Value - r[refs[1]]!.Value, r[refs[3]]!.Value, 6);
        Assert.Null((await resolver.ResolveAsync(new[] { "capability:compute.ema.AAPL.0" }, default, Now))["capability:compute.ema.AAPL.0"]);
        MetricResolver.ClearDailyCandleCache();
    }

    [Fact]
    public async Task MetricExit_ThresholdIsAnotherMetric()
    {
        const string a = "capability:compute.ema.AAPL.20", b = "capability:compute.ema.AAPL.50";
        var spec = LongEquityTests.EquitySpec();
        spec = spec with
        {
            Exits = new SpecExits
            {
                Deterministic = spec.Exits.Deterministic with
                {
                    MetricExit = new MetricExit { MetricRef = a, Operator = "LT", Threshold = new GateThreshold { MetricRef = b } },
                },
            },
        };
        Assert.True(StrategySpecValidator.Validate(spec).IsValid, string.Join("; ", StrategySpecValidator.Validate(spec).Errors));

        var (store, instance) = NewRuntime();
        var data = new RecordingData { Metrics = new() { ["capability:compute.ema_spread.AAPL.20.50"] = 1.0 } };
        data.Quotes["AAPL"] = new LegQuote(269.90, 270.10, Now);
        data.Build = () => LongEquityCandidateBuilder.BuildAsync((s, _) => Task.FromResult(data.Quotes.GetValueOrDefault(s)), instance, spec, "AAPL", Now, default).Result;
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, spec, "AAPL", Now, default));
        var pos = Assert.Single(store.OpenPositions());

        data.Metrics = new() { [a] = 101.0, [b] = 100.0 };   // EMA20 > EMA50: sigue
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued,
            await ShadowRuntimeEngine.ValuePositionAsync(store, data, pos, spec.Exits.Deterministic, Now, default));
        data.Metrics = new() { [a] = 99.0 };                  // falta EMA50: no cierra, queda anotado
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued,
            await ShadowRuntimeEngine.ValuePositionAsync(store, data, store.GetPosition(pos.PositionId)!, spec.Exits.Deterministic, Now, default));
        Assert.NotNull(store.GetPosition(pos.PositionId)!.ValuationProblems);
        data.Metrics = new() { [a] = 99.0, [b] = 100.0 };     // cruza: cierra
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed,
            await ShadowRuntimeEngine.ValuePositionAsync(store, data, store.GetPosition(pos.PositionId)!, spec.Exits.Deterministic, Now, default));
        Assert.Equal("METRIC_EXIT", store.GetPosition(pos.PositionId)!.ExitReason);
    }

    // ── Ventana de entrada ───────────────────────────────────────────

    private static StrategySpec WindowSpec(TradeLimitsHolder? limits = null) => Spec() with
    {
        Operational = Spec().Operational with
        {
            EntryWindow = new EntryWindow { Start = "13:45", End = "13:50" },
            TradeLimits = limits?.Value,
        },
        RiskLimits = new SpecRiskLimits { MaxConcurrentPositions = 5 },
    };

    private sealed record TradeLimitsHolder(SpecTradeLimits Value);

    private static (ShadowRuntimeStore Store, FakeData Data) TickRuntime(StrategySpec spec)
    {
        var (store, _) = NewRuntime();
        store.RegisterSpec("shadow_runtime_test_v1", spec);
        return (store, new FakeData { Build = () => CandidateBuildResult.Built(RealCandidate()) });
    }

    [Theory]
    [InlineData(17, 44, false)]   // 13:44 ET
    [InlineData(17, 45, true)]    // 13:45 ET
    [InlineData(17, 49, true)]
    [InlineData(17, 50, false)]   // el fin es exclusivo
    [InlineData(17, 51, false)]   // 13:51 ET
    public async Task EntryWindow_OnlyEvaluatesInsideIt(int hour, int minute, bool evaluates)
    {
        var (store, data) = TickRuntime(WindowSpec());
        var when = new DateTime(2026, 9, 24, hour, minute, 0, DateTimeKind.Utc);

        var outcomes = await ShadowRuntimeTick.RunEntryTickAsync(store, data, () => true, when, default);

        if (evaluates)
        {
            Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, outcomes["i-1:SPY"]);
            Assert.Single(store.AllPositions());
        }
        else
        {
            Assert.Empty(outcomes);
            Assert.Equal(0, data.BuildCalls);
            Assert.Empty(store.AllPositions());
            Assert.Empty(store.GetEvaluations("i-1"));
            Assert.Equal(ShadowRuntimeTick.SchedulerStates.OutsideEntryWindow, store.GetInstance("i-1")!.SchedulerState);
        }
    }

    // ── Límites de frecuencia (operational.trade_limits) ─────────────

    private static string Reason(ShadowRuntimeStore store) =>
        (string)store.GetEvents("i-1").Last(e => e.EventType == "ENTRY_SKIPPED").Payload["reason"]!;

    [Fact]
    public async Task MaxEntriesPerDay_SecondTickSameDayDoesNotOpen_NextDayDoes()
    {
        var (store, data) = TickRuntime(WindowSpec(new(new SpecTradeLimits { MaxEntriesPerDay = 1 })));
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened,
            (await ShadowRuntimeTick.RunEntryTickAsync(store, data, () => true, D1745, default))["i-1:SPY"]);

        var second = await ShadowRuntimeTick.RunEntryTickAsync(store, data, () => true, D1745.AddMinutes(1), default);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.TradeLimit, second["i-1:SPY"]);
        Assert.Contains("por día", Reason(store));
        Assert.Single(store.AllPositions());

        var nextDay = await ShadowRuntimeTick.RunEntryTickAsync(store, data, () => true, D1745.AddDays(1), default);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, nextDay["i-1:SPY"]);
        Assert.Equal(2, store.AllPositions().Count);
    }

    [Fact]
    public async Task MaxEntriesPerDay_CountsTheDayInTheSpecTimezone_NotUtc()
    {
        // 20:30 ET del miércoles (00:30Z del jueves) y 09:45 ET del jueves son días distintos en ET aunque sea el mismo día en UTC.
        var spec = Spec() with
        {
            Operational = Spec().Operational with { TradeLimits = new SpecTradeLimits { MaxEntriesPerDay = 1 } },
            RiskLimits = new SpecRiskLimits { MaxConcurrentPositions = 5 },
        };
        var (store, instance) = NewRuntime();
        var data = new FakeData { Build = () => CandidateBuildResult.Built(RealCandidate()) };
        Task<string> Enter(DateTime utc) => ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, spec, "SPY", utc, default);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, await Enter(new DateTime(2026, 9, 24, 0, 30, 0, DateTimeKind.Utc)));
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, await Enter(new DateTime(2026, 9, 24, 13, 45, 0, DateTimeKind.Utc)));
        Assert.Equal(ShadowRuntimeEngine.Outcomes.TradeLimit, await Enter(new DateTime(2026, 9, 24, 14, 0, 0, DateTimeKind.Utc)));
    }

    [Fact]
    public async Task MaxEntriesPerWeek_CountsMondayToSunday()
    {
        var spec = Spec() with
        {
            Operational = Spec().Operational with { TradeLimits = new SpecTradeLimits { MaxEntriesPerWeek = 2 } },
            RiskLimits = new SpecRiskLimits { MaxConcurrentPositions = 9 },
        };
        var (store, instance) = NewRuntime();
        var data = new FakeData { Build = () => CandidateBuildResult.Built(RealCandidate()) };
        Task<string> Enter(int day) => ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, spec, "SPY", new DateTime(2026, 9, day, 15, 0, 0, DateTimeKind.Utc), default);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, await Enter(21));   // lunes 21/09
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, await Enter(23));   // miércoles
        Assert.Equal(ShadowRuntimeEngine.Outcomes.TradeLimit, await Enter(25));   // viernes: 3.ª de la semana
        Assert.Contains("por semana", Reason(store));
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, await Enter(28));   // lunes siguiente
    }

    // ── Condiciones de eventos (event_gates) ─────────────────────────

    /// <summary>Calendario falso: eventos por (tipo, sujeto) y, si se pide, estado NoData / tipo desconocido.</summary>
    private sealed class FakeEvents : IEventCalendar
    {
        public List<CalendarEvent> Events = new();
        public HashSet<string> NoData = new();      // tipos sin lectura
        public HashSet<string> Unknown = new();     // tipos sin fuente
        public List<(string Type, string? Subject)> Asked = new();
        public IReadOnlyCollection<EventTypeInfo> Catalog => EventCatalog.Builtin;
        public Task<EventQueryResult> QueryAsync(string type, string? subject, DateTime fromUtc, DateTime toUtc, CancellationToken ct)
        {
            Asked.Add((type, subject));
            if (Unknown.Contains(type)) return Task.FromResult(EventQueryResult.Unknown(type));
            if (NoData.Contains(type)) return Task.FromResult(EventQueryResult.NoData("fuente caída"));
            // Como el proveedor: por símbolo sin símbolo no hay respuesta; con DATE, los días que tocan el rango.
            if (EventCatalog.Builtin.First(t => t.Type == type).PerSymbol && subject == null) return Task.FromResult(EventQueryResult.NoData("por símbolo"));
            return Task.FromResult(EventQueryResult.Ok(Events.Where(e => e.Type == type
                && (subject == null || string.Equals(e.Subject, subject, StringComparison.OrdinalIgnoreCase))
                && (e.Precision == EventPrecision.Time ? e.StartUtc >= fromUtc && e.StartUtc <= toUtc
                    : e.StartUtc >= fromUtc.Date.AddDays(-1) && e.StartUtc <= toUtc.Date.AddDays(1))).ToList()));
        }
    }

    private static CalendarEvent Fomc(DateTime startUtc) => new("FOMC", null, startUtc, EventPrecision.Time, "fed", Now);
    private static CalendarEvent DateEvent(string type, string? subject, int day) =>
        new(type, subject, new DateTime(2026, 9, day, 0, 0, 0, DateTimeKind.Utc), EventPrecision.Date, "test", Now);

    private static readonly SpecOperational NyOp = new();
    private static readonly string[] UniverseSymbols = { "SPY", "AAPL" };
    private static readonly DateTime FedDayNow = new(2026, 9, 24, 17, 45, 0, DateTimeKind.Utc);       // 13:45 ET
    private static readonly DateTime FedDecision = new(2026, 9, 24, 18, 0, 0, DateTimeKind.Utc);      // 14:00 ET

    private static EventGate EGate(string type, string? subject, string from, string to, int? minutes, string must,
        string onNoData = "BLOCK", string onFail = "NO_TRADE") => new()
    {
        Id = "ev", Type = type, Subject = subject, Window = new EventGateWindow { From = from, To = to, Minutes = minutes },
        Must = must, OnFail = onFail, OnNoData = onNoData,
    };

    private static Task<GateResult> Eval(EventGate g, IEventCalendar? calendar, DateTime? now = null) =>
        EventGates.EvaluateAsync(g, calendar, NyOp, UniverseSymbols, now ?? FedDayNow, default);

    [Fact]
    public async Task EventGate_MustExistAndNotExist_InADayWindow()
    {
        var cal = new FakeEvents { Events = { Fomc(FedDecision) } };
        Assert.Equal("FAIL", (await Eval(EGate("FOMC", null, "day_start", "day_end", null, "not_exist"), cal)).Status);    // evitar el día de la Fed
        Assert.Equal("PASS", (await Eval(EGate("FOMC", null, "day_start", "day_end", null, "exist"), cal)).Status);        // sólo días de Fed

        var normalDay = new DateTime(2026, 9, 25, 17, 45, 0, DateTimeKind.Utc);
        Assert.Equal("PASS", (await Eval(EGate("FOMC", null, "day_start", "day_end", null, "not_exist"), cal, normalDay)).Status);
        var none = await Eval(EGate("FOMC", null, "day_start", "day_end", null, "exist"), cal, normalDay);
        Assert.Equal("FAIL", none.Status);
        Assert.Equal(0, none.Value);
        Assert.Equal("EVENT_EXISTS", none.Operator);
    }

    [Fact]
    public async Task EventGate_MinutesWindow_UsesTheExactTimeOfTimeEvents()
    {
        var cal = new FakeEvents { Events = { Fomc(FedDecision) } };
        // 13:45 ET: la decisión (14:00) está a 15 minutos. «No entrar si hay una decisión en las próximas 2 h 15».
        Assert.Equal("FAIL", (await Eval(EGate("FOMC", null, "now", "minutes_after_now", 135, "not_exist"), cal)).Status);
        Assert.Equal("PASS", (await Eval(EGate("FOMC", null, "now", "minutes_after_now", 10, "not_exist"), cal)).Status);   // en 10 min todavía no
        // 14:01 ET: ya pasó.
        Assert.Equal("PASS", (await Eval(EGate("FOMC", null, "now", "minutes_after_now", 135, "not_exist"), cal, FedDecision.AddMinutes(1))).Status);
    }

    [Fact]
    public async Task EventGate_DateOnlyEvents_MatchDayWindows_ButMinuteWindowsAreNoData()
    {
        var cal = new FakeEvents { Events = { DateEvent("CPI", null, 24) } };
        Assert.Equal("FAIL", (await Eval(EGate("CPI", null, "day_start", "day_end", null, "not_exist"), cal)).Status);
        Assert.Equal("PASS", (await Eval(EGate("CPI", null, "day_start", "day_end", null, "exist"), cal)).Status);
        // Sin hora de publicación, «en los próximos 135 minutos» no se puede responder: NO_DATA, nunca una hora inventada.
        Assert.Equal("NO_DATA", (await Eval(EGate("CPI", null, "now", "minutes_after_now", 135, "not_exist"), cal)).Status);
        Assert.Equal("NO_DATA", (await Eval(EGate("CPI", null, "now", "minutes_after_now", 135, "exist"), cal)).Status);
        // Un evento de otro día que la ventana de minutos no toca no cuenta ni es ambiguo.
        var tomorrow = new FakeEvents { Events = { DateEvent("CPI", null, 26) } };
        Assert.Equal("PASS", (await Eval(EGate("CPI", null, "now", "minutes_after_now", 135, "not_exist"), tomorrow)).Status);
    }

    [Fact]
    public async Task EventGate_Subjects_Specific_Universe_Any()
    {
        var cal = new FakeEvents { Events = { DateEvent("EARNINGS", "AAPL", 24) } };
        Task<GateResult> E(string? subject, string must = "not_exist") => Eval(EGate("EARNINGS", subject, "day_start", "day_end", null, must), cal);

        Assert.Equal("FAIL", (await E("AAPL")).Status);                       // balance de AAPL hoy
        Assert.Equal("PASS", (await E("MSFT")).Status);                       // otro símbolo
        Assert.Equal("FAIL", (await E("UNIVERSE")).Status);                   // AAPL está en el universo (SPY, AAPL)
        Assert.Equal("PASS", (await E("UNIVERSE", "exist")).Status);
        Assert.Contains(("EARNINGS", "SPY"), cal.Asked);                      // se preguntó por cada símbolo del universo
        Assert.Contains(("EARNINGS", "AAPL"), cal.Asked);

        // UNIVERSE sin balances de nadie del universo: no existe.
        var other = new FakeEvents { Events = { DateEvent("EARNINGS", "MSFT", 24) } };
        Assert.Equal("PASS", (await Eval(EGate("EARNINGS", "UNIVERSE", "day_start", "day_end", null, "not_exist"), other)).Status);
        // ANY en un tipo por símbolo: ninguna fuente lista los de todos, NO_DATA (y el validador lo rechaza antes).
        Assert.Equal("NO_DATA", (await E("ANY")).Status);
        Assert.Equal("NO_DATA", (await E(null)).Status);
        // ANY en un tipo global (sin sujeto) sí responde.
        Assert.Equal("FAIL", (await Eval(EGate("FOMC", "ANY", "day_start", "day_end", null, "not_exist"), new FakeEvents { Events = { Fomc(FedDecision) } })).Status);
    }

    [Fact]
    public async Task EventGate_NoData_UnknownType_AndMissingCalendar()
    {
        var down = new FakeEvents { NoData = { "FOMC" } };
        Assert.Equal("NO_DATA", (await Eval(EGate("FOMC", null, "day_start", "day_end", null, "not_exist"), down)).Status);   // nunca «no hay Fed»
        Assert.Equal("NO_DATA", (await Eval(EGate("FOMC", null, "day_start", "day_end", null, "exist"), down)).Status);
        var unknown = new FakeEvents { Unknown = { "FOMC" } };
        Assert.Equal("NO_DATA", (await Eval(EGate("FOMC", null, "day_start", "day_end", null, "not_exist"), unknown)).Status);
        Assert.Equal("NO_DATA", (await Eval(EGate("FOMC", null, "day_start", "day_end", null, "not_exist"), null)).Status);   // sin calendario
        // Un símbolo del universo ilegible: no se sabe aunque el otro diga que no hay…
        var partial = new FakeEvents { NoData = { "EARNINGS" } };
        Assert.Equal("NO_DATA", (await Eval(EGate("EARNINGS", "UNIVERSE", "day_start", "day_end", null, "not_exist"), partial)).Status);
        // …pero si ya hay un evento seguro, el resultado se sabe.
        var found = new FakeEvents { Events = { Fomc(FedDecision) } };
        Assert.Equal("FAIL", (await Eval(EGate("FOMC", null, "day_start", "day_end", null, "not_exist"), found)).Status);
    }

    [Fact]
    public async Task EventGate_InTheEngine_BlocksOrAppliesOnNoData_AndLeavesTheTraceInTheEvaluation()
    {
        StrategySpec WithEvent(EventGate g) => Spec() with
        {
            EntryFilters = Spec().EntryFilters with { GateLayer = Spec().EntryFilters.GateLayer with { EventGates = new() { g } } },
        };

        async Task<(string Outcome, ShadowRuntimeStore Store)> Enter(EventGate g, IEventCalendar? cal)
        {
            var (store, instance) = NewRuntime();
            var data = new RecordingData { Events = cal, Metrics = new() { [VixRef] = 15.2, [GexRef] = 120.0 }, Build = () => CandidateBuildResult.Built(RealCandidate()) };
            return (await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, WithEvent(g), "SPY", FedDayNow, default), store);
        }

        var fed = new FakeEvents { Events = { Fomc(FedDecision) } };
        var avoid = EGate("FOMC", null, "day_start", "day_end", null, "not_exist");
        var (blocked, store) = await Enter(avoid, fed);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.GatesNotPassed, blocked);
        Assert.Contains(store.GetEvaluations("i-1").Single().GateResults, r => r.GateId == "ev" && r.Status == "FAIL");

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, (await Enter(avoid, new FakeEvents())).Outcome);                      // sin Fed hoy
        Assert.Equal(ShadowRuntimeEngine.Outcomes.GatesNotPassed, (await Enter(avoid, null)).Outcome);                         // sin calendario: BLOCK
        var down = new FakeEvents { NoData = { "FOMC" } };
        Assert.Equal(ShadowRuntimeEngine.Outcomes.GatesNotPassed, (await Enter(avoid, down)).Outcome);                         // fuente caída: BLOCK
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, (await Enter(avoid with { OnNoData = "PASS" }, down)).Outcome);       // la spec lo declara
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, (await Enter(avoid with { OnFail = "INFORM_ONLY" }, fed)).Outcome);   // sólo informa
    }

    [Fact]
    public void Validator_EventGates_UnknownTypeHasNoDataSource_AndSubjectsMustMatchTheType()
    {
        StrategySpec With(params EventGate[] gates) => Spec() with
        {
            EntryFilters = Spec().EntryFilters with { GateLayer = Spec().EntryFilters.GateLayer with { EventGates = gates.ToList() } },
        };
        var ok = EGate("FOMC", null, "day_start", "day_end", null, "not_exist");
        Assert.True(StrategySpecValidator.Validate(With(ok)).IsValid, string.Join("; ", Errors(With(ok))));
        Assert.True(StrategySpecValidator.Validate(With(EGate("EARNINGS", "AAPL", "now", "minutes_after_now", 60, "exist"))).IsValid);
        Assert.True(StrategySpecValidator.Validate(With(EGate("EARNINGS", "UNIVERSE", "day_start", "day_end", null, "not_exist"))).IsValid);

        Assert.Contains(Errors(With(ok with { Type = "PRESIDENT_SPEECH" })), e => e.Contains("no data source for that event type"));
        Assert.Contains(Errors(With(EGate("EARNINGS", null, "day_start", "day_end", null, "exist"))), e => e.Contains("per symbol"));
        Assert.Contains(Errors(With(EGate("EARNINGS", "ANY", "day_start", "day_end", null, "exist"))), e => e.Contains("per symbol"));
        Assert.Contains(Errors(With(EGate("FOMC", "AAPL", "day_start", "day_end", null, "exist"))), e => e.Contains("not tied to a symbol"));
        Assert.Contains(Errors(With(ok with { Must = "maybe" })), e => e.Contains("must be exist or not_exist"));
        Assert.Contains(Errors(With(ok with { Window = new EventGateWindow { From = "yesterday", To = "day_end" } })), e => e.Contains("window.from"));
        Assert.Contains(Errors(With(ok with { Window = new EventGateWindow { From = "now", To = "minutes_after_now" } })), e => e.Contains("window.minutes"));
        Assert.Contains(Errors(With(ok with { Window = new EventGateWindow { From = "now", To = "day_end", Minutes = 5 } })), e => e.Contains("only applies with minutes_after_now"));
        Assert.Contains(Errors(With(ok, ok)), e => e.Contains("duplicate gate id"));
        // Un catálogo de otro proveedor (p. ej. un almacén de eventos futuro) se pasa al validador sin tocar el runtime.
        var custom = new[] { new EventTypeInfo("PRESIDENT_SPEECH", "Discursos", false, EventPrecision.Time, "store") };
        Assert.True(StrategySpecValidator.Validate(With(ok with { Type = "PRESIDENT_SPEECH" }), custom).IsValid);
    }

    // ── El proveedor compuesto de GaleCore ───────────────────────────

    private sealed class RoutingMediator : IMediator
    {
        public Func<object, object?> Handler = _ => null;
        public Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken ct = default) => Task.FromResult((TResponse)Handler(request)!);
        public Task Send<TRequest>(TRequest request, CancellationToken ct = default) where TRequest : IRequest => throw new NotSupportedException();
        public Task<object?> Send(object request, CancellationToken ct = default) => throw new NotSupportedException();
        public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamRequest<TResponse> request, CancellationToken ct = default) => throw new NotSupportedException();
        public IAsyncEnumerable<object?> CreateStream(object request, CancellationToken ct = default) => throw new NotSupportedException();
        public Task Publish(object notification, CancellationToken ct = default) => throw new NotSupportedException();
        public Task Publish<TNotification>(TNotification notification, CancellationToken ct = default) where TNotification : INotification => throw new NotSupportedException();
    }

    private static SourcedResponse<List<T>> Sourced<T>(List<T> data) => new() { Source = "t", RetrievedAt = Now, Data = data };

    [Fact]
    public async Task MediatorEventCalendar_Fomc_IsTimeEventAt1400NyOfTheLastMeetingDay()
    {
        var mediator = new RoutingMediator
        {
            Handler = r => r is FomcMeetingsRequest q && q.Years == "2026" ? Sourced(new List<FomcMeeting>
            {
                new(2026, "September", "15-16*", new DateOnly(2026, 9, 15), new DateOnly(2026, 9, 16), true, true),
                new(2026, "October", "27-28", new DateOnly(2026, 10, 27), new DateOnly(2026, 10, 28), false, true),
            }) : throw new UpstreamSourceException("fed", "sin ese año"),
        };
        var cal = new MediatorEventCalendar(mediator, NullLogger.Instance);
        var res = await cal.QueryAsync("FOMC", null, new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc), new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc), default);
        Assert.Equal(EventQueryStatus.Ok, res.Status);
        var ev = Assert.Single(res.Events);
        Assert.Equal(EventPrecision.Time, ev.Precision);
        Assert.Equal(new DateTime(2026, 9, 16, 18, 0, 0, DateTimeKind.Utc), ev.StartUtc);   // 14:00 EDT

        // Un rango que cruza a un año que la página no trae: no se sabe.
        var cross = await cal.QueryAsync("FOMC", null, new DateTime(2026, 12, 20, 0, 0, 0, DateTimeKind.Utc), new DateTime(2027, 1, 5, 0, 0, 0, DateTimeKind.Utc), default);
        Assert.Equal(EventQueryStatus.NoData, cross.Status);
    }

    [Fact]
    public async Task MediatorEventCalendar_Fred_IsDateOnly_Earnings_PerSymbol_AndHonestAboutGaps()
    {
        var mediator = new RoutingMediator
        {
            Handler = r => r switch
            {
                FredReleaseDatesRequest f when f.ReleaseIds == "10" => Sourced(new List<FredReleaseDateDto> { new(10, "CPI", "2026-09-24") }),
                MarketMetricsVolatilityRequest m when m.Symbols == "AAPL" => new MarketMetricsVolatilityResponse
                {
                    Items = new() { new MarketMetricsVolatilityDto { Symbol = "AAPL", Earnings = new EarningsDto { ExpectedReportDate = "2026-10-29", TimeOfDay = "AMC" } } },
                },
                MarketMetricsVolatilityRequest m when m.Symbols == "OLD" => new MarketMetricsVolatilityResponse
                {
                    Items = new() { new MarketMetricsVolatilityDto { Symbol = "OLD", Earnings = new EarningsDto { ExpectedReportDate = "2026-01-10" } } },
                },
                MarketMetricsVolatilityRequest m => new MarketMetricsVolatilityResponse { Items = new() { new MarketMetricsVolatilityDto { Symbol = m.Symbols } } },   // ETF: sin earnings
                _ => throw new UpstreamSourceException("x", "caída"),
            },
        };
        var cal = new MediatorEventCalendar(mediator, NullLogger.Instance);
        var from = new DateTime(2026, 9, 24, 4, 0, 0, DateTimeKind.Utc);
        var to = from.AddDays(1);

        var cpi = await cal.QueryAsync("CPI", null, from, to, default);
        Assert.Equal(EventPrecision.Date, Assert.Single(cpi.Events).Precision);
        Assert.Equal(EventQueryStatus.NoData, (await cal.QueryAsync("PPI", null, from, to, default)).Status);   // FRED caído

        var inRange = await cal.QueryAsync("EARNINGS", "AAPL", from, new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc), default);
        Assert.Equal("AAPL", Assert.Single(inRange.Events).Subject);
        Assert.Empty((await cal.QueryAsync("EARNINGS", "AAPL", from, to, default)).Events);                      // existe pero más adelante
        Assert.Equal(EventQueryStatus.NoData, (await cal.QueryAsync("EARNINGS", "OLD", from, to, default)).Status);   // fecha vieja
        Assert.Equal(EventQueryStatus.NoData, (await cal.QueryAsync("EARNINGS", "SPY", from, to, default)).Status);   // ETF: sin balance informado
        Assert.Equal(EventQueryStatus.NoData, (await cal.QueryAsync("EARNINGS", null, from, to, default)).Status);    // sin símbolo
        Assert.Equal(EventQueryStatus.UnknownType, (await cal.QueryAsync("PRESIDENT_SPEECH", null, from, to, default)).Status);
    }

    // ── Salidas: por hora y % del costo ──────────────────────────────

    private static ShadowPosition Open(double entryCredit, string structure = "put_credit_spread") =>
        new() { PositionId = "p", InstanceId = "i-1", Symbol = "X", Structure = structure, Status = "OPEN", EntryCredit = entryCredit };

    [Fact]
    public void DebitTakeProfitAndStopLoss_ArePercentOfCost_CreditUnchanged()
    {
        // Acciones: entrada a 270 (crédito −270); el valor de cierre es −precio (venderlas).
        var pos = Open(-270, RuntimeStructures.LongEquity);
        var exits = new DeterministicExits
        {
            TakeProfit = new TakeProfitExit { PctOfCost = 10 },   // +27 → precio 297
            StopLoss = new StopLossExit { PctOfCost = 5 },        // −13.5 → precio 256.5
        };
        Assert.Null(ShadowFillSimulator.EvaluateExits(pos, exits, -296.99, int.MaxValue));
        Assert.Equal("TAKE_PROFIT", ShadowFillSimulator.EvaluateExits(pos, exits, -297, int.MaxValue));
        Assert.Null(ShadowFillSimulator.EvaluateExits(pos, exits, -256.51, int.MaxValue));
        Assert.Equal("STOP_LOSS", ShadowFillSimulator.EvaluateExits(pos, exits, -256.5, int.MaxValue));

        // Crédito: igual que siempre (50% de 1.00 = el spread vale 0.50; 200% = pérdida de 2.00).
        var credit = Open(1.00);
        var creditExits = new DeterministicExits
        {
            TakeProfit = new TakeProfitExit { PctOfCredit = 50 }, StopLoss = new StopLossExit { PctOfCredit = 200 },
        };
        Assert.Null(ShadowFillSimulator.EvaluateExits(credit, creditExits, 0.51, 30));
        Assert.Equal("TAKE_PROFIT", ShadowFillSimulator.EvaluateExits(credit, creditExits, 0.50, 30));
        Assert.Equal("STOP_LOSS", ShadowFillSimulator.EvaluateExits(credit, creditExits, 3.00, 30));
        // pct_of_cost no dispara una posición de crédito (el validador además lo rechaza).
        Assert.Null(ShadowFillSimulator.EvaluateExits(credit, new DeterministicExits { TakeProfit = new TakeProfitExit { PctOfCost = 1 } }, 0.0, 30));
    }

    [Fact]
    public void TimeExit_AtOnlyFiresWhenReached_MaxDteStillWorks()
    {
        var pos = Open(1.00);
        var at = new DeterministicExits { TimeExit = new TimeExit { At = "15:30" } };
        Assert.Null(ShadowFillSimulator.EvaluateExits(pos, at, 0.8, 0, timeOfDayReached: false));
        Assert.Equal("TIME_EXIT", ShadowFillSimulator.EvaluateExits(pos, at, 0.8, 0, timeOfDayReached: true));
        Assert.Null(ShadowFillSimulator.EvaluateExits(pos, at, 0.8, 0));                        // at sin max_dte: DTE 0 solo no alcanza
        var dte = new DeterministicExits { TimeExit = new TimeExit { MaxDte = 7 } };
        Assert.Equal("TIME_EXIT", ShadowFillSimulator.EvaluateExits(pos, dte, 0.8, 7));
        Assert.Null(ShadowFillSimulator.EvaluateExits(pos, dte, 0.8, 8));
    }

    [Fact]
    public async Task TimeExit_At_ClosesOnExpirationDayFromThatTimeInSpecTimezone()
    {
        var candidate = RealCandidate();
        candidate = candidate with { Legs = candidate.Legs.Select(l => l with { Expiration = "2026-09-24" }).ToList() };
        var terms = new ExecutionTerms();
        var (store, instance) = NewRuntime();
        var pos = ShadowFillSimulator.Fill(candidate, Now, terms);
        store.AddPosition(pos);
        var data = new FakeData();
        foreach (var l in pos.Legs)
            data.Quotes[l.StreamerSymbol!] = l.Side == "SELL" ? new LegQuote(1.50, 1.70, default) : new LegQuote(0.70, 0.90, default);
        var exits = new DeterministicExits { TimeExit = new TimeExit { At = "15:30" } };
        var op = Spec().Operational;

        async Task<string> At(DateTime utc)
        {
            foreach (var l in pos.Legs)
                data.Quotes[l.StreamerSymbol!] = data.Quotes[l.StreamerSymbol!] is LegQuote q ? new LegQuote(q.Bid, q.Ask, utc) : null;
            return await ShadowRuntimeEngine.ValuePositionAsync(store, data, store.GetPosition(pos.PositionId)!, exits, utc, default, operational: op);
        }

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, await At(new DateTime(2026, 9, 24, 19, 29, 0, DateTimeKind.Utc)));   // 15:29 ET
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed, await At(new DateTime(2026, 9, 24, 19, 30, 0, DateTimeKind.Utc)));   // 15:30 ET
        var closed = store.GetPosition(pos.PositionId)!;
        Assert.Equal("TIME_EXIT", closed.ExitReason);
        Assert.NotNull(closed.ExitDebit);
    }

    [Fact]
    public async Task TimeExit_At_DoesNotFireBeforeExpirationDay()
    {
        var candidate = RealCandidate();   // vence 2026-10-30
        var (store, _) = NewRuntime();
        var pos = ShadowFillSimulator.Fill(candidate, Now, new ExecutionTerms());
        store.AddPosition(pos);
        var data = new FakeData();
        var late = new DateTime(2026, 9, 24, 19, 45, 0, DateTimeKind.Utc);
        foreach (var l in pos.Legs)
            data.Quotes[l.StreamerSymbol!] = l.Side == "SELL" ? new LegQuote(1.50, 1.70, late) : new LegQuote(0.70, 0.90, late);
        var outcome = await ShadowRuntimeEngine.ValuePositionAsync(store, data, pos,
            new DeterministicExits { TimeExit = new TimeExit { At = "15:30" } }, late, default, operational: Spec().Operational);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, outcome);
    }

    // ── Validación de los campos nuevos ──────────────────────────────

    private static List<string> Errors(StrategySpec spec) => StrategySpecValidator.Validate(spec).Errors;

    [Fact]
    public void Validator_AcceptsTheNewShapes()
    {
        var spec = WindowSpec(new(new SpecTradeLimits { MaxEntriesPerDay = 1, MaxEntriesPerWeek = 3 }));
        Assert.True(StrategySpecValidator.Validate(spec).IsValid, string.Join("; ", Errors(spec)));
    }

    [Fact]
    public void Validator_RejectsBadEntryWindow_Blackout_MaxEntries_TimeExit()
    {
        var op = Spec().Operational;
        Assert.Contains(Errors(Spec() with { Operational = op with { EntryWindow = new EntryWindow { Start = "25:00", End = "13:50" } } }),
            e => e.Contains("entry_window.start"));
        Assert.Contains(Errors(Spec() with { Operational = op with { EntryWindow = new EntryWindow { Start = "13:45", End = "1350" } } }),
            e => e.Contains("entry_window.end"));
        Assert.Contains(Errors(Spec() with { Operational = op with { EntryWindow = new EntryWindow { Start = "13:50", End = "13:45" } } }),
            e => e.Contains("must be after start"));
        Assert.Contains(Errors(Spec() with { Operational = op with { EntryWindow = new EntryWindow { Start = "09:00", End = "10:00" } } }),
            e => e.Contains("inside operational.session_hours"));
        foreach (var (limits, expected) in new[]
        {
            (new SpecTradeLimits { MaxEntriesPerDay = 0 }, "max_entries_per_day must be positive"),
            (new SpecTradeLimits { MaxEntriesPerWeek = -1 }, "max_entries_per_week must be positive"),
            (new SpecTradeLimits { MaxEntriesPerDay = 3, MaxEntriesPerWeek = 2 }, "cannot be below"),
            (new SpecTradeLimits(), "must declare at least one limit"),
        })
            Assert.Contains(Errors(Spec() with { Operational = op with { TradeLimits = limits } }), e => e.Contains(expected));
        Assert.Contains(Errors(Spec() with { Operational = op with { Timezone = "Nowhere/Nada", EntryWindow = new EntryWindow { Start = "13:45", End = "13:50" } } }),
            e => e.Contains("not a known time zone"));

        foreach (var (te, expected) in new[]
        {
            (new TimeExit { At = "15:3" }, "time_exit.at must be HH:mm"),
            (new TimeExit { At = "16:30" }, "inside operational.session_hours"),
            (new TimeExit(), "must declare max_dte, at or both"),
            (new TimeExit { MaxDte = -1 }, "max_dte must be >= 0"),
        })
            Assert.Contains(Errors(Spec() with { Exits = new SpecExits { Deterministic = new DeterministicExits { TimeExit = te } } }),
                e => e.Contains(expected));
        Assert.True(StrategySpecValidator.Validate(Spec() with
        {
            Exits = new SpecExits { Deterministic = new DeterministicExits { TimeExit = new TimeExit { At = "15:30" } } },
        }).IsValid);
    }

    [Fact]
    public void Validator_RejectsMetricRefThresholdMixedWithValue_AndBetween()
    {
        Assert.Contains(Errors(WithGate(new GateThreshold { MetricRef = "capability:compute.ema.SPY.50", Value = 0 }, "GT")),
            e => e.Contains("cannot be combined"));
        Assert.Contains(Errors(WithGate(new GateThreshold { MetricRef = "capability:compute.ema.SPY.50" }, "BETWEEN")),
            e => e.Contains("BETWEEN does not support"));
        Assert.Contains(Errors(WithGate(new GateThreshold { MetricRef = " " }, "GT")), e => e.Contains("must not be empty"));
        Assert.Contains(Errors(WithGate(new GateThreshold(), "GT")), e => e.Contains("requires its threshold"));
        Assert.True(StrategySpecValidator.Validate(WithGate(new GateThreshold { MetricRef = "capability:compute.ema.SPY.50" }, "GT")).IsValid);

        var exit = new MetricExit { MetricRef = "capability:compute.ema.SPY.20", Operator = "LT", Threshold = new GateThreshold { MetricRef = "x", Min = 1 } };
        Assert.Contains(Errors(Spec() with { Exits = new SpecExits { Deterministic = new DeterministicExits { MetricExit = exit } } }),
            e => e.Contains("metric_exit") && e.Contains("cannot be combined"));
    }

    private static StrategySpec WithGate(GateThreshold t, string op) => Spec() with
    {
        EntryFilters = new EntryFilters
        {
            GateLayer = new GateLayer { Gates = new() { Gate("capability:compute.ema.SPY.20", op, t) } },
        },
    };

    [Fact]
    public void Validator_PctOfCostOnlyForDebit_PctOfCreditOnlyForCredit()
    {
        // Crédito (la spec de prueba): pct_of_cost se rechaza.
        Assert.Contains(Errors(Spec() with
        {
            Exits = new SpecExits { Deterministic = new DeterministicExits { TakeProfit = new TakeProfitExit { PctOfCost = 50 } } },
        }), e => e.Contains("take_profit.pct_of_cost only applies to a debit"));

        // Débito (acciones): pct_of_cost sí, pct_of_credit no, y pct_of_cost debe ser positivo.
        var eq = LongEquityTests.EquitySpec();
        Assert.True(StrategySpecValidator.Validate(eq with
        {
            Exits = new SpecExits { Deterministic = eq.Exits.Deterministic with { TakeProfit = new TakeProfitExit { PctOfCost = 20 }, StopLoss = new StopLossExit { PctOfCost = 8 } } },
        }).IsValid);
        Assert.Contains(Errors(eq with
        {
            Exits = new SpecExits { Deterministic = eq.Exits.Deterministic with { TakeProfit = new TakeProfitExit { PctOfCredit = 50 } } },
        }), e => e.Contains("take_profit.pct_of_credit does not apply"));
        Assert.Contains(Errors(eq with
        {
            Exits = new SpecExits { Deterministic = eq.Exits.Deterministic with { StopLoss = new StopLossExit { PctOfCost = 0 } } },
        }), e => e.Contains("stop_loss.pct_of_cost is required"));
    }

    [Fact]
    public void Loader_ParsesNewJsonShapes_AndRejectsUnknownKeys()
    {
        var json = JsonNode.Parse(SpecJson())!;
        json["operational"]!["entry_window"] = new JsonObject { ["start"] = "13:45", ["end"] = "13:50" };
        json["operational"]!["trade_limits"] = new JsonObject
        {
            ["max_entries_per_day"] = 1, ["max_entries_per_week"] = 3,
        };
        json["entry_filters"]!["gate_layer"]!["event_gates"] = new JsonArray(new JsonObject
        {
            ["id"] = "sin_fomc", ["type"] = "FOMC", ["must"] = "not_exist",
            ["window"] = new JsonObject { ["from"] = "now", ["to"] = "minutes_after_now", ["minutes"] = 135 },
        });
        json["exits"]!["deterministic"]!["time_exit"] = new JsonObject { ["at"] = "15:30" };
        json["entry_filters"]!["gate_layer"]!["gates"]![0]!["threshold"] = new JsonObject { ["metric_ref"] = "capability:compute.ema.SPY.50" };
        var ok = StrategySpecLoader.LoadFromJson(json.ToJsonString());
        Assert.True(ok.Success, string.Join("; ", ok.Errors));
        Assert.Equal("15:30", ok.Spec!.Exits.Deterministic.TimeExit!.At);
        Assert.Equal(3, ok.Spec.Operational.TradeLimits!.MaxEntriesPerWeek);
        Assert.Equal(135, ok.Spec.EntryFilters.GateLayer.EventGates.Single().Window.Minutes);
        Assert.Equal("capability:compute.ema.SPY.50", ok.Spec.EntryFilters.GateLayer.Gates[0].Threshold.MetricRef);

        foreach (var (path, key) in new[] { ("trade_limits", "max_day_trades_per_rolling_business_days"), ("entry_window", "days") })
        {
            var bad = JsonNode.Parse(json.ToJsonString())!;
            bad["operational"]![path]![key] = true;
            Assert.False(StrategySpecLoader.LoadFromJson(bad.ToJsonString()).Success, path);
        }
        var bad2 = JsonNode.Parse(json.ToJsonString())!;
        bad2["entry_filters"]!["gate_layer"]!["gates"]![0]!["threshold"]!["value"] = 30;   // metric_ref + value
        var r2 = StrategySpecLoader.LoadFromJson(bad2.ToJsonString());
        Assert.False(r2.Success);
        Assert.Contains(r2.Errors, e => e.Contains("cannot be combined"));
    }
}
