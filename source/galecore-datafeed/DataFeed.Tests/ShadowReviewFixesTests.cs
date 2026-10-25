using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Application.Data.Tastytrade.MarketDataCandle;
using MediatR;
using Microsoft.Extensions.Logging.Abstractions;
using static DataFeed.Tests.ShadowRuntimeEngineTests;

namespace DataFeed.Tests;

/// <summary>
/// WS-0062 revisión interna — salida por hora en un cierre temprano, valuación vencida que no deja P&amp;L viejo, cierre oficial que
/// todavía no está (no se vuelve a pedir en cada tick) y el % de riesgo por operación que exige capital simulado.
/// </summary>
public class ShadowReviewFixesTests
{
    // ── M2: time_exit.at sin days_after_entry en un cierre temprano ───────────

    [Fact]
    public async Task TimeExitAt_On0Dte_EarlyClose_FiresFiveMinutesBeforeTheClose()
    {
        // 27/11/2026 (viernes después de Acción de Gracias): cierre 13:00 ET. Con at=15:30 la salida es 12:55 ET.
        var pos = new ShadowPosition
        {
            PositionId = "p-1", InstanceId = "i-1", Symbol = "SPX", Structure = RuntimeStructures.CustomOptions, Status = "OPEN",
            EntryCredit = 2.6, Width = 5, MaxRisk = 240, EntryDte = 0, EntryAt = new DateTime(2026, 11, 27, 14, 35, 0, DateTimeKind.Utc),
            Legs = new()
            {
                new() { Side = "SELL", Type = "PUT", Strike = 7615, Expiration = "2026-11-27", OccSymbol = "SPXW  261127P07615000", StreamerSymbol = ".SPXW261127P7615" },
                new() { Side = "BUY", Type = "PUT", Strike = 7610, Expiration = "2026-11-27", OccSymbol = "SPXW  261127P07610000", StreamerSymbol = ".SPXW261127P7610" },
            },
            EntryContext = new EntryContext { Execution = new ExecutionTerms { Fill = ExecutionTerms.Mid } },
        };
        var exits = new DeterministicExits { TimeExit = new TimeExit { At = "15:30" } };
        var op = Spec().Operational;

        async Task<(string Outcome, ShadowPosition P)> At(DateTime utc)
        {
            var (store, _) = NewRuntime();
            store.AddPosition(pos);
            var data = new FakeData();
            data.Quotes[".SPXW261127P7615"] = new LegQuote(2.0, 2.2, utc);
            data.Quotes[".SPXW261127P7610"] = new LegQuote(0.9, 1.0, utc);
            var outcome = await ShadowRuntimeEngine.ValuePositionAsync(store, data, pos, exits, utc, default, operational: op);
            return (outcome, store.GetPosition("p-1")!);
        }

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, (await At(new DateTime(2026, 11, 27, 17, 54, 0, DateTimeKind.Utc))).Outcome);   // 12:54 ET
        var (outcome, closed) = await At(new DateTime(2026, 11, 27, 17, 55, 0, DateTimeKind.Utc));                                       // 12:55 ET
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed, outcome);
        Assert.Equal("TIME_EXIT", closed.ExitReason);
    }

    // ── M4: una posición sin valuación vigente no conserva el P&L viejo ──────────

    [Fact]
    public async Task NoValuation_ClearsTheOldPnl_SoNobodySumsIt()
    {
        var (store, _) = NewRuntime();
        var pos = ShadowFillSimulator.Fill(RealCandidate(), Now, new ExecutionTerms()) with { InstanceId = "i-1", UnrealizedPnl = 30, LastSpreadValue = 0.55 };
        store.AddPosition(pos);

        var outcome = await ShadowRuntimeEngine.ValuePositionAsync(store, new FakeData(), pos, Spec().Exits.Deterministic, Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.NoData, outcome);
        var p = store.GetPosition(pos.PositionId)!;
        Assert.Null(p.UnrealizedPnl);
        Assert.Null(p.LastSpreadValue);
        Assert.NotEmpty(p.ValuationProblems!);
        var rec = new SpecVersionRecord { ContentHash = "sha256:x", SpecName = "a", SpecVersion = "1", Positions = new() { p } };
        var metrics = ShadowMetrics.Compute(rec);
        Assert.Null(metrics.UnrealizedPnl);
        Assert.Equal(1, metrics.OpenPositionsNotValued);
        Assert.Null(ShadowCapital.Exposure(new[] { rec }, new CapitalLimits { Capital = 10_000, MaxRiskPerTradePct = 5, MaxOpenRiskPct = 50, MaxBetPct = 100 }, Now).UnrealizedPnl);
    }

    [Fact]
    public async Task PendingSettlement_ClearsTheOldPnl()
    {
        var (store, _) = NewRuntime();
        var pos = ShadowFillSimulator.Fill(RealCandidate(), Now, new ExecutionTerms()) with { InstanceId = "i-1", UnrealizedPnl = 30, LastSpreadValue = 0.55 };
        store.AddPosition(pos);
        var afterExpiry = new DateTime(2026, 10, 30, 21, 0, 0, DateTimeKind.Utc);   // 17:00 ET, sin cierre oficial (FakeData no lo trae)

        await ShadowRuntimeEngine.ValuePositionAsync(store, new FakeData(), pos, Spec().Exits.Deterministic, afterExpiry, default);

        var p = store.GetPosition(pos.PositionId)!;
        Assert.True(ShadowPerformance.IsPendingSettlement(p));
        Assert.Null(p.UnrealizedPnl);
    }

    // ── Cierre oficial que todavía no existe: no se pide en cada tick ─────────

    private sealed class CandleMediator : IMediator
    {
        public List<CandleData> Data = new();
        public int Calls;
        public Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken ct = default)
        {
            Calls++;
            object resp = new MarketDataCandleResponse { data = Data };
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
    public async Task OfficialClose_NotThereYet_IsNotAskedAgainEveryTick_ButAnotherDateIs()
    {
        var mediator = new CandleMediator();
        var date = new DateTime(2026, 10, 30);
        // Cada tick crea su propio MediatorRuntimeMarketData: la memoria no puede vivir en la instancia.
        MediatorRuntimeMarketData NewData() => new(mediator, NullLogger.Instance);

        Assert.Null(await NewData().GetOfficialCloseAsync("RETRYTEST", date, default));
        Assert.Null(await NewData().GetOfficialCloseAsync("RETRYTEST", date, default));
        Assert.Null(await NewData().GetOfficialCloseAsync("retrytest", date, default));
        Assert.Equal(1, mediator.Calls);

        Assert.Null(await NewData().GetOfficialCloseAsync("RETRYTEST", date.AddDays(1), default));   // otra fecha: se pide
        Assert.Equal(2, mediator.Calls);

        // Un cierre que sí está se devuelve y no deja memoria de «no hay».
        var found = new DateTime(2026, 10, 29);
        mediator.Data = new() { new CandleData { Time = new DateTimeOffset(found, TimeSpan.Zero).ToUnixTimeMilliseconds(), Close = 7600 } };
        Assert.Equal(7600, await NewData().GetOfficialCloseAsync("RETRYTEST", found, default));
        Assert.Equal(7600, await NewData().GetOfficialCloseAsync("RETRYTEST", found, default));
        Assert.Equal(4, mediator.Calls);
    }

    // ── Validador: max_risk_per_trade_pct mide contra el capital simulado ─────

    [Fact]
    public void MaxRiskPerTradePct_WithoutSimulatedCapital_IsRejected()
    {
        var spec = Spec() with { RiskLimits = Spec().RiskLimits with { MaxRiskPerTradePct = 5, SimulatedCapitalUsd = null } };
        Assert.Contains(StrategySpecValidator.Validate(spec).Errors, e => e.Contains("max_risk_per_trade_pct needs risk_limits.simulated_capital_usd"));

        var ok = spec with { RiskLimits = spec.RiskLimits with { SimulatedCapitalUsd = 25_000 } };
        Assert.True(StrategySpecValidator.Validate(ok).IsValid, string.Join("; ", StrategySpecValidator.Validate(ok).Errors));
    }
}
