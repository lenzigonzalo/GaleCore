using System.Globalization;
using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Application.App.Shared;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Las estructuras que el runtime SHADOW sabe construir (P1-07). Cada una es uno o dos spreads verticales de
    /// crédito del mismo vencimiento: un lado de puts, uno de calls, o los dos (iron condor).
    /// </summary>
    public static class RuntimeStructures
    {
        public const string PutCreditSpread = "put_credit_spread";
        public const string CallCreditSpread = "call_credit_spread";
        public const string IronCondor = "iron_condor";

        /// <summary>Acciones en largo (WS-0061): una pata BUY del subyacente, sin opciones.</summary>
        public const string LongEquity = "long_equity";

        public static readonly string[] Supported = { PutCreditSpread, CallCreditSpread, IronCondor, LongEquity };

        public static bool IsSupported(string structure) => Sides(structure) != null || structure == LongEquity;

        /// <summary>Los lados ("PUT", "CALL") de la estructura, en ese orden; null si el runtime no la construye.</summary>
        public static string[]? Sides(string structure) => structure switch
        {
            PutCreditSpread => new[] { "PUT" },
            CallCreditSpread => new[] { "CALL" },
            IronCondor => new[] { "PUT", "CALL" },
            _ => null,
        };
    }

    /// <summary>
    /// Construye un TradeCandidate de crédito (PCS, CCS o iron condor, según structure.default_structure) usando
    /// datos de mercado reales.
    ///
    /// Pipeline:
    ///   1. Cadena → vencimientos (DTE recalculado en fecha ET) → el más cercano al centro del rango
    ///   2. Griegas y OI de ESE vencimiento → en cada lado, la pata vendida por delta (put &lt; 0, call &gt; 0)
    ///   3. Pata comprada = vendida ∓ ancho (put abajo, call arriba)
    ///   4. Quotes de todas las patas → crédito = mids vendidos − mids comprados
    ///   5. Riesgo máximo = (ancho mayor − crédito) × 100: en un iron condor sólo un lado puede perder a la vez
    ///
    /// Datos reales o nada (GC-0002, W-1): si falta la cadena, un strike, un delta, una cotización
    /// utilizable de cualquiera de las patas o un parámetro de la spec, no hay candidato y el
    /// resultado dice por qué. Nunca se completa un precio con cero ni un parámetro con un default.
    /// Todo lo que se registra (vencimiento, DTE, strikes, deltas, precios) es del mismo vencimiento:
    /// si el cálculo de griegas no usó el elegido, no hay candidato (R1-B2).
    /// </summary>
    public class CreditSpreadCandidateBuilder
    {
        private static readonly string[] ExpirationTypes = { "Regular", "Weekly" };

        private readonly IPcsMarketSource _market;

        public CreditSpreadCandidateBuilder(IPcsMarketSource market)
        {
            _market = market;
        }

        private sealed record SideParams(string Type, double TargetDelta, double DeltaTolerance, double Width);

        private sealed record BuiltSide(CandidateLeg Short, CandidateLeg Long, LegQuote ShortQuote, LegQuote LongQuote)
        {
            public double Width => Math.Abs(Short.Strike - Long.Strike);
        }

        /// <summary>
        /// Construye un TradeCandidate real, o el motivo por el que no hay candidato viable.
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
            var structure = spec.Structure.DefaultStructure;
            var sideTypes = RuntimeStructures.Sides(structure);
            if (sideTypes == null)
                return Rejected($"el runtime no construye la estructura '{structure}'");

            // Leer parámetros del spec: si falta uno, no se inventa (R1-m1).
            var sides = new List<SideParams>();
            var missing = new List<string>();
            foreach (var type in sideTypes)
            {
                var sellLeg = cc.Legs.FirstOrDefault(l => l.Side == "SELL" && l.Type == type);
                var buyLeg = cc.Legs.FirstOrDefault(l => l.Side == "BUY" && l.Type == type);
                if (sellLeg == null || buyLeg == null)
                    return Rejected($"la spec no declara una pata SELL {type} y una BUY {type}");
                if (sellLeg.StrikeSelection.TargetDelta == null) missing.Add("target_delta");
                if (sellLeg.StrikeSelection.DeltaTolerance == null) missing.Add("delta_tolerance");
                if (buyLeg.StrikeSelection.Width == null) missing.Add("width");
                if (missing.Count == 0)
                    sides.Add(new SideParams(type, sellLeg.StrikeSelection.TargetDelta!.Value,
                        sellLeg.StrikeSelection.DeltaTolerance!.Value, buyLeg.StrikeSelection.Width!.Value));
            }
            if (cc.Constraints.MinDte == null) missing.Add("min_dte");
            if (cc.Constraints.MaxDte == null) missing.Add("max_dte");
            if (cc.Constraints.MinCredit == null) missing.Add("min_credit");
            if (missing.Count > 0)
                return Rejected($"la spec no declara {string.Join(", ", missing.Distinct())}");

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

            // ── 3-4. Cada lado: pata vendida por delta, comprada a un ancho, cotizaciones frescas ──
            var built = new List<BuiltSide>();
            foreach (var side in sides)
            {
                var (result, error) = await BuildSideAsync(side, gexResponse.Strikes, spot, symbol, expirationDate, spec, nowUtc, ct);
                if (result == null) return Rejected(error!);
                built.Add(result);
            }

            // Credit = mids vendidos − mids comprados
            double credit = Math.Round(built.Sum(s => s.ShortQuote.Mid - s.LongQuote.Mid), 2);
            if (!double.IsFinite(credit))
                return Rejected($"crédito no finito ({credit})");

            // Todas las estructuras del runtime son de crédito: cero o débito no se abre, sea cual sea el mínimo.
            if (!(credit > 0))
                return Rejected($"crédito {credit} no positivo");
            if (credit < minCredit)
                return Rejected($"crédito {credit} menor al mínimo {minCredit}");

            double actualWidth = built.Max(s => s.Width);
            double maxRisk = Math.Round((actualWidth - credit) * 100, 2);
            if (!double.IsFinite(maxRisk))
                return Rejected($"riesgo máximo no finito ({maxRisk})");

            // La hora más vieja entre las patas que la informan; las que no, se cuentan aparte.
            var allQuotes = built.SelectMany(s => new[] { s.ShortQuote, s.LongQuote }).ToList();
            var knownTimes = allQuotes.Where(q => q.AsOf.HasValue).Select(q => q.AsOf!.Value).ToList();
            DateTime? oldestQuoteAt = knownTimes.Count > 0 ? knownTimes.Min() : null;
            int quotesWithoutTime = allQuotes.Count - knownTimes.Count;

            // ── 5. Armar TradeCandidate ──
            return CandidateBuildResult.Built(new TradeCandidate
            {
                CandidateId = Guid.NewGuid().ToString(),
                InstanceId = instance.InstanceId,
                Symbol = symbol,
                Structure = structure,
                Credit = credit,
                MaxRisk = maxRisk,
                Width = actualWidth,
                Dte = dte,
                // En un iron condor, el delta de la put vendida (el primer lado), como en el PCS.
                DeltaShort = built[0].Short.Delta ?? 0,
                Legs = built.SelectMany(s => new[] { s.Short, s.Long }).ToList(),
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

        /// <summary>
        /// Un spread vertical de crédito: puts fuera del dinero (strike &lt; spot, delta en (−0,5; 0)) con la comprada
        /// abajo, o calls (strike &gt; spot, delta en (0; 0,5)) con la comprada arriba.
        /// </summary>
        private async Task<(BuiltSide? Side, string? Error)> BuildSideAsync(
            SideParams p, List<GammaExposureStrike> strikes, double spot, string symbol, string expirationDate,
            StrategySpec spec, DateTime nowUtc, CancellationToken ct)
        {
            bool isPut = p.Type == "PUT";
            string name = isPut ? "put" : "call";
            double Delta(GammaExposureStrike s) => isPut ? s.PutDelta : s.CallDelta;
            string? Streamer(GammaExposureStrike s) => isPut ? s.PutStreamerSymbol : s.CallStreamerSymbol;

            var shortStrike = strikes
                .Where(s => isPut
                    ? s.Strike < spot && s.PutDelta < 0 && s.PutDelta > -0.5
                    : s.Strike > spot && s.CallDelta > 0 && s.CallDelta < 0.5)
                .OrderBy(s => Math.Abs(Delta(s) - p.TargetDelta))
                .FirstOrDefault();
            if (shortStrike == null)
                return (null, $"sin {name}s fuera del dinero con delta válido");

            if (Math.Abs(Delta(shortStrike) - p.TargetDelta) > p.DeltaTolerance)
                return (null, $"el delta {(isPut ? "" : "de call ")}más cercano ({Delta(shortStrike):0.000}) está fuera de ±{p.DeltaTolerance} "
                              + $"del objetivo {p.TargetDelta}");

            double longStrikePrice = isPut ? shortStrike.Strike - p.Width : shortStrike.Strike + p.Width;
            var longStrike = strikes
                .OrderBy(s => Math.Abs(s.Strike - longStrikePrice))
                .FirstOrDefault();
            if (longStrike == null || Math.Abs(longStrike.Strike - longStrikePrice) > 1.0)
                return (null, isPut
                    ? $"no hay strike para la pata comprada cerca de {longStrikePrice}"
                    : $"no hay strike para la call comprada cerca de {longStrikePrice}");
            // Con un ancho menor que el paso de strikes, el más cercano puede ser la misma pata vendida (o quedar del
            // lado equivocado): no sería un spread de riesgo definido.
            if (isPut ? longStrike.Strike >= shortStrike.Strike : longStrike.Strike <= shortStrike.Strike)
                return (null, $"la pata comprada ({longStrike.Strike}) no queda {(isPut ? "debajo" : "arriba")} de la vendida ({shortStrike.Strike}); ancho {p.Width} menor que el paso de strikes");

            string? shortSymbol = Streamer(shortStrike);
            string? longSymbol = Streamer(longStrike);
            if (string.IsNullOrEmpty(shortSymbol) || string.IsNullOrEmpty(longSymbol))
                return (null, "falta el símbolo de streamer de una pata; no se puede cotizar");

            var shortQuote = await _market.GetQuoteAsync(shortSymbol, ct);
            if (shortQuote == null)
                return (null, $"sin cotización utilizable para la pata vendida {shortSymbol}");
            var longQuote = await _market.GetQuoteAsync(longSymbol, ct);
            if (longQuote == null)
                return (null, $"sin cotización utilizable para la pata comprada {longSymbol}");

            // Frescura por pata: una pata vieja o con hora futura descarta el candidato aunque la otra
            // no tenga hora (Codex C1). Sin hora, la edad no se puede medir (ver DataFreshness).
            var maxAge = DataFreshness.MaxAge(spec);
            foreach (var (legName, legSymbol, quote) in new[] { ("vendida", shortSymbol, shortQuote), ("comprada", longSymbol, longQuote) })
            {
                var problem = DataFreshness.Problem(quote.AsOf, nowUtc, maxAge);
                if (problem != null)
                    return (null, $"cotización de la pata {legName} {legSymbol} no utilizable: {problem}");
            }

            char right = isPut ? 'P' : 'C';
            CandidateLeg Leg(string side, GammaExposureStrike s, string streamer, LegQuote q) => new()
            {
                Side = side,
                Type = p.Type,
                Strike = s.Strike,
                Expiration = expirationDate,
                OccSymbol = CascadeUtils.BuildOccSymbol(symbol, expirationDate, s.Strike, right),
                StreamerSymbol = streamer,
                Delta = Delta(s),
                Bid = q.Bid,
                Ask = q.Ask
            };
            return (new BuiltSide(Leg("SELL", shortStrike, shortSymbol, shortQuote), Leg("BUY", longStrike, longSymbol, longQuote),
                shortQuote, longQuote), null);
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
