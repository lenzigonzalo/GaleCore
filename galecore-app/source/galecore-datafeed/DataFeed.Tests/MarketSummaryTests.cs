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

    private static long Ms(int y, int m, int d, int h = 0, int min = 0) => new DateTimeOffset(y, m, d, h, min, 0, TimeSpan.Zero).ToUnixTimeMilliseconds();
    // Viernes 20/11/2026, ET en UTC-5: 16:00 ET = 21:00 UTC.
    private static readonly Day[] Dias = { new(Ms(2026, 11, 19), 690, 692, 685, 1e6), new(Ms(2026, 11, 20), 689.81, 695, 688, 2e6) };

    [Fact]
    public void Afterhours_con_vela_posterior_al_cierre_da_el_extendido_contra_el_cierre()
    {
        var ext = new[] { new Day(Ms(2026, 11, 20, 20, 55), 689.9, 690, 689, 100), new Day(Ms(2026, 11, 20, 22, 0), 697.13, 697.2, 697, 500) };
        var r = MarketSummaryMath.Build("SPY", Dias, ext, new DateTimeOffset(2026, 11, 20, 22, 30, 0, TimeSpan.Zero));
        Assert.False(r.SessionOpen);
        Assert.Equal(697.13, r.ExtendedLast);
        Assert.Equal(7.32, r.ExtendedChange);
        Assert.Equal(1.06, r.ExtendedChangePct);
        Assert.Equal("afterhours", r.ExtendedSession);
        Assert.Equal(DateTimeOffset.FromUnixTimeMilliseconds(Ms(2026, 11, 20, 22, 0)), r.ExtendedAt);
        Assert.Equal(689.81, r.Last);
    }

    [Fact]
    public void Premarket_del_dia_siguiente_se_marca_premarket()
    {
        var ext = new[] { new Day(Ms(2026, 11, 23, 12, 0), 691, 691, 690, 50) };
        var r = MarketSummaryMath.Build("SPY", Dias, ext, new DateTimeOffset(2026, 11, 23, 13, 0, 0, TimeSpan.Zero));
        Assert.Equal("premarket", r.ExtendedSession);
        Assert.Equal(0.17, r.ExtendedChangePct);
    }

    [Fact]
    public void Con_la_sesion_abierta_no_hay_extendido()
    {
        var dias = new[] { Dias[0], new Day(Ms(2026, 11, 20), 693, 695, 688, 2e6) };
        var ext = new[] { new Day(Ms(2026, 11, 20, 18, 0), 693, 693, 693, 10) };
        var r = MarketSummaryMath.Build("SPY", dias, ext, new DateTimeOffset(2026, 11, 20, 18, 5, 0, TimeSpan.Zero));
        Assert.True(r.SessionOpen);
        Assert.Null(r.ExtendedLast);
        Assert.Null(r.ExtendedSession);
    }

    [Fact]
    public void Sin_velas_de_5m_posteriores_al_cierre_el_extendido_es_nulo()
    {
        var ext = new[] { new Day(Ms(2026, 11, 20, 20, 0), 689.5, 690, 689, 100) };
        var now = new DateTimeOffset(2026, 11, 20, 22, 30, 0, TimeSpan.Zero);
        var r = MarketSummaryMath.Build("SPY", Dias, ext, now);
        Assert.False(r.SessionOpen);
        Assert.Null(r.ExtendedLast);
        Assert.Null(r.ExtendedChangePct);
        Assert.Null(MarketSummaryMath.Build("SPY", Dias, null, now).ExtendedLast);
    }

    [Fact]
    public void Feriado_y_fin_de_semana_no_son_sesion_abierta()
    {
        // Sábado 21/11 en horario; y lunes 23/11 en horario pero la última vela diaria es del viernes (feriado).
        Assert.False(MarketSummaryMath.Build("SPY", Dias, null, new DateTimeOffset(2026, 11, 21, 15, 0, 0, TimeSpan.Zero)).SessionOpen);
        Assert.False(MarketSummaryMath.Build("SPY", Dias, null, new DateTimeOffset(2026, 11, 23, 15, 0, 0, TimeSpan.Zero)).SessionOpen);
    }

    [Fact]
    public void Medio_dia_cierra_a_las_13_y_lo_posterior_es_fuera_de_hora()
    {
        // Viernes 27/11/2026, después de Acción de Gracias: NYSE cierra a las 13:00 ET (18:00 UTC).
        var dias = new[] { new Day(Ms(2026, 11, 25), 700, 702, 698, 1e6), new Day(Ms(2026, 11, 27), 705, 706, 701, 1e6) };
        var ext = new[] { new Day(Ms(2026, 11, 27, 18, 30), 706.5, 707, 706, 300) };
        var r = MarketSummaryMath.Build("SPY", dias, ext, new DateTimeOffset(2026, 11, 27, 19, 0, 0, TimeSpan.Zero));
        Assert.False(r.SessionOpen);
        Assert.Equal(706.5, r.ExtendedLast);
        Assert.Equal("afterhours", r.ExtendedSession);
        Assert.True(MarketSummaryMath.Build("SPY", dias, ext, new DateTimeOffset(2026, 11, 27, 17, 0, 0, TimeSpan.Zero)).SessionOpen);
    }
}
