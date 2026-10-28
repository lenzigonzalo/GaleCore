using DataFeed.Application.App.Shared;
using Xunit;

namespace DataFeed.Tests;

/// <summary>
/// Congela el tiempo a vencimiento del expected move (CascadeUtils.YearsToExpiry).
///
/// Existe por el bug del 2026-08-10: con DTE 0 el entero de días daba 0, sqrt(0) colapsaba el
/// producto y el tablero mostraba "±0.0 pts" en el vencimiento que la estrategia GEX pone PRIMERO.
/// Es exactamente el tipo de cálculo que se rompe en silencio — el número sigue apareciendo, solo
/// que mal — así que se fija con horas pinchadas en vez de confiar en mirarlo.
///
/// Las fechas son de agosto (EDT, UTC-4). El helper recibe el instante para que el test no dependa
/// de cuándo corre.
/// </summary>
public class ExpectedMoveTests
{
    // 2026-08-10 13:30 UTC = 09:30 ET (apertura). Quedan 6.5h hasta el cierre.
    private static DateTimeOffset EtOpen => new(2026, 8, 10, 13, 30, 0, TimeSpan.Zero);

    [Fact]
    public void DtePositivo_UsaDiasCalendario()
    {
        // No se toca la convención histórica: cambiarla movería TODOS los expected move del tablero.
        Assert.Equal(1 / 365.0, CascadeUtils.YearsToExpiry(1, EtOpen)!.Value, 12);
        Assert.Equal(39 / 365.0, CascadeUtils.YearsToExpiry(39, EtOpen)!.Value, 12);
    }

    [Fact]
    public void ZeroDte_EnLaApertura_UsaElRestoDeLaRueda()
    {
        // 09:30 -> 16:00 ET son 6.5h. En años: 6.5 / (24*365).
        var t = CascadeUtils.YearsToExpiry(0, EtOpen);
        Assert.NotNull(t);
        Assert.Equal(6.5 / (24.0 * 365.0), t!.Value, 12);
    }

    [Fact]
    public void ZeroDte_NoDevuelveCero()
    {
        // El bug original en una sola línea: lo que rompía no era la raíz, era el cero de entrada.
        Assert.True(CascadeUtils.YearsToExpiry(0, EtOpen) > 0);
    }

    [Fact]
    public void ZeroDte_DecreceALoLargoDeLaRueda_YSiempreEsMenorQueUnDia()
    {
        // Propiedad real de la implementación, no aritmética: a medida que avanza la rueda queda
        // menos tiempo, y en ningún momento del 0DTE puede haber MÁS tiempo que el que reporta un
        // DTE de 1. Si alguien volviera a meter un entero de días acá, las tres serían iguales
        // (y cero), y este test lo agarra.
        double apertura = CascadeUtils.YearsToExpiry(0, EtOpen)!.Value;
        double mediodia = CascadeUtils.YearsToExpiry(0, new DateTimeOffset(2026, 8, 10, 16, 0, 0, TimeSpan.Zero))!.Value;
        double cierreCasi = CascadeUtils.YearsToExpiry(0, new DateTimeOffset(2026, 8, 10, 19, 59, 0, TimeSpan.Zero))!.Value;

        Assert.True(apertura > mediodia, "el tiempo restante tiene que decrecer durante la rueda");
        Assert.True(mediodia > cierreCasi, "el tiempo restante tiene que decrecer durante la rueda");
        Assert.True(apertura < 1 / 365.0, "un 0DTE nunca puede tener más tiempo que un DTE de 1");
        Assert.True(cierreCasi > 0, "mientras el mercado esté abierto siempre queda algo de tiempo");
    }

    [Fact]
    public void ZeroDte_DespuesDelCierre_EsNull()
    {
        var postCierre = new DateTimeOffset(2026, 8, 10, 20, 30, 0, TimeSpan.Zero); // 16:30 ET
        Assert.Null(CascadeUtils.YearsToExpiry(0, postCierre));
    }

    [Fact]
    public void ZeroDte_JustoEnElCierre_EsNull()
    {
        var cierre = new DateTimeOffset(2026, 8, 10, 20, 0, 0, TimeSpan.Zero); // 16:00 ET clavadas
        Assert.Null(CascadeUtils.YearsToExpiry(0, cierre));
    }

    [Fact]
    public void DteNegativo_EsNull()
    {
        Assert.Null(CascadeUtils.YearsToExpiry(-1, EtOpen));
    }

    [Fact]
    public void ZeroDte_EnInvierno_RespetaEST()
    {
        // Enero: EST (UTC-5). 14:30 UTC = 09:30 ET, mismas 6.5h. Si el huso se resolviera con una
        // regla fija en vez de la zona real, acá daría 5.5h o 7.5h.
        var eneroApertura = new DateTimeOffset(2027, 1, 12, 14, 30, 0, TimeSpan.Zero);
        var t = CascadeUtils.YearsToExpiry(0, eneroApertura);
        Assert.NotNull(t);
        Assert.Equal(6.5 / (24.0 * 365.0), t!.Value, 12);
    }
}
