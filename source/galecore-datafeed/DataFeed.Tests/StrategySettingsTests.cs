using DataFeed.Application.App.Runtime;

namespace DataFeed.Tests;

/// <summary>WS-0036 — etapa (SHADOW/PAPER/LIVE) y modo (AUTO/MANUAL) de cada estrategia.</summary>
public class StrategySettingsTests
{
    [Fact]
    public void Defaults_RpfIsLiveManual_RuntimeIsShadowAuto()
    {
        Assert.Equal(("LIVE", "MANUAL"), StrategySettings.Default("rpf"));
        Assert.Equal(("SHADOW", "AUTO"), StrategySettings.Default("spy_prima_varianza_30_45d"));
    }

    [Theory]
    [InlineData("SHADOW", "AUTO", false)]
    [InlineData("SHADOW", "MANUAL", false)]
    [InlineData("PAPER", "AUTO", false)]
    [InlineData("LIVE", "MANUAL", false)]
    [InlineData("LIVE", "AUTO", true)]
    [InlineData("REAL", "AUTO", true)]
    [InlineData("SHADOW", "SEMI", true)]
    public void Problem_BlocksLiveAutoAndUnknownValues(string stage, string mode, bool blocked) =>
        Assert.Equal(blocked, StrategySettings.Problem(stage, mode) != null);

    [Fact]
    public void Resolve_UsesSavedRowsAndDefaults_OncePerName()
    {
        var at = new DateTime(2026, 10, 14, 23, 0, 0, DateTimeKind.Utc);
        var saved = new Dictionary<string, (string, string, string, DateTime)> { ["a"] = ("SHADOW", "MANUAL", "u1", at) };
        var rows = StrategySettings.Resolve(new[] { "rpf", "a", "a", "b" }, saved);

        Assert.Equal(new[] { "a", "b", "rpf" }, rows.Select(r => r.Name));
        Assert.Equal("MANUAL", rows[0].Mode); Assert.False(rows[0].IsDefault); Assert.Equal("u1", rows[0].UpdatedBy);
        Assert.Equal(("SHADOW", "AUTO", true), (rows[1].Stage, rows[1].Mode, rows[1].IsDefault));
        Assert.Equal(("LIVE", "MANUAL"), (rows[2].Stage, rows[2].Mode));
        Assert.All(rows, r => Assert.False(string.IsNullOrEmpty(r.Effect)));
    }
}
