using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Application.Data.Tastytrade.MarketDataCandle;
using MediatR;
using Microsoft.Extensions.Logging.Abstractions;

namespace DataFeed.Tests;

/// <summary>WS-0061 — acciones en largo (long_equity): métrica ema_spread, entrada, valuación, salida por métrica y P&amp;L.</summary>
[Collection("RuntimeStaticCaches")]
public class LongEquityTests
{
    private static readonly DateTime Now = ShadowRuntimeEngineTests.Now;
    private const string EmaRef = "capability:compute.ema_spread.AAPL.20.50";

    // ── Métrica ─────────────────────────────────────────────────────

    private static List<CandleData> Candles(int count, Func<int, double> close, DateTime? lastAt = null)
    {
        var last = lastAt ?? Now.AddDays(-1);
        return Enumerable.Range(0, count).Select(i => new CandleData
        {
            Close = close(i),
            Time = new DateTimeOffset(last.AddDays(-(count - 1 - i))).ToUnixTimeMilliseconds(),
        }).ToList();
    }

    [Fact]
    public void EmaSpread_RisingSeries_IsPositive_FallingIsNegative()
    {
        Assert.True(MetricResolver.UsableEmaSpread(Candles(120, i => 100 + i), 20, 50, Now) > 0);
        Assert.True(MetricResolver.UsableEmaSpread(Candles(120, i => 300 - i), 20, 50, Now) < 0);
    }

    [Fact]
    public void EmaSpread_MatchesHandComputedEma()
    {
        // Serie constante 100 y un último cierre de 110: EMA(n) = 100 + 10·k, con k = 2/(n+1).
        var candles = Candles(100, i => i == 99 ? 110 : 100);
        double expected = 10 * (2.0 / 21) - 10 * (2.0 / 51);
        Assert.Equal(expected, MetricResolver.UsableEmaSpread(candles, 20, 50, Now)!.Value, 9);
    }

    [Fact]
    public void EmaSpread_InsufficientOrStaleOrNoCandles_IsNull()
    {
        Assert.Null(MetricResolver.UsableEmaSpread(Candles(99, i => 100 + i), 20, 50, Now));          // < slow×2
        Assert.Null(MetricResolver.UsableEmaSpread(Candles(120, i => 100 + i, Now.AddDays(-12)), 20, 50, Now)); // vela vieja
        Assert.Null(MetricResolver.UsableEmaSpread(Candles(120, i => 0), 20, 50, Now));               // cierres 0 no cuentan
        Assert.Null(MetricResolver.UsableEmaSpread(null, 20, 50, Now));
        Assert.Null(MetricResolver.UsableEmaSpread(Candles(120, i => 100 + i), 50, 20, Now));         // fast >= slow
    }

    [Fact]
    public void EmaSpread_FutureOrTimelessCandle_IsNull()
    {
        var future = Candles(120, i => 100 + i);
        future[^1].Time = new DateTimeOffset(Now.AddDays(3)).ToUnixTimeMilliseconds();   // la vela más nueva, en el futuro
        Assert.Null(MetricResolver.UsableEmaSpread(future, 20, 50, Now));

        var timeless = Candles(120, i => 100 + i);
        timeless[0].Time = 0;                                                            // una vela sin hora
        Assert.Null(MetricResolver.UsableEmaSpread(timeless, 20, 50, Now));
    }

