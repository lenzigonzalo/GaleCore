using DataFeed.Application.App.Shared;
using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;
using static DataFeed.Tests.ShadowRuntimeEngineTests;

namespace DataFeed.Tests;

/// <summary>WS-0062 inc.5 revisión — time_exit con days_after_entry, event_exits, TP/SL de débito de punta a punta, mensaje de métrica faltante.</summary>
public class ShadowInc5ReviewTests
{
    private const string EmaRef = "capability:compute.ema_spread.AAPL.20.50";

    private sealed class Data : IRuntimeMarketData
    {
        public Dictionary<string, double?> Metrics = new();
        public Dictionary<string, LegQuote?> Quotes = new();
        public IEventCalendar? Events { get; set; }
        public Func<CandidateBuildResult>? Build;
        public Task<Dictionary<string, double?>> ResolveMetricsAsync(IEnumerable<string> r, DateTime n, TimeSpan? m, CancellationToken ct) =>
            Task.FromResult(r.ToDictionary(x => x, x => Metrics.GetValueOrDefault(x)));
        public Task<CandidateBuildResult> BuildCandidateAsync(StrategyInstance i, StrategySpec s, string sym, double? vix, DateTime now, CancellationToken ct) =>
            Task.FromResult(Build!());
        public Task<LegQuote?> GetQuoteAsync(string s, CancellationToken ct) => Task.FromResult(Quotes.GetValueOrDefault(s));
    }

    private sealed class Events : IEventCalendar
    {
        public List<CalendarEvent> List = new();
        public bool NoData;
        public IReadOnlyCollection<EventTypeInfo> Catalog => EventCatalog.Builtin;
        public Task<EventQueryResult> QueryAsync(string type, string? subject, DateTime from, DateTime to, CancellationToken ct) =>
            Task.FromResult(NoData ? EventQueryResult.NoData("caída") : EventQueryResult.Ok(List.Where(e => e.Type == type
                && string.Equals(e.Subject, subject, StringComparison.OrdinalIgnoreCase))));
    }

    private static StrategySpec Equity(DeterministicExits exits) =>
        LongEquityTests.EquitySpec() with { Exits = new SpecExits { Deterministic = exits } };

