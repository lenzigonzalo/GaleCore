using DataFeed.Application.App.GammaExposure;

namespace DataFeed.Tests;

/// <summary>
/// Congela la banda de gamma: <b>la ventana de ancho <c>W = 0.25 × EM</c> que junta más |GEX| de su
/// lado, con la zona del dinero afuera, y su borde EXTERNO como referencia</b>.
///
/// Reemplaza al argmax como objeto que la pantalla de GEX muestra (2026-08-28). El argmax sigue
/// existiendo —<see cref="GammaExposureHandler.SelectCallWall"/>, congelado por
/// <c>GammaExposureWallTests</c>— porque RPF lo usa de gate; lo que cambia es qué se dibuja.
///
/// Las tres propiedades que se congelan acá son las tres razones por las que la banda existe:
/// <list type="bullet">
/// <item><b>No es un argmax</b> — el borde puede caer lejos del strike más alto, y de hecho tiene
/// que caerlo cuando la masa está repartida.</item>
/// <item><b>La zona del dinero sale del pool</b> — sin eso la ventana más densa puede SER la pila
/// de gamma del dinero. Es el defecto que en QQQ 18-Sep devolvió un muro en 710 con el spot en
/// 708.02.</item>
/// <item><b>"No hay banda" es un resultado válido</b> — sin EM no hay ancho, y con un lado flaco no
/// hay nada que medir. Devuelve null en vez de inventar un strike.</item>
/// </list>
///
/// Ver research/got/ §61.4 y el hallazgo del 2026-08-28.
/// </summary>
public class GammaExposureBandTests
{
    private static GammaExposureStrike S(double strike, double callGex, double putGex) =>
        new() { Strike = strike, CallGEX = callGex, PutGEX = putGex };

    /// <summary>
    /// El caso que motiva todo: dos candidatos casi empatados, y el argmax elige por un margen
    /// mínimo mientras la masa real está en otro lado.
    ///
    /// Con spot 100 y EM 40, W = 10 y la zona del dinero llega hasta 106. El strike 130 es el
    /// argmax puntual (900), pero está solo; entre 112 y 120 hay 800+750+700 = 2250 juntos. La
    /// banda tiene que elegir la concentración, no el pico.
    /// </summary>
    [Fact]
    public void SelectWallBand_EligeLaConcentracionYNoElPicoSuelto()
    {
        var strikes = new List<GammaExposureStrike>
        {
            S(108, 200, 0),
            S(112, 800, 0),
            S(116, 750, 0),
            S(120, 700, 0),
            S(126, 150, 0),
            S(130, 900, 0),   // el argmax puntual, y está solo
        };

        var b = GammaExposureHandler.SelectWallBand(strikes, spot: 100, expectedMove: 40, isCall: true);

        Assert.NotNull(b);
        Assert.Equal(112, b!.Low);
        Assert.Equal(122, b.High);          // 112 + W, y W = 0.25 * 40 = 10
        Assert.Equal(122, b.Edge);          // el borde externo del lado call es el extremo alto
        Assert.Equal(10, b.Width);

        // 2250 de 3500 del lado. El argmax del mismo dataset junta 900, o sea 25.7%.
        Assert.Equal(64.3, b.PctOfSide);
        Assert.NotEqual(130, b.Edge);
    }

    /// <summary>
    /// El borde externo del lado put es el extremo BAJO — el más lejos del spot—, espejo del call.
    /// Y la ventana se mide hacia adentro (k0 − W → k0) para que sea así.
    /// </summary>
    [Fact]
    public void SelectWallBand_DelLadoPutElBordeEsElExtremoBajo()
    {
        var strikes = new List<GammaExposureStrike>
        {
            S(92, 0, -200),
            S(88, 0, -800),
            S(84, 0, -750),
            S(80, 0, -700),
            S(74, 0, -150),
            S(70, 0, -100),
        };

        var b = GammaExposureHandler.SelectWallBand(strikes, spot: 100, expectedMove: 40, isCall: false);

        Assert.NotNull(b);
        Assert.Equal(78, b!.Low);           // 88 - W
        Assert.Equal(88, b.High);
        Assert.Equal(78, b.Edge);           // el borde externo del put es el extremo BAJO
    }

