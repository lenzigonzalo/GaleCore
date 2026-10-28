using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Repositories;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using static DataFeed.Tests.ShadowRuntimeEngineTests;

namespace DataFeed.Tests;

/// <summary>
/// Corre sólo con una base PostgreSQL de prueba en GALECORE_TEST_DB (la pone
/// `python dev/galecore_dev.py test`, en el proyecto de desarrollo). Sin ella, o si la base no se
/// llama *_test (cada test vacía las tablas del runtime: nunca contra la base de desarrollo ni la de
/// producción), queda Skipped con el motivo: nunca pasa en falso ni toca otra base.
/// </summary>
public sealed class PostgresFactAttribute : FactAttribute
{
    public PostgresFactAttribute()
    {
        var cs = Environment.GetEnvironmentVariable("GALECORE_TEST_DB");
        if (string.IsNullOrWhiteSpace(cs)) Skip = "sin base de prueba (GALECORE_TEST_DB)";
        else if (!(new NpgsqlConnectionStringBuilder(cs).Database ?? "").EndsWith("_test", StringComparison.Ordinal))
            Skip = "GALECORE_TEST_DB no apunta a una base *_test";
    }
}

/// <summary>
/// GC-0004 — el repositorio EF contra PostgreSQL real: la migración aplica, lo guardado vuelve igual,
/// guardar dos veces no duplica y el runtime retoma después de un "reinicio" (store nuevo, misma base).
/// Cada test empieza con las tablas del runtime vacías en la base de prueba (no la de desarrollo).
/// </summary>
[Collection("PostgresTestDb")]
public class EfShadowRuntimeRepositoryTests
{
    private static readonly string? ConnectionString = Environment.GetEnvironmentVariable("GALECORE_TEST_DB");
    private static readonly object MigrateLock = new();
    private static bool _migrated;

    private static DbContextOptions<GaleCoreDbContext> Options() => new DbContextOptionsBuilder<GaleCoreDbContext>()
        .UseNpgsql(ConnectionString).UseSnakeCaseNamingConvention().Options;

    private static EfShadowRuntimeRepository FreshRepository()
    {
        var options = Options();
        lock (MigrateLock)
        {
            if (!_migrated)
            {
                EnsureDatabase();
                using var db = new GaleCoreDbContext(options);
                db.Database.Migrate();
                _migrated = true;
            }
        }
        using (var db = new GaleCoreDbContext(options))
            db.Database.ExecuteSqlRaw("TRUNCATE strategy_specs, strategy_deployments, strategy_instances, shadow_positions, evaluation_logs, operational_events CASCADE");
        return new EfShadowRuntimeRepository(() => new GaleCoreDbContext(options));
    }

    private static void EnsureDatabase()
    {
        var target = new NpgsqlConnectionStringBuilder(ConnectionString);
        var admin = new NpgsqlConnectionStringBuilder(ConnectionString) { Database = "postgres" };
        using var conn = new NpgsqlConnection(admin.ConnectionString);
        conn.Open();
        using var exists = new NpgsqlCommand("SELECT 1 FROM pg_database WHERE datname = @n", conn);
        exists.Parameters.AddWithValue("n", target.Database!);
        if (exists.ExecuteScalar() == null)
            new NpgsqlCommand($"CREATE DATABASE \"{target.Database}\"", conn).ExecuteNonQuery();
    }

