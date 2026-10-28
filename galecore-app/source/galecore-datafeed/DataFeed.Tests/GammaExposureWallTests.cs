using DataFeed.Application.App.GammaExposure;

namespace DataFeed.Tests;

/// <summary>
/// Congela la definición de Call Wall / Put Wall: <b>ranking por lado, guarda por signo del neto</b>.
///
/// Los casos salen de la medición sobre SPY del 2026-08-18 (cadena completa, 17 vencimientos,
/// cobertura 100%, spot 767.85), que comparó las tres definiciones posibles. Las dos mitades de la
/// regla se congelan por separado porque cada una responde a una falla distinta:
/// <list type="bullet">
/// <item><b>El ranking es por lado</b> — es lo que dibuja GexBarsPanel (barras por lado, no netas) y
/// es más estable: rankear por neto bajaba el margen entre el #1 y el #2 del Call Wall global de
/// 23.8% a 6.1%.</item>
/// <item><b>La guarda es por neto</b> — sin ella el Call Wall del 0DTE de ese día salía 770, con OI
/// de puts 6x el de calls y gamma neto −$30B.</item>
/// </list>
/// </summary>
public class GammaExposureWallTests
{
    private static GammaExposureStrike S(double strike, double callGex, double putGex) =>
        new() { Strike = strike, CallGEX = callGex, PutGEX = putGex };

    /// <summary>
    /// El caso real del 0DTE de SPY (2026-08-18), en millones: 770 era el mayor CallGEX arriba del
    /// spot, pero su neto era −30.246 (OI de puts 11.560 vs 1.848 de calls). El muro es 774, el único
    /// strike arriba del spot con neto positivo.
    /// </summary>
    [Fact]
    public void SelectCallWall_IgnoraElStrikeDominadoPorPuts()
    {
        var strikes = new List<GammaExposureStrike>
        {
            S(770, 7_882.4, -38_129.3),   // mayor CallGEX, pero neto -30.246
            S(773, 7_157.1, -10_577.0),   // neto -3.419
            S(774, 6_173.4,  -4_381.2),   // neto +1.792  <- único con neto positivo
            S(775, 4_368.9,  -5_793.5),   // neto -1.424
        };

        Assert.Equal(774, GammaExposureHandler.SelectCallWall(strikes, 767.854));
    }

    /// <summary>
    /// La otra mitad: entre los que pasan la guarda, gana el de mayor CallGEX — NO el de mayor neto.
    /// Congela que la guarda es un filtro y no un cambio de métrica de ranking.
    /// </summary>
    [Fact]
    public void SelectCallWall_RankeaPorLadoNoPorNeto()
    {
        var strikes = new List<GammaExposureStrike>
        {
            S(775, 162_630, -77_330),   // CallGEX mayor, neto  85.300  <- gana
            S(780,  91_744, -11_688),   // CallGEX menor, neto  80.056
            S(785,  65_235,  -3_576),   // neto 61.660
        };

        Assert.Equal(775, GammaExposureHandler.SelectCallWall(strikes, 767.854));
    }

    /// <summary>
    /// El vencimiento sin OI (2026-09-01 en la corrida: 30 strikes, OI total 0). Todo en cero no es
    /// un muro: antes de la guarda, el argmax devolvía el primero de la lista como si lo fuera.
    /// </summary>
    [Fact]
    public void SelectCallWall_SinOi_DevuelveNull()
    {
        var strikes = new List<GammaExposureStrike> { S(825, 0, 0), S(830, 0, 0), S(835, 0, 0) };

        Assert.Null(GammaExposureHandler.SelectCallWall(strikes, 767.854));
    }

    /// <summary>Ningún strike arriba del spot con neto positivo: no hay muro que reportar.</summary>
    [Fact]
    public void SelectCallWall_TodoNetoNegativo_DevuelveNull()
    {
        var strikes = new List<GammaExposureStrike>
        {
            S(770, 7_882, -38_129),
            S(773, 7_157, -10_577),
        };

        Assert.Null(GammaExposureHandler.SelectCallWall(strikes, 767.854));
    }

    [Fact]
    public void SelectCallWall_SoloMiraArribaDelSpot()
    {
        var strikes = new List<GammaExposureStrike>
        {
            S(760, 999_999, -1),   // el mayor CallGEX de la lista, pero está abajo del spot
            S(775, 162_630, -77_330),
        };

        Assert.Equal(775, GammaExposureHandler.SelectCallWall(strikes, 767.854));
    }

    /// <summary>Espejo del Call Wall: mayor |PutGEX| abajo del spot, entre los de neto negativo.</summary>
    [Fact]
    public void SelectPutWall_EligeElMayorPutGexConNetoNegativo()
    {
        var strikes = new List<GammaExposureStrike>
        {
            S(765, 54_340, -320_526),   // |PutGEX| mayor, neto -266.186  <- gana
            S(760, 53_847, -157_169),   // neto -103.323
            S(750, 51_459,  -86_614),   // neto -35.155
        };

        Assert.Equal(765, GammaExposureHandler.SelectPutWall(strikes, 767.854));
    }

    /// <summary>El caso simétrico al 0DTE: mucho put pero el call lo tapa, así que no es muro.</summary>
    [Fact]
    public void SelectPutWall_IgnoraElStrikeDominadoPorCalls()
    {
        var strikes = new List<GammaExposureStrike>
        {
            S(765, 400_000, -320_526),   // |PutGEX| mayor, pero neto +79.474
            S(760,  53_847, -157_169),   // neto -103.323  <- gana
        };

        Assert.Equal(760, GammaExposureHandler.SelectPutWall(strikes, 767.854));
    }

    [Fact]
    public void SelectPutWall_SinOi_DevuelveNull()
    {
        var strikes = new List<GammaExposureStrike> { S(750, 0, 0), S(745, 0, 0) };

        Assert.Null(GammaExposureHandler.SelectPutWall(strikes, 767.854));
    }

    [Fact]
    public void SelectPutWall_SoloMiraAbajoDelSpot()
    {
        var strikes = new List<GammaExposureStrike>
        {
            S(775, 1, -999_999),        // el mayor |PutGEX|, pero está arriba del spot
            S(760, 53_847, -157_169),
        };

        Assert.Equal(760, GammaExposureHandler.SelectPutWall(strikes, 767.854));
    }

    /// <summary>Un strike exactamente en el spot no es ni resistencia ni soporte: queda afuera.</summary>
    [Fact]
    public void Muros_ExcluyenElStrikeEnElSpot()
    {
        var spot = 768.0;
        var strikes = new List<GammaExposureStrike> { S(768, 500_000, -1_000) };

        Assert.Null(GammaExposureHandler.SelectCallWall(strikes, spot));
        Assert.Null(GammaExposureHandler.SelectPutWall(strikes, spot));
    }
}
