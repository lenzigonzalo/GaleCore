using DataFeed.Application.Shared;

namespace DataFeed.Tests;

/// <summary>
/// Congela la traducción OCC → símbolo streamer de DXLink, que es la frontera entre los dos
/// formatos de símbolo que conviven en la API (ver "Símbolos de opción" en CLAUDE.md).
///
/// Lo que protege es un fallo que NO se ve: DXLink no rechaza un símbolo inexistente, devuelve un
/// snapshot vacío y el request agota su timeout. Un error de traducción no aparece como excepción
/// ni como 500 — aparece como una opción sin datos, indistinguible de una sin mercado. Por eso lo
/// cubre un test y no la inspección de una respuesta.
///
/// El caso que lo motivó: hasta el 2026-08-24 la función descartaba los 3 decimales del strike y
/// convertía "TSLA  260904P00352500" en ".TSLA260904P352". Todos los strikes de medio dólar
/// quedaban mudos en los cinco handlers que traducen OCC.
/// </summary>
public class TastytradeSymbolTests
{
    [Theory]
    // Strike entero: sin punto decimal, y sin los ceros de relleno del OCC.
    [InlineData("TSLA  260904P00350000", ".TSLA260904P350")]
    [InlineData("SPY   260516P00520000", ".SPY260516P520")]
    [InlineData("TSLA  261016C00400000", ".TSLA261016C400")]
    // Strike fraccionario: el decimal viaja, sin ceros a la derecha.
    [InlineData("TSLA  260904P00352500", ".TSLA260904P352.5")]
    [InlineData("TSLA  260904C00292500", ".TSLA260904C292.5")]
    [InlineData("AAPL  260918C00237500", ".AAPL260918C237.5")]
    // Tres decimales significativos: no se redondea a uno.
    [InlineData("SPY   260516P00520125", ".SPY260516P520.125")]
    // Strike de cuatro dígitos y de dos: el largo del entero no cambia el formato.
    [InlineData("SPX   261016C01000000", ".SPX261016C1000")]
    [InlineData("SKM   260918P00025000", ".SKM260918P25")]
    public void GetOptionSymbolFromTicker_TraduceStrikeEnteroYFraccionario(string occ, string esperado)
    {
        Assert.Equal(esperado, TastytradeHelper.GetOptionSymbolFromTicker(occ));
    }

    /// <summary>
    /// El strike que sale del OCC y el que viaja en el símbolo streamer son el MISMO número. Si las
    /// dos lecturas del mismo campo se separan, un leg se suscribe a un strike y se contabiliza en
    /// otro — que es exactamente la clase de fallo silencioso que trajo el bug de los decimales.
    /// </summary>
    [Theory]
    [InlineData("TSLA  260904P00352500", 352.5)]
    [InlineData("TSLA  260904P00350000", 350)]
    [InlineData("SPY   260516P00520125", 520.125)]
    public void StrikeDelSimboloStreamer_CoincideConGetStrikeFromTicker(string occ, decimal strike)
    {
        var streamer = TastytradeHelper.GetOptionSymbolFromTicker(occ);
        var desdeStreamer = decimal.Parse(
            streamer.Substring(streamer.LastIndexOfAny(new[] { 'C', 'P' }) + 1),
            System.Globalization.CultureInfo.InvariantCulture);

        Assert.Equal(strike, desdeStreamer);
        Assert.Equal(TastytradeHelper.GetStrikeFromTicker(occ), desdeStreamer);
    }
}
