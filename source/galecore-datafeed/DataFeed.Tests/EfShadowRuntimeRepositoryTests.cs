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
        Assert.Equal(25.0, third.GetPosition(opened.PositionId)!.UnrealizedPnl);
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

        Assert.Equal(DeployResult.KindConflict, result.Kind);
        using var check = new GaleCoreDbContext(Options());
        Assert.Equal(1, check.StrategyInstances.Count(i => i.LifecycleState == "RUNNING"));
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
    }
}
