using DataFeed.Application.Shared;
using Xunit;

namespace DataFeed.Tests;

public class DailyCacheTests
{
    private class Box { public int N; }

    [Fact]
    public async Task UnaLecturaPorDiaCompartidaEntrePedidosSimultaneos()
    {
        var key = $"test:{Guid.NewGuid()}";
        var reads = 0;
        var gate = new TaskCompletionSource();
        async Task<Box> Read(CancellationToken _) { Interlocked.Increment(ref reads); await gate.Task; return new Box { N = reads }; }
        var first = DailyCache.GetAsync(key, Read, CancellationToken.None);
        var second = DailyCache.GetAsync(key, Read, CancellationToken.None);
        gate.SetResult();
        Assert.Same(await first, await second);
        Assert.Same(await first, await DailyCache.GetAsync(key, Read, CancellationToken.None));
        Assert.Equal(1, reads);
    }

    [Fact]
    public async Task UnaLecturaFallidaNoQuedaGuardada()
    {
        var key = $"test:{Guid.NewGuid()}";
        var fail = true;
        Task<Box> Read(CancellationToken _) => fail ? throw new HttpRequestException("caída") : Task.FromResult(new Box { N = 1 });
        await Assert.ThrowsAsync<HttpRequestException>(() => DailyCache.GetAsync(key, Read, CancellationToken.None));
        fail = false;
        Assert.Equal(1, (await DailyCache.GetAsync(key, Read, CancellationToken.None)).N);
    }

    [Fact]
    public async Task UnPedidoCanceladoNoCortaLaLecturaCompartida()
    {
        var key = $"test:{Guid.NewGuid()}";
        var gate = new TaskCompletionSource();
        async Task<Box> Read(CancellationToken _) { await gate.Task; return new Box { N = 7 }; }
        using var cancel = new CancellationTokenSource();
        var aborted = DailyCache.GetAsync(key, Read, cancel.Token);
        cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => aborted);
        gate.SetResult();
        Assert.Equal(7, (await DailyCache.GetAsync(key, Read, CancellationToken.None)).N);
    }
}
