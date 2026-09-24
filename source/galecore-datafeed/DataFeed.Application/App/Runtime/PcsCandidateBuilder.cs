using System.Globalization;
using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Application.App.Shared;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Construye un TradeCandidate para un Put Credit Spread (PCS) usando datos de mercado reales.
    ///
    /// Pipeline:
    ///   1. Cadena → vencimientos (DTE recalculado en fecha ET) → el más cercano al centro del rango
    ///   2. Griegas y OI de ESE vencimiento → short put por delta
    ///   3. Long put = short put strike - width
    ///   4. Quotes de ambas patas → credit = short mid - long mid
    ///   5. Armar TradeCandidate con snapshot real
    ///
    /// Datos reales o nada (GC-0002, W-1): si falta la cadena, un strike, un delta, una cotización
    /// utilizable de cualquiera de las patas o un parámetro de la spec, no hay candidato y el
    /// resultado dice por qué. Nunca se completa un precio con cero ni un parámetro con un default.
    /// Todo lo que se registra (vencimiento, DTE, strikes, deltas, precios) es del mismo vencimiento:
    /// si el cálculo de griegas no usó el elegido, no hay candidato (R1-B2).
    ///
    /// Específico para PCS. Se generaliza cuando haya más estructuras.
    /// </summary>
    public class PcsCandidateBuilder
    {
        private static readonly string[] ExpirationTypes = { "Regular", "Weekly" };

        private readonly IPcsMarketSource _market;

        public PcsCandidateBuilder(IPcsMarketSource market)
        {
            _market = market;
        }

        /// <summary>
        /// Construye un TradeCandidate PCS real, o el motivo por el que no hay candidato viable.
        /// </summary>
        public async Task<CandidateBuildResult> BuildAsync(
            StrategyInstance instance,
            StrategySpec spec,
            string symbol,
            double? vixPrice,
            DateTime nowUtc,
            CancellationToken ct = default)
        {
            var cc = spec.CandidateConstruction;

            // Leer parámetros del spec: si falta uno, no se inventa (R1-m1).
            var sellLeg = cc.Legs.FirstOrDefault(l => l.Side == "SELL" && l.Type == "PUT");
            var buyLeg = cc.Legs.FirstOrDefault(l => l.Side == "BUY" && l.Type == "PUT");
            if (sellLeg == null || buyLeg == null)
                return Rejected("la spec no declara una pata SELL PUT y una BUY PUT");

            var missing = new List<string>();
            if (sellLeg.StrikeSelection.TargetDelta == null) missing.Add("target_delta");
            if (sellLeg.StrikeSelection.DeltaTolerance == null) missing.Add("delta_tolerance");
            if (buyLeg.StrikeSelection.Width == null) missing.Add("width");
            if (cc.Constraints.MinDte == null) missing.Add("min_dte");
            if (cc.Constraints.MaxDte == null) missing.Add("max_dte");
            if (cc.Constraints.MinCredit == null) missing.Add("min_credit");
            if (missing.Count > 0)
                return Rejected($"la spec no declara {string.Join(", ", missing)}");

            double targetDelta = sellLeg.StrikeSelection.TargetDelta!.Value;
            double deltaTolerance = sellLeg.StrikeSelection.DeltaTolerance!.Value;
            double width = buyLeg.StrikeSelection.Width!.Value;
            int minDte = cc.Constraints.MinDte!.Value;
            int maxDte = cc.Constraints.MaxDte!.Value;
            double minCredit = cc.Constraints.MinCredit!.Value;

            // ── 1. Cadena → vencimiento en rango DTE ──
            // El DTE del proveedor no es confiable (ver GammaExposureHandler.NormalizeExpirations):
            // se recalcula en fecha ET contra el reloj del runtime, con la misma regla.
            var rawExpirations = await _market.GetExpirationsAsync(symbol, ct);
            if (rawExpirations == null || rawExpirations.Count == 0)
                return Rejected($"sin cadena de opciones para {symbol}");

            var today = CascadeUtils.TodayEt(new DateTimeOffset(DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc)));
            int midDte = (minDte + maxDte) / 2;
            var expiration = rawExpirations
                .Where(e => e != null && ExpirationTypes.Contains(e.ExpirationType))
                .Select(e => (e.ExpirationDate, Dte: DteFrom(e.ExpirationDate, today)))
                .Where(e => e.Dte is int d && d >= minDte && d <= maxDte)
                .Select(e => (e.ExpirationDate, Dte: e.Dte!.Value))
                .OrderBy(e => Math.Abs(e.Dte - midDte))
                .ThenBy(e => e.Dte)
                .FirstOrDefault();
            if (expiration.ExpirationDate == null)
                return Rejected($"sin vencimiento regular o weekly con DTE entre {minDte} y {maxDte}");

            string expirationDate = expiration.ExpirationDate;

            // El handler de griegas interpreta TargetDte = 0 como "el de mayor DTE": con un 0DTE
            // elegido las griegas serían de otro vencimiento. No se soporta (la spec pide 30-50).
            if (expiration.Dte == 0)
                return Rejected($"el vencimiento elegido {expirationDate} es 0DTE; el constructor no lo soporta");

            // ── 2. Griegas y OI del vencimiento elegido ──
            // Sin ExpirationTypes el handler sólo mira mensuales y puede devolver otro vencimiento.
            var gexResponse = await _market.GetGammaExposureAsync(new GammaExposureRequest
            {
                Symbol = symbol,
                TargetDte = expiration.Dte,
                MaxDTE = maxDte,
                ExpirationTypes = ExpirationTypes,
                IncludeZeroDte = minDte == 0,
            }, ct);

            if (gexResponse == null)
                return Rejected($"sin griegas para el vencimiento {expirationDate}");
            if (gexResponse.Expiration != expirationDate)
                return Rejected($"las griegas son del vencimiento {gexResponse.Expiration ?? "(ninguno)"}, "
                                + $"no del elegido {expirationDate}");
            if (gexResponse.Strikes == null || gexResponse.Strikes.Count == 0)
                return Rejected($"sin strikes con griegas para el vencimiento {expirationDate}");

            int dte = gexResponse.DTE;
            double spot = gexResponse.Spot;
            if (!(spot > 0))
                return Rejected($"sin precio del subyacente {symbol}");

            // ── 3. Encontrar short put por delta ──
            // Puts OTM (strike < spot) con delta cercano al target. Put delta es negativo.
            var shortPutStrike = gexResponse.Strikes
                .Where(s => s.Strike < spot && s.PutDelta < 0 && s.PutDelta > -0.5)
                .OrderBy(s => Math.Abs(s.PutDelta - targetDelta))
                .FirstOrDefault();

            if (shortPutStrike == null)
                return Rejected("sin puts fuera del dinero con delta válido");

            if (Math.Abs(shortPutStrike.PutDelta - targetDelta) > deltaTolerance)
                return Rejected($"el delta más cercano ({shortPutStrike.PutDelta:0.000}) está fuera de ±{deltaTolerance} "
                                + $"del objetivo {targetDelta}");

            // ── 4. Long put = short strike - width ──
            double longPutStrikePrice = shortPutStrike.Strike - width;
            var longPutStrike = gexResponse.Strikes
                .OrderBy(s => Math.Abs(s.Strike - longPutStrikePrice))
                .FirstOrDefault();

            if (longPutStrike == null || Math.Abs(longPutStrike.Strike - longPutStrikePrice) > 1.0)
                return Rejected($"no hay strike para la pata comprada cerca de {longPutStrikePrice}");

            // ── 5. Cotizaciones reales de ambas patas (por símbolo de streamer) ──
            string? shortSymbol = shortPutStrike.PutStreamerSymbol;
            string? longSymbol = longPutStrike.PutStreamerSymbol;
            if (string.IsNullOrEmpty(shortSymbol) || string.IsNullOrEmpty(longSymbol))
                return Rejected("falta el símbolo de streamer de una pata; no se puede cotizar");

            var shortQuote = await _market.GetQuoteAsync(shortSymbol, ct);
            if (shortQuote == null)
                return Rejected($"sin cotización utilizable para la pata vendida {shortSymbol}");
            var longQuote = await _market.GetQuoteAsync(longSymbol, ct);
            if (longQuote == null)
                return Rejected($"sin cotización utilizable para la pata comprada {longSymbol}");

            // Frescura por pata: una pata vieja o con hora futura descarta el candidato aunque la otra
            // no tenga hora (Codex C1). Sin hora, la edad no se puede medir (ver DataFreshness).
            var maxAge = DataFreshness.MaxAge(spec);
            foreach (var (legName, legSymbol, quote) in new[] { ("vendida", shortSymbol, shortQuote), ("comprada", longSymbol, longQuote) })
            {
                var problem = DataFreshness.Problem(quote.AsOf, nowUtc, maxAge);
                if (problem != null)
                    return Rejected($"cotización de la pata {legName} {legSymbol} no utilizable: {problem}");
            }

            // Credit = short mid - long mid
            double credit = Math.Round(shortQuote.Mid - longQuote.Mid, 2);
            if (!double.IsFinite(credit))
                return Rejected($"crédito no finito ({credit})");

            if (credit < minCredit)
                return Rejected($"crédito {credit} menor al mínimo {minCredit}");

            double actualWidth = shortPutStrike.Strike - longPutStrike.Strike;
            double maxRisk = Math.Round((actualWidth - credit) * 100, 2);
            if (!double.IsFinite(maxRisk))
                return Rejected($"riesgo máximo no finito ({maxRisk})");

            // ── 6. Construir OCC symbols ──
            string shortOcc = CascadeUtils.BuildOccSymbol(symbol, expirationDate, shortPutStrike.Strike, 'P');
            string longOcc = CascadeUtils.BuildOccSymbol(symbol, expirationDate, longPutStrike.Strike, 'P');

            // La hora más vieja entre las patas que la informan; las que no, se cuentan aparte.
            var knownTimes = new[] { shortQuote.AsOf, longQuote.AsOf }.Where(t => t.HasValue).Select(t => t!.Value).ToList();
            DateTime? oldestQuoteAt = knownTimes.Count > 0 ? knownTimes.Min() : null;
            int quotesWithoutTime = 2 - knownTimes.Count;

            // ── 7. Armar TradeCandidate ──
            return CandidateBuildResult.Built(new TradeCandidate
            {
                CandidateId = Guid.NewGuid().ToString(),
                InstanceId = instance.InstanceId,
                Symbol = symbol,
                Structure = spec.Structure.DefaultStructure,
                Credit = credit,
                MaxRisk = maxRisk,
                Width = actualWidth,
                Dte = dte,
                DeltaShort = shortPutStrike.PutDelta,
                Legs = new List<CandidateLeg>
                {
                    new()
                    {
                        Side = "SELL",
                        Type = "PUT",
                        Strike = shortPutStrike.Strike,
                        Expiration = expirationDate,
                        OccSymbol = shortOcc,
                        StreamerSymbol = shortSymbol,
                        Delta = shortPutStrike.PutDelta,
                        Bid = shortQuote.Bid,
                        Ask = shortQuote.Ask
                    },
                    new()
                    {
                        Side = "BUY",
                        Type = "PUT",
                        Strike = longPutStrike.Strike,
                        Expiration = expirationDate,
                        OccSymbol = longOcc,
                        StreamerSymbol = longSymbol,
                        Delta = longPutStrike.PutDelta,
                        Bid = longQuote.Bid,
                        Ask = longQuote.Ask
                    }
                },
                Snapshot = new MarketSnapshot
                {
                    UnderlyingPrice = spot,
                    Vix = vixPrice,
                    AsOf = nowUtc,
                    OldestQuoteAt = oldestQuoteAt,
                    QuotesWithoutTime = quotesWithoutTime,
                },
                CreatedAt = nowUtc
            });
        }

        /// <summary>DTE en fecha ET; null si la fecha no parsea o el vencimiento ya pasó.</summary>
        private static int? DteFrom(string? expirationDate, DateTime todayEt)
        {
            if (!DateTime.TryParseExact(expirationDate, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                    DateTimeStyles.None, out var date))
                return null;
            int dte = (date.Date - todayEt).Days;
            return dte < 0 ? null : dte;
        }

        private static CandidateBuildResult Rejected(string reason) => CandidateBuildResult.Rejected(reason);
    }
}
