using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;
using static DataFeed.Tests.ShadowRuntimeEngineTests;

namespace DataFeed.Tests;

/// <summary>
/// GC-0004 — el runtime SHADOW guarda antes de recordar (AC-02) y retoma lo guardado tras un reinicio
/// sin duplicar ni perder estado (AC-04). Un repositorio falso hace de base; la prueba contra
/// PostgreSQL real está en EfShadowRuntimeRepositoryTests.
/// </summary>
public class ShadowRuntimePersistenceTests
{
    /// <summary>Base en memoria que registra lo guardado y puede fallar a pedido.</summary>
    internal sealed class FakeRepository : IShadowRuntimeRepository
    {
        public readonly Dictionary<string, string> Specs = new();
        public readonly List<StrategyDeployment> Deployments = new();
        public readonly Dictionary<string, StrategyInstance> Instances = new();
        public readonly Dictionary<string, ShadowPosition> Positions = new();
        public readonly List<EvaluationResult> Evaluations = new();
        public readonly List<OperationalEvent> Events = new();
        public int InstanceSaves;
        public bool Fail;
        public bool FailOnSpecJson;
        public bool FailOnSpec;

        private void Check() { if (Fail) throw new InvalidOperationException("base caída"); }

        public void SaveSpec(StrategySpec spec, string specJson)
        {
            Check();
            if (FailOnSpec) throw new InvalidOperationException("base caída");
            Specs.TryAdd(spec.ContentHash!, specJson);
        }
        public void SaveDeployment(StrategyDeployment d) { Check(); Deployments.Add(d); }
        public void SaveInstance(StrategyInstance i) { Check(); InstanceSaves++; Instances[i.InstanceId] = i; }
        public StrategyInstance? Deploy(StrategyDeployment d, StrategyInstance i, OperationalEvent e)
        {
            Check();   // una transacción: los tres o nada
            Deployments.Add(d); InstanceSaves++; Instances[i.InstanceId] = i; Events.Add(e);
            return null;
        }
        public void SavePosition(ShadowPosition p, OperationalEvent? e = null)
        {
            Check();   // una transacción: la posición y su evento, o nada
            Positions[p.PositionId] = p;
            if (e != null) Events.Add(e);
        }
        public void AddEvaluation(EvaluationResult e) { Check(); Evaluations.Add(e); }
        public void AddEvent(OperationalEvent e) { Check(); Events.Add(e); }

        public ShadowRuntimeSnapshot Load(int maxEvaluationsPerInstance, int maxEventsPerInstance)
        {
            Check();
            return new ShadowRuntimeSnapshot
            {
                Instances = Instances.Values.ToList(),
                Positions = Positions.Values.ToList(),
                Evaluations = Evaluations.ToList(),
                Events = Events.ToList(),
            };
        }

        public string? GetSpecJson(string contentHash)
        {
            if (FailOnSpecJson) throw new InvalidOperationException("base caída");
            return Specs.GetValueOrDefault(contentHash);
        }

        public IReadOnlyList<SpecVersionRecord> LoadMetricsInputs() => throw new NotSupportedException();
    }

