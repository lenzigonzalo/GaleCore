using DataFeed.Application.App.GammaExposure;
// Ojo: hay DOS clases Expiration. El handler consume la de Infrastructure, que es la que
// deserializa la respuesta cruda de Tastytrade; la de Application/Data es el DTO de la API propia.
using DataFeed.Infrastructure.Providers.Tastytrade.Models;

namespace DataFeed.Tests;

/// <summary>
/// Congela que el DTE se calcula contra la fecha de hoy en ET y NO se toma del proveedor.
///
/// El caso que lo motivó es real y está fechado: el 2026-08-25, la cadena de SPY y la de TSLA
/// traían <c>2026-08-24</c> —un weekly de lunes ya vencido— con <c>days-to-expiration: 0</c> y toda
/// su serie corrida un día, mientras la de QQQ, pedida en el mismo minuto, venía correcta. Un campo
/// que puede estar mal para un símbolo y bien para otro a la vez no se puede usar como fuente de
/// verdad, y el daño no era cosmético: la gamma del contrato vencido entraba al agregado (el 37%
/// del neto de SPY ese día) y <c>YearsToExpiry</c> le daba tiempo real, porque para DTE 0 mide las
/// horas hasta el cierre de hoy.
/// </summary>
public class GammaExposureExpirationTests
{
    /// <summary>2026-08-25 a las 14:00 ET, que es cuando se observó el caso.</summary>
    private static readonly DateTimeOffset Ahora = new(2026, 8, 25, 18, 0, 0, TimeSpan.Zero);

    private static Expiration E(string fecha, int dteDelProveedor, string tipo = "Weekly") =>
        new() { ExpirationDate = fecha, DaysToExpiration = dteDelProveedor, ExpirationType = tipo };

    [Fact]
    public void DescartaElVencimientoQueYaPaso_AunqueElProveedorLoMarqueComoCeroDte()
    {
        // Exactamente lo que devolvió la cadena de SPY: el 24 como 0DTE y el resto corrido.
        var chain = new[] { E("2026-08-24", 0), E("2026-08-25", 1), E("2026-08-26", 2) };

        var vivas = GammaExposureHandler.NormalizeExpirations(chain, Ahora);

        Assert.DoesNotContain(vivas, e => e.ExpirationDate == "2026-08-24");
        Assert.Equal(2, vivas.Count);
    }

    [Fact]
    public void RecalculaElDte_YNoLeCreeAlProveedor()
    {
        var chain = new[] { E("2026-08-25", 1), E("2026-09-18", 25, "Regular"), E("2026-10-16", 53, "Regular") };

        var vivas = GammaExposureHandler.NormalizeExpirations(chain, Ahora);

        // El proveedor decía 1 / 25 / 53; la cuenta de calendario da 0 / 24 / 52.
        Assert.Equal(0, vivas.Single(e => e.ExpirationDate == "2026-08-25").DaysToExpiration);
        Assert.Equal(24, vivas.Single(e => e.ExpirationDate == "2026-09-18").DaysToExpiration);
        Assert.Equal(52, vivas.Single(e => e.ExpirationDate == "2026-10-16").DaysToExpiration);
    }

    /// <summary>
    /// El que vence HOY se conserva con DTE 0: es el 0DTE de verdad, y es el único caso en el que
    /// <c>YearsToExpiry</c> debe medir horas hasta el cierre. Confundirlo con uno vencido apagaría
    /// el 0DTE, que la estrategia GEX incluye a propósito.
    /// </summary>
    [Fact]
    public void ElQueVenceHoyEsCeroDte_YSobrevive()
    {
        var vivas = GammaExposureHandler.NormalizeExpirations(new[] { E("2026-08-25", 1) }, Ahora);

        var hoy = Assert.Single(vivas);
        Assert.Equal(0, hoy.DaysToExpiration);
    }

    /// <summary>
    /// A las 20:30 ET del 25 en Nueva York ya es el 26 en UTC. Si la referencia fuera UTC, el
    /// vencimiento del 26 se contaría como 0DTE con el mercado de mañana todavía sin abrir.
    /// </summary>
    [Fact]
    public void LaReferenciaEsLaFechaDeNuevaYork_NoLaUtc()
    {
        var nocheEnEt = new DateTimeOffset(2026, 8, 26, 0, 30, 0, TimeSpan.Zero); // 20:30 ET del 25

        var vivas = GammaExposureHandler.NormalizeExpirations(new[] { E("2026-08-26", 0) }, nocheEnEt);

        Assert.Equal(1, Assert.Single(vivas).DaysToExpiration);
    }

