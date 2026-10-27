using System.Text.Json.Nodes;
using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.ImpliedVolatility;
using DataFeed.Application.App.IVRank;
using DataFeed.Application.App.Shared.Dtos;
using DataFeed.Application.Data.Tastytrade.MarketDataCandle;
using DataFeed.Application.Data.Tastytrade.MarketDataQuote;

namespace DataFeed.Application.App.Shared
{
    /// <summary>
    /// Primitivos de cálculo compartidos entre motores de decisión (hoy RPF y GEX).
    /// Funciones puras sobre datos de mercado y nodos JSON de reglas — sin I/O ni estado.
    /// Cada estrategia le pasa SU propio JSON: los primitivos no saben de qué estrategia son.
    /// Contratos de salida en <see cref="Dtos"/>.
    /// </summary>
    public static class CascadeUtils
    {
        // ═══════════════════════════════════════════════════════════════════════
        // JSON helpers
        // ═══════════════════════════════════════════════════════════════════════

        internal static JsonNode? FindCheck(JsonArray? checks, string checkId)
        {
            if (checks == null) return null;
            return checks.FirstOrDefault(c => c?["id"]?.GetValue<string>() == checkId);
        }

        internal static JsonNode? GetPositionBuilderLayer(JsonObject rules, int layerId)
        {
            var layers = rules["position_builder"]?["layers"]?.AsArray();
            if (layers == null) return null;
            return layers.FirstOrDefault(l => l?["id"]?.GetValue<int>() == layerId);
        }

