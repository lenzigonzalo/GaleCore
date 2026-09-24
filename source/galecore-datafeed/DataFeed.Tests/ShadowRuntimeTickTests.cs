using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;
using static DataFeed.Tests.ShadowRuntimeEngineTests;

namespace DataFeed.Tests;

/// <summary>
/// GC-0002 — los ticks de los loops SHADOW: el switch OFF pausa entradas sin borrar ni frenar el
/// seguimiento (AC-04, R1-M2), y fuera de sesión no se simulan fills ni cierres (R1-M1).
/// </summary>
public class ShadowRuntimeTickTests
{
    private static readonly DateTime Night = new(2026, 9, 25, 0, 30, 0, DateTimeKind.Utc);     // jueves 20:30 ET
    private static readonly DateTime Saturday = new(2026, 9, 26, 15, 0, 0, DateTimeKind.Utc);  // sábado 11:00 ET

    private static (ShadowRuntimeStore Store, StrategyInstance Instance) RuntimeWithSpec()
    {
        var (store, instance) = NewRuntime();
        store.RegisterSpec("shadow_runtime_test_v1", Spec());
        return (store, instance);
    }

    // ── Sesión ─────────────────────────────────────────────────────

    [Fact]
    public void Session_OpenOnlyOnWeekdaysWithinHours()
    {
        var op = Spec().Operational;
        Assert.True(ShadowSession.IsOpen(op, Now));
        Assert.True(ShadowSession.IsOpen(op, new DateTime(2026, 9, 24, 13, 30, 0, DateTimeKind.Utc)));   // 09:30 ET
        Assert.False(ShadowSession.IsOpen(op, new DateTime(2026, 9, 24, 13, 29, 0, DateTimeKind.Utc)));  // 09:29 ET
        Assert.False(ShadowSession.IsOpen(op, new DateTime(2026, 9, 24, 20, 0, 0, DateTimeKind.Utc)));   // 16:00 ET
        Assert.False(ShadowSession.IsOpen(op, Night));
        Assert.False(ShadowSession.IsOpen(op, Saturday));
    }

    [Fact]
    public void Session_UnreadableConfig_IsClosed()
    {
        var op = Spec().Operational;
        Assert.False(ShadowSession.IsOpen(op with { Timezone = "Nowhere/Nada" }, Now));
        Assert.False(ShadowSession.IsOpen(op with { SessionHours = new SessionHours { Start = "9.30", End = "16:00" } }, Now));
    }

    // ── Entrada ────────────────────────────────────────────────────

    [Fact]
    public async Task EntryTick_InSession_Evaluates()
    {
        var (store, _) = RuntimeWithSpec();
        var data = new FakeData { Build = () => CandidateBuildResult.Built(RealCandidate()) };

        var outcomes = await ShadowRuntimeTick.RunEntryTickAsync(store, data, switchEnabled: true, Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, outcomes["SPY"]);
        Assert.Equal(ShadowRuntimeTick.SchedulerStates.Idle, store.GetInstance("i-1")!.SchedulerState);
    }

    [Theory]
    [MemberData(nameof(ClosedTimes))]
    public async Task EntryTick_OutsideSession_NeverEvaluatesNorFills(DateTime when)
    {
        var (store, _) = RuntimeWithSpec();
        var data = new FakeData { Build = () => CandidateBuildResult.Built(RealCandidate()) };

        var outcomes = await ShadowRuntimeTick.RunEntryTickAsync(store, data, switchEnabled: true, when, default);

        Assert.Empty(outcomes);
        Assert.Equal(0, data.BuildCalls);
        Assert.Empty(store.AllPositions());
        Assert.Empty(store.GetEvaluations("i-1"));
        Assert.Equal(ShadowRuntimeTick.SchedulerStates.OutsideSession, store.GetInstance("i-1")!.SchedulerState);
    }

    public static IEnumerable<object[]> ClosedTimes() => new[] { new object[] { Night }, new object[] { Saturday } };

    // ── AC-04: el switch OFF pausa, no borra ni frena el monitor ──

