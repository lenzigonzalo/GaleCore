using System.Threading;

namespace DataFeed.Application.App.GammaExposure
{
    public class GammaExposureResponse
    {
        /// <summary>
        /// Símbolo del subyacente
        /// </summary>
        public string Symbol { get; set; }

        /// <summary>
        /// Precio spot del subyacente
        /// </summary>
        public double Spot { get; set; }

        /// <summary>
        /// Fecha de expiración utilizada
        /// </summary>
        public string Expiration { get; set; }

        /// <summary>
        /// Días hasta expiración
        /// </summary>
        public int DTE { get; set; }

        /// <summary>
        /// Tipo de expiración (Regular, Weekly)
        /// </summary>
        public string ExpirationType { get; set; }

        /// <summary>
        /// Nivel de precio donde el Net GEX cruza de negativo a positivo
        /// </summary>
        public double? GammaZeroLevel { get; set; }

        /// <summary>
        /// Strike con el máximo CallGEX (mayor gamma long de dealers).
        ///
        /// Es un ARGMAX sobre un solo strike, y está medido que es un mal objeto — ver
        /// <see cref="GammaExposureHandler.SelectWallBand"/>. La pantalla de GEX ya no lo muestra
        /// (desde 2026-08-28 muestra <see cref="GammaExposureExpiry.CallBand"/>). Sigue acá porque
        /// RPF lo usa de gate y el Monitor lo dibuja en su StrikeLadder: cambiarle la definición
        /// movería el comportamiento de una estrategia operativa sin evidencia de que mejore.
        /// </summary>
        public double? CallWall { get; set; }

        /// <summary>
        /// Strike con el máximo |PutGEX| (mayor gamma short de dealers). Espejo de
        /// <see cref="CallWall"/>, con la misma salvedad.
        /// </summary>
        public double? PutWall { get; set; }

        /// <summary>
        /// Tasa libre de riesgo utilizada (FRED DGS1 o default)
        /// </summary>
        public double RiskFreeRate { get; set; }

        /// <summary>
        /// GEX por cada strike. En modo global (AllExpirations) cada fila es la SUMA del strike
        /// sobre todas las expiraciones incluidas.
        /// </summary>
        public List<GammaExposureStrike> Strikes { get; set; } = new();

        /// <summary>
        /// Desglose por vencimiento. Solo se puebla con IncludeByExpiry = true (estrategia GEX);
        /// vacío en el modo de una sola expiración.
        /// </summary>
        public List<GammaExposureExpiry> ByExpiry { get; set; } = new();

        // ── Cobertura del snapshot ──────────────────────────────────────────────
        // Un símbolo sin Greeks no aporta al GEX. Con la cadena completa eso puede ser un
        // vencimiento entero, y sin estos contadores el faltante es invisible: el GEX simplemente
        // da más chico. Se publican para que el tablero pueda marcar un barrido parcial.

        /// <summary>Símbolos de opción pedidos a DXLink.</summary>
        public int SymbolsRequested { get; set; }

        /// <summary>Símbolos que efectivamente devolvieron Greeks.</summary>
        public int SymbolsWithGreeks { get; set; }

        /// <summary>Vencimientos que entraron en el barrido (los que quedaron sin datos no aparecen en ByExpiry).</summary>
        public int ExpirationsRequested { get; set; }

        /// <summary>Calls a las que se les pidió OI (con Greeks y dentro de la banda de |delta|).</summary>
        public int CallOiRequested { get; set; }
        /// <summary>Calls de las pedidas cuyo OI volvió válido (&gt; 0).</summary>
        public int CallOiReceived { get; set; }
        /// <summary>Puts a las que se les pidió OI (con Greeks y dentro de la banda de |delta|).</summary>
        public int PutOiRequested { get; set; }
        /// <summary>Puts de las pedidas cuyo OI volvió válido (&gt; 0).</summary>
        public int PutOiReceived { get; set; }

        public int StrikesWithOI => Strikes.Count(s => s.CallOI > 0 || s.PutOI > 0);
        public int StrikesWithGEX => Strikes.Count(s => s.CallGEX > 0 || s.PutGEX < 0);

        public double CallGEX
        {
            get
            {
                return Math.Round(Strikes.Sum(x => x.CallGEX), 4);
            }
        }

