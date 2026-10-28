using System.Text.RegularExpressions;

namespace DataFeed.Tests;

/// <summary>
/// GC-0002 AC-07 — el runtime SHADOW no depende de GaleCore-AI y no puede mandar órdenes.
/// Se verifica sobre el código fuente del runtime: sólo puede pedir datos de mercado de lectura
/// (cadena, gamma, cotización, velas), no usa HTTP directo y no nombra a GaleCore-AI.
/// </summary>
public class ShadowRuntimeBoundaryTests
{
    private static readonly string[] AllowedRequests =
    {
        "OptionChainsRequest", "GammaExposureRequest", "MarketDataQuoteRequest", "MarketDataTradeRequest",
        "MarketDataCandleRequest",   // velas diarias para ema_spread (WS-0061): lectura de mercado
        "FomcMeetingsRequest", "FredReleaseDatesRequest", "MarketMetricsVolatilityRequest",   // calendario de eventos (WS-0062 inc.5): lectura
    };

    private static IEnumerable<string> RuntimeSources()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "DataFeed.Application", "App", "Runtime")))
            dir = dir.Parent;
        Assert.NotNull(dir);
        var runtime = Directory.GetFiles(Path.Combine(dir!.FullName, "DataFeed.Application", "App", "Runtime"), "*.cs",
            SearchOption.AllDirectories);
        var infra = Directory.GetFiles(Path.Combine(dir.FullName, "DataFeed.Api", "Infrastructure"), "*.cs")
            .Where(f => Path.GetFileName(f).StartsWith("Shadow") || Path.GetFileName(f) == "RuntimeStrategySwitch.cs");
        return runtime.Concat(infra).ToList();
    }

    [Fact]
    public void Runtime_OnlyRequestsReadOnlyMarketData()
    {
        // Cualquier mención a un tipo *Request, no sólo "new XRequest": también "XRequest x = new()" (R1-m5).
        var used = RuntimeSources()
            .SelectMany(f => Regex.Matches(File.ReadAllText(f), @"\b([A-Z]\w*Request)\b").Select(m => m.Groups[1].Value))
            .Distinct().ToList();
        Assert.NotEmpty(used);
        Assert.All(used, r => Assert.Contains(r, AllowedRequests));
    }

    [Theory]
    [InlineData(@"HttpClient")]
    [InlineData(@"galecore[\s_.\-]?ai")]
    [InlineData(@"\w*Order(Request|Command|Client|Service)\b")]
    [InlineData(@"(Place|Submit|Send)Order")]
    public void Runtime_HasNoForbiddenDependency(string pattern)
    {
        foreach (var f in RuntimeSources())
            Assert.False(Regex.IsMatch(File.ReadAllText(f), pattern, RegexOptions.IgnoreCase),
                $"{Path.GetFileName(f)} contiene '{pattern}'");
    }
}
