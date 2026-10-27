using System.Text.Json.Nodes;
using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;
using static DataFeed.Tests.ShadowRuntimePersistenceTests;

namespace DataFeed.Tests;

/// <summary>WS-0062 inc.11: POST /App/Runtime/Specs registra una spec aprobada sin reinicio.</summary>
public class StrategySpecRegistrarTests
{
    private static readonly DateTime Now = new(2026, 10, 26, 15, 0, 0, DateTimeKind.Utc);

    private static string Sandwich() => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "sandwich_spec.json"));

    /// <summary>La misma spec con otro contenido (otra versión): mismo nombre, otro hash.</summary>
    private static string OtherVersion()
    {
        var node = JsonNode.Parse(Sandwich())!;
        node["identity"]!["version"] = "1.0.1";
        return node.ToJsonString();
    }

    private static (ShadowRuntimeStore Store, FakeRepository Repo) Durable()
    {
        var store = new ShadowRuntimeStore();
        var repo = new FakeRepository();
        ShadowRuntimeRecovery.Recover(store, repo, new Dictionary<string, SpecLoadResult>());
        return (store, repo);
    }

    private static SpecRegisterOutcome Register(ShadowRuntimeStore store, string json, bool available = true)
        => StrategySpecRegistrar.Register(store, json, available, available ? null : "apagada");

    private static DeployResult Deploy(ShadowRuntimeStore store, string specName, string hash, string? expectedHash = null)
    {
        var instance = new StrategyInstance
        {
            InstanceId = Guid.NewGuid().ToString(), DeploymentId = Guid.NewGuid().ToString(), VersionHash = hash,
            SpecName = specName, LifecycleState = "RUNNING", SchedulerState = "IDLE", Mode = "SHADOW", CreatedAt = Now, UpdatedAt = Now,
        };
        return store.DeployOrGetRunning(
            new StrategyDeployment { DeploymentId = instance.DeploymentId, VersionHash = hash, SpecName = specName, DeployedAt = Now },
            instance,
            new OperationalEvent { EventId = Guid.NewGuid().ToString(), InstanceId = instance.InstanceId, EventType = "INSTANCE_CREATED", Timestamp = Now },
            expectedHash);
    }

    [Fact]
    public void ValidSpec_IsRegistered_WithTheHashGaleCoreComputes_AndIsDeployable()
    {
        var (store, repo) = Durable();
        var json = Sandwich();

        var r = Register(store, json);

        Assert.Equal(SpecRegisterOutcome.KindRegistered, r.Kind);
        Assert.Equal("sandwich_spx_0dte_fixture", r.Name);
        Assert.Equal(StrategySpecHasher.ComputeHash(json), r.ContentHash);
        Assert.Null(r.ReplacedHash);
        Assert.Equal(r.ContentHash, store.GetSpec(r.Name!)!.ContentHash);
        Assert.Empty(repo.Specs);   // nada en la base hasta desplegar

        var deploy = Deploy(store, r.Name!, r.ContentHash!);

        Assert.Equal(DeployResult.KindCreated, deploy.Kind);
        Assert.Equal(json, repo.Specs[r.ContentHash!]);   // el deploy guarda la spec con el JSON exacto: se reconstruye al reiniciar
        Assert.Single(repo.Deployments);
    }

    [Fact]
    public void Deploy_WithTheExpectedHash_Deploys_AndWithoutItWorksAsBefore()
    {
        var (store, _) = Durable();
        var r = Register(store, Sandwich());

        var deploy = Deploy(store, r.Name!, r.ContentHash!, expectedHash: r.ContentHash);

        Assert.Equal(DeployResult.KindCreated, deploy.Kind);
        // Ya corre esa versión: devuelve la existente, con o sin hash esperado.
        Assert.Equal(DeployResult.KindExisting, Deploy(store, r.Name!, r.ContentHash!, expectedHash: r.ContentHash).Kind);
        Assert.Equal(DeployResult.KindExisting, Deploy(store, r.Name!, r.ContentHash!).Kind);
    }

    [Fact]
    public void Deploy_WhenTheCurrentSpecIsNotTheExpectedHash_Is409_AndCreatesNothing()
    {
        var (store, repo) = Durable();
        var approved = Register(store, Sandwich());
        var newer = Register(store, OtherVersion());   // otra subida entre la aprobación y el Deploy

        var deploy = Deploy(store, approved.Name!, approved.ContentHash!, expectedHash: approved.ContentHash);

        Assert.Equal(DeployResult.KindHashMismatch, deploy.Kind);
        Assert.Equal(newer.ContentHash, deploy.CurrentHash);
        Assert.Empty(store.RunningInstances());
        Assert.Empty(repo.Deployments);
    }

    [Fact]
    public void Deploy_WithAnUnknownExpectedHash_Is409_AndCreatesNothing()
    {
        var (store, repo) = Durable();
        var r = Register(store, Sandwich());

        var deploy = Deploy(store, r.Name!, r.ContentHash!, expectedHash: "sha256:inexistente");

        Assert.Equal(DeployResult.KindHashMismatch, deploy.Kind);
        Assert.Equal(r.ContentHash, deploy.CurrentHash);
        Assert.Empty(store.RunningInstances());
        Assert.Empty(repo.Deployments);
    }

    [Fact]
    public void RegisteredAndDeployedSpec_IsRebuiltAfterRestart()
    {
        var (store, repo) = Durable();
        var r = Register(store, Sandwich());
        Deploy(store, r.Name!, r.ContentHash!);

        var restarted = new ShadowRuntimeStore();
        var report = ShadowRuntimeRecovery.Recover(restarted, repo, new Dictionary<string, SpecLoadResult>());

        Assert.Empty(report.Problems);
        Assert.Equal(new[] { r.ContentHash }, report.SpecsRebuilt);
        Assert.NotNull(restarted.GetSpecByHash(r.ContentHash!));
        Assert.Single(restarted.RunningInstances());
    }

    [Fact]
    public void InvalidSpec_GivesTheSameErrorsAsTheCheck_AndRegistersNothing()
    {
        var (store, _) = Durable();
        var node = JsonNode.Parse(Sandwich())!;
        node["operational"]!["entry_window"]!["days"] = 3;
        var bad = node.ToJsonString();

        var r = Register(store, bad);

        Assert.Equal(SpecRegisterOutcome.KindInvalid, r.Kind);
        Assert.NotEmpty(r.Errors);
        Assert.Equal(StrategySpecChecker.Check(bad).Errors, r.Errors);
        Assert.Empty(store.AllSpecs());
    }

    [Fact]
    public void SameNameAndHash_IsIdempotent()
    {
        var (store, _) = Durable();
        var first = Register(store, Sandwich());

        var again = Register(store, Sandwich());

        Assert.Equal(SpecRegisterOutcome.KindRegistered, again.Kind);
        Assert.Equal(first.ContentHash, again.ContentHash);
        Assert.Null(again.ReplacedHash);
        Assert.Single(store.AllSpecs());
    }

    [Fact]
    public void SameNameOtherHash_WithARunningInstance_IsRejected_AndTheOldOneStays()
    {
        var (store, _) = Durable();
        var old = Register(store, Sandwich());
        Deploy(store, old.Name!, old.ContentHash!);

        var r = Register(store, OtherVersion());

        Assert.Equal(SpecRegisterOutcome.KindConflict, r.Kind);
        Assert.Equal(old.ContentHash, r.RunningHash);
        Assert.NotNull(r.RunningInstanceId);
        Assert.Contains("frena", r.Message);
        Assert.Equal(old.ContentHash, store.GetSpec(old.Name!)!.ContentHash);
    }

    [Fact]
    public void SameNameOtherHash_AfterStoppingTheRunningOne_Replaces()
    {
        var (store, _) = Durable();
        var old = Register(store, Sandwich());
        var running = Deploy(store, old.Name!, old.ContentHash!).Instance!;
        store.Stop(running.InstanceId, new OperationalEvent
        {
            EventId = Guid.NewGuid().ToString(), InstanceId = running.InstanceId, EventType = "INSTANCE_STOPPED", Timestamp = Now,
        });

        var r = Register(store, OtherVersion());

        Assert.Equal(SpecRegisterOutcome.KindRegistered, r.Kind);
        Assert.Equal(old.ContentHash, r.ReplacedHash);
        Assert.NotEqual(old.ContentHash, r.ContentHash);
        Assert.Equal(r.ContentHash, store.GetSpec(r.Name!)!.ContentHash);
        Assert.NotNull(store.GetSpecByHash(old.ContentHash!));   // la versión que corrió sigue resoluble por su hash
    }

    [Fact]
    public void SameNameOtherHash_WithNoInstance_Replaces()
    {
        var (store, _) = Durable();
        var old = Register(store, Sandwich());

        var r = Register(store, OtherVersion());

        Assert.Equal(SpecRegisterOutcome.KindRegistered, r.Kind);
        Assert.Equal(old.ContentHash, r.ReplacedHash);
        Assert.Equal(r.ContentHash, store.GetSpec(r.Name!)!.ContentHash);
    }

    [Fact]
    public void WithoutPersistence_IsRejected_AndRegistersNothing()
    {
        var (store, _) = Durable();

        var unavailable = Register(store, Sandwich(), available: false);
        var notDurable = Register(new ShadowRuntimeStore(), Sandwich());

        Assert.Equal(SpecRegisterOutcome.KindNoPersistence, unavailable.Kind);
        Assert.Equal(SpecRegisterOutcome.KindNoPersistence, notDurable.Kind);
        Assert.Empty(store.AllSpecs());
    }

    [Fact]
    public void ControllerRoute_IsPostRuntimeSpecs_AndMapsEachOutcomeToItsStatus()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "DataFeed.Api", "Controllers", "AppController.cs"))) dir = dir.Parent;
        var src = File.ReadAllText(Path.Combine(dir!.FullName, "DataFeed.Api", "Controllers", "AppController.cs"));
        var at = src.IndexOf("[HttpPost(\"Runtime/Specs\")]", StringComparison.Ordinal);

        Assert.True(at > 0, "falta la ruta POST Runtime/Specs");
        var body = src[at..src.IndexOf("[HttpPost(\"Runtime/Instances/{id}/Stop\")]", at, StringComparison.Ordinal)];
        Assert.Contains("StrategySpecRegistrar.Register(", body);
        Assert.Contains("BadRequest", body);
        Assert.Contains("Conflict(", body);
        Assert.Contains("Status503ServiceUnavailable", body);
    }
}
