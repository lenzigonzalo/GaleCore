using DataFeed.Application.App.Runtime;

namespace DataFeed.Tests;

public class ShadowRuntimeOwnerTests
{
    [Fact]
    public void WithoutOwner_AnyoneCanDeployAndStop_LikeToday()
    {
        var owner = new ShadowRuntimeOwner(null);
        Assert.False(owner.IsScoped);
        Assert.True(owner.Allows(Guid.NewGuid()));
        Assert.True(owner.Allows(null));
    }

    [Fact]
    public void WithOwner_OnlyThatUserCanDeployAndStop()
    {
        var me = Guid.NewGuid();
        var owner = new ShadowRuntimeOwner(me);
        Assert.True(owner.IsScoped);
        Assert.True(owner.Allows(me));
        Assert.False(owner.Allows(Guid.NewGuid()));
        Assert.Equal(me.ToString(), ShadowRuntimeOwner.DeployedByOf(me));
    }

    [Fact]
    public void WithOwner_ApiKeyOnlyRequest_IsAllowedAndAttributedToTheOwner()
    {
        var me = Guid.NewGuid();
        var owner = new ShadowRuntimeOwner(me);
        Assert.True(owner.Allows(null));
        Assert.Equal(me, owner.Attribute(null));
        Assert.Equal(me, owner.Attribute(me));
        Assert.False(owner.Allows(Guid.NewGuid()));   // otro usuario autenticado: 403
        Assert.Null(new ShadowRuntimeOwner(null).Attribute(null));   // sin dueño: como siempre ("SYSTEM")
    }

    [Fact]
    public void EmptyGuid_IsTreatedAsNoOwner() => Assert.False(new ShadowRuntimeOwner(Guid.Empty).IsScoped);

    // ── Sin dueño (producción): desplegar y parar exigen usuario; lecturas no se filtran ──

    [Fact]
    public void WithoutOwner_Deploy_NeedsAnAuthenticatedUser()
    {
        var owner = new ShadowRuntimeOwner(null);
        var denied = owner.CheckDeploy(null);
        Assert.Equal(401, denied!.Status);
        Assert.Equal(ShadowRuntimeOwner.NoUserMessage, denied.Error);
        Assert.Null(owner.CheckDeploy(Guid.NewGuid()));
    }

    [Fact]
    public void WithoutOwner_Stop_NoUser_Is401()
    {
        var owner = new ShadowRuntimeOwner(null);
        Assert.Equal(401, owner.CheckStop(null, "SYSTEM", isAdmin: false)!.Status);
        Assert.Equal(401, owner.CheckStop(null, null, isAdmin: true)!.Status);
    }

    [Fact]
    public void WithoutOwner_Stop_OnlyWhoDeployedOrAdmin()
    {
        var owner = new ShadowRuntimeOwner(null);
        var ana = Guid.NewGuid();
        var beto = Guid.NewGuid();
        Assert.Null(owner.CheckStop(ana, ana.ToString(), isAdmin: false));                 // el dueño de la instancia
        var other = owner.CheckStop(beto, ana.ToString(), isAdmin: false);                 // otro usuario
        Assert.Equal(403, other!.Status);
        Assert.Equal(ShadowRuntimeOwner.NotYoursMessage, other.Error);
        Assert.Null(owner.CheckStop(beto, ana.ToString(), isAdmin: true));                 // admin
        Assert.Equal(403, owner.CheckStop(beto, "SYSTEM", isAdmin: false)!.Status);        // instancia heredada sin dueño: sólo admin
        Assert.Null(owner.CheckStop(beto, null, isAdmin: false));                          // inexistente: no se rechaza acá (404)
    }

    [Fact]
    public void WithOwner_Deploy_AndStop_KeepTodayBehaviour()
    {
        var me = Guid.NewGuid();
        var owner = new ShadowRuntimeOwner(me);
        Assert.Null(owner.CheckDeploy(me));
        Assert.Null(owner.CheckDeploy(null));                                              // ApiKey local: se atribuye al dueño
        Assert.Equal(403, owner.CheckDeploy(Guid.NewGuid())!.Status);
        Assert.Null(owner.CheckStop(me, "lo-que-sea", isAdmin: false));
        Assert.Null(owner.CheckStop(null, me.ToString(), isAdmin: false));
        var other = owner.CheckStop(Guid.NewGuid(), me.ToString(), isAdmin: true);         // ni un admin ajeno: con dueño manda el dueño
        Assert.Equal(403, other!.Status);
        Assert.Equal(ShadowRuntimeOwner.DeniedMessage, other.Error);
    }

    [Fact]
    public void StrategyInstance_DeployedBy_DefaultsToSystem_AndSurvivesWith()
    {
        var i = new DataFeed.Application.App.Runtime.Contracts.StrategyInstance { InstanceId = "x" };
        Assert.Equal("SYSTEM", i.DeployedBy);
        var u = Guid.NewGuid().ToString();
        Assert.Equal(u, (i with { DeployedBy = u } with { LifecycleState = "STOPPED" }).DeployedBy);
    }

    private static (DataFeed.Application.App.Runtime.Contracts.StrategyDeployment, DataFeed.Application.App.Runtime.Contracts.StrategyInstance, DataFeed.Application.App.Runtime.Contracts.OperationalEvent) Deploy(string by, string hash)
    {
        var id = Guid.NewGuid().ToString();
        return (new() { DeploymentId = "d-" + id, VersionHash = hash, DeployedBy = by },
                new() { InstanceId = id, DeploymentId = "d-" + id, VersionHash = hash, SpecName = "s", LifecycleState = "RUNNING", DeployedBy = by },
                new() { EventId = Guid.NewGuid().ToString(), InstanceId = id, EventType = "INSTANCE_CREATED" });
    }

    [Fact]
    public void Store_SameVersion_TwoUsers_TwoInstances_SameUserTwice_Existing()
    {
        var store = new ShadowRuntimeStore();
        var ana = Guid.NewGuid().ToString();
        var beto = Guid.NewGuid().ToString();

        var (d1, i1, e1) = Deploy(ana, "h1");
        var a = store.DeployOrGetRunning(d1, i1, e1);
        var (d2, i2, e2) = Deploy(beto, "h1");
        var b = store.DeployOrGetRunning(d2, i2, e2);
        var (d3, i3, e3) = Deploy(ana, "h1");
        var again = store.DeployOrGetRunning(d3, i3, e3);

        Assert.Equal(DeployResult.KindCreated, a.Kind);
        Assert.Equal(DeployResult.KindCreated, b.Kind);
        Assert.NotEqual(a.Instance!.InstanceId, b.Instance!.InstanceId);
        Assert.Equal(ana, a.Instance.DeployedBy);
        Assert.Equal(beto, b.Instance.DeployedBy);
        Assert.Equal(DeployResult.KindExisting, again.Kind);
        Assert.Equal(a.Instance.InstanceId, again.Instance!.InstanceId);
        Assert.Equal(2, store.RunningInstances().Count);
    }
}
