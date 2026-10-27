using DataFeed.Application.App.GammaExposure;

namespace DataFeed.Tests;

/// <summary>
/// Regresión del bug de OI corrupto que envenenaba el netGEX agregado (netGEX = -1.2e17).
/// Congela la validación de Open Interest: un OI enorme / NaN / Infinity / negativo no debe
/// llegar crudo al cálculo de GEX, ni desbordar <c>(long)poi</c> a <c>long.MinValue</c>.
/// </summary>
public class GammaExposureOiTests
{
    [Theory]
    [InlineData("493", 493L)]
    [InlineData("200.0", 200L)]          // OI puede venir como decimal
    [InlineData("1", 1L)]
    [InlineData("1000000000", 1_000_000_000L)]  // tope plausible, inclusivo
    public void TryParseValidOpenInterest_AceptaValoresPlausibles(string raw, long expected)
    {
        Assert.True(GammaExposureHandler.TryParseValidOpenInterest(raw, out var oi));
        Assert.Equal(expected, oi);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-5")]
    [InlineData("1000000001")]            // apenas sobre el tope
    [InlineData("1e19")]                  // el caso real: double > long.MaxValue
    [InlineData("9999999999999999999")]   // idem, sin notación científica
    [InlineData("Infinity")]
    [InlineData("NaN")]
    [InlineData("abc")]
    [InlineData("")]
    [InlineData(null)]
    public void TryParseValidOpenInterest_RechazaValoresInvalidos(string? raw)
    {
        Assert.False(GammaExposureHandler.TryParseValidOpenInterest(raw, out var oi));
        Assert.Equal(0L, oi);   // nunca long.MinValue ni un residuo del cast
    }

    [Fact]
    public void TryParseValidOpenInterest_OiEnorme_NoDesbordaALongMinValue()
    {
        // Reproduce la causa raíz: un OI que como double supera long.MaxValue.
        // Antes del fix, (long)poi devolvía long.MinValue (-9.2e18) y envenenaba el netGEX.
        Assert.False(GammaExposureHandler.TryParseValidOpenInterest("1e19", out var oi));
        Assert.NotEqual(long.MinValue, oi);
        Assert.Equal(0L, oi);
    }

    [Theory]
    [InlineData(long.MinValue, 0L)]   // el sentinel que aparecía en putOI
    [InlineData(-1L, 0L)]
    [InlineData(0L, 0L)]
    [InlineData(100L, 100L)]
    [InlineData(long.MaxValue, long.MaxValue)]
    public void SanitizeOpenInterest_ClampeaNegativosACero(long input, long expected)
    {
        Assert.Equal(expected, GammaExposureHandler.SanitizeOpenInterest(input));
    }

    // ── Ventana de candles para el OI ──────────────────────────────────────
    // DXLink sólo publica el candle de un día si el contrato operó. Con 2 días de ventana, un strike
    // sin operaciones reciente entraba al GEX con OI 0 aunque tuviera contratos abiertos (SPY
    // 2026-11-20 call 515: OI 97, último candle 10/09; verificado el 24/09).

    private static readonly DateTime Today = new(2026, 9, 24, 0, 0, 0, DateTimeKind.Utc);
    private static long Ms(DateTime utc) => new DateTimeOffset(utc, TimeSpan.Zero).ToUnixTimeMilliseconds();

    [Fact]
    public void OiWindow_IncluyeUnCandleDeHaceDosSemanas()
    {
        var from = GammaExposureHandler.OiCandlesFromTime(Today);
        Assert.True(Ms(new DateTime(2026, 9, 10, 0, 0, 0, DateTimeKind.Utc)) >= from);   // call 515
    }

    [Fact]
    public void PrevClose_SigueUsandoSoloCandlesDeLosUltimosDosDias()
    {
        Assert.True(GammaExposureHandler.IsRecentForPrevClose(Ms(Today), Today));
        Assert.True(GammaExposureHandler.IsRecentForPrevClose(Ms(Today.AddDays(-2)), Today));
        Assert.False(GammaExposureHandler.IsRecentForPrevClose(Ms(Today.AddDays(-3)), Today));
        Assert.False(GammaExposureHandler.IsRecentForPrevClose(Ms(new DateTime(2026, 9, 10, 0, 0, 0, DateTimeKind.Utc)), Today));
    }

    // Candles como los devolvió DXLink el 24/09 para SPY 2026-11-20.
    private static (long, string?, string?) C(DateTime day, string? oi, string? close) => (Ms(day), oi, close);
    private static DateTime D(int month, int day) => new(2026, month, day, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Pick_StrikeSinOperacionesRecientes_TomaElOiDelUltimoCandle_SinCierrePrevio()
    {
        // Call 515: último candle el 10/09 con OI 97 (IBKR: 97). Antes entraba al GEX con 0.
        var picked = GammaExposureHandler.PickOpenInterest(new[] { C(D(9, 10), "97", "250.1") }, Today);
        Assert.Equal((97L, (double?)null), picked);
    }

    [Fact]
    public void Pick_GanaElCandleMasReciente_YSuCloseEsElCierrePrevio()
    {
        // Put 700: candles del 21 al 24/09; el de hoy trae OI 36627 (IBKR: 36627).
        var candles = new[]
        {
            C(D(9, 21), "33158", "3.06"), C(D(9, 24), "36627", "3.43"),
            C(D(9, 22), "32934", "2.77"), C(D(9, 23), "33594", "3.37"),
        };
        Assert.Equal((36627L, (double?)3.43), GammaExposureHandler.PickOpenInterest(candles, Today));
    }

    [Fact]
    public void Pick_SinCandleConOi_OConOiInvalido_EsNull()
    {
        Assert.Null(GammaExposureHandler.PickOpenInterest(Array.Empty<(long, string?, string?)>(), Today));
        Assert.Null(GammaExposureHandler.PickOpenInterest(new[] { C(D(9, 24), "", "1.0") }, Today));
        // Strike recién listado: DXLink manda OI 0 (IBKR también 0); 0 no es un OI válido para el GEX.
        Assert.Null(GammaExposureHandler.PickOpenInterest(new[] { C(D(9, 24), "0", "1.0") }, Today));
        // Como antes: si el más reciente trae un OI inválido, no se cae a uno más viejo.
        Assert.Null(GammaExposureHandler.PickOpenInterest(new[] { C(D(9, 23), "500", "1.0"), C(D(9, 24), "NaN", "1.0") }, Today));
    }
}
