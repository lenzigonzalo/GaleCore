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
}