    private sealed class CandleMediator : IMediator
    {
        public List<CandleData>? Data;
        public MarketDataCandleRequest? Seen;
        public Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken ct = default)
        {
            Seen = (MarketDataCandleRequest)(object)request;
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
    public async Task Resolver_AsksDailyCandlesWithEnoughHistory_AndReturnsSpreadOrNull()
    {
        MetricResolver.ClearDailyCandleCache();
        var mediator = new CandleMediator { Data = Candles(120, i => 100 + i) };
        var resolver = new MetricResolver(mediator, NullLogger.Instance);

        var ok = await resolver.ResolveAsync(new[] { EmaRef }, default, Now);
        Assert.True(ok[EmaRef] > 0);
        Assert.Equal("1d", mediator.Seen!.Interval);
        Assert.Equal("AAPL", mediator.Seen.Symbol);
        Assert.Equal(Now.AddDays(-300), mediator.Seen.FromTime);   // slow 50 × 6

        MetricResolver.ClearDailyCandleCache();
        mediator.Data = Candles(30, i => 100 + i);
        var none = await resolver.ResolveAsync(new[] { EmaRef, "capability:compute.ema_spread.AAPL.10.20" }, default, Now);
        Assert.Null(none[EmaRef]);
        Assert.Null(none["capability:compute.ema_spread.AAPL.10.20"]);   // 30 < 20×2
        Assert.Equal(Now.AddDays(-250), mediator.Seen!.FromTime);         // piso de 250 (20 × 6 = 120)

        MetricResolver.ClearDailyCandleCache();
        mediator.Data = null!;
        Assert.Null((await resolver.ResolveAsync(new[] { EmaRef }, default, Now))[EmaRef]);
    }

    [Fact]
    public async Task Resolver_CachesDailyCandles_ForTenMinutes()
    {
        MetricResolver.ClearDailyCandleCache();
        var mediator = new CandleMediator { Data = Candles(120, i => 100 + i) };
        var resolver = new MetricResolver(mediator, NullLogger.Instance);
        await resolver.ResolveAsync(new[] { EmaRef }, default, Now);
        mediator.Seen = null;

        await resolver.ResolveAsync(new[] { EmaRef }, default, Now.AddMinutes(9));   // dentro del TTL: sin pedido
        Assert.Null(mediator.Seen);
        await resolver.ResolveAsync(new[] { EmaRef }, default, Now.AddMinutes(11));  // vencido: pide de nuevo
        Assert.NotNull(mediator.Seen);
        MetricResolver.ClearDailyCandleCache();
    }

    [Fact]
    public async Task Resolver_DoesNotCache_PartialOrStaleCandles()
    {
        MetricResolver.ClearDailyCandleCache();
        var mediator = new CandleMediator { Data = Candles(30, i => 100 + i) };   // parcial: 30 < 50×2
        var resolver = new MetricResolver(mediator, NullLogger.Instance);
        Assert.Null((await resolver.ResolveAsync(new[] { EmaRef }, default, Now))[EmaRef]);

        mediator.Seen = null;
        mediator.Data = Candles(120, i => 100 + i);   // el proveedor ya devuelve todo: se pide de nuevo, no se usa el parcial
        Assert.True((await resolver.ResolveAsync(new[] { EmaRef }, default, Now.AddMinutes(1)))[EmaRef] > 0);
        Assert.NotNull(mediator.Seen);

        MetricResolver.ClearDailyCandleCache();
        mediator.Data = Candles(120, i => 100 + i, Now.AddDays(-12));   // última vela vieja
        Assert.Null((await resolver.ResolveAsync(new[] { EmaRef }, default, Now))[EmaRef]);
        mediator.Seen = null;
        mediator.Data = Candles(120, i => 100 + i);
        Assert.True((await resolver.ResolveAsync(new[] { EmaRef }, default, Now.AddMinutes(1)))[EmaRef] > 0);
        Assert.NotNull(mediator.Seen);
        MetricResolver.ClearDailyCandleCache();
    }

    // ── Spec ────────────────────────────────────────────────────────

    private static string SpecFilePath() =>
        Path.Combine(Path.GetDirectoryName(ShadowRuntimeEngineTests.SpecPath())!, "aapl_cruce_ema_20_50.json");

    /// <summary>La spec de acciones con fill al MID (WS-0062 inc.2): estos tests se escribieron con precios al medio.</summary>
    internal static StrategySpec EquitySpec() => NaturalEquitySpec() with { Execution = new SpecExecution { Fill = "mid" } };

    /// <summary>La spec de acciones tal cual el archivo: sin bloque execution, o sea fill natural.</summary>
    internal static StrategySpec NaturalEquitySpec()
    {
        var r = StrategySpecLoader.LoadFromFile(SpecFilePath());
        Assert.True(r.Success, string.Join("; ", r.Errors));
        return r.Spec!;
    }

    [Fact]
    public void ExampleSpec_Loads_AndValidatorAcceptsLongEquity()
    {
        var spec = EquitySpec();
        Assert.Equal("long_equity", spec.Structure.DefaultStructure);
        Assert.Equal("LT", spec.Exits.Deterministic.MetricExit!.Operator);
    }

    [Fact]
    public void Validator_RejectsBadLongEquity_AndLeavesSpreadsAlone()
    {
        var spec = EquitySpec();
        Assert.Contains(StrategySpecValidator.Validate(spec with { Universe = spec.Universe with { InstrumentTypes = new() { "EQUITY_OPTION" } } }).Errors,
            e => e.Contains("EQUITY"));
        Assert.Contains(StrategySpecValidator.Validate(spec with { Universe = spec.Universe with { InstrumentTypes = new() { "EQUITY", "EQUITY_OPTION" } } }).Errors,
            e => e.Contains("exactly"));
        foreach (var c in new[]
        {
            spec.CandidateConstruction.Constraints with { MinDte = 30 },
            spec.CandidateConstruction.Constraints with { MaxDte = 45 },
            spec.CandidateConstruction.Constraints with { MinCredit = 0.5 },
        })
            Assert.Contains(StrategySpecValidator.Validate(spec with
            {
                CandidateConstruction = spec.CandidateConstruction with { Constraints = c },
            }).Errors, e => e.Contains("constraints"));
        foreach (var sel in new[]
        {
            new LegStrikeSelection { Method = "DELTA" },
            new LegStrikeSelection { Method = "NONE", TargetDelta = -0.16 },
            new LegStrikeSelection { Method = "NONE", Width = 5 },
        })
            Assert.Contains(StrategySpecValidator.Validate(spec with
            {
                CandidateConstruction = spec.CandidateConstruction with
                {
                    Legs = new() { spec.CandidateConstruction.Legs[0] with { StrikeSelection = sel } },
                },
            }).Errors, e => e.Contains("strike_selection"));
        Assert.Contains(StrategySpecValidator.Validate(spec with
        {
            Exits = new SpecExits { Deterministic = spec.Exits.Deterministic with { DefensiveRoll = new DefensiveRollExit { Enabled = true } } },
        }).Errors, e => e.Contains("defensive_roll"));
        Assert.Contains(StrategySpecValidator.Validate(spec with
        {
            CandidateConstruction = spec.CandidateConstruction with { Sizing = new SizingConfig { Method = "FIXED", FixedContracts = 0 } },
        }).Errors, e => e.Contains("sizing"));
        Assert.Contains(StrategySpecValidator.Validate(spec with
        {
            Exits = new SpecExits { Deterministic = spec.Exits.Deterministic with { StopLoss = new StopLossExit { PctOfCredit = 200 } } },
        }).Errors, e => e.Contains("pct_of_credit"));   // acciones = débito: el stop es pct_of_cost (WS-0062 inc.5)
        Assert.Contains(StrategySpecValidator.Validate(spec with
        {
            Exits = new SpecExits { Deterministic = spec.Exits.Deterministic with { MetricExit = new MetricExit { MetricRef = EmaRef, Operator = "LT" } } },
        }).Errors, e => e.Contains("metric_exit"));

        // Los spreads siguen igual: la spec de prueba existente valida y una estructura desconocida se sigue rechazando.
        Assert.True(StrategySpecValidator.Validate(ShadowRuntimeEngineTests.Spec()).IsValid);
        var spread = ShadowRuntimeEngineTests.Spec();
        Assert.Contains(StrategySpecValidator.Validate(spread with
        {
            Structure = spread.Structure with { AllowedStrategies = new() { "straddle" }, DefaultStructure = "straddle" },
        }).Errors, e => e.Contains("not built by the runtime"));
    }

    // ── Constructor, riesgo y fill ──────────────────────────────────

    private static Func<string, CancellationToken, Task<LegQuote?>> Quote(double bid, double ask, DateTime? asOf = null) =>
        (_, _) => Task.FromResult<LegQuote?>(new LegQuote(bid, ask, asOf ?? Now));

    private static StrategyInstance Instance() => ShadowRuntimeEngineTests.NewRuntime().Instance;

    [Fact]
    public async Task Builder_BuysAtMid_CostIsMaxRisk_CreditIsNegative()
    {
        var built = await LongEquityCandidateBuilder.BuildAsync(Quote(269.90, 270.10), Instance(), EquitySpec(), "AAPL", Now, default);

        var c = built.Candidate!;
        Assert.Equal(-270.0, c.Credit);
        Assert.Equal(2700.0, c.MaxRisk);                         // costo: 270 × 10 acciones
        var leg = Assert.Single(c.Legs);
        Assert.Equal(("BUY", "STOCK", 10), (leg.Side, leg.Type, leg.Quantity));
        Assert.True(ShadowRiskValidator.Validate(c, EquitySpec(), 0, null, Now).IsValid);

        var pos = ShadowFillSimulator.Fill(c, Now, ShadowFillSimulatorTests.MidTerms);
        Assert.Equal(-270.0, pos.EntryCredit);
        Assert.Equal(270.0, pos.Legs.Single().EntryPrice);
        Assert.Equal(10, pos.Legs.Single().Quantity);
        Assert.Equal(10, ShadowFillSimulator.Multiplier(pos));
    }

    [Fact]
    public async Task Builder_InvalidCrossedStaleOrMissingQuote_NoCandidate()
    {
        var spec = EquitySpec();
        foreach (var q in new[] { Quote(270.10, 269.90), Quote(0, 0), Quote(double.NaN, 270), Quote(269, 270, Now.AddMinutes(-10)),
                                  Quote(269, 270, Now.AddMinutes(10)) })
            Assert.Null((await LongEquityCandidateBuilder.BuildAsync(q, Instance(), spec, "AAPL", Now, default)).Candidate);
        Assert.Null((await LongEquityCandidateBuilder.BuildAsync((_, _) => Task.FromResult<LegQuote?>(null), Instance(), spec, "AAPL", Now, default)).Candidate);

        var noQty = spec with { CandidateConstruction = spec.CandidateConstruction with { Sizing = new SizingConfig { Method = "RISK_BASED" } } };
        Assert.Null((await LongEquityCandidateBuilder.BuildAsync(Quote(269, 270), Instance(), noQty, "AAPL", Now, default)).Candidate);
    }

    [Fact]
    public async Task RiskValidator_RejectsPositiveCreditOrNoQuantity()
    {
        var c = (await LongEquityCandidateBuilder.BuildAsync(Quote(269, 271), Instance(), EquitySpec(), "AAPL", Now, default)).Candidate!;
        Assert.False(ShadowRiskValidator.Validate(c with { Credit = 270 }, EquitySpec(), 0, null, Now).IsValid);
        Assert.False(ShadowRiskValidator.Validate(c with { Legs = new() { c.Legs[0] with { Quantity = null } } }, EquitySpec(), 0, null, Now).IsValid);
    }

    // ── Motor: entrada, valuación, salida ───────────────────────────

    private static ShadowRuntimeEngineTests.FakeData Data(double? metric, double bid, double ask)
    {
        var data = new ShadowRuntimeEngineTests.FakeData { Metrics = new() { [EmaRef] = metric } };
        data.Quotes["AAPL"] = new LegQuote(bid, ask, Now);
        data.Build = () => LongEquityCandidateBuilder.BuildAsync((s, _) => Task.FromResult(data.Quotes.GetValueOrDefault(s)),
            Instance(), EquitySpec(), "AAPL", Now, default).Result;
        return data;
    }

    private static async Task<(ShadowRuntimeStore Store, ShadowRuntimeEngineTests.FakeData Data, ShadowPosition Pos)> OpenPosition()
    {
        var (store, instance) = ShadowRuntimeEngineTests.NewRuntime();
        var data = Data(metric: 1.5, bid: 269.90, ask: 270.10);
        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, EquitySpec(), "AAPL", Now, default);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, outcome);
        return (store, data, Assert.Single(store.OpenPositions()));
    }

    [Fact]
    public async Task Entry_OpensWhenGatePasses_AndNotWhenEmaBelowOrMissing_OrQuoteInvalid()
    {
        var (store, data, pos) = await OpenPosition();
        Assert.Equal("long_equity", pos.Structure);
        Assert.Equal(2700.0, pos.MaxRisk);

        // Ya hay una posición: máximo 1.
        var (_, instance) = ShadowRuntimeEngineTests.NewRuntime();
        Assert.Equal(ShadowRuntimeEngine.Outcomes.MaxPositions,
            await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, EquitySpec(), "AAPL", Now, default));

        foreach (var (metric, bid, ask, expected) in new (double?, double, double, string)[]
        {
            (-0.5, 269.9, 270.1, ShadowRuntimeEngine.Outcomes.GatesNotPassed),    // EMA20 < EMA50
            (null, 269.9, 270.1, ShadowRuntimeEngine.Outcomes.GatesNotPassed),    // sin velas: ON_NO_DATA BLOCK
            (1.5, 270.1, 269.9, ShadowRuntimeEngine.Outcomes.NoCandidate),        // cotización cruzada
        })
        {
            var (s2, i2) = ShadowRuntimeEngineTests.NewRuntime();
            var d = Data(metric, bid, ask);
            Assert.Equal(expected, await ShadowRuntimeEngine.EvaluateEntryAsync(s2, d, i2, EquitySpec(), "AAPL", Now, default));
            Assert.Empty(s2.AllPositions());
        }
    }

    [Fact]
    public async Task Valuation_UnrealizedPnl_IsPriceDifferenceTimesShares()
    {
        var (store, data, pos) = await OpenPosition();
        data.Quotes["AAPL"] = new LegQuote(274.90, 275.10, Now);                 // mid 275: +5 × 10

        var outcome = await ShadowRuntimeEngine.ValuePositionAsync(store, data, pos, EquitySpec().Exits.Deterministic, Now, default,
            maxQuoteAge: DataFreshness.MaxAge(EquitySpec()));

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, outcome);
        var valued = store.GetPosition(pos.PositionId)!;
        Assert.Equal(50.0, valued.UnrealizedPnl);
        Assert.Equal(-275.0, valued.LastSpreadValue);
        Assert.Null(valued.CurrentDte);
        Assert.Null(valued.ValuationProblems);
        Assert.Equal("OPEN", valued.Status);
    }

    [Fact]
    public async Task MetricExit_Closes_WithOwnRule_AndPnlOnShares()
    {
        var (store, data, pos) = await OpenPosition();
        data.Quotes["AAPL"] = new LegQuote(264.90, 265.10, Now);                 // mid 265: −5 × 10
        data.Metrics[EmaRef] = -0.3;                                             // EMA20 < EMA50

        var outcome = await ShadowRuntimeEngine.ValuePositionAsync(store, data, pos, EquitySpec().Exits.Deterministic, Now, default,
            maxQuoteAge: DataFreshness.MaxAge(EquitySpec()));

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed, outcome);
        var closed = store.GetPosition(pos.PositionId)!;
        Assert.Equal("CLOSED", closed.Status);
        Assert.Equal("METRIC_EXIT", closed.ExitReason);
        Assert.Equal(-50.0, closed.RealizedPnl);
        Assert.Equal(-265.0, closed.ExitDebit);
        Assert.Contains(store.GetEvents("i-1"), e => e.EventType == "POSITION_CLOSED");
    }

    [Fact]
    public async Task MetricExit_NotMet_OrNoData_OrOutsideSession_DoesNotClose()
    {
        var (store, data, pos) = await OpenPosition();
        var exits = EquitySpec().Exits.Deterministic;
        var maxAge = DataFreshness.MaxAge(EquitySpec());

        data.Metrics[EmaRef] = 0.4;                                               // sigue arriba
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued,
            await ShadowRuntimeEngine.ValuePositionAsync(store, data, pos, exits, Now, default, maxQuoteAge: maxAge));

        data.Metrics[EmaRef] = null;                                              // sin dato: no cierra y anota
        pos = store.GetPosition(pos.PositionId)!;
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued,
            await ShadowRuntimeEngine.ValuePositionAsync(store, data, pos, exits, Now, default, maxQuoteAge: maxAge));
        var noted = store.GetPosition(pos.PositionId)!;
        Assert.Equal("OPEN", noted.Status);
        Assert.Contains(EmaRef, Assert.Single(noted.ValuationProblems!));
        Assert.NotNull(noted.UnrealizedPnl);
        Assert.Single(store.GetEvents("i-1"), e => e.EventType == "VALUATION_NO_DATA");

        // Mismo problema en el tick siguiente: sin evento repetido.
        await ShadowRuntimeEngine.ValuePositionAsync(store, data, noted, exits, Now, default, maxQuoteAge: maxAge);
        Assert.Single(store.GetEvents("i-1"), e => e.EventType == "VALUATION_NO_DATA");

        data.Metrics[EmaRef] = -1;                                                // cumple, pero fuera de sesión no cierra
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued,
            await ShadowRuntimeEngine.ValuePositionAsync(store, data, store.GetPosition(pos.PositionId)!, exits, Now, default,
                evaluateExits: false, maxQuoteAge: maxAge));
        Assert.Equal("OPEN", store.GetPosition(pos.PositionId)!.Status);
    }

    [Fact]
    public void ExitPrecedence_StopLossFirst_ThenMetricExit_ThenTakeProfit()
    {
        var pos = new ShadowPosition { Status = "OPEN", EntryCredit = 1.0 };
        var exits = new DeterministicExits
        {
            StopLoss = new StopLossExit { PctOfCredit = 200 },
            TakeProfit = new TakeProfitExit { PctOfCredit = 50 },
            MetricExit = new MetricExit { MetricRef = EmaRef, Operator = "LT", Threshold = new GateThreshold { Value = 0 } },
        };
        Assert.Equal("STOP_LOSS", ShadowFillSimulator.EvaluateExits(pos, exits, 3.5, 30, metricExitMet: true));
        Assert.Equal("METRIC_EXIT", ShadowFillSimulator.EvaluateExits(pos, exits, 0.4, 30, metricExitMet: true));
        Assert.Equal("TAKE_PROFIT", ShadowFillSimulator.EvaluateExits(pos, exits, 0.4, 30, metricExitMet: false));
        Assert.Equal("TAKE_PROFIT", ShadowFillSimulator.EvaluateExits(pos, exits with { MetricExit = null }, 0.4, 30, metricExitMet: true));
    }

    // ── Performance y spreads sin cambios ───────────────────────────

    [Fact]
    public void Performance_BreaksDownMetricExit_AndPercentIsOnCost()
    {
        var t0 = new DateTime(2026, 10, 1, 14, 0, 0, DateTimeKind.Utc);
        var closed = new ShadowPosition
        {
            PositionId = "p1", Status = "CLOSED", Symbol = "AAPL", Structure = "long_equity",
            Legs = new() { new ShadowLeg { Side = "BUY", Type = "STOCK", EntryPrice = 270, Quantity = 10 } },
            EntryCredit = -270, ExitDebit = -265, RealizedPnl = -50, ExitReason = "METRIC_EXIT", MaxRisk = 2700,
            EntryAt = t0, ExitAt = t0.AddDays(5),
        };
        var rec = new SpecVersionRecord { ContentHash = "h", SpecName = "aapl", SpecVersion = "1", Positions = new() { closed } };
        var rep = ShadowPerformance.Compute(new[] { rec }, new Dictionary<string, DeterministicExits> { ["h"] = EquitySpec().Exits.Deterministic }, 10000, t0.AddDays(10));

        var rule = Assert.Single(rep.Strategies.Single().ByExitRule);
        Assert.Equal(("METRIC_EXIT", 1, -50.0), (rule.Rule, rule.Count, rule.RealizedPnl));
        var trade = rep.Trades.Single();
        Assert.Equal(-1.9, trade.PnlPctOfMaxRisk);               // −50 / 2700
        Assert.Null(trade.PnlPctOfCredit);
        Assert.Equal(-0.5, rep.Portfolio.RealizedReturnPct);
    }

    [Fact]
    public void EquityWithoutQuantity_FailsExplicitly_InsteadOfUsingOne()
    {
        var noQty = new ShadowPosition
        {
            PositionId = "p9", Structure = "long_equity", EntryCredit = -270, Status = "OPEN",
            Legs = new() { new ShadowLeg { Side = "BUY", Type = "STOCK" } },
        };
        var ex = Assert.Throws<InvalidOperationException>(() => ShadowFillSimulator.Multiplier(noQty));
        Assert.Contains("p9", ex.Message);
        Assert.Throws<InvalidOperationException>(() => ShadowFillSimulator.Pnl(noQty, 275));
    }

    [Fact]
    public void Spreads_KeepTheirMultiplierAndPnl()
    {
        var spread = new ShadowPosition { Structure = "put_credit_spread", EntryCredit = 0.85, Status = "OPEN" };
        Assert.Equal(100, ShadowFillSimulator.Multiplier(spread));
        var closed = ShadowFillSimulator.Close(spread, 0.40, "TAKE_PROFIT", Now);
        Assert.Equal(45.0, closed.RealizedPnl);
    }
}