    private static SpecLoadResult SpecFile(string name = "shadow_runtime_test_v1")
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "DataFeed.Api", "Files", "Runtime")))
            dir = dir.Parent;
        return StrategySpecLoader.LoadFromFile(Path.Combine(dir!.FullName, "DataFeed.Api", "Files", "Runtime", name + ".json"));
    }

    private static Dictionary<string, SpecLoadResult> FileSpecs() => new() { ["shadow_runtime_test_v1"] = SpecFile() };

    private static ShadowRuntimeStore Boot(IShadowRuntimeRepository repo, out ShadowRecoveryReport report)
    {
        var files = FileSpecs();
        var store = new ShadowRuntimeStore();
        foreach (var (name, r) in files) store.RegisterSpec(name, r.Spec!);
        report = ShadowRuntimeRecovery.Recover(store, repo, files);
        return store;
    }

    private static StrategyInstance Deploy(ShadowRuntimeStore store)
    {
        var spec = store.GetSpec("shadow_runtime_test_v1")!;
        var instance = new StrategyInstance
        {
            InstanceId = Guid.NewGuid().ToString(), DeploymentId = Guid.NewGuid().ToString(), VersionHash = spec.ContentHash!,
            SpecName = "shadow_runtime_test_v1", LifecycleState = "RUNNING", SchedulerState = "IDLE", Mode = "SHADOW",
            CreatedAt = Now, UpdatedAt = Now,
        };
        _ = store.DeployOrGetRunning(
            new StrategyDeployment { DeploymentId = instance.DeploymentId, VersionHash = instance.VersionHash, DeployedAt = Now },
            instance,
            new OperationalEvent { EventId = Guid.NewGuid().ToString(), InstanceId = instance.InstanceId, EventType = "INSTANCE_CREATED", Timestamp = Now,
                Payload = new() { ["spec_name"] = "shadow_runtime_test_v1", ["version_hash"] = instance.VersionHash } });
        return instance;
    }

    [PostgresFact]
    public async Task SavedRecords_ComeBackAfterRestart_AndTheOpenPositionKeepsBeingValued()
    {
        var repo = FreshRepository();
        var store = Boot(repo, out _);
        var instance = Deploy(store);
        var data = new FakeData { Build = () => CandidateBuildResult.Built(RealCandidate() with { InstanceId = instance.InstanceId }) };
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened,
            await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, store.SpecFor(instance)!, "SPY", Now, default));
        var opened = store.AllPositions().Single();

        // Reinicio: store nuevo, repositorio nuevo, misma base.
        var after = Boot(new EfShadowRuntimeRepository(() => new GaleCoreDbContext(Options())), out var report);

        Assert.Equal(1, report.Instances);
        Assert.Equal(1, report.OpenPositions);
        Assert.Empty(report.Problems);
        var recovered = after.GetPosition(opened.PositionId)!;
        Assert.Equal(opened.EntryCredit, recovered.EntryCredit);
        Assert.Equal(opened.EntryAt, recovered.EntryAt);
        Assert.NotNull(recovered.EntryContext);
        Assert.Equal(opened.EntryContext!.Gates.Select(g => g.Value), recovered.EntryContext!.Gates.Select(g => g.Value));
        Assert.Equal(opened.EntryContext.Legs.Select(l => (l.Bid, l.Ask)), recovered.EntryContext.Legs.Select(l => (l.Bid, l.Ask)));
        Assert.Equal(opened.Legs.Select(l => l.StreamerSymbol), recovered.Legs.Select(l => l.StreamerSymbol));
        Assert.Equal(store.GetEvaluations(instance.InstanceId).Single().GateResults.Count,
                     after.GetEvaluations(instance.InstanceId).Single().GateResults.Count);
        Assert.Equal(store.GetEvents(instance.InstanceId).Select(e => e.EventType), after.GetEvents(instance.InstanceId).Select(e => e.EventType));
        Assert.Equal(instance.InstanceId, after.RunningInstances().FirstOrDefault()?.InstanceId);

        data.Quotes[".SPY261030P720"] = new LegQuote(1.20, 1.30, Now);
        data.Quotes[".SPY261030P715"] = new LegQuote(0.60, 0.70, Now);
        var outcomes = await ShadowRuntimeTick.RunMonitorTickAsync(after, data, Now, default);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, outcomes[opened.PositionId]);

        var third = Boot(new EfShadowRuntimeRepository(() => new GaleCoreDbContext(Options())), out _);
        // Valuación al natural (WS-0062 inc. 2, por defecto sin bloque execution): recompra 720 a 1,30 y vende 715 a 0,60.
        Assert.Equal(15.0, third.GetPosition(opened.PositionId)!.UnrealizedPnl);
        Assert.Single(third.AllPositions());
    }

    [PostgresFact]
    public async Task AfterRestart_TheEntrySavedInPostgres_CountsForSpacing()
    {
        // GC-0005: la hora de entrada vuelve de la base (UTC, precisión de microsegundos) y el espaciado la usa.
        var repo = FreshRepository();
        var store = Boot(repo, out _);
        var instance = Deploy(store);
        var data = new FakeData { Build = () => CandidateBuildResult.Built(RealCandidate() with { InstanceId = instance.InstanceId }) };
        var spec = store.SpecFor(instance)!;
        var spaced = spec with { RiskLimits = spec.RiskLimits with { MaxConcurrentPositions = 10, MinMinutesBetweenEntries = 1440 } };
        await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, spaced, "SPY", Now, default);

        var after = Boot(new EfShadowRuntimeRepository(() => new GaleCoreDbContext(Options())), out _);

        Assert.Equal(DateTimeKind.Utc, after.LastEntryAt(instance.InstanceId)!.Value.Kind);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.TooSoon,
            await ShadowRuntimeEngine.EvaluateEntryAsync(after, data, instance, spaced, "SPY", Now.AddMinutes(1439), default));
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened,
            await ShadowRuntimeEngine.EvaluateEntryAsync(after, data, instance, spaced, "SPY", Now.AddMinutes(1440), default));
    }

    [PostgresFact]
    public async Task OpenedPosition_AndItsEvent_AreOneTransaction()
    {
        var repo = FreshRepository();
        var store = Boot(repo, out _);
        var instance = Deploy(store);
        var data = new FakeData { Build = () => CandidateBuildResult.Built(RealCandidate() with { InstanceId = instance.InstanceId }) };
        await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, store.SpecFor(instance)!, "SPY", Now, default);

        using var db = new GaleCoreDbContext(Options());
        Assert.Equal(1, db.ShadowPositions.Count());
        Assert.Equal(1, db.OperationalEvents.Count(e => e.EventType == "POSITION_OPENED"));
    }

    [PostgresFact]
    public void TwoProcesses_CannotBothRunTheSameVersion()
    {
        var repo = FreshRepository();
        var first = Boot(repo, out _);
        Deploy(first);
        // Otro proceso con su propio store (no comparte el lock en memoria): la base lo frena.
        var second = Boot(new EfShadowRuntimeRepository(() => new GaleCoreDbContext(Options())), out _);
        second.UpdateInstanceState(second.RunningInstances().FirstOrDefault()!.InstanceId, "STOPPED");   // simula un store que no la ve
        var spec = second.GetSpec("shadow_runtime_test_v1")!;
        var other = new StrategyInstance
        {
            InstanceId = Guid.NewGuid().ToString(), DeploymentId = Guid.NewGuid().ToString(), VersionHash = spec.ContentHash!,
            SpecName = "shadow_runtime_test_v1", LifecycleState = "RUNNING", SchedulerState = "IDLE", Mode = "SHADOW",
            CreatedAt = Now, UpdatedAt = Now,
        };
        using (var db = new GaleCoreDbContext(Options()))
        {
            db.Database.ExecuteSqlRaw("UPDATE strategy_instances SET lifecycle_state = 'RUNNING'");   // la del primero sigue RUNNING
        }

        var result = second.DeployOrGetRunning(
            new StrategyDeployment { DeploymentId = other.DeploymentId, VersionHash = other.VersionHash, DeployedAt = Now },
            other,
            new OperationalEvent { EventId = Guid.NewGuid().ToString(), InstanceId = other.InstanceId, EventType = "INSTANCE_CREATED", Timestamp = Now });

        // Devuelve la instancia del primero y no deja nada del intento perdido (ni deployment ni evento).
        Assert.Equal(DeployResult.KindExisting, result.Kind);
        Assert.NotEqual(other.InstanceId, result.Instance!.InstanceId);
        using var check = new GaleCoreDbContext(Options());
        Assert.Equal(1, check.StrategyInstances.Count(i => i.LifecycleState == "RUNNING"));
        Assert.False(check.StrategyDeployments.Any(d => d.Id == Guid.Parse(other.DeploymentId)));
        Assert.False(check.OperationalEvents.Any(e => e.InstanceId == Guid.Parse(other.InstanceId)));
    }

    private static StrategyInstance DeployAs(ShadowRuntimeStore store, Guid user, string specName)
    {
        var spec = store.GetSpec(specName)!;
        var instance = new StrategyInstance
        {
            InstanceId = Guid.NewGuid().ToString(), DeploymentId = Guid.NewGuid().ToString(), VersionHash = spec.ContentHash!,
            SpecName = specName, LifecycleState = "RUNNING", SchedulerState = "IDLE", Mode = "SHADOW", CreatedAt = Now, UpdatedAt = Now,
        };
        _ = store.DeployOrGetRunning(
            new StrategyDeployment { DeploymentId = instance.DeploymentId, VersionHash = instance.VersionHash, DeployedAt = Now, DeployedBy = user.ToString() },
            instance,
            new OperationalEvent { EventId = Guid.NewGuid().ToString(), InstanceId = instance.InstanceId, EventType = "INSTANCE_CREATED", Timestamp = Now,
                Payload = new() { ["spec_name"] = specName, ["version_hash"] = instance.VersionHash } });
        return instance;
    }

    private static ShadowRuntimeStore BootAs(Guid? owner, out EfShadowRuntimeRepository repo)
    {
        repo = new EfShadowRuntimeRepository(() => new GaleCoreDbContext(Options()), new ShadowRuntimeOwner(owner));
        var files = new Dictionary<string, SpecLoadResult>
        {
            ["shadow_runtime_test_v1"] = SpecFile(), ["shadow_runtime_test_v2"] = SpecFile("shadow_runtime_test_v2"),
        };
        var store = new ShadowRuntimeStore();
        foreach (var (name, r) in files) store.RegisterSpec(name, r.Spec!);
        ShadowRuntimeRecovery.Recover(store, repo, files);
        return store;
    }

    [PostgresFact]
    public void TwoOwners_OneDatabase_EachRecoversOnlyItsOwn_AndNeverWritesTheOthers()
    {
        FreshRepository();
        var ana = Guid.NewGuid();
        var beto = Guid.NewGuid();
        var anaStore = BootAs(ana, out _);
        var a = DeployAs(anaStore, ana, "shadow_runtime_test_v1");
        var betoStore = BootAs(beto, out _);
        Assert.Empty(betoStore.AllInstances());          // no ve la de Ana
        var b = DeployAs(betoStore, beto, "shadow_runtime_test_v2");

        // "Reinicio" de ambas: cada una retoma sólo lo suyo; el runtime sin dueño (producción) ve todo.
        Assert.Equal(new[] { a.InstanceId }, BootAs(ana, out _).AllInstances().Select(i => i.InstanceId));
        Assert.Equal(new[] { b.InstanceId }, BootAs(beto, out _).RunningInstances().Select(i => i.InstanceId));
        Assert.Equal(2, BootAs(null, out _).AllInstances().Count);

        // Parar la suya no toca la del otro.
        var betoAgain = BootAs(beto, out _);
        betoAgain.Stop(b.InstanceId, new OperationalEvent { EventId = Guid.NewGuid().ToString(), InstanceId = b.InstanceId, EventType = "INSTANCE_STOPPED", Timestamp = Now });
        Assert.Equal(StopResult.KindNotFound, betoAgain.Stop(a.InstanceId, new OperationalEvent { EventId = Guid.NewGuid().ToString(), InstanceId = a.InstanceId, EventType = "INSTANCE_STOPPED", Timestamp = Now }).Kind);
        using var check = new GaleCoreDbContext(Options());
        Assert.Equal("RUNNING", check.StrategyInstances.Single(i => i.Id == Guid.Parse(a.InstanceId)).LifecycleState);
        Assert.Equal("STOPPED", check.StrategyInstances.Single(i => i.Id == Guid.Parse(b.InstanceId)).LifecycleState);
    }

    [PostgresFact]
    public void TwoOwners_SameVersion_SecondDeployIsRejected_NotAdopted()
    {
        FreshRepository();
        var ana = Guid.NewGuid();
        var beto = Guid.NewGuid();
        DeployAs(BootAs(ana, out _), ana, "shadow_runtime_test_v1");
        var betoStore = BootAs(beto, out _);

        var ex = Assert.Throws<ShadowRuntimeConflictException>(() => DeployAs(betoStore, beto, "shadow_runtime_test_v1"));
        Assert.Contains("Otra cuenta", ex.Message);
        Assert.Empty(betoStore.AllInstances());           // no adoptó la instancia de Ana
    }

    [PostgresFact]
    public void ScopedMetricsInputs_ListOnlyTheOwnersInstances()
    {
        FreshRepository();
        var ana = Guid.NewGuid();
        var beto = Guid.NewGuid();
        DeployAs(BootAs(ana, out _), ana, "shadow_runtime_test_v1");
        DeployAs(BootAs(beto, out var betoRepo), beto, "shadow_runtime_test_v2");

        Assert.Equal("shadow_runtime_test_v2", Assert.Single(betoRepo.LoadMetricsInputs()).SpecName);
        BootAs(null, out var all);
        Assert.Equal(2, all.LoadMetricsInputs().Count);
    }

    [PostgresFact]
    public void TwoVersions_RunAtTheSameTime_AndBothComeBackAfterRestart()
    {
        var repo = FreshRepository();
        var store = Boot(repo, out _);
        var first = Deploy(store);
        var v2 = SpecFile("shadow_runtime_test_v2");
        repo.SaveSpec(v2.Spec!, v2.Json!);
        var other = first with
        {
            InstanceId = Guid.NewGuid().ToString(), DeploymentId = Guid.NewGuid().ToString(),
            VersionHash = v2.ContentHash!, SpecName = "shadow_runtime_test_v2",
        };

        var deployed = store.DeployOrGetRunning(
            new StrategyDeployment { DeploymentId = other.DeploymentId, VersionHash = other.VersionHash, DeployedAt = Now },
            other,
            new OperationalEvent { EventId = Guid.NewGuid().ToString(), InstanceId = other.InstanceId, EventType = "INSTANCE_CREATED", Timestamp = Now });

        Assert.Equal(DeployResult.KindCreated, deployed.Kind);   // el índice único es por versión (P1-07)
        using (var check = new GaleCoreDbContext(Options()))
            Assert.Equal(2, check.StrategyInstances.Count(i => i.LifecycleState == "RUNNING"));
        var restarted = Boot(new EfShadowRuntimeRepository(() => new GaleCoreDbContext(Options())), out _);
        Assert.Equal(new[] { first.InstanceId, other.InstanceId }.OrderBy(x => x),
            restarted.RunningInstances().Select(i => i.InstanceId).OrderBy(x => x));
    }

    [PostgresFact]
    public void StoppedInstance_LetsAnotherVersionRun_AndStaysStoppedAfterRestart()
    {
        var repo = FreshRepository();
        var store = Boot(repo, out _);
        var first = Deploy(store);

        var stopped = store.Stop(first.InstanceId,
            new OperationalEvent { EventId = Guid.NewGuid().ToString(), InstanceId = first.InstanceId, EventType = "INSTANCE_STOPPED", Timestamp = Now });
        var v2 = SpecFile("shadow_runtime_test_v2");
        repo.SaveSpec(v2.Spec!, v2.Json!);
        var other = first with
        {
            InstanceId = Guid.NewGuid().ToString(), DeploymentId = Guid.NewGuid().ToString(),
            VersionHash = v2.ContentHash, SpecName = "shadow_runtime_test_v2",
        };
        var deployed = store.DeployOrGetRunning(
            new StrategyDeployment { DeploymentId = other.DeploymentId, VersionHash = other.VersionHash, DeployedAt = Now },
            other,
            new OperationalEvent { EventId = Guid.NewGuid().ToString(), InstanceId = other.InstanceId, EventType = "INSTANCE_CREATED", Timestamp = Now });

        Assert.Equal(StopResult.KindStopped, stopped.Kind);
        Assert.Equal(DeployResult.KindCreated, deployed.Kind);   // el índice único sólo cuenta las RUNNING
        var restarted = Boot(new EfShadowRuntimeRepository(() => new GaleCoreDbContext(Options())), out _);
        Assert.Equal("STOPPED", restarted.GetInstance(first.InstanceId)!.LifecycleState);
        Assert.Equal(other.InstanceId, restarted.RunningInstances().FirstOrDefault()!.InstanceId);
        Assert.Contains(restarted.GetEvents(first.InstanceId), e => e.EventType == "INSTANCE_STOPPED");
    }

    [PostgresFact]
    public void SavingTwice_DuplicatesNothing()
    {
        var repo = FreshRepository();
        var store = Boot(repo, out _);
        var instance = Deploy(store);
        var evt = store.GetEvents(instance.InstanceId).Single();
        var spec = SpecFile();

        repo.SaveSpec(spec.Spec!, spec.Json!);
        repo.SaveInstance(store.GetInstance(instance.InstanceId)!);
        repo.AddEvent(evt);
        repo.SaveDeployment(new StrategyDeployment { DeploymentId = instance.DeploymentId, VersionHash = instance.VersionHash, DeployedAt = Now });

        using var db = new GaleCoreDbContext(Options());
        Assert.Equal(1, db.StrategySpecs.Count());
        Assert.Equal(1, db.StrategyDeployments.Count());
        Assert.Equal(1, db.StrategyInstances.Count());
        Assert.Equal(1, db.OperationalEvents.Count());
        Assert.Equal(spec.Json, repo.GetSpecJson(spec.ContentHash!));
    }

    [PostgresFact]
    public async Task MetricsInputs_CountWhatHappened_PerSpecVersion()
    {
        var repo = FreshRepository();
        var store = Boot(repo, out _);
        var instance = Deploy(store);
        var spec = store.SpecFor(instance)!;
        var blocked = new FakeData();
        blocked.Metrics[GexRef] = null;
        await ShadowRuntimeEngine.EvaluateEntryAsync(store, blocked, instance, spec, "SPY", Now, default);
        await ShadowRuntimeEngine.EvaluateEntryAsync(store, new FakeData(), instance, spec, "SPY", Now.AddMinutes(1), default);

        var record = repo.LoadMetricsInputs().Single();
        var m = ShadowMetrics.Compute(record);

        Assert.Equal(instance.VersionHash, m.ContentHash);
        Assert.Equal("shadow_runtime_test_v1", m.SpecName);
        Assert.Equal(2, m.Evaluations);
        Assert.Equal(1, m.EvaluationsPassed);
        Assert.Equal(1, m.Discards["GATES_NOT_PASSED"]);
        Assert.Equal(1, m.Discards["CANDIDATE_NOT_VIABLE"]);
        Assert.Equal(1, m.NoDataBlocks);
        Assert.True(m.NoTrades);
        Assert.Null(m.RealizedPnl);
        Assert.Equal(Now, m.FirstEvaluationAt);

        // WS-0036: con spec, sólo esa (lo usa el panel); otra spec no trae nada.
        Assert.Equal(2, repo.LoadMetricsInputs("shadow_runtime_test_v1").Single().Evaluations);
        Assert.Empty(repo.LoadMetricsInputs("otra_spec"));
    }
}