    /// <summary>
    /// La zona del dinero sale del POOL entero, no sólo de la comparación.
    ///
    /// Con spot 100 y EM 40, la exclusión llega hasta 106. El strike 102 lleva 5000 —más que todo
    /// lo demás junto— y aun así la banda no lo toca: es la pila del dinero, no un muro. Sin esta
    /// regla, la "ventana más densa" del lado call sería siempre la que empieza pegada al spot.
    /// </summary>
    [Fact]
    public void SelectWallBand_ExcluyeLaPilaDeGammaDelDinero()
    {
        var strikes = new List<GammaExposureStrike>
        {
            S(102, 5000, 0),   // pila del dinero: |102 - 100| = 2 < 0.15 * 40 = 6
            S(112,  800, 0),
            S(116,  750, 0),
            S(120,  700, 0),
            S(126,  150, 0),
            S(130,  200, 0),
            S(134,  100, 0),
        };

        var b = GammaExposureHandler.SelectWallBand(strikes, spot: 100, expectedMove: 40, isCall: true);

        Assert.NotNull(b);
        Assert.Equal(112, b!.Low);
        Assert.True(b.Low > 106, "la banda no puede arrancar dentro de la zona del dinero");
    }

    /// <summary>
    /// xmed compara la banda contra la ventana MEDIANA de su lado: ¿hay algo apilado, o es una
    /// ventana cualquiera? Con la masa repartida pareja el cociente tiende a 1x, que es la lectura
    /// de "acá no hay muro".
    ///
    /// No lleva umbral y no decide nada — se muestra como forma. Lo que se congela es que sea el
    /// cociente contra la mediana y no contra otra cosa.
    /// </summary>
    [Fact]
    public void SelectWallBand_XMedCercaDeUnoCuandoLaMasaEstaRepartida()
    {
        var plana = new List<GammaExposureStrike>();
        for (double k = 112; k <= 160; k += 4) plana.Add(S(k, 500, 0));

        var b = GammaExposureHandler.SelectWallBand(plana, spot: 100, expectedMove: 40, isCall: true);

        Assert.NotNull(b);
        Assert.NotNull(b!.XMed);
        Assert.True(b.XMed <= 1.5, $"con masa pareja xmed tiene que quedar cerca de 1x, dio {b.XMed}");
    }

    /// <summary>
    /// Sin Expected Move no hay banda, y eso NO es un error: el ancho es una fracción del EM.
    ///
    /// Es la razón por la que la fila de la cadena agregada sale vacía en la pantalla — el agregado
    /// no tiene un `t` con el cual definir el EM (61.1). El argmax sí se podía calcular ahí, y por
    /// eso mostraba un número: uno que quedaba pegado al spot ($0.83 en SPY).
    /// </summary>
    [Theory]
    [InlineData(null)]
    [InlineData(0d)]
    public void SelectWallBand_SinExpectedMoveNoHayBanda(double? em)
    {
        var strikes = new List<GammaExposureStrike>
        {
            S(112, 800, 0), S(116, 750, 0), S(120, 700, 0),
            S(126, 150, 0), S(130, 200, 0), S(134, 100, 0),
        };

        Assert.Null(GammaExposureHandler.SelectWallBand(strikes, spot: 100, expectedMove: em, isCall: true));
    }

    /// <summary>
    /// Con un lado flaco tampoco hay banda: la ventana más densa y la mediana se calcularían sobre
    /// un puñado de puntos y el cociente sería ruido. "No hay banda" es la degradación limpia; el
    /// argmax en cambio siempre devuelve algo, que es justamente el problema.
    /// </summary>
    [Fact]
    public void SelectWallBand_ConPocosStrikesDevuelveNull()
    {
        var strikes = new List<GammaExposureStrike>
        {
            S(112, 800, 0), S(116, 750, 0), S(120, 700, 0),
        };

        Assert.Null(GammaExposureHandler.SelectWallBand(strikes, spot: 100, expectedMove: 40, isCall: true));
    }

    /// <summary>
    /// El lado se respeta: un pool de puts no produce banda de call aunque tenga toda la masa.
    /// Cada lado se mide con su propio GEX y sólo con los strikes de su lado del spot.
    /// </summary>
    [Fact]
    public void SelectWallBand_NoCruzaDeLado()
    {
        var soloPuts = new List<GammaExposureStrike>
        {
            S(92, 0, -200), S(88, 0, -800), S(84, 0, -750),
            S(80, 0, -700), S(74, 0, -150), S(70, 0, -100),
        };

        Assert.Null(GammaExposureHandler.SelectWallBand(soloPuts, spot: 100, expectedMove: 40, isCall: true));
        Assert.NotNull(GammaExposureHandler.SelectWallBand(soloPuts, spot: 100, expectedMove: 40, isCall: false));
    }

    /// <summary>
    /// Los defaults del handler son los que declara <c>gex.wall_band</c> en el JSON de GEX. Si
    /// alguien cambia uno de los dos sin el otro, la pantalla dibuja una banda y el panel de
    /// References describe otra.
    /// </summary>
    [Fact]
    public void DefaultsDelHandler_CoincidenConElJson()
    {
        Assert.Equal(0.25, GammaExposureHandler.WallBandWidthEm);
        Assert.Equal(0.15, GammaExposureHandler.WallBandMoneyZoneEm);
    }
}