    [Fact]
    public async Task SwitchOff_PausesEntries_KeepsState_MonitorKeepsValuing()
    {
        var (store, _) = RuntimeWithSpec();
        var data = new FakeData { Build = () => CandidateBuildResult.Built(RealCandidate()) };
        await ShadowRuntimeTick.RunEntryTickAsync(store, data, switchEnabled: true, Now, default);
        var pos = Assert.Single(store.AllPositions());
        int eventsBefore = store.GetEvents("i-1").Count;
        int evaluationsBefore = store.GetEvaluations("i-1").Count;

        // Switch OFF, en sesión: el tick de entrada no evalúa ni abre, y la instancia muestra la pausa.
        var entry = await ShadowRuntimeTick.RunEntryTickAsync(store, data, switchEnabled: false, Now.AddMinutes(1), default);
        Assert.Empty(entry);
        Assert.Equal(1, data.BuildCalls);
        Assert.Equal(ShadowRuntimeTick.SchedulerStates.Paused, store.GetInstance("i-1")!.SchedulerState);
        Assert.Equal("RUNNING", store.GetInstance("i-1")!.LifecycleState);

        // Todo lo registrado sigue consultable.
        Assert.Equal(eventsBefore, store.GetEvents("i-1").Count);
        Assert.Equal(evaluationsBefore, store.GetEvaluations("i-1").Count);
        Assert.Single(store.OpenPositions());

        // El monitor no depende del switch: valúa y cierra con precios reales.
        data.Quotes[".SPY261030P720"] = new LegQuote(0.50, 0.60, Now);
        data.Quotes[".SPY261030P715"] = new LegQuote(0.20, 0.30, Now);
        var monitor = await ShadowRuntimeTick.RunMonitorTickAsync(store, data, Now.AddMinutes(2), default);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed, monitor[pos.PositionId]);
        Assert.Equal("TAKE_PROFIT", store.GetPosition(pos.PositionId)!.ExitReason);
    }

    // ── Monitor ────────────────────────────────────────────────────

    [Fact]
    public async Task MonitorTick_OutsideSession_ValuesButNeverCloses()
    {
        var (store, _) = RuntimeWithSpec();
        var data = new FakeData { Build = () => CandidateBuildResult.Built(RealCandidate()) };
        await ShadowRuntimeTick.RunEntryTickAsync(store, data, switchEnabled: true, Now, default);
        var pos = store.AllPositions().Single();
        data.Quotes[".SPY261030P720"] = new LegQuote(0.50, 0.60, Now);   // take profit si se evaluara
        data.Quotes[".SPY261030P715"] = new LegQuote(0.20, 0.30, Now);

        var monitor = await ShadowRuntimeTick.RunMonitorTickAsync(store, data, Night, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, monitor[pos.PositionId]);
        var same = store.GetPosition(pos.PositionId)!;
        Assert.Equal("OPEN", same.Status);
        Assert.Equal(0.3, same.LastSpreadValue);
        Assert.Equal(Night, same.LastValuedAt);
    }

    [Fact]
    public async Task MonitorTick_PositionWithoutSpec_IsRecorded_Once()
    {
        var (store, _) = NewRuntime();   // sin spec registrada
        store.AddPosition(new ShadowPosition { PositionId = "p-1", InstanceId = "i-1", Symbol = "SPY", Status = "OPEN" });

        await ShadowRuntimeTick.RunMonitorTickAsync(store, new FakeData(), Now, default);
        await ShadowRuntimeTick.RunMonitorTickAsync(store, new FakeData(), Now.AddSeconds(30), default);

        var ev = Assert.Single(store.GetEvents("i-1"), e => e.EventType == "VALUATION_NO_DATA");
        Assert.Contains("sin spec", ((List<string>)ev.Payload["problems"]!).Single());
    }
}

/// <summary>GC-0002 R1-B1 — un net GEX sin datos reales es NO_DATA, no 0.</summary>
public class MetricResolverNetGexTests
{
    private static GammaExposureResponse WithStrikes(int greeks, long oi) => new()
    {
        SymbolsWithGreeks = greeks,
        Strikes = new() { new() { Strike = 700, CallOI = oi, PutOI = oi, CallGEX = 5000, PutGEX = -2000 } },
    };

    [Fact]
    public void NoResponse_NoStrikes_NoGreeks_NoOi_AreNoData()
    {
        Assert.Null(MetricResolver.UsableNetGex(null));
        Assert.Null(MetricResolver.UsableNetGex(new GammaExposureResponse()));
        Assert.Null(MetricResolver.UsableNetGex(WithStrikes(greeks: 0, oi: 10)));
        Assert.Null(MetricResolver.UsableNetGex(WithStrikes(greeks: 2, oi: 0)));
    }

    [Fact]
    public void RealData_ReturnsTheSum()
    {
        Assert.Equal(3.0, MetricResolver.UsableNetGex(WithStrikes(greeks: 2, oi: 10)));   // (5000 − 2000) / 1000
    }
}
