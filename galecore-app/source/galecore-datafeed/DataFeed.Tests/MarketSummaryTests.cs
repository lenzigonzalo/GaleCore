using DataFeed.Application.App.Market;
using Xunit;

namespace DataFeed.Tests;

public class MarketSummaryTests
{
    [Fact]
    public void Ultima_vela_es_hoy_y_la_anterior_da_el_cierre_previo()
    {
        var days = new[] { new Day(1, 760, 765, 755, 1e6), new Day(2, 770, 772, 761, 2e6), new Day(3, 771.74, 775, 764, 5.5e7) };
        var r = MarketSummaryMath.Build("SPY", days);
        Assert.Equal(771.74, r.Last);
        Assert.Equal(770, r.PrevClose);
        Assert.Equal(1.74, r.Change);
        Assert.Equal(0.23, r.ChangePct);
        Assert.Equal(5.5e7, r.Volume);
        Assert.Equal(775, r.High);
    }

    [Fact]
    public void Sin_velas_no_inventa_y_con_una_sola_no_hay_variacion()
    {
        Assert.Null(MarketSummaryMath.Build("SPY", new Day[0]).Last);
        var one = MarketSummaryMath.Build("SPY", new[] { new Day(1, 770, 772, 761, 2e6) });
        Assert.Equal(770, one.Last);
        Assert.Null(one.Change);
    }
}