    /// <summary>Abre 10 acciones de AAPL a 270 (mid) con las salidas dadas. Entrada: jueves 24/09/2026 11:00 ET.</summary>
    private static async Task<(ShadowRuntimeStore Store, Data Data, StrategySpec Spec, ShadowPosition Pos)> OpenEquity(DeterministicExits exits)
    {
        var spec = Equity(exits);
        var (store, instance) = NewRuntime();
        var data = new Data { Metrics = new() { [EmaRef] = 1.0 } };
        data.Quotes["AAPL"] = new LegQuote(269.90, 270.10, Now);
        data.Build = () => LongEquityCandidateBuilder.BuildAsync((s, _) => Task.FromResult(data.Quotes.GetValueOrDefault(s)), instance, spec, "AAPL", Now, default).Result;
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, spec, "AAPL", Now, default));
        return (store, data, spec, Assert.Single(store.OpenPositions()));
    }

    private static Task<string> Value(ShadowRuntimeStore store, Data data, StrategySpec spec, ShadowPosition pos, DateTime at, double mid)
    {
        data.Quotes["AAPL"] = new LegQuote(mid - 0.10, mid + 0.10, at);
        return ShadowRuntimeEngine.ValuePositionAsync(store, data, store.GetPosition(pos.PositionId)!, spec.Exits.Deterministic, at, default,
            maxQuoteAge: DataFreshness.MaxAge(spec), operational: spec.Operational);
    }

    private static DateTime Et(int day, int hour, int minute = 0) => new(2026, 9, day, hour + 4, minute, 0, DateTimeKind.Utc);   // EDT

    // ── time_exit con days_after_entry ───────────────────────────────

    [Theory]
    [InlineData(0, 24, 15, 29, false)]   // mismo día, antes de la hora
    [InlineData(0, 24, 15, 30, true)]
    [InlineData(1, 24, 15, 31, false)]   // día 0 con days=1: todavía no
    [InlineData(1, 25, 15, 29, false)]
    [InlineData(1, 25, 15, 30, true)]    // viernes: el 1.er día de sesión después del jueves
    [InlineData(1, 28, 10, 0, true)]     // si el monitor no corrió ese día, el lunes cierra igual
    public async Task TimeExit_DaysAfterEntry_ClosesAtThatTimeOnLongEquity(int days, int day, int hour, int minute, bool closes)
    {
        var (store, data, spec, pos) = await OpenEquity(new DeterministicExits { TimeExit = new TimeExit { At = "15:30", DaysAfterEntry = days } });
        var outcome = await Value(store, data, spec, pos, Et(day, hour, minute), 270);
        Assert.Equal(closes ? ShadowRuntimeEngine.Outcomes.Closed : ShadowRuntimeEngine.Outcomes.Valued, outcome);
        if (closes) Assert.Equal("TIME_EXIT", store.GetPosition(pos.PositionId)!.ExitReason);
    }

    [Fact]
    public void AddSessionDays_SkipsWeekends()
    {
        Assert.Equal(new DateTime(2026, 9, 28), ShadowRuntimeEngine.AddSessionDays(new DateTime(2026, 9, 25), 1));   // viernes → lunes
        Assert.Equal(new DateTime(2026, 9, 25), ShadowRuntimeEngine.AddSessionDays(new DateTime(2026, 9, 25), 0));
        Assert.Equal(new DateTime(2026, 10, 1), ShadowRuntimeEngine.AddSessionDays(new DateTime(2026, 9, 24), 5));
    }

    // ── Calendario de NYSE: feriados y cierres tempranos ─────────────

    private static DateTime Utc(int y, int m, int d, int h, int min = 0) => new(y, m, d, h, min, 0, DateTimeKind.Utc);

    [Fact]
    public void NyseCalendar_Kinds()
    {
        Assert.Equal(NyseDay.Closed, NyseCalendar.Kind(new DateOnly(2026, 11, 26)));       // Acción de Gracias
        Assert.Equal(NyseDay.Closed, NyseCalendar.Kind(new DateOnly(2028, 7, 4)));
        Assert.Equal(NyseDay.EarlyClose, NyseCalendar.Kind(new DateOnly(2026, 11, 27)));
        Assert.Equal(NyseDay.EarlyClose, NyseCalendar.Kind(new DateOnly(2028, 7, 3)));
        Assert.Equal(NyseDay.Normal, NyseCalendar.Kind(new DateOnly(2026, 11, 30)));
        Assert.Equal(NyseDay.Unknown, NyseCalendar.Kind(new DateOnly(2025, 12, 25)));
        Assert.Equal(NyseDay.Unknown, NyseCalendar.Kind(new DateOnly(2029, 1, 2)));
        Assert.Equal(Utc(2026, 11, 27, 18), NyseCalendar.EarlyCloseUtc(new DateOnly(2026, 11, 27)));   // 13:00 EST
    }

    [Fact]
    public void Session_HolidayIsClosedAllDay()
    {
        var op = Spec().Operational;
        Assert.False(ShadowSession.IsOpen(op, Utc(2026, 11, 26, 15)));    // jueves 26/11 10:00 ET: Acción de Gracias
        Assert.True(ShadowSession.IsOpen(op, Utc(2026, 11, 25, 15)));     // el día anterior, normal
    }

    [Fact]
    public void Session_EarlyCloseEndsAt1300NewYork_NormalDayIsUnchanged()
    {
        var op = Spec().Operational;                                       // 09:30–16:00 NY
        Assert.True(ShadowSession.IsOpen(op, Utc(2026, 11, 27, 17, 59)));  // 12:59 ET
        Assert.False(ShadowSession.IsOpen(op, Utc(2026, 11, 27, 18, 0)));  // 13:00 ET
        Assert.False(ShadowSession.IsOpen(op, Utc(2026, 11, 27, 20, 0)));  // 15:00 ET
        Assert.True(ShadowSession.IsOpen(op, Utc(2026, 11, 30, 20, 59)));  // lunes normal 15:59 ET
        Assert.False(ShadowSession.IsOpen(op, Utc(2026, 11, 30, 21, 0)));
        // Una spec que ya termina antes del cierre temprano no se estira.
        Assert.False(ShadowSession.IsOpen(op with { SessionHours = new SessionHours { Start = "09:30", End = "12:00" } }, Utc(2026, 11, 27, 17, 30)));
    }

    [Fact]
    public void Session_YearOutsideTheTable_IsClosed()
    {
        var op = Spec().Operational;
        Assert.False(ShadowSession.IsOpen(op, Utc(2029, 3, 7, 15)));       // miércoles 10:00 ET de un año sin calendario
        Assert.False(ShadowSession.IsOpen(op, Utc(2025, 9, 24, 15)));
    }

    [Fact]
    public void AddSessionDays_SkipsHolidays_AndFailsClosedOutsideTheTable()
    {
        Assert.Equal(new DateTime(2026, 11, 27), ShadowRuntimeEngine.AddSessionDays(new DateTime(2026, 11, 25), 1));   // salta el jueves 26
        Assert.Equal(new DateTime(2026, 12, 28), ShadowRuntimeEngine.AddSessionDays(new DateTime(2026, 12, 24), 1));   // 25 feriado, fin de semana
        Assert.Equal(new DateTime(2026, 7, 6), ShadowRuntimeEngine.AddSessionDays(new DateTime(2026, 7, 2), 1));      // viernes 3/7 feriado
        Assert.Null(ShadowRuntimeEngine.AddSessionDays(new DateTime(2028, 12, 29), 1));                               // lunes 1/1/2029 sin calendario
    }

    [Fact]
    public async Task TimeExit_DaysAfterEntry_CrossesAHolidayAndFiresOnTheEarlyCloseDay()
    {
        var (store, data, spec, pos) = await OpenEquity(new DeterministicExits { TimeExit = new TimeExit { At = "15:45", DaysAfterEntry = 1 } });
        store.UpdatePosition(pos with { EntryAt = Utc(2026, 11, 25, 16) });   // miércoles 25/11 11:00 ET
        // El jueves 26 es feriado y el viernes 27 cierra 13:00: el día 1 es el viernes y la salida de las 15:45 cae a las 12:55.
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, await Value(store, data, spec, pos, Utc(2026, 11, 27, 17, 54), 270));
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed, await Value(store, data, spec, pos, Utc(2026, 11, 27, 17, 55), 270));
        Assert.Equal("TIME_EXIT", store.GetPosition(pos.PositionId)!.ExitReason);
    }

    [Fact]
    public async Task TimeExit_DaysAfterEntry_TargetOutsideTheCalendar_DoesNotInventADay()
    {
        var (store, data, spec, pos) = await OpenEquity(new DeterministicExits { TimeExit = new TimeExit { At = "15:30", DaysAfterEntry = 1 } });
        store.UpdatePosition(pos with { EntryAt = Utc(2028, 12, 29, 16) });   // viernes 29/12/2028; el día 1 sería 2029
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, await Value(store, data, spec, pos, Utc(2028, 12, 29, 20, 45), 270));   // 15:45 ET
        Assert.Contains(store.GetPosition(pos.PositionId)!.ValuationProblems!, p => p.Contains("calendario de NYSE"));
    }

    // ── event_exits ──────────────────────────────────────────────────

    private static EventExit Earnings(string onNoData = "HOLD") => new()
    {
        Id = "antes_del_balance", Type = "EARNINGS", Subject = "AAPL", Must = "exist", OnNoData = onNoData,
        Window = new EventGateWindow { From = "day_start", To = "day_end" },
    };

    [Fact]
    public async Task EventExit_ClosesWhenTheEventExists_HoldsOrClosesWithoutData()
    {
        var exits = new DeterministicExits { EventExits = new() { Earnings() } };
        var today = new CalendarEvent("EARNINGS", "AAPL", new DateTime(2026, 9, 24, 0, 0, 0, DateTimeKind.Utc), EventPrecision.Date, "t", Now);

        // Sin balance hoy: sigue.
        var (store, data, spec, pos) = await OpenEquity(exits);
        data.Events = new Events();
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, await Value(store, data, spec, pos, Et(24, 12), 270));

        // Balance hoy: cierra con EVENT_EXIT.
        data.Events = new Events { List = { today } };
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed, await Value(store, data, spec, pos, Et(24, 12), 270));
        Assert.Equal("EVENT_EXIT", store.GetPosition(pos.PositionId)!.ExitReason);

        // Sin dato: HOLD (default) mantiene y anota; CLOSE cierra. Sin calendario también es sin dato.
        foreach (var calendar in new IEventCalendar?[] { new Events { NoData = true }, null })
        {
            var (s2, d2, sp2, p2) = await OpenEquity(exits);
            d2.Events = calendar;
            Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, await Value(s2, d2, sp2, p2, Et(24, 12), 270));
            var held = s2.GetPosition(p2.PositionId)!;
            Assert.Equal("OPEN", held.Status);
            Assert.Contains(held.ValuationProblems!, m => m.Contains("evento sin dato"));

            var closeSpec = Equity(new DeterministicExits { EventExits = new() { Earnings("CLOSE") } });
            Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed, await ShadowRuntimeEngine.ValuePositionAsync(s2, d2, held,
                closeSpec.Exits.Deterministic, Et(24, 12), default, maxQuoteAge: DataFreshness.MaxAge(closeSpec), operational: closeSpec.Operational));
            Assert.Equal("EVENT_EXIT", s2.GetPosition(p2.PositionId)!.ExitReason);
        }
    }

    [Fact]
    public async Task EventExit_StopLossStillGoesFirst()
    {
        var exits = new DeterministicExits { StopLoss = new StopLossExit { PctOfCost = 5 }, EventExits = new() { Earnings() } };
        var (store, data, spec, pos) = await OpenEquity(exits);
        data.Events = new Events { List = { new CalendarEvent("EARNINGS", "AAPL", new DateTime(2026, 9, 24, 0, 0, 0, DateTimeKind.Utc), EventPrecision.Date, "t", Now) } };
        await Value(store, data, spec, pos, Et(24, 12), 250);
        Assert.Equal("STOP_LOSS", store.GetPosition(pos.PositionId)!.ExitReason);
    }

    // ── MetricExit: el mensaje nombra la métrica que falta ───────────

    [Fact]
    public async Task MetricExit_MissingThresholdMetric_IsNamedInTheProblem_AndDoesNotClose()
    {
        const string a = "capability:compute.ema.AAPL.20", b = "capability:compute.ema.AAPL.50";
        var exits = new DeterministicExits
        {
            MetricExit = new MetricExit { MetricRef = a, Operator = "LT", Threshold = new GateThreshold { MetricRef = b } },
        };
        var (store, data, spec, pos) = await OpenEquity(exits);
        data.Metrics = new() { [a] = 99.0 };   // falta sólo la del umbral
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, await Value(store, data, spec, pos, Et(24, 12), 270));
        var problems = store.GetPosition(pos.PositionId)!.ValuationProblems!;
        Assert.Contains(problems, m => m.Contains(b));
        Assert.DoesNotContain(problems, m => m.Contains(a));
        Assert.Equal("OPEN", store.GetPosition(pos.PositionId)!.Status);
    }

    // ── TP / SL de débito de punta a punta ───────────────────────────

    [Fact]
    public async Task LongEquity_TakeProfitAndStopLoss_PctOfCost_CloseWithReasonAndPnl()
    {
        var exits = new DeterministicExits
        {
            TakeProfit = new TakeProfitExit { PctOfCost = 10 },   // costó 2.700 → cierra con +270 o más
            StopLoss = new StopLossExit { PctOfCost = 5 },        // pierde 135 o más
        };
        var (store, data, spec, pos) = await OpenEquity(exits);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, await Value(store, data, spec, pos, Et(24, 12), 280));   // +100: todavía no

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed, await Value(store, data, spec, pos, Et(24, 13), 298));
        var tp = store.GetPosition(pos.PositionId)!;
        Assert.Equal("TAKE_PROFIT", tp.ExitReason);
        Assert.Equal(280.0, tp.RealizedPnl);         // (298 − 270) × 10 acciones
        Assert.Equal(-298.0, tp.ExitDebit);

        var (s2, d2, sp2, p2) = await OpenEquity(exits);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, await Value(s2, d2, sp2, p2, Et(24, 12), 265));          // −50: todavía no
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed, await Value(s2, d2, sp2, p2, Et(24, 13), 255));
        var sl = s2.GetPosition(p2.PositionId)!;
        Assert.Equal("STOP_LOSS", sl.ExitReason);
        Assert.Equal(-150.0, sl.RealizedPnl);        // (255 − 270) × 10
    }

    private static StrategySpec DebitOptionsSpec(DeterministicExits exits)
    {
        var spec = NaturalSpec();
        return spec with
        {
            Structure = spec.Structure with { AllowedStrategies = new() { RuntimeStructures.CustomOptions }, DefaultStructure = RuntimeStructures.CustomOptions },
            CandidateConstruction = spec.CandidateConstruction with
            {
                Legs = new() { new LegTemplate { Id = "call", Side = "BUY", Type = "CALL", StrikeSelection = new() { Method = "POINTS_FROM_SPOT", PointsFromSpot = 5 } } },
                Constraints = new() { MinDte = 5, MaxDte = 40, MaxDebit = 3 },
            },
            Exits = new SpecExits { Deterministic = exits },
            Execution = new SpecExecution { Fill = "mid" },
        };
    }

    [Fact]
    public async Task CustomOptionsDebit_TakeProfitAndStopLoss_PctOfCost_CloseWithReasonAndPnl()
    {
        var exits = new DeterministicExits
        {
            TakeProfit = new TakeProfitExit { PctOfCost = 40 },   // costó 2,00: cierra con +0,80 o más
            StopLoss = new StopLossExit { PctOfCost = 30 },       // pierde 0,60 o más
        };
        var spec = DebitOptionsSpec(exits);
        Assert.True(StrategySpecValidator.Validate(spec).IsValid, string.Join("; ", StrategySpecValidator.Validate(spec).Errors));

        async Task<(ShadowRuntimeStore, ShadowPosition)> Open()
        {
            var (store, _) = NewRuntime();
            var candidate = new TradeCandidate
            {
                CandidateId = "c", InstanceId = "i-1", Symbol = "SPY", Structure = RuntimeStructures.CustomOptions, Credit = -2.0, MaxRisk = 200, Dte = 20,
                Legs = new() { new CandidateLeg { Side = "BUY", Type = "CALL", Strike = 770, Expiration = "2026-10-30", StreamerSymbol = ".SPY261030C770", Bid = 1.9, Ask = 2.1 } },
                Snapshot = new MarketSnapshot { UnderlyingPrice = 765, AsOf = Now, OldestQuoteAt = Now }, CreatedAt = Now,
            };
            var pos = ShadowFillSimulator.Fill(candidate, Now, ExecutionTerms.From(spec));
            await Task.CompletedTask;
            store.AddPosition(pos);
            return (store, pos);
        }

        Task<string> Value(ShadowRuntimeStore store, ShadowPosition pos, double mid)
        {
            var data = new Data();
            data.Quotes[".SPY261030C770"] = new LegQuote(mid - 0.1, mid + 0.1, Now);
            return ShadowRuntimeEngine.ValuePositionAsync(store, data, store.GetPosition(pos.PositionId)!, exits, Now, default,
                maxQuoteAge: DataFreshness.MaxAge(spec), operational: spec.Operational);
        }

        var (s1, p1) = await Open();
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, await Value(s1, p1, 2.5));        // +0,50: todavía no
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed, await Value(s1, p1, 3.0));
        var tp = s1.GetPosition(p1.PositionId)!;
        Assert.Equal("TAKE_PROFIT", tp.ExitReason);
        Assert.Equal(100.0, tp.RealizedPnl);                                                 // (3,00 − 2,00) × 100

        var (s2, p2) = await Open();
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, await Value(s2, p2, 1.7));         // −0,30: todavía no
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed, await Value(s2, p2, 1.2));
        var sl = s2.GetPosition(p2.PositionId)!;
        Assert.Equal("STOP_LOSS", sl.ExitReason);
        Assert.Equal(-80.0, sl.RealizedPnl);                                                 // (1,20 − 2,00) × 100
    }

    // ── Validación ───────────────────────────────────────────────────

    private static List<string> Errors(StrategySpec spec) => StrategySpecValidator.Validate(spec).Errors;

    [Fact]
    public void Validator_TimeExit_DaysAfterEntryRules()
    {
        // Acciones: at exige days_after_entry; max_dte no aplica; days_after_entry exige at.
        Assert.Empty(Errors(Equity(new DeterministicExits { TimeExit = new TimeExit { At = "15:30", DaysAfterEntry = 0 } })));
        Assert.Contains(Errors(Equity(new DeterministicExits { TimeExit = new TimeExit { At = "15:30" } })), e => e.Contains("needs days_after_entry"));
        Assert.Contains(Errors(Equity(new DeterministicExits { TimeExit = new TimeExit { MaxDte = 5 } })), e => e.Contains("does not apply to long_equity"));
        Assert.Contains(Errors(Equity(new DeterministicExits { TimeExit = new TimeExit { DaysAfterEntry = 1 } })), e => e.Contains("days_after_entry needs at"));
        Assert.Contains(Errors(Equity(new DeterministicExits { TimeExit = new TimeExit { At = "15:30", DaysAfterEntry = -1 } })), e => e.Contains("days_after_entry must be >= 0"));

        // Con vencimiento, sin days_after_entry sigue siendo el día del vencimiento.
        var spread = Spec() with { Exits = new SpecExits { Deterministic = new DeterministicExits { TimeExit = new TimeExit { At = "15:30" } } } };
        Assert.Empty(Errors(spread));
        Assert.Empty(Errors(spread with { Exits = new SpecExits { Deterministic = new DeterministicExits { TimeExit = new TimeExit { At = "15:30", DaysAfterEntry = 2 } } } }));
    }

    [Fact]
    public void Validator_EventExits()
    {
        StrategySpec With(EventExit e) => Spec() with { Exits = new SpecExits { Deterministic = new DeterministicExits { EventExits = new() { e } } } };
        Assert.Empty(Errors(Spec() with { Universe = Spec().Universe with { Symbols = new() { "AAPL" } }, Exits = new SpecExits { Deterministic = new DeterministicExits { EventExits = new() { Earnings() } } } }));
        Assert.Contains(Errors(With(Earnings() with { Type = "PRESIDENT_SPEECH" })), e => e.Contains("no data source for that event type"));
        Assert.Contains(Errors(With(Earnings() with { Subject = "ANY" })), e => e.Contains("per symbol"));
        Assert.Contains(Errors(With(Earnings() with { OnNoData = "BLOCK" })), e => e.Contains("on_no_data must be HOLD or CLOSE"));
        Assert.Contains(Errors(With(Earnings() with { Must = "" })), e => e.Contains("must must be exist or not_exist"));
    }
}
