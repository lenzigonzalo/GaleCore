using Xunit;

namespace DataFeed.Tests;

/// <summary>Tests que comparten cachés estáticas del runtime (MetricResolver.DailyCandleCache, NoCloseUntil): no corren en paralelo.</summary>
[CollectionDefinition("RuntimeStaticCaches", DisableParallelization = true)]
public class RuntimeStaticCachesCollection { }
