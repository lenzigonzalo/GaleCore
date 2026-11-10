using DataFeed.Application.App.Gex;

namespace DataFeed.Tests;

/// <summary>
/// GET /App/Gex/Scope: el agregado de los vencimientos elegidos usa los mismos helpers que el
/// global; pidiendo todos los vencimientos tiene que coincidir con el global.
/// </summary>
public class GexScopeCalculatorTests
{
    private static GexStrike K(double k, double c, double p) =>
        new() { Strike = k, CallGEX = c, PutGEX = p, NetGEX = c + p, CallDelta = 0.5, PutDelta = -0.5 };

    private static GexAnalysisResponse Analysis()
    {
        var e1 = new GexExpiryScope { Expiration = "2026-11-20", Dte = 11, Strikes = new() { K(95, 0, -5), K(100, 1, -1), K(105, 3, 0), K(110, 1, 0) } };
        var e2 = new GexExpiryScope { Expiration = "2026-12-18", Dte = 39, Strikes = new() { K(90, 0, -9), K(95, 0, -3), K(105, 4, 0), K(115, 2, 0) } };
        return new GexAnalysisResponse
        {
            SpotPrice = 100,
            Gex = new GexPayload { ByExpiry = new() { e1, e2 }, Global = new GexScope { CoveragePct = 100 } },
        };
    }

    [Fact]
    public void DosVencimientos_SumaPorStrikeYEligeMuros()
    {
        var s = GexScopeCalculator.Compute(Analysis(), new[] { "2026-11-20", "2026-12-18" });

        Assert.Equal(2, s.ExpirationsIncluded);
        Assert.Equal(105, s.CallWall);   // 3 + 4 = 7, el mayor CallGEX arriba del spot
        Assert.Equal(90, s.PutWall);     // 90 (-9) le gana a 95 (-5 + -3 = -8)
        Assert.Equal(100, s.GammaZeroLevel);
    }

    [Fact]
    public void UnVencimiento_IgnoraElOtroYLosInexistentes()
    {
        var s = GexScopeCalculator.Compute(Analysis(), new[] { "2026-12-18", "2030-01-01" });

        Assert.Equal(1, s.ExpirationsIncluded);
        Assert.Equal(115, s.Strikes.Max(x => x.Strike));
        Assert.DoesNotContain(s.Strikes, x => x.Strike == 110);
    }

    [Fact]
    public void TodosLosVencimientos_CoincideConElGlobal()
    {
        var a = Analysis();
        var all = a.Gex.ByExpiry.Select(e => e.Expiration).ToList();
        var s = GexScopeCalculator.Compute(a, all);

        // Global calculado a mano con los mismos helpers sobre la suma por strike.
        Assert.Equal(6, s.Strikes.Count);
        Assert.Equal(11.0, s.CallGex);
        Assert.Equal(-18.0, s.PutGex);
        Assert.Equal(all.Count, s.ExpirationsIncluded);
    }
}