        public double PutGEX
        {
            get
            {
                return Math.Round(Strikes.Sum(x => x.PutGEX), 4);
            }
        }

        public double NetGEX
        {
            get
            {
                return Math.Round((CallGEX + PutGEX) / 1000, 1);
            }
        }

        /// <summary>Escala de los campos de GEX de esta respuesta (BL-002).</summary>
        public GexUnits Units => GexUnits.Current;
    }

    /// <summary>
    /// La escala del GEX, declarada en el contrato. Antes sólo se sabía leyendo este archivo: los
    /// GEX de strike y de lado salen en millones de USD y el neto en billones (miles de millones),
    /// y un consumidor que los sumaba entre sí mezclaba escalas sin enterarse (BL-002).
    ///
    /// Es descriptivo: cambiar un número acá no reescala nada. Si cambia la fórmula o una división
    /// del handler, se cambia esto en el mismo commit (lo congela GexUnitsTests).
    /// </summary>
    /// <summary>
    /// Cómo se calcula el GEX, declarado en el contrato (WS-0045, Biblioteca): para que quien lo lea pueda decir la
    /// fórmula y de dónde viene cada dato sin leer este código. Descriptivo, como <see cref="GexUnits"/>: si cambia el
    /// cálculo del handler, se cambia esto en el mismo commit.
    /// </summary>
    public sealed class GexMethod
    {
        public static readonly GexMethod Current = new();

        public string StrikeFormula { get; } = "GEX = gamma × OI × 100 × spot², dividido por 1.000.000 (millones de USD); calls con signo +, puts con signo −";
        public string SignConvention { get; } = "Supuesto de mercado: los dealers están comprados de los calls y vendidos de los puts que el público opera, así que el gamma de calls suma y el de puts resta";
        public string GammaSource { get; } = "Gamma, delta e IV de cada contrato: greeks de DXLink (Tastytrade) al momento del cálculo";
        public string OpenInterestSource { get; } = "OI: la vela diaria más reciente que trae OI, hasta 30 días atrás (DXLink); OI inválido o negativo se descarta";
        public string Aggregation { get; } = "Un strike se suma entre vencimientos; el global suma todos los vencimientos ≤ max_dte, incluido 0DTE; neto = (calls + puts) / 1.000 (miles de millones de USD)";
        public string MoveScale { get; } = "Es la exposición para un movimiento de 1 (100 %) del subyacente; para un movimiento del 1 % se divide por 100";
        public string GammaZero { get; } = "Interpolación lineal entre strikes donde el GEX neto pasa de negativo a positivo; si hay varios cruces, el más cercano al spot";
        public string Walls { get; } = "Muro de calls: strike sobre el spot con mayor GEX de calls y neto positivo. Muro de puts: strike bajo el spot con mayor |GEX de puts| y neto negativo";
    }

    public sealed class GexUnits
    {
        public static readonly GexUnits Current = new();

        /// <summary>CallGEX / PutGEX / NetGEX de cada strike.</summary>
        public string Strike { get; } = "USD_MILLIONS";

        /// <summary>CallGEX / PutGEX sumados (raíz, vencimiento, global).</summary>
        public string Side { get; } = "USD_MILLIONS";

        /// <summary>NetGEX agregado (raíz, vencimiento, global) = (CallGEX + PutGEX) / 1000.</summary>
        public string Net { get; } = "USD_BILLIONS";

        /// <summary>
        /// Qué mide: cambio del delta de los dealers, en USD, ante un movimiento de 100% del spot
        /// (gamma × OI × 100 × spot²). Para "por 1%" se multiplica por 0.01.
        /// </summary>
        public string Basis { get; } = "gamma*oi*100*spot^2 (USD delta change per 100% spot move; x0.01 for 1%)";

        /// <summary>Signo: supuesto de dealers largos en calls (+) y cortos en puts (−).</summary>
        public string Sign { get; } = "dealer: calls positive, puts negative";
    }

    /// <summary>
    /// GEX de un vencimiento puntual de la cadena. Mismos campos derivados que la respuesta raíz,
    /// pero calculados solo con los strikes de ese vencimiento.
    /// </summary>
    public class GammaExposureExpiry
    {
        public string Expiration { get; set; } = "";
        public int DTE { get; set; }
        public string? ExpirationType { get; set; }

