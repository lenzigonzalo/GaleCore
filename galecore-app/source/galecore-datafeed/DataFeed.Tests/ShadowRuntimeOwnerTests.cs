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
        Assert.False(owner.Allows(null));
        Assert.Equal(me.ToString(), ShadowRuntimeOwner.DeployedByOf(me));
    }

    [Fact]
    public void EmptyGuid_IsTreatedAsNoOwner() => Assert.False(new ShadowRuntimeOwner(Guid.Empty).IsScoped);
}