    /// <summary>
    /// BL-011: pasado el cierre (16:00 ET) el que vence hoy ya liquidó. Antes sobrevivía hasta la
    /// medianoche ET y la lectura de la tarde sumaba su gamma muerta al agregado.
    /// </summary>
    [Fact]
    public void PasadoElCierre_ElQueVenceHoyYaNoEntra()
    {
        var chain = new[] { E("2026-08-25", 0), E("2026-08-26", 1) };
        var cierre = new DateTimeOffset(2026, 8, 25, 20, 0, 0, TimeSpan.Zero);    // 16:00 ET
        var tarde = new DateTimeOffset(2026, 8, 25, 22, 30, 0, TimeSpan.Zero);    // 18:30 ET

        Assert.Equal("2026-08-26", Assert.Single(GammaExposureHandler.NormalizeExpirations(chain, cierre)).ExpirationDate);
        Assert.Equal(1, Assert.Single(GammaExposureHandler.NormalizeExpirations(chain, tarde)).DaysToExpiration);
    }

    /// <summary>Un minuto antes del cierre el 0DTE sigue vivo: el corte es el cierre, no la tarde.</summary>
    [Fact]
    public void UnMinutoAntesDelCierre_ElCeroDteSigue()
    {
        var casiCierre = new DateTimeOffset(2026, 8, 25, 19, 59, 0, TimeSpan.Zero); // 15:59 ET

        var vivas = GammaExposureHandler.NormalizeExpirations(new[] { E("2026-08-25", 0) }, casiCierre);

        Assert.Equal(0, Assert.Single(vivas).DaysToExpiration);
    }

    [Fact]
    public void UnaFechaIlegibleSeDescarta_PorqueSinFechaNoSeSabeSiElContratoExiste()
    {
        var chain = new[] { E("", 0), E("no-es-fecha", 3), E("2026-09-18", 25, "Regular") };

        var vivas = GammaExposureHandler.NormalizeExpirations(chain, Ahora);

        Assert.Equal("2026-09-18", Assert.Single(vivas).ExpirationDate);
    }

    [Fact]
    public void SinExpiraciones_DevuelveListaVacia_YNoRevienta()
    {
        Assert.Empty(GammaExposureHandler.NormalizeExpirations(null!, Ahora));
        Assert.Empty(GammaExposureHandler.NormalizeExpirations(Array.Empty<Expiration>(), Ahora));
    }

    // ── Selección del vencimiento en modo de uno solo ────────────────────────────────────

    private static List<Expiration> Cadena() => new()
    {
        E("2026-08-28", 3), E("2026-09-04", 10), E("2026-09-18", 24, "Regular"),
        E("2026-10-02", 38), E("2026-10-16", 52, "Regular"),
    };

    /// <summary>
    /// Sin objetivo se mantiene el comportamiento histórico —el de MAYOR DTE— porque es el que
    /// produjo todos los números que el operador viene mirando.
    /// </summary>
    [Fact]
    public void SinTargetDte_EligeElDeMayorDte()
    {
        var elegida = GammaExposureHandler.SelectSingleExpiration(Cadena(), targetDte: 0);
        Assert.Equal("2026-10-16", elegida.ExpirationDate);
    }

    /// <summary>
    /// Con objetivo, el más cercano. Es lo que hace que la serie de skew25 sea comparable consigo
    /// misma: "el mayor dentro de 60" saltaba de vencimiento una vez por mes, y con él saltaba el
    /// plazo medido — de DTE 35 a DTE 59 el 2026-08-18, un escalón de +0.038 en el skew de SPY que
    /// no era mercado.
    /// </summary>
    [Fact]
    public void ConTargetDte_EligeElMasCercanoAlObjetivo()
    {
        var elegida = GammaExposureHandler.SelectSingleExpiration(Cadena(), targetDte: 30);
        Assert.Equal("2026-09-18", elegida.ExpirationDate);   // 24 está a 6; 38 está a 8
    }

    /// <summary>A igual distancia gana el más corto, para que la regla no dependa del orden.</summary>
    [Fact]
    public void AIgualDistancia_GanaElMasCorto()
    {
        var empate = new List<Expiration> { E("2026-10-02", 38), E("2026-08-28", 22) };

        var elegida = GammaExposureHandler.SelectSingleExpiration(empate, targetDte: 30);

        Assert.Equal("2026-08-28", elegida.ExpirationDate);
    }
}