        /// <summary>Nivel donde el Net GEX de este vencimiento cruza de negativo a positivo.</summary>
        public double? GammaZeroLevel { get; set; }
        public double? CallWall { get; set; }
        public double? PutWall { get; set; }

        /// <summary>
        /// La banda de gamma del lado call de este vencimiento. Es lo que la pantalla de GEX
        /// muestra desde 2026-08-28 en lugar de <see cref="CallWall"/>, que es un argmax que salta.
        /// null = no hay banda (sin EM, o el lado no tiene suficientes strikes con GEX), y es un
        /// resultado válido. Ver <see cref="GammaExposureHandler.SelectWallBand"/>.
        /// </summary>
        public GammaBand? CallBand { get; set; }

        /// <summary>La banda de gamma del lado put. Espejo de <see cref="CallBand"/>.</summary>
        public GammaBand? PutBand { get; set; }

        /// <summary>IV del strike más cercano al spot en este vencimiento (fuente: Greeks DXLink).</summary>
        public double? AtmIv { get; set; }

        /// <summary>spot * atmIv * sqrt(dte/365). Ver definitions.expected_move.</summary>
        public double? ExpectedMove { get; set; }

        public List<GammaExposureStrike> Strikes { get; set; } = new();

        public double CallGEX => Math.Round(Strikes.Sum(x => x.CallGEX), 4);
        public double PutGEX => Math.Round(Strikes.Sum(x => x.PutGEX), 4);

        /// <summary>Net GEX del vencimiento en billones (misma escala que la respuesta raíz).</summary>
        public double NetGEX => Math.Round((CallGEX + PutGEX) / 1000, 1);
    }

    public class GammaExposureStrike
    {
        public double Strike { get; set; }

        // Call
        public string? CallStreamerSymbol { get; set; }
        public double CallDelta { get; set; }
        public double CallGamma { get; set; }
        public double CallIV { get; set; }
        public long CallOI { get; set; }
        public double CallGEX { get; set; }
        /// <summary>Cierre del período anterior (close del candle diario) del call.</summary>
        public double? CallPrevClose { get; set; }

        // Put
        public string? PutStreamerSymbol { get; set; }
        public double PutDelta { get; set; }
        public double PutGamma { get; set; }
        public double PutIV { get; set; }
        public long PutOI { get; set; }
        public double PutGEX { get; set; }
        /// <summary>Cierre del período anterior (close del candle diario) del put.</summary>
        public double? PutPrevClose { get; set; }

        // Neto
        public double NetGEX
        {
            get
            {
                return Math.Round(CallGEX + PutGEX, 4);
            }
        }
    }

    /// <summary>
    /// La banda de gamma de un lado de la cadena: dónde está apilado el open interest, como un
    /// RANGO y no como un strike. La produce <see cref="GammaExposureHandler.SelectWallBand"/>.
    ///
    /// Que sea un rango es el punto: el objeto que reemplaza —el argmax de un strike— no es una
    /// concentración, y preguntarle a una distribución cuál es su punto más alto es la pregunta
    /// equivocada cuando lo que importa es dónde está acumulada la masa.
    /// </summary>
    public class GammaBand
    {
        /// <summary>Extremo inferior del rango.</summary>
        public double Low { get; set; }

        /// <summary>Extremo superior del rango.</summary>
        public double High { get; set; }

        /// <summary>
        /// El borde EXTERNO — el extremo más lejos del spot: <see cref="High"/> del lado call,
        /// <see cref="Low"/> del lado put. Es la referencia de la banda.
        /// </summary>
        public double Edge { get; set; }

        /// <summary>Qué porcentaje del |GEX| de su lado junta la banda.</summary>
        public double PctOfSide { get; set; }

        /// <summary>
        /// La banda contra la ventana MEDIANA del mismo lado: ¿hay algo apilado acá, o es una
        /// ventana cualquiera? Cerca de 1x quiere decir que no hay muro.
        ///
        /// NO lleva umbral, y es a propósito: no hay ninguna falla observada contra la cual
        /// declararlo, y fijar un corte sobre cero observaciones es peor que no tenerlo. Se muestra
        /// como lectura de forma, no como veredicto.
        /// </summary>
        public double? XMed { get; set; }

        /// <summary>El ancho usado, en puntos de precio (<c>width_em × ExpectedMove</c>).</summary>
        public double Width { get; set; }
    }
}