        internal static double? GetCheckThresholdValue(JsonArray? checks, string checkId)
        {
            var check = FindCheck(checks, checkId);
            return check?["threshold"]?["value"]?.GetValue<double>();
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Layer 1 — macro_regime
        // Lee de: rules["macro_regime"]["checks"] + rules["definitions"]
        // ═══════════════════════════════════════════════════════════════════════

        /// <summary>
        /// Evalúa los 6 checks de régimen macro contra el JSON de la estrategia que se le pase.
        /// Es el mismo cálculo para todas: lo que cambia son los umbrales del JSON. RPF lo usa como
        /// gate de estado; GEX lo usa como lectura (sus checks declaran on_fail: inform_only).
        /// </summary>
        /// <param name="vix">
        /// VIX real (índice CBOE), no la IV del símbolo. Lo trae el llamador con
        /// MarketDataTradeRequest{Symbol="VIX"}. Es macro: el mismo valor para todos los símbolos.
        /// Sin parámetro por defecto a propósito — que un call site nuevo no compile es preferible
        /// a que caiga en silencio al proxy viejo.
        /// </param>
        /// <param name="vix9d">
        /// VIX9D (índice CBOE de 9 días). Igual que <paramref name="vix"/>: macro, mismo valor para
        /// todos los símbolos, y sin default para que un call site nuevo no compile en vez de
        /// degradar en silencio.
        /// </param>
        public static MacroRegimeResult EvaluateLayer1(
            JsonObject rules, string symbol,
            GammaExposureResponse gex, IVRankResponse ivr, ImpliedVolatilityResponse iv,
            double? vix, double? vix9d)
        {
            var macroChecks = rules["macro_regime"]?["checks"]?.AsArray();
            var definitions = rules["definitions"];

            // --- VIX Absolute — VIX real, NO la IV del símbolo ---
            // Hasta 2026-08-10 esto usaba iv.IV30_30d como proxy. En SPY coincidía por casualidad
            // (IV30 ≈ VIX) y por eso nunca se notó; con el universo multi-símbolo de GEX cada símbolo
            // reportaba "su" VIX (SKM 77.2 → check en rojo declarando pánico donde solo había un ADR
            // ilíquido con IV alta). Un índice único no puede tener un valor por símbolo.
            // Sin dato de VIX el check NO pasa: fail-closed, porque en RPF su on_fail es no_trade.
            var vixAbsDef = FindCheck(macroChecks, "vix_absolute");
            double maxVix = vixAbsDef?["threshold"]?["value"]?.GetValue<double>() ?? 30.0;
            bool vixAbsPassed = vix.HasValue && vix.Value < maxVix;

            var vixAbsoluteCheck = new VixAbsoluteCheck
            {
                Passed = vixAbsPassed,
                Value = vix,
                Threshold = maxVix
            };

            var vixTSCheck = EvaluateVixTermStructure(vix9d, vix);
            bool vixTSPassed = vixTSCheck.Passed;

            // --- IV Rank ---
            var ivRankDef = FindCheck(macroChecks, "iv_rank");
            double ivMin = ivRankDef?["threshold"]?["min"]?.GetValue<double>() ?? 25;
            double ivMax = ivRankDef?["threshold"]?["max"]?.GetValue<double>() ?? 65;
            bool ivRankPassed = ivr.IVRank >= ivMin && ivr.IVRank <= ivMax;

            var ivRankCheck = new IVRankCheck
            {
                Passed = ivRankPassed,
                Value = ivr.IVRank,
                Min = ivMin,
                Max = ivMax
            };

            // --- IV Momentum ---
            var ivMomDef = FindCheck(macroChecks, "iv_momentum");
            double ivMomentumThreshold = ivMomDef?["threshold"]?["value"]?.GetValue<double>() ?? 12.0;
            bool ivMomentumPassed = iv.IV30RocPct.HasValue && Math.Abs(iv.IV30RocPct.Value) <= ivMomentumThreshold;

            var ivMomentumCheck = new IVMomentumCheck
            {
                Passed = ivMomentumPassed,
                Value = iv.IV30RocPct,
                Threshold = ivMomentumThreshold
            };

            // --- GEX Total (threshold por símbolo desde definitions) ---
            // Sin umbral declarado no hay contra qué comparar: el check no pasa y se informa
            // Threshold = null. No hay default — un default inventado hacía que un símbolo sin
            // configurar diera un veredicto (verde o rojo) que nadie definió. El tablero muestra
            // esa celda apagada; el JSON es el único que decide qué símbolos se evalúan.
            var gexThresholdNode = definitions?["gex_threshold_by_symbol"]?["values"]?[symbol];
            double? gexThreshold = gexThresholdNode?.GetValue<double>();
            double gexValue = gex.NetGEX;
            bool gexPassed = gexThreshold.HasValue && gexValue >= gexThreshold.Value;

            var gexCheck = new GexTotalCheck
            {
                Passed = gexPassed,
                Value = gexValue,
                Metric = "billions_usd",
                Threshold = gexThreshold,
                ThresholdDeclared = gexThreshold.HasValue
            };

            // --- Spot vs ZGL (buffer desde definitions) ---
            double bufferPct = definitions?["zgl_with_buffer"]?["buffer_pct"]?.GetValue<double>() ?? 0.005;
            bool spotPassed = gex.GammaZeroLevel.HasValue
                && gex.Spot >= gex.GammaZeroLevel.Value * (1 + bufferPct);

            var spotCheck = new SpotVsZglCheck
            {
                Passed = spotPassed,
                Spot = gex.Spot,
                ZGL = gex.GammaZeroLevel,
                BufferPct = bufferPct
            };

            // --- Signal ---
            var checks = new[] { vixAbsPassed, vixTSPassed, ivRankPassed, ivMomentumPassed, gexPassed, spotPassed };
            int passed = checks.Count(c => c);
            int total = checks.Length;

            string signal = passed == total ? "OPERAR"
                : passed >= total - 1 ? "ESPERAR"
                : "NO_OPERAR";

            return new MacroRegimeResult
            {
                Signal = signal,
                PassedCount = passed,
                TotalChecks = total,
                Checks = new MacroRegimeChecks
                {
                    VixAbsolute = vixAbsoluteCheck,
                    VixTermStructure = vixTSCheck,
                    IVRank = ivRankCheck,
                    IVMomentum = ivMomentumCheck,
                    GexTotal = gexCheck,
                    SpotVsZgl = spotCheck
                }
            };
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Multi-factor computations
        // ═══════════════════════════════════════════════════════════════════════

        internal static double ComputePriceZScore(List<CandleData> candles, double ivAtm)
        {
            if (candles.Count < 6 || ivAtm <= 0)
                return 0;

            double closeToday = candles[^1].Close;
            double close5dAgo = candles[^6].Close;

            if (close5dAgo <= 0 || closeToday <= 0)
                return 0;

            double ret5d = Math.Log(closeToday / close5dAgo);
            double dailySigma = ivAtm / Math.Sqrt(252);

            return dailySigma > 0 ? ret5d / dailySigma : 0;
        }

        internal static string ComputeGexSkew(double callGex, double putGex)
        {
            double denominator = callGex + Math.Abs(putGex);
            if (denominator == 0) return "symmetric";
            double skew = callGex / denominator;
            return skew > 0.6 ? "call_dominant" : skew < 0.4 ? "put_dominant" : "symmetric";
        }

        internal static (double? ema20, double? ema50, string signal) ComputeTrend(List<CandleData> candles)
        {
            if (candles.Count < 50)
                return (null, null, "unavailable");

            double ema20 = ComputeEMA(candles, 20);
            double ema50 = ComputeEMA(candles, 50);

            if (ema50 <= 0)
                return (ema20, ema50, "unavailable");

            double diff = Math.Abs(ema20 - ema50) / ema50;

            string signal;
            if (diff < 0.002)
                signal = "neutral";
            else if (ema20 > ema50)
                signal = "up";
            else
                signal = "down";

            return (ema20, ema50, signal);
        }

        internal static double ComputeEMA(List<CandleData> candles, int period)
        {
            if (candles.Count < period)
                return 0;

            double sma = candles.Take(period).Average(c => c.Close);
            double k = 2.0 / (period + 1);
            double ema = sma;

            for (int i = period; i < candles.Count; i++)
            {
                ema = candles[i].Close * k + ema * (1 - k);
            }

            return ema;
        }

        internal static (double? rv10d, double? rv30d, string signal) ComputeRealizedVol(List<CandleData> candles)
        {
            if (candles.Count < 31)
                return (null, null, "unavailable");

            var logReturns = new List<double>();
            for (int i = 1; i < candles.Count; i++)
            {
                if (candles[i - 1].Close > 0 && candles[i].Close > 0)
                    logReturns.Add(Math.Log(candles[i].Close / candles[i - 1].Close));
            }

            if (logReturns.Count < 30)
                return (null, null, "unavailable");

            double rv10d = ComputeAnnualizedVol(logReturns, 10);
            double rv30d = ComputeAnnualizedVol(logReturns, 30);

            string signal = rv10d > rv30d ? "high" : "low";

            return (rv10d, rv30d, signal);
        }

        internal static double ComputeAnnualizedVol(List<double> logReturns, int window)
        {
            if (logReturns.Count < window)
                return 0;

            var recent = logReturns.Skip(logReturns.Count - window).Take(window).ToList();
            double mean = recent.Average();
            double variance = recent.Sum(r => (r - mean) * (r - mean)) / (window - 1);
            double stddev = Math.Sqrt(variance);

            return stddev * Math.Sqrt(252) * 100;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Structure resolution
        // ═══════════════════════════════════════════════════════════════════════

        internal static (string structure, int? ruleId, string? ruleName, string? ruleLabel) ResolveStructure(
            JsonNode? structureConfig, double priceZScore, string gexSkew, string trendSignal,
            double neutralZ, double extremeZ)
        {
            bool enabled = structureConfig?["enabled"]?.GetValue<bool>() ?? true;
            if (!enabled)
            {
                string forced = structureConfig?["forced_structure_while_disabled"]?.GetValue<string>()
                    ?? "put_credit_spread";
                return (forced, null, "forced_pcs_only", "PCS-only (motor multi_factor desactivado)");
            }

            return EvaluateStructureRules(structureConfig, priceZScore, gexSkew, trendSignal, neutralZ, extremeZ);
        }

        internal static (string structure, int? ruleId, string? ruleName, string? ruleLabel) EvaluateStructureRules(
            JsonNode? structureConfig, double priceZScore, string gexSkew, string trendSignal,
            double neutralZ, double extremeZ)
        {
            var rulesArray = structureConfig?["rules"]?.AsArray();
            if (rulesArray == null)
                return ("iron_condor", null, null, null);

            foreach (var rule in rulesArray)
            {
                if (rule == null) continue;

                var conditions = rule["conditions"];
                string? output = rule["output"]?.GetValue<string>();
                int? id = rule["id"]?.GetValue<int>();
                string? name = rule["name"]?.GetValue<string>();
                string? label = rule["label"]?.GetValue<string>();

                if (conditions is JsonValue condValue && condValue.GetValue<string>() == "fallthrough")
                    return (output ?? "no_trade", id, name, label);

                if (conditions is not JsonObject condObj)
                    continue;

                bool allConditionsMet = true;

                foreach (var cond in condObj)
                {
                    bool condMet = EvaluateCondition(cond.Key, cond.Value?.GetValue<string>(),
                        priceZScore, gexSkew, trendSignal, neutralZ, extremeZ);

                    if (!condMet)
                    {
                        allConditionsMet = false;
                        break;
                    }
                }

                if (allConditionsMet)
                    return (output ?? "iron_condor", id, name, label);
            }

            return ("no_trade", 6, "no_trade_fallthrough", "Sin señal — ninguna condición satisfecha");
        }

        internal static bool EvaluateCondition(string conditionKey, string? conditionValue,
            double priceZScore, string gexSkew, string trendSignal,
            double neutralZ, double extremeZ)
        {
            return conditionKey switch
            {
                "price_zscore_abs" => Math.Abs(priceZScore) < neutralZ,
                "price_zscore" when conditionValue?.Contains(">") == true => priceZScore > extremeZ,
                "price_zscore" when conditionValue?.Contains("<") == true => priceZScore < -extremeZ,
                "gex_skew" => gexSkew == conditionValue,
                "trend" => trendSignal == conditionValue,
                _ => true
            };
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Strike helpers
        // ═══════════════════════════════════════════════════════════════════════

        internal static double SnapToNearestStrike(List<GammaExposureStrike> strikes, double target)
        {
            if (strikes == null || strikes.Count == 0)
                return target;

            var nearest = strikes.OrderBy(s => Math.Abs(s.Strike - target)).FirstOrDefault();
            return nearest?.Strike ?? target;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Microstructure checks
        // ═══════════════════════════════════════════════════════════════════════

        internal static BidAskChecks BuildBidAskChecks(
            Dictionary<string, QuoteEvent?> quotes, StrikeEngineResult strikeEngine, double maxPct)
        {
            return new BidAskChecks
            {
                ShortPut = strikeEngine.ShortPutStrike.HasValue
                    ? BuildSingleBidAskCheck(quotes.GetValueOrDefault("shortPut"), maxPct) : null,
                ShortCall = strikeEngine.ShortCallStrike.HasValue
                    ? BuildSingleBidAskCheck(quotes.GetValueOrDefault("shortCall"), maxPct) : null,
                LongPut = strikeEngine.LongPutStrike.HasValue
                    ? BuildSingleBidAskCheck(quotes.GetValueOrDefault("longPut"), maxPct) : null,
                LongCall = strikeEngine.LongCallStrike.HasValue
                    ? BuildSingleBidAskCheck(quotes.GetValueOrDefault("longCall"), maxPct) : null
            };
        }

        internal static BidAskLegCheck BuildSingleBidAskCheck(QuoteEvent? quote, double maxPct)
        {
            if (quote == null || quote.MidPrice <= 0)
                return new BidAskLegCheck { Passed = false, SpreadPct = null, MaxAllowed = maxPct };

            double spreadPct = (quote.AskPrice - quote.BidPrice) / quote.MidPrice;
            return new BidAskLegCheck
            {
                Passed = spreadPct <= maxPct,
                SpreadPct = Math.Round(spreadPct, 4),
                MaxAllowed = maxPct
            };
        }

        internal static CreditMinimumCheck BuildCreditCheck(
            Dictionary<string, QuoteEvent?> quotes, StrikeEngineResult strikeEngine, double minRequired)
        {
            double totalCredit = 0;
            bool hasValidQuotes = true;

            if (strikeEngine.ShortPutStrike.HasValue && strikeEngine.LongPutStrike.HasValue)
            {
                var shortQuote = quotes.GetValueOrDefault("shortPut");
                var longQuote = quotes.GetValueOrDefault("longPut");

                if (shortQuote == null || shortQuote.MidPrice <= 0
                    || longQuote == null || longQuote.MidPrice <= 0)
                {
                    hasValidQuotes = false;
                }
                else
                {
                    totalCredit += shortQuote.MidPrice - longQuote.MidPrice;
                }
            }

            if (strikeEngine.ShortCallStrike.HasValue && strikeEngine.LongCallStrike.HasValue)
            {
                var shortQuote = quotes.GetValueOrDefault("shortCall");
                var longQuote = quotes.GetValueOrDefault("longCall");

                if (shortQuote == null || shortQuote.MidPrice <= 0
                    || longQuote == null || longQuote.MidPrice <= 0)
                {
                    hasValidQuotes = false;
                }
                else
                {
                    totalCredit += shortQuote.MidPrice - longQuote.MidPrice;
                }
            }

            return new CreditMinimumCheck
            {
                Passed = hasValidQuotes && totalCredit >= minRequired,
                MidCredit = Math.Round(totalCredit, 2),
                MinRequired = minRequired
            };
        }

        // ═══════════════════════════════════════════════════════════════════════
        // VIX term structure
        // ═══════════════════════════════════════════════════════════════════════

        /// <summary>
        /// Contango del VIX: VIX9D por debajo del VIX de 30 días es lo normal; invertido
        /// (backwardation) señala estrés de corto plazo, que es cuando el check tiene que frenar.
        ///
        /// Hasta 2026-08-10 esto comparaba la IV del propio símbolo a 9d y 30d. Eso SÍ es una curva,
        /// pero del símbolo barrido y no del mercado — el mismo error de categoría que tenía
        /// vix_absolute. Y el JSON de RPF declaraba una TERCERA cosa: el cierre del VIX de hace 9 días
        /// contra el de hace 30, que son dos puntos de la misma serie en el pasado, o sea una
        /// tendencia y no una estructura temporal. Los dos JSON quedaron unificados en VIX9D vs VIX.
        ///
        /// A DIFERENCIA de vix_absolute, sin dato NO bloquea (on_no_data: pass en el JSON): el feed
        /// DXLink tiene caídas intermitentes sin causa identificada y fail-closed acá frenaría toda la
        /// operatoria de RPF en silencio. Se marca NoData para que el tablero lo distinga de un pass
        /// legítimo — un ✓ verde por falta de datos escondería que la guarda dejó de correr.
        ///
        /// Vive acá y no inline en los dos motores a propósito: es la cuarta vez en el día que una
        /// lógica duplicada entre CascadeUtils y RpfTickHandler diverge o casi.
        /// </summary>
        public static VixTermStructureCheck EvaluateVixTermStructure(double? vix9d, double? vix)
        {
            bool hasData = vix9d.HasValue && vix.HasValue;
            return new VixTermStructureCheck
            {
                Passed = !hasData || vix9d!.Value < vix!.Value,
                NoData = !hasData,
                Vix9d = vix9d,
                Vix30d = vix,
            };
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Tiempo a vencimiento (expected move)
        // ═══════════════════════════════════════════════════════════════════════

        /// <summary>Zona del mercado. .NET 6+ resuelve IDs IANA también en Windows; el fallback cubre
        /// el modo de globalización invariante, donde solo existen los IDs de Windows.</summary>
        private static readonly TimeZoneInfo EtZone = ResolveEtZone();

        private static TimeZoneInfo ResolveEtZone()
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById("America/New_York"); }
            catch (TimeZoneNotFoundException) { return TimeZoneInfo.FindSystemTimeZoneById("Eastern Standard Time"); }
        }

        /// <summary>
        /// La fecha de HOY en la zona del mercado. Es la referencia contra la que se mide un
        /// vencimiento: la fecha local de la máquina no sirve —el servidor puede estar en otro
        /// huso, y de hecho lo está— y la UTC tampoco, porque de 20:00 ET a medianoche ya es el
        /// día siguiente en UTC mientras el mercado sigue siendo el de hoy.
        /// </summary>
        public static DateTime TodayEt(DateTimeOffset? nowUtc = null) =>
            TimeZoneInfo.ConvertTime(nowUtc ?? DateTimeOffset.UtcNow, EtZone).Date;

        /// <summary>Rueda regular de EE. UU.: lunes a viernes, 9:30 a 16:00 ET (los feriados no se descuentan).</summary>
        public static bool IsRegularSessionEt(DateTimeOffset? nowUtc = null)
        {
            var et = TimeZoneInfo.ConvertTime(nowUtc ?? DateTimeOffset.UtcNow, EtZone);
            if (et.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday) return false;
            var t = et.TimeOfDay;
            return t >= new TimeSpan(9, 30, 0) && t < new TimeSpan(16, 0, 0);
        }

        /// <summary>
        /// Años hasta el vencimiento, para el expected move (spot · IV · √T).
        ///
        /// DTE &gt; 0: se mantiene la convención de días calendario (dte/365), que es la que produjo
        /// todos los números que el operador viene mirando. Cambiarla movería TODOS los expected move
        /// del tablero, no solo el del 0DTE.
        ///
        /// DTE = 0: acá el entero de días miente. A media rueda quedan horas de sesión y contarlas
        /// como cero colapsaba el producto entero — el panel mostraba "±0.0 pts" justo en el
        /// vencimiento donde más movimiento se espera. Se usa el resto real de la rueda hasta el
        /// cierre (16:00 ET; SPY y los ETFs son PM-settled). Queda continuo con el tramo anterior:
        /// a las 15:59 del día previo el DTE es 1 y faltan ~24h, que es exactamente 1/365.
        ///
        /// Devuelve null si ya venció (pasó el cierre, o DTE negativo): sin tiempo no hay movimiento
        /// esperado que reportar, y null hace que el tablero muestre "—" en vez de un cero que se
        /// leería como "no se espera que se mueva".
        /// </summary>
        /// <param name="nowUtc">Inyectable para test; por defecto, ahora.</param>
        public static double? YearsToExpiry(int dte, DateTimeOffset? nowUtc = null)
        {
            if (dte > 0) return dte / 365.0;
            if (dte < 0) return null;

            var etNow = TimeZoneInfo.ConvertTime(nowUtc ?? DateTimeOffset.UtcNow, EtZone);
            // El cierre es el mismo día y el offset no cambia entre las 00:00 y las 16:00 (los saltos
            // de DST son a las 02:00, y ese día el mercado no abre a horario distinto).
            var close = new DateTimeOffset(etNow.Year, etNow.Month, etNow.Day, 16, 0, 0, etNow.Offset);

            double hoursLeft = (close - etNow).TotalHours;
            return hoursLeft <= 0 ? null : hoursLeft / (24.0 * 365.0);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Regime classification
        // ═══════════════════════════════════════════════════════════════════════

        public static string ClassifyRegime(JsonNode? regimeClassification, double? vix)
        {
            if (vix is not > 0) return "normal";
            var ranges = regimeClassification?["ranges"]?.AsArray();
            if (ranges != null)
            {
                foreach (var r in ranges)
                {
                    double min = r?["min"]?.GetValue<double>() ?? double.MinValue;
                    double max = r?["max"]?.GetValue<double>() ?? double.MaxValue;
                    if (vix.Value >= min && vix.Value < max)
                        return r?["value"]?.GetValue<string>() ?? "normal";
                }
            }
            return "normal";
        }

        // ═══════════════════════════════════════════════════════════════════════
        // OCC symbol builder
        // ═══════════════════════════════════════════════════════════════════════

        internal static string BuildOccSymbol(string underlying, string expiration, double strike, char optionType)
        {
            string symbolPart = underlying.PadRight(6);
            var dt = DateTime.Parse(expiration);
            string datePart = dt.ToString("yyMMdd");
            long strikeInt = (long)(strike * 1000);
            string strikePart = strikeInt.ToString("D8");

            return symbolPart + datePart + optionType + strikePart;
        }
    }
}
