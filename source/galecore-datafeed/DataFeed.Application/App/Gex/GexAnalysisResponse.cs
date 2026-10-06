using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.Shared.Dtos;

namespace DataFeed.Application.App.Gex
{
    /// <summary>
    /// Respuesta de GET /App/Gex/Analysis. Estrategia informativa: describe el gamma exposure del
    /// símbolo y su contexto de mercado. No propone estructura, strikes, sizing ni señal de trade.
    /// </summary>
    public class GexAnalysisResponse
    {
        public string Symbol { get; set; } = "";
        public DateTime Timestamp { get; set; }
        public double SpotPrice { get; set; }

        /// <summary>true si la respuesta salió del cache del handler (ver gex.cache_seconds del JSON).</summary>
        public bool FromCache { get; set; }

        /// <summary>
        /// Estado del switch de la estrategia. En false no se barrió nada: lo que viaja es el último
        /// dato que había en cache (congelado) o vacío si nunca se barrió en esta corrida.
        /// </summary>
        public bool SwitchEnabled { get; set; } = true;

        /// <summary>
        /// true = el dato es de un barrido anterior y nadie lo va a actualizar mientras el switch
        /// esté en OFF. El tablero lo muestra con la hora del barrido para que no se lea como vigente.
        /// </summary>
        public bool Frozen { get; set; }

        /// <summary>Milisegundos que tardó el barrido de la cadena. 0 si vino del cache.</summary>
        public long ElapsedMs { get; set; }

        /// <summary>
        /// Los 6 checks de contexto (VIX, VIX TS, IV Rank, IV Momentum, GEX, Spot vs ZGL) evaluados
        /// con el JSON de GEX. El check gexTotal y spotVsZgl usan el GEX GLOBAL, no un vencimiento.
        /// Acá es lectura: `on_fail: inform_only`, no bloquea nada.
        /// </summary>
        public MacroRegimeResult? MacroRegime { get; set; }

        /// <summary>Factores de contexto de mercado (z-score, GEX skew, trend EMA, RV, flow).</summary>
        public StructureInputs? StructureInputs { get; set; }

        public GexPayload Gex { get; set; } = new();
    }

    public class GexPayload
    {
        /// <summary>Agregado de toda la cadena incluida (todos los vencimientos ≤ max_dte, incluido 0DTE).</summary>
        public GexScope Global { get; set; } = new();

        /// <summary>Desglose por vencimiento, ordenado por DTE ascendente (0DTE primero).</summary>
        public List<GexExpiryScope> ByExpiry { get; set; } = new();

        /// <summary>Parámetros efectivos del barrido, tal como salieron del nodo `gex` del JSON.</summary>
        public GexScanConfig Config { get; set; } = new();

        /// <summary>Escala de CallGex/PutGex/NetGex de Global, ByExpiry y sus strikes (BL-002).</summary>
        public GexUnits Units => GexUnits.Current;
    }

    public class GexScope
    {
        public double Spot { get; set; }
        public double CallGex { get; set; }
        public double PutGex { get; set; }
        /// <summary>Net GEX en billones de USD.</summary>
        public double NetGex { get; set; }
        public double? GammaZeroLevel { get; set; }
        public double? CallWall { get; set; }
        public double? PutWall { get; set; }
        /// <summary>Vencimientos que llegaron con datos (los que aparecen en byExpiry).</summary>
        public int ExpirationsIncluded { get; set; }

        /// <summary>Vencimientos que entraron en el barrido. Si supera a ExpirationsIncluded, el GEX está incompleto.</summary>
        public int ExpirationsRequested { get; set; }

        /// <summary>Símbolos con Greeks sobre símbolos pedidos, en % — cobertura del barrido.</summary>
        public double CoveragePct { get; set; }

        public List<GexStrike> Strikes { get; set; } = new();
    }

    public class GexExpiryScope
    {
        public string Expiration { get; set; } = "";
        public int Dte { get; set; }
        public string? ExpirationType { get; set; }
        public double CallGex { get; set; }
        public double PutGex { get; set; }
        public double NetGex { get; set; }
        public double? GammaZeroLevel { get; set; }
        public double? CallWall { get; set; }
        public double? PutWall { get; set; }
        /// <summary>
        /// La banda de gamma del lado call: dónde está apilado el open interest, como RANGO y no
        /// como strike. Es lo que la pantalla dibuja desde 2026-08-28 en lugar de
        /// <see cref="CallWall"/>, que es un argmax que salta. null = no hay banda acá, y es un
        /// resultado válido. Ver <c>GammaExposureHandler.SelectWallBand</c>.
        /// </summary>
        public GammaBand? CallBand { get; set; }

        /// <summary>La banda de gamma del lado put. Espejo de <see cref="CallBand"/>.</summary>
        public GammaBand? PutBand { get; set; }

        /// <summary>IV ATM del vencimiento (fuente: Greeks DXLink del strike más cercano al spot).</summary>
        public double? AtmIv { get; set; }
        /// <summary>spot * atmIv * sqrt(dte/365) — ver definitions.expected_move.</summary>
        public double? ExpectedMove { get; set; }
        public List<GexStrike> Strikes { get; set; } = new();
    }

    /// <summary>
    /// Fila de strike. Era el mismo shape que ValidationGexStrike —el de la cascada v1.4.0— para
    /// que el frontend reusara el chart; desde que se expone la IV por strike es un SUPERCONJUNTO
    /// de aquel. El chart sigue andando porque solo lee los campos que ya estaban.
    /// </summary>
    public class GexStrike
    {
        public double Strike { get; set; }
        public double CallGEX { get; set; }
        public double PutGEX { get; set; }
        public double NetGEX { get; set; }
        public long CallOI { get; set; }
        public long PutOI { get; set; }
        public double CallDelta { get; set; }
        public double PutDelta { get; set; }

        /// <summary>
        /// IV por strike y por lado — la superficie de volatilidad, no un promedio.
        ///
        /// Se calculaba en cada barrido y se descartaba en el mapeo hasta 2026-08-25. Es el dato
        /// que gobierna la asimetría entre lados que la investigación de GOT midió (research/got,
        /// sección 43.4): dos strikes al MISMO delta pueden tener IV muy distinta según la forma
        /// del smile, y esa pendiente es la que le resta crédito a un vertical y se lo suma al
        /// otro. Sin la IV por strike, esa asimetría solo se puede inferir de los precios.
        ///
        /// La gamma por strike sigue sin exponerse a propósito: es una función suave del
        /// moneyness, o sea que el delta ya la contiene. Lo que agrega información es lo
        /// irregular — el open interest y la superficie de IV.
        /// </summary>
        public double CallIV { get; set; }
        public double PutIV { get; set; }
    }

    public class GexScanConfig
    {
        public int MaxDte { get; set; }
        public bool IncludeZeroDte { get; set; }
        public string[] ExpirationTypes { get; set; } = Array.Empty<string>();
        public int GreeksBatchSize { get; set; }
        public int GreeksRetries { get; set; }
        public int CacheSeconds { get; set; }
        /// <summary>Cobertura mínima para que un barrido se considere cacheable. Debajo, no se guarda.</summary>
        public double CacheMinCoveragePct { get; set; }
    }
}