    private static SpecLoadResult SpecFile()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "DataFeed.Api", "Files", "Runtime")))
            dir = dir.Parent;
        var result = StrategySpecLoader.LoadFromFile(
            Path.Combine(dir!.FullName, "DataFeed.Api", "Files", "Runtime", "shadow_runtime_test_v1.json"));
        Assert.True(result.Success, string.Join("; ", result.Errors));
        Assert.NotNull(result.Json);
        return result;
    }

    private static Dictionary<string, SpecLoadResult> FileSpecs() => new() { ["shadow_runtime_test_v1"] = SpecFile() };

    /// <summary>Un store recién arrancado: vacío; las specs las registra la recuperación después de guardarlas.</summary>
    private static ShadowRuntimeStore FreshStore(Dictionary<string, SpecLoadResult> _) => new();

    private static StrategyInstance InstanceOf(StrategySpec spec, string id = "11111111-1111-1111-1111-111111111111") => new()
    {
        InstanceId = id, DeploymentId = "22222222-2222-2222-2222-222222222222", VersionHash = spec.ContentHash!,
        SpecName = "shadow_runtime_test_v1", LifecycleState = "RUNNING", SchedulerState = "IDLE", Mode = "SHADOW",
        CreatedAt = Now, UpdatedAt = Now,
    };

    /// <summary>Arranque durable con una instancia desplegada (como después de POST Runtime/Deploy).</summary>
    private static (ShadowRuntimeStore Store, FakeRepository Repo, StrategyInstance Instance) DurableRuntime()
    {
        var files = FileSpecs();
        var store = FreshStore(files);
        var repo = new FakeRepository();
        ShadowRuntimeRecovery.Recover(store, repo, files);
        var instance = InstanceOf(files.Values.Single().Spec!);
        Assert.Equal(DeployResult.KindCreated, Deploy(store, instance).Kind);
        return (store, repo, instance);
    }

    private static DeployResult Deploy(ShadowRuntimeStore store, StrategyInstance instance) => store.DeployOrGetRunning(
        new StrategyDeployment { DeploymentId = instance.DeploymentId, VersionHash = instance.VersionHash, DeployedAt = Now },
        instance,
        new OperationalEvent { EventId = Guid.NewGuid().ToString(), InstanceId = instance.InstanceId, EventType = "INSTANCE_CREATED", Timestamp = Now });

    private static TradeCandidate CandidateFor(StrategyInstance instance) => RealCandidate() with { InstanceId = instance.InstanceId };

    // ── AC-02: write-through ───────────────────────────────────────

    [Fact]
    public async Task OpenedPosition_IsSaved_WithItsEvaluationAndEvents()
    {
        var (store, repo, instance) = DurableRuntime();
        var data = new FakeData { Build = () => CandidateBuildResult.Built(CandidateFor(instance)) };

        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, store.SpecFor(instance)!, "SPY", Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, outcome);
        var pos = store.AllPositions().Single();
        Assert.Equal(pos, repo.Positions[pos.PositionId]);
        Assert.Equal(store.GetEvaluations(instance.InstanceId).Select(e => e.EvaluationId), repo.Evaluations.Select(e => e.EvaluationId));
        Assert.Equal(store.GetEvents(instance.InstanceId).Select(e => e.EventId), repo.Events.Select(e => e.EventId));
        Assert.Contains(repo.Events, e => e.EventType == "POSITION_OPENED");
        Assert.Single(repo.Deployments);
    }

    [Fact]
    public async Task DatabaseDown_NoPositionIsOpened_AndMemoryHasNothingUnsaved()
    {
        var (store, repo, instance) = DurableRuntime();
        var data = new FakeData { Build = () => CandidateBuildResult.Built(CandidateFor(instance)) };
        int eventsBefore = store.GetEvents(instance.InstanceId).Count;
        repo.Fail = true;

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, store.SpecFor(instance)!, "SPY", Now, default));

        Assert.Empty(store.AllPositions());
        Assert.Empty(store.GetEvaluations(instance.InstanceId));
        Assert.Equal(eventsBefore, store.GetEvents(instance.InstanceId).Count);
    }

    [Fact]
    public async Task DatabaseDownAtTheFill_PositionIsNotOpened()
    {
        var (store, repo, instance) = DurableRuntime();
        var data = new FakeData { Build = () => CandidateBuildResult.Built(CandidateFor(instance)) };
        // La base cae justo al registrar la posición: todo lo anterior quedó guardado, la posición no.
        var failing = new FailingOnPosition(repo);
        store.AttachRepository(failing);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, store.SpecFor(instance)!, "SPY", Now, default));

        Assert.Empty(store.AllPositions());
        Assert.Empty(repo.Positions);
        Assert.DoesNotContain(store.GetEvents(instance.InstanceId), e => e.EventType == "POSITION_OPENED");
        Assert.DoesNotContain(repo.Events, e => e.EventType == "POSITION_OPENED");
    }

    [Fact]
    public async Task ClosingAPosition_SavesTheCloseAndItsEventTogether()
    {
        var (store, repo, instance) = DurableRuntime();
        var data = new FakeData { Build = () => CandidateBuildResult.Built(CandidateFor(instance)) };
        await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, store.SpecFor(instance)!, "SPY", Now, default);
        var pos = store.AllPositions().Single();
        data.Quotes[".SPY261030P720"] = new LegQuote(0.50, 0.60, Now);   // take profit con precios reales
        data.Quotes[".SPY261030P715"] = new LegQuote(0.20, 0.30, Now);

        var outcome = await ShadowRuntimeEngine.ValuePositionAsync(store, data, pos, store.SpecFor(instance)!.Exits.Deterministic, Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Closed, outcome);
        Assert.Equal("CLOSED", repo.Positions[pos.PositionId].Status);
        Assert.Single(repo.Events, e => e.EventType == "POSITION_CLOSED");
        Assert.Single(store.GetEvents(instance.InstanceId), e => e.EventType == "POSITION_CLOSED");
    }

    [Fact]
    public void SpecCannotBeSaved_NothingIsRegistered_AndTheStoreIsNotDurable()
    {
        var repo = new FakeRepository { FailOnSpec = true };
        var store = new ShadowRuntimeStore();

        Assert.Throws<InvalidOperationException>(() => ShadowRuntimeRecovery.Recover(store, repo, FileSpecs()));

        Assert.Empty(store.AllSpecs());
        Assert.False(store.IsDurable);
    }

    private sealed class FailingOnPosition : IShadowRuntimeRepository
    {
        private readonly FakeRepository _inner;
        public FailingOnPosition(FakeRepository inner) => _inner = inner;
        public void SaveSpec(StrategySpec spec, string specJson) => _inner.SaveSpec(spec, specJson);
        public void SaveDeployment(StrategyDeployment d) => _inner.SaveDeployment(d);
        public void SaveInstance(StrategyInstance i) => _inner.SaveInstance(i);
        public StrategyInstance? Deploy(StrategyDeployment d, StrategyInstance i, OperationalEvent e) => _inner.Deploy(d, i, e);
        public void SavePosition(ShadowPosition p, OperationalEvent? e = null) => throw new InvalidOperationException("base caída");
        public void AddEvaluation(EvaluationResult e) => _inner.AddEvaluation(e);
        public void AddEvent(OperationalEvent e) => _inner.AddEvent(e);
        public ShadowRuntimeSnapshot Load(int a, int b) => _inner.Load(a, b);
        public string? GetSpecJson(string h) => _inner.GetSpecJson(h);
        public IReadOnlyList<SpecVersionRecord> LoadMetricsInputs() => _inner.LoadMetricsInputs();
    }

    [Fact]
    public void InstanceState_IsSavedOnlyWhenItChanges()
    {
        var (store, repo, instance) = DurableRuntime();
        int saves = repo.InstanceSaves;

        store.UpdateInstanceState(instance.InstanceId, "RUNNING", "IDLE");        // igual que antes
        Assert.Equal(saves, repo.InstanceSaves);

        store.UpdateInstanceState(instance.InstanceId, "RUNNING", "PAUSED");
        Assert.Equal(saves + 1, repo.InstanceSaves);
        Assert.Equal("PAUSED", repo.Instances[instance.InstanceId].SchedulerState);
    }

    [Fact]
    public void Deploy_SameVersionAgain_ReturnsTheRunningInstance_AndOtherVersionRunsAlongside()
    {
        var (store, repo, instance) = DurableRuntime();

        var again = Deploy(store, instance with { InstanceId = Guid.NewGuid().ToString(), DeploymentId = Guid.NewGuid().ToString() });
        Assert.Equal(DeployResult.KindExisting, again.Kind);
        Assert.Equal(instance.InstanceId, again.Instance.InstanceId);

        // P1-07: otra versión es otra instancia RUNNING, al lado de la primera.
        var other = Deploy(store, instance with { InstanceId = Guid.NewGuid().ToString(), DeploymentId = Guid.NewGuid().ToString(), VersionHash = "sha256:otra" });
        Assert.Equal(DeployResult.KindCreated, other.Kind);

        Assert.Equal(new[] { instance.InstanceId, other.Instance.InstanceId }, store.RunningInstances().Select(i => i.InstanceId));
        Assert.Equal(2, repo.Instances.Count);
        Assert.Equal(2, repo.Deployments.Count);
    }

    [Fact]
    public async Task Deploy_Concurrent_CreatesOneInstance()
    {
        var files = FileSpecs();
        var store = FreshStore(files);
        var repo = new FakeRepository();
        ShadowRuntimeRecovery.Recover(store, repo, files);
        var spec = files.Values.Single().Spec!;

        var results = await Task.WhenAll(Enumerable.Range(0, 16).Select(_ => Task.Run(() =>
            Deploy(store, InstanceOf(spec, Guid.NewGuid().ToString()) with { DeploymentId = Guid.NewGuid().ToString() }))));

        Assert.Single(results, r => r.Kind == DeployResult.KindCreated);
        Assert.Single(results.Select(r => r.Instance.InstanceId).Distinct());
        Assert.Single(store.AllInstances());
        Assert.Single(repo.Deployments);
    }

    [Fact]
    public void ActiveInstance_IsTheOldestRunning_Deterministically()
    {
        var store = new ShadowRuntimeStore();
        var spec = SpecFile().Spec!;
        var newer = InstanceOf(spec, "b") with { CreatedAt = Now.AddMinutes(5) };
        var older = InstanceOf(spec, "z") with { CreatedAt = Now };
        store.SetInstance(newer.InstanceId, newer);
        store.SetInstance(older.InstanceId, older);
        Assert.Equal("z", store.RunningInstances().FirstOrDefault()?.InstanceId);
    }

    // ── AC-04: recuperación ────────────────────────────────────────

    /// <summary>Reinicio: un store nuevo, con la misma base.</summary>
    private static (ShadowRuntimeStore Store, ShadowRecoveryReport Report) Restart(FakeRepository repo, Dictionary<string, SpecLoadResult>? files = null)
    {
        files ??= FileSpecs();
        var store = FreshStore(files);
        var report = ShadowRuntimeRecovery.Recover(store, repo, files);
        return (store, report);
    }

    [Fact]
    public async Task AfterRestart_RecordsAreBack_AndOpenPositionKeepsBeingValued()
    {
        var (store, repo, instance) = DurableRuntime();
        var data = new FakeData { Build = () => CandidateBuildResult.Built(CandidateFor(instance)) };
        await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, store.SpecFor(instance)!, "SPY", Now, default);
        var opened = store.AllPositions().Single();

        var (after, report) = Restart(repo);

        Assert.True(after.IsDurable);
        Assert.Equal(1, report.OpenPositions);
        Assert.Empty(report.Problems);
        Assert.Equal(opened, after.GetPosition(opened.PositionId));
        Assert.Equal(store.GetEvaluations(instance.InstanceId).Count, after.GetEvaluations(instance.InstanceId).Count);
        Assert.Equal(store.GetEvents(instance.InstanceId).Count, after.GetEvents(instance.InstanceId).Count);
        Assert.Equal("RUNNING", after.RunningInstances().FirstOrDefault()?.LifecycleState);

        // El monitor retoma la posición con precios reales y la valuación queda guardada.
        data.Quotes[".SPY261030P720"] = new LegQuote(1.20, 1.30, Now);
        data.Quotes[".SPY261030P715"] = new LegQuote(0.60, 0.70, Now);
        var outcomes = await ShadowRuntimeTick.RunMonitorTickAsync(after, data, Now, default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, outcomes[opened.PositionId]);
        Assert.Equal(25.0, repo.Positions[opened.PositionId].UnrealizedPnl);
        Assert.Single(after.AllPositions());
        Assert.Single(repo.Positions);
    }

    [Fact]
    public async Task AfterRestart_MaxPositionsCountsTheRecoveredOnes_NoDuplicateEntry()
    {
        var (store, repo, instance) = DurableRuntime();
        var data = new FakeData { Build = () => CandidateBuildResult.Built(CandidateFor(instance)) };
        await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, store.SpecFor(instance)!, "SPY", Now, default);
        var (after, _) = Restart(repo);
        var spec = after.SpecFor(instance)!;
        int max = spec.RiskLimits.MaxConcurrentPositions!.Value;

        for (int i = 0; i < max + 2; i++)
        {
            var fresh = new FakeData { Build = () => CandidateBuildResult.Built(CandidateFor(instance) with { CandidateId = Guid.NewGuid().ToString() }) };
            await ShadowRuntimeTick.RunEntryTickAsync(after, fresh, () => true, Now, default);
        }

        Assert.Equal(max, after.OpenPositionCount(instance.InstanceId));
        Assert.Equal(max, repo.Positions.Values.Count(p => p.Status == "OPEN"));
    }

    [Fact]
    public async Task AfterRestart_SpacingCountsTheRecoveredEntry()
    {
        var (store, repo, instance) = DurableRuntime();
        var data = new FakeData { Build = () => CandidateBuildResult.Built(CandidateFor(instance)) };
        var spec = store.SpecFor(instance)!;
        var spaced = spec with { RiskLimits = spec.RiskLimits with { MaxConcurrentPositions = 10, MinMinutesBetweenEntries = 1440 } };
        await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, spaced, "SPY", Now, default);
        var (after, _) = Restart(repo);

        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(after, data, instance, spaced, "SPY", Now.AddHours(3), default);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.TooSoon, outcome);
        Assert.Single(repo.Positions);
    }

    [Fact]
    public void RecoveringTwice_DuplicatesNothing()
    {
        var (store, repo, instance) = DurableRuntime();
        var files = FileSpecs();

        ShadowRuntimeRecovery.Recover(store, repo, files);
        ShadowRuntimeRecovery.Recover(store, repo, files);

        Assert.Single(store.AllInstances());
        Assert.Single(store.GetEvents(instance.InstanceId));   // INSTANCE_CREATED, una vez
        Assert.Single(repo.Specs);
    }

    [Fact]
    public async Task AfterRestart_WithAChangedSpecFile_TheInstanceKeepsRunningItsOwnVersion()
    {
        var (_, repo, instance) = DurableRuntime();
        // El archivo cambió: hoy dice otra cosa y tiene otro hash.
        var changedJson = SpecFile().Json!.Replace("\"max_concurrent_positions\": 1", "\"max_concurrent_positions\": 2");
        Assert.NotEqual(SpecFile().Json, changedJson);
        var changed = StrategySpecLoader.LoadFromJson(changedJson);
        Assert.True(changed.Success);
        var files = new Dictionary<string, SpecLoadResult> { ["shadow_runtime_test_v1"] = changed };

        var (after, report) = Restart(repo, files);

        Assert.Equal(new List<string> { instance.VersionHash }, report.SpecsRebuilt);
        Assert.Equal(instance.VersionHash, after.SpecFor(instance)?.ContentHash);
        Assert.Equal(changed.ContentHash, after.GetSpec("shadow_runtime_test_v1")?.ContentHash);   // la vigente no cambia

        var outcomes = await ShadowRuntimeTick.RunEntryTickAsync(after, new FakeData(), () => true, Now, default);
        Assert.True(outcomes.ContainsKey($"{instance.InstanceId}:SPY"));
    }

    [Fact]
    public async Task AfterRestart_WithAnUnrecoverableSpec_TheInstanceDoesNotEvaluate()
    {
        var (_, repo, instance) = DurableRuntime();
        repo.Specs[instance.VersionHash] = SpecFile().Json!.Replace("SPY", "QQQ");   // hash distinto del guardado
        var files = new Dictionary<string, SpecLoadResult>();                         // y ya no está en archivo

        var (after, report) = Restart(repo, files);

        Assert.Single(report.Problems);
        Assert.Contains("otro hash", report.Problems[0]);
        var outcomes = await ShadowRuntimeTick.RunEntryTickAsync(after, new FakeData(), () => true, Now, default);
        Assert.Empty(outcomes);
        Assert.Equal(ShadowRuntimeTick.SchedulerStates.SpecNotFound, after.GetInstance(instance.InstanceId)!.SchedulerState);
    }

    [Fact]
    public void RecoveryFails_StoreIsUntouched_AndNotDurable()
    {
        var (_, repo, instance) = DurableRuntime();
        repo.FailOnSpecJson = true;
        var store = new ShadowRuntimeStore();     // sin specs de archivo: la instancia necesita GetSpecJson

        Assert.Throws<InvalidOperationException>(() => ShadowRuntimeRecovery.Recover(store, repo, new Dictionary<string, SpecLoadResult>()));

        Assert.False(store.IsDurable);
        Assert.Empty(store.AllInstances());
        Assert.Null(store.RunningInstances().FirstOrDefault());
        Assert.Contains(instance.InstanceId, repo.Instances.Keys);
    }

    // ── Parar una instancia (para desplegar otra versión) ──────────

    private static StopResult Stop(ShadowRuntimeStore store, string instanceId) => store.Stop(instanceId,
        new OperationalEvent { EventId = Guid.NewGuid().ToString(), InstanceId = instanceId, EventType = "INSTANCE_STOPPED", Timestamp = Now });

    [Fact]
    public void Stop_IsSaved_AndFreesTheSlotForAnotherVersion()
    {
        var (store, repo, instance) = DurableRuntime();

        var result = Stop(store, instance.InstanceId);

        Assert.Equal(StopResult.KindStopped, result.Kind);
        Assert.Equal("STOPPED", repo.Instances[instance.InstanceId].LifecycleState);
        Assert.Equal("STOPPED", store.GetInstance(instance.InstanceId)!.LifecycleState);
        Assert.Single(repo.Events, e => e.EventType == "INSTANCE_STOPPED");
        Assert.Null(store.RunningInstances().FirstOrDefault());
        var other = instance with { InstanceId = "33333333-3333-3333-3333-333333333333", VersionHash = "sha256:otra-version" };
        Assert.Equal(DeployResult.KindCreated, Deploy(store, other).Kind);
        Assert.Equal(other.InstanceId, store.RunningInstances().FirstOrDefault()!.InstanceId);
    }

    [Fact]
    public void Stop_Twice_DoesNothingTheSecondTime()
    {
        var (store, repo, instance) = DurableRuntime();
        Stop(store, instance.InstanceId);
        int saves = repo.InstanceSaves;

        var again = Stop(store, instance.InstanceId);

        Assert.Equal(StopResult.KindAlreadyStopped, again.Kind);
        Assert.Equal(saves, repo.InstanceSaves);
        Assert.Single(repo.Events, e => e.EventType == "INSTANCE_STOPPED");
        Assert.Equal(StopResult.KindNotFound, Stop(store, "no-existe").Kind);
    }

    [Fact]
    public void Stop_DatabaseDown_InstanceKeepsRunning()
    {
        var (store, repo, instance) = DurableRuntime();
        repo.Fail = true;

        Assert.Throws<InvalidOperationException>(() => Stop(store, instance.InstanceId));

        Assert.Equal("RUNNING", store.GetInstance(instance.InstanceId)!.LifecycleState);
        Assert.Equal(instance.InstanceId, store.RunningInstances().FirstOrDefault()!.InstanceId);
    }

    [Fact]
    public void ATickThatStartedBeforeTheStop_DoesNotBringTheInstanceBack()
    {
        var (store, repo, instance) = DurableRuntime();
        Stop(store, instance.InstanceId);

        store.UpdateInstanceState(instance.InstanceId, "RUNNING", ShadowRuntimeTick.SchedulerStates.Idle);

        Assert.Equal("STOPPED", store.GetInstance(instance.InstanceId)!.LifecycleState);
        Assert.Equal("STOPPED", repo.Instances[instance.InstanceId].LifecycleState);
        Assert.Null(store.RunningInstances().FirstOrDefault());
    }

    [Fact]
    public async Task InstanceStoppedDuringTheEntry_NoPositionIsOpened()
    {
        var (store, repo, instance) = DurableRuntime();
        var data = new FakeData { Build = () => CandidateBuildResult.Built(CandidateFor(instance)) };
        // Se para justo al registrar la posición (canOpen corre dentro del mismo lock que Stop).
        bool canOpen() { Stop(store, instance.InstanceId); return true; }

        var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(
            store, data, instance, store.SpecFor(instance)!, "SPY", Now, default, canOpen: canOpen);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Paused, outcome);
        Assert.Empty(store.AllPositions());
        Assert.Empty(repo.Positions);
        Assert.Contains(repo.Events, e => e.EventType == "ENTRY_ABORTED");
    }

    [Fact]
    public void StoppedInstance_StaysStoppedAfterRestart()
    {
        var (store, repo, instance) = DurableRuntime();
        Stop(store, instance.InstanceId);

        var restarted = new ShadowRuntimeStore();
        ShadowRuntimeRecovery.Recover(restarted, repo, FileSpecs());

        Assert.Equal("STOPPED", restarted.GetInstance(instance.InstanceId)!.LifecycleState);
        Assert.Null(restarted.RunningInstances().FirstOrDefault());
        Assert.Contains(restarted.GetEvents(instance.InstanceId), e => e.EventType == "INSTANCE_STOPPED");
    }
}
