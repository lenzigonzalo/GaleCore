using MediatR;

namespace DataFeed.Application.App.GammaExposure
{
    public class GammaExposureRequest : IRequest<GammaExposureResponse>
    {
        /// <summary>
        /// Símbolo del subyacente (ej: AAPL, MSFT, SPY)
        /// </summary>
        public string Symbol { get; set; }

        /// <summary>
        /// Máximo DTE para filtrar expiraciones (default: 60)
        /// </summary>
        public int MaxDTE { get; set; } = 60;

        // ═══════════════════════════════════════════════════════════════════
        // Modo global (estrategia GEX) — opt-in. Con todos los defaults el
        // handler se comporta exactamente como antes: una sola expiración.
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// true = agrega TODAS las expiraciones dentro de MaxDTE (GEX global).
        /// false (default) = solo la expiración más cercana, como siempre.
        /// </summary>
        public bool AllExpirations { get; set; } = false;

        /// <summary>
        /// true = además del agregado, devuelve el desglose por vencimiento en <c>ByExpiry</c>.
        /// </summary>
        public bool IncludeByExpiry { get; set; } = false;

        /// <summary>
        /// Tipos de expiración a incluir. null (default) = solo "Regular", el comportamiento histórico.
        /// La estrategia GEX pasa ["Regular", "Weekly"].
        /// </summary>
        public string[]? ExpirationTypes { get; set; } = null;

        /// <summary>
        /// true = incluye el vencimiento del día (DTE 0). Default false: el filtro histórico exige DTE &gt; 0.
        /// </summary>
        public bool IncludeZeroDte { get; set; } = false;

        /// <summary>
        /// DTE objetivo para el modo de UN vencimiento. 0 (default) = comportamiento histórico:
        /// se elige el de MAYOR DTE dentro de <see cref="MaxDTE"/>. Con un valor &gt; 0 se elige el
        /// más cercano a ese DTE.
        ///
        /// Existe porque "el mayor dentro de 60" produce una serie que NO es comparable consigo
        /// misma: como los Regular son mensuales, el elegido salta de vencimiento una vez por mes
        /// y con él salta el DTE medido. En skew25_history.json eso se vio como un escalón de
        /// +0.038 en SPY y +0.034 en QQQ el 2026-08-18 —los dos símbolos el mismo día, que es la
        /// firma de un cambio de método y no de mercado—, cuando el vencimiento medido pasó de
        /// 2026-09-18 (DTE 35) a 2026-10-16 (DTE 59). El skew es función del DTE, así que el
        /// escalón era puro cambio de plazo, y entraba al RoC 5d del gate tail_score como si
        /// fuera precio de cola.
        /// </summary>
        public int TargetDte { get; set; } = 0;

        /// <summary>
        /// Tamaño de lote para pedir Greeks a DXLink. 0 (default) = un solo pedido con todos los símbolos.
        /// Con la cadena completa son miles de símbolos y conviene trocearlos.
        /// </summary>
        public int GreeksBatchSize { get; set; } = 0;

        /// <summary>
        /// Reintentos del snapshot de Greeks sobre los símbolos que no contestaron. 0 (default) =
        /// una sola pasada, el comportamiento histórico. Sin reintentos, un lote que agota el
        /// timeout se lleva puestos vencimientos enteros y el GEX cambia entre corridas.
        /// </summary>
        public int GreeksRetries { get; set; } = 0;

        /// <summary>Banda de |delta| para pedir OI (Candle). Fuera de la banda el gamma es ≈ 0.</summary>
        public double OiDeltaMin { get; set; } = 0.02;

        /// <summary>Banda de |delta| para pedir OI (Candle).</summary>
        public double OiDeltaMax { get; set; } = 0.98;

        /// <summary>
        /// Ancho de la banda de gamma, en Expected Moves. Lo declara <c>gex.wall_band.width_em</c>;
        /// el default es el mismo valor, para que el handler se comporte igual sin config.
        ///
        /// Sin calibrar, y está medido que mueve el borde ($9.6 en promedio con ±20%). Eso importa
        /// menos de lo que parece acá: en una pantalla informativa el ancho cambia dónde se dibuja
        /// el rango, no un veredicto — no hay ninguno.
        /// </summary>
        public double WallBandWidthEm { get; set; } = GammaExposureHandler.WallBandWidthEm;

        /// <summary>
        /// Semiancho de la zona del dinero que se excluye del pool de la banda, en Expected Moves.
        /// Lo declara <c>gex.wall_band.money_zone_em</c>. Sin esto la ventana más densa puede ser
        /// la pila de gamma del dinero en vez de un muro.
        /// </summary>
        public double WallBandMoneyZoneEm { get; set; } = GammaExposureHandler.WallBandMoneyZoneEm;
    }
}
