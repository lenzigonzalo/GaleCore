using System.Globalization;
using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Application.App.Shared;
using DataFeed.Application.Data.Tastytrade.OptionChains;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Una pata de opciones ya leída de la spec: lado, tipo y cómo se elige su strike. Un solo selector por pata.
    /// </summary>
    internal sealed record LegPlan(
        string Id, string Side, string Type, string Method,
        double? TargetDelta = null, double? DeltaTolerance = null,
        double? Points = null, double? Pct = null, double? Strike = null,
        string? FromLeg = null, double? Offset = null, double Tolerance = 0)
    {
        public bool IsPut => Type == "PUT";
        public string SideWord => Side == "SELL" ? "vendida" : "comprada";
    }

    /// <summary>Valor de la estructura de opciones al vencimiento: el débito de cierre (vendidas − compradas, al intrínseco) según el subyacente.</summary>
    public static class OptionPayoff
    {
        public static double Debit(IEnumerable<(string Side, string Type, double Strike)> legs, double underlying) =>
            legs.Sum(l => (l.Side == "SELL" ? 1 : -1) *
                (l.Type == "CALL" ? Math.Max(underlying - l.Strike, 0) : Math.Max(l.Strike - underlying, 0)));

        /// <summary>
        /// Mínimo y máximo del débito de cierre sobre todos los precios posibles del subyacente. Es lineal entre strikes: alcanza con
        /// evaluar en 0 y en cada strike; más allá del mayor strike la pendiente es (calls vendidas − compradas): si es positiva el máximo
        /// es infinito (calls descubiertas), si es negativa el mínimo (ganancia de calls largas).
        /// </summary>
        public static (double Min, double Max) DebitRange(IReadOnlyCollection<(string Side, string Type, double Strike)> legs)
        {
            var points = legs.Select(l => l.Strike).Append(0).Distinct().Select(s => Debit(legs, s)).ToList();
            int callSlope = legs.Where(l => l.Type == "CALL").Sum(l => l.Side == "SELL" ? 1 : -1);
            return (callSlope < 0 ? double.NegativeInfinity : points.Min(), callSlope > 0 ? double.PositiveInfinity : points.Max());
        }
    }

    /// <summary>
    /// Constructor único de candidatos de opciones (WS-0062 inc.4): N patas del mismo vencimiento y raíz, cada una con su selector
    /// de strike. Las familias (put/call credit spread, iron condor) y custom_options llegan acá como una lista de <see cref="LegPlan"/>.
    ///
    /// Pipeline: vencimiento (DTE en fecha ET, sin AM) → strikes (de las griegas si alguna pata es por delta; si no, de la cadena
    /// del vencimiento elegido) → cotizaciones frescas → crédito al precio de fill del modelo → riesgo máximo del payoff de las patas.
    /// Datos reales o nada (GC-0002): cualquier faltante da un motivo, nunca un valor completado.
    /// </summary>
    internal sealed class OptionStructureBuilder
    {
        private sealed record StrikeRow(
            double Strike, string? PutStreamer, string? CallStreamer, string? PutOcc, string? CallOcc,
            double? PutDelta, double? CallDelta);

        private sealed record Resolved(LegPlan Plan, StrikeRow Row, string Streamer, string Occ, double? Delta);

        private readonly IPcsMarketSource _market;

        public OptionStructureBuilder(IPcsMarketSource market) => _market = market;

        private static bool IsAmExpiration(Expiration e) =>
            string.Equals(e.SettlementType, "AM", StringComparison.OrdinalIgnoreCase)
            || Expiry.IsAmRoot(FirstOcc(e));

        private static string? FirstOcc(Expiration e) =>
            e.strikes?.Select(s => s.call ?? s.put).FirstOrDefault(o => !string.IsNullOrWhiteSpace(o));

        /// <summary>Raíz de la serie (SPX, SPXW...) del vencimiento: las letras del símbolo OCC; null si la cadena no trae strikes.</summary>
        private static string? RootOf(Expiration e) =>
            FirstOcc(e) is string occ ? new string(occ.Trim().TakeWhile(char.IsLetter).ToArray()) : null;

        /// <summary>Raíz de un símbolo de streamer (".SPXW261026C3200" → "SPXW").</summary>
        private static string RootOfStreamer(string streamer) =>
            new string(streamer.TrimStart('.').TakeWhile(char.IsLetter).ToArray());

        public async Task<CandidateBuildResult> BuildAsync(
            StrategyInstance instance, StrategySpec spec, string structure, List<LegPlan> plans, List<string> missing,
            string symbol, double? vixPrice, DateTime nowUtc, CancellationToken ct)
        {
            var cc = spec.CandidateConstruction;
            if (cc.Constraints.MinDte == null) missing.Add("min_dte");
            if (cc.Constraints.MaxDte == null) missing.Add("max_dte");
            if (cc.Constraints.MinCredit == null && (structure != RuntimeStructures.CustomOptions || cc.Constraints.MaxDebit == null))
                missing.Add(structure == RuntimeStructures.CustomOptions ? "min_credit o max_debit" : "min_credit");
            if (missing.Count > 0)
                return Rejected($"la spec no declara {string.Join(", ", missing.Distinct())}");

            int minDte = cc.Constraints.MinDte!.Value;
            int maxDte = cc.Constraints.MaxDte!.Value;

            // ── 1. Cadena → vencimiento en rango DTE ──
            // El DTE del proveedor no es confiable (ver GammaExposureHandler.NormalizeExpirations):
            // se recalcula en fecha ET contra el reloj del runtime, con la misma regla.
            var rawExpirations = await _market.GetExpirationsAsync(symbol, ct);
            if (rawExpirations == null || rawExpirations.Count == 0)
                return Rejected($"sin cadena de opciones para {symbol}");

            var today = CascadeUtils.TodayEt(new DateTimeOffset(DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc)));
            int midDte = (minDte + maxDte) / 2;
            // Los vencimientos AM (SPX mensual) no se pueden liquidar con el cierre: no se abren (ver Expiry.IsAmSettled).
            var inTypes = rawExpirations.Where(e => e != null && CreditSpreadCandidateBuilder.ExpirationTypes.Contains(e.ExpirationType)).ToList();
            var amExpirations = inTypes.Where(IsAmExpiration).ToList();
            var chosen = inTypes.Except(amExpirations)
                .Select(e => (Exp: e, Dte: DteFrom(e.ExpirationDate, today)))
                .Where(e => e.Dte is int d && d >= minDte && d <= maxDte)
                .Select(e => (e.Exp, Dte: e.Dte!.Value))
                .OrderBy(e => Math.Abs(e.Dte - midDte))
                .ThenBy(e => e.Dte)
                .FirstOrDefault();
            if (chosen.Exp == null)
            {
                var amInRange = amExpirations.Where(e => DteFrom(e.ExpirationDate, today) is int d && d >= minDte && d <= maxDte)
                    .Select(e => e.ExpirationDate).ToList();
                return Rejected(amInRange.Count > 0
                    ? $"sin vencimiento con DTE entre {minDte} y {maxDte}: {string.Join(", ", amInRange)} es de liquidación AM y no hay precio para liquidarlo"
                    : $"sin vencimiento con DTE entre {minDte} y {maxDte}");
            }

            string expirationDate = chosen.Exp.ExpirationDate;
            string? root = RootOf(chosen.Exp);   // la serie elegida: todas las patas son de esta raíz (el 3.er viernes SPX AM y SPXW PM comparten fecha)
            int dte = chosen.Dte;

            // ── 2. Strikes: griegas del vencimiento elegido si alguna pata es por delta; si no, la cadena ──
            List<StrikeRow> rows;
            double? gexSpot = null;
            if (plans.Any(p => p.Method == "DELTA"))
            {
                // 0DTE sólo si el rango de la spec lo incluye (el filtro de arriba ya lo garantiza). El handler de griegas
                // interpreta TargetDte = 0 como "el de mayor DTE dentro de MaxDTE": con un 0DTE se acota MaxDTE a 0
                // para que el único vencimiento posible sea el de hoy. Sin ExpirationTypes el handler sólo mira mensuales.
                var gexResponse = await _market.GetGammaExposureAsync(new GammaExposureRequest
                {
                    Symbol = symbol,
                    TargetDte = chosen.Dte,
                    MaxDTE = chosen.Dte == 0 ? 0 : maxDte,
                    ExpirationTypes = CreditSpreadCandidateBuilder.ExpirationTypes,
                    IncludeZeroDte = minDte == 0,
                }, ct);

                if (gexResponse == null)
                    return Rejected($"sin griegas para el vencimiento {expirationDate}");
                if (gexResponse.Expiration != expirationDate)
                    return Rejected($"las griegas son del vencimiento {gexResponse.Expiration ?? "(ninguno)"}, "
                                    + $"no del elegido {expirationDate}");
                if (gexResponse.Strikes == null || gexResponse.Strikes.Count == 0)
                    return Rejected($"sin strikes con griegas para el vencimiento {expirationDate}");

                dte = gexResponse.DTE;
                gexSpot = gexResponse.Spot;
                if (!(gexSpot > 0))
                    return Rejected($"sin precio del subyacente {symbol}");

                var chainByStrike = ChainRows(chosen.Exp);
                rows = gexResponse.Strikes.Select(s =>
                {
                    chainByStrike.TryGetValue(s.Strike, out var c);
                    return new StrikeRow(s.Strike, s.PutStreamerSymbol, s.CallStreamerSymbol, c?.PutOcc, c?.CallOcc, s.PutDelta, s.CallDelta);
                }).ToList();
            }
            else
            {
                rows = ChainRows(chosen.Exp).Values.OrderBy(r => r.Strike).ToList();
                if (rows.Count == 0)
                    return Rejected($"sin strikes en la cadena del vencimiento {expirationDate}");
            }

            // ── 3. Precio del subyacente para los selectores por puntos o %: cotización real con hora ──
            double? quoteSpot = null;
            DateTime? spotAsOf = null;
            if (plans.Any(p => p.Method is "POINTS_FROM_SPOT" or "PCT_FROM_SPOT"))
            {
                var underlying = await _market.GetUnderlyingAsync(symbol, ct);
                if (underlying == null || !double.IsFinite(underlying.Price) || !(underlying.Price > 0))
                    return Rejected($"sin precio del subyacente {symbol} para elegir strikes por puntos o %");
                var spotProblem = DataFreshness.Problem(underlying.AsOf, nowUtc, DataFreshness.MaxAge(spec));
                if (spotProblem != null)
                    return Rejected($"precio del subyacente {symbol} no utilizable: {spotProblem}");
                quoteSpot = underlying.Price;
                spotAsOf = underlying.AsOf;
            }

            // ── 4. Cada pata: su strike ──
            var resolved = new Dictionary<string, Resolved>();
            var pending = plans.ToList();
            while (pending.Count > 0)
            {
                var next = pending.FirstOrDefault(p => p.Method != "OFFSET_FROM_LEG" || (p.FromLeg != null && resolved.ContainsKey(p.FromLeg)));
                if (next == null)
                    return Rejected($"la pata {pending[0].Id} depende de {pending[0].FromLeg ?? "(ninguna)"}, que no existe o es circular");
                pending.Remove(next);
                var (leg, error) = ResolveLeg(next, rows, gexSpot, quoteSpot, resolved, symbol, expirationDate);
                if (leg == null) return Rejected(error!);
                resolved[next.Id] = leg;
            }
            var legs = plans.Select(p => resolved[p.Id]).ToList();

            if (legs.Select(l => (l.Plan.Type, l.Row.Strike)).Distinct().Count() != legs.Count)
                return Rejected("dos patas quedaron en el mismo tipo y strike");

            // Todas las patas, de la misma raíz (y la de la serie elegida si la cadena la informa).
            if (legs.Any(l => string.IsNullOrEmpty(l.Streamer)))
                return Rejected("falta el símbolo de streamer de una pata; no se puede cotizar");
            var roots = legs.Select(l => RootOfStreamer(l.Streamer)).Distinct().ToList();
            if (roots.Count > 1 || (root != null && !string.Equals(roots[0], root, StringComparison.OrdinalIgnoreCase)))
                return Rejected($"las patas son de la raíz {string.Join("/", roots)} y el vencimiento elegido {expirationDate} es de {root ?? roots[0]}: no se mezclan series");

            // ── 5. Cotizaciones frescas, por pata ──
            var quotes = new Dictionary<string, LegQuote>();
            foreach (var l in legs)
            {
                var q = await _market.GetQuoteAsync(l.Streamer, ct);
                if (q == null)
                    return Rejected($"sin cotización utilizable para la pata {l.Plan.SideWord} {l.Streamer}");
                quotes[l.Plan.Id] = q;
            }
            // Frescura por pata: una pata vieja o con hora futura descarta el candidato aunque la otra
            // no tenga hora (Codex C1). Sin hora no sirve (ver DataFreshness).
            var maxAge = DataFreshness.MaxAge(spec);
            foreach (var l in legs)
            {
                var problem = DataFreshness.Problem(quotes[l.Plan.Id].AsOf, nowUtc, maxAge);
                if (problem != null)
                    return Rejected($"cotización de la pata {l.Plan.SideWord} {l.Streamer} no utilizable: {problem}");
            }

            // ── 6. Crédito al precio de fill (natural: bids vendidos − asks comprados; con fill mid, los mids). Los costos no entran: van al P&L ──
            var terms = ExecutionTerms.From(spec);
            double credit = Math.Round(legs.Sum(l =>
            {
                var q = quotes[l.Plan.Id];
                return (l.Plan.Side == "SELL" ? 1 : -1)
                    * ShadowFillSimulator.LegPrice(q.Bid, q.Ask, buying: l.Plan.Side == "BUY", terms, 4);
            }), 2);
            if (!double.IsFinite(credit))
                return Rejected($"crédito no finito ({credit})");

            var c = cc.Constraints;
            if (c.MinCredit is double minCredit)
            {
                // Con crédito mínimo declarado cero o débito no se abre, sea cual sea el mínimo.
                if (!(credit > 0))
                    return Rejected($"crédito {credit} no positivo");
                if (credit < minCredit)
                    return Rejected($"crédito {credit} menor al mínimo {minCredit}");
            }
            else if (c.MaxDebit is double maxDebit && -credit > maxDebit)
                return Rejected($"débito {-credit} mayor al máximo {maxDebit}");

            // ── 7. Riesgo máximo: el peor débito de cierre posible según el payoff de las patas, menos el crédito cobrado ──
            var payoffLegs = legs.Select(l => (l.Plan.Side, l.Plan.Type, l.Row.Strike)).ToList();
            var (_, worstDebit) = OptionPayoff.DebitRange(payoffLegs);
            if (!double.IsFinite(worstDebit))
                return Rejected("riesgo ilimitado: hay más calls vendidas que compradas");
            worstDebit = Math.Round(worstDebit, 6);
            double maxRisk = Math.Round((worstDebit - credit) * 100, 2);
            if (!double.IsFinite(maxRisk))
                return Rejected($"riesgo máximo no finito ({maxRisk})");

            // La hora más vieja entre las cotizaciones que la informan; las que no, se cuentan aparte.
            var allTimes = quotes.Values.Select(q => q.AsOf).ToList();
            var knownTimes = allTimes.Where(t => t.HasValue).Select(t => t!.Value).ToList();
            if (spotAsOf.HasValue) knownTimes.Add(spotAsOf.Value);
            DateTime? oldestQuoteAt = knownTimes.Count > 0 ? knownTimes.Min() : null;
            int quotesWithoutTime = allTimes.Count(t => !t.HasValue);

            return CandidateBuildResult.Built(new TradeCandidate
            {
                CandidateId = Guid.NewGuid().ToString(),
                InstanceId = instance.InstanceId,
                Symbol = symbol,
                Structure = structure,
                Credit = credit,
                MaxRisk = maxRisk,
                Width = worstDebit,
                Dte = dte,
                // El delta de la primera pata vendida (en el iron condor, la put), como en el PCS.
                DeltaShort = legs.FirstOrDefault(l => l.Plan.Side == "SELL")?.Delta ?? 0,
                Legs = legs.Select(l =>
                {
                    var q = quotes[l.Plan.Id];
                    return new CandidateLeg
                    {
                        Side = l.Plan.Side, Type = l.Plan.Type, Strike = l.Row.Strike, Expiration = expirationDate,
                        OccSymbol = l.Occ, StreamerSymbol = l.Streamer, Delta = l.Delta, Bid = q.Bid, Ask = q.Ask,
                    };
                }).ToList(),
                Snapshot = new MarketSnapshot
                {
                    UnderlyingPrice = gexSpot ?? quoteSpot,
                    Vix = vixPrice,
                    AsOf = nowUtc,
                    OldestQuoteAt = oldestQuoteAt,
                    QuotesWithoutTime = quotesWithoutTime,
                },
                CreatedAt = nowUtc,
            });
        }

        private static Dictionary<double, StrikeRow> ChainRows(Expiration e)
        {
            var rows = new Dictionary<double, StrikeRow>();
            foreach (var s in e.strikes ?? new List<Strike>())
            {
                if (!double.TryParse(s.StrikePrice, NumberStyles.Float, CultureInfo.InvariantCulture, out var k) || !(k > 0)) continue;
                rows[k] = new StrikeRow(k, s.PutStreamerSymbol, s.CallStreamerSymbol, s.put, s.call, null, null);
            }
            return rows;
        }

        private static (Resolved? Leg, string? Error) ResolveLeg(
            LegPlan p, List<StrikeRow> rows, double? gexSpot, double? quoteSpot, Dictionary<string, Resolved> resolved,
            string symbol, string expirationDate)
        {
            bool isPut = p.IsPut;
            string name = isPut ? "put" : "call";
            string? Streamer(StrikeRow r) => isPut ? r.PutStreamer : r.CallStreamer;
            double? Delta(StrikeRow r) => isPut ? r.PutDelta : r.CallDelta;
            var withSymbol = rows.Where(r => !string.IsNullOrEmpty(Streamer(r)) || p.Method == "DELTA").ToList();

            StrikeRow? row;
            switch (p.Method)
            {
                case "DELTA":
                {
                    double spot = gexSpot ?? 0;
                    row = rows
                        .Where(s => Delta(s) is double d && (isPut ? s.Strike < spot && d < 0 && d > -0.5 : s.Strike > spot && d > 0 && d < 0.5))
                        .OrderBy(s => Math.Abs(Delta(s)!.Value - p.TargetDelta!.Value))
                        .FirstOrDefault();
                    if (row == null)
                        return (null, $"sin {name}s fuera del dinero con delta válido");
                    if (Math.Abs(Delta(row)!.Value - p.TargetDelta!.Value) > p.DeltaTolerance!.Value)
                        return (null, $"el delta {(isPut ? "" : "de call ")}más cercano ({Delta(row):0.000}) está fuera de ±{p.DeltaTolerance} "
                                      + $"del objetivo {p.TargetDelta}");
                    break;
                }
                case "POINTS_FROM_SPOT":
                case "PCT_FROM_SPOT":
                {
                    double spot = quoteSpot!.Value;
                    double target = p.Method == "POINTS_FROM_SPOT" ? spot + p.Points!.Value : spot * (1 + p.Pct!.Value / 100.0);
                    bool below = target < spot;
                    // «El primer strike a N o más del precio»: hacia afuera del lado que marca el signo.
                    row = below
                        ? withSymbol.Where(s => s.Strike <= target + 1e-9).OrderByDescending(s => s.Strike).FirstOrDefault()
                        : withSymbol.Where(s => s.Strike >= target - 1e-9).OrderBy(s => s.Strike).FirstOrDefault();
                    if (row == null)
                        return (null, $"sin strike de {name} {(below ? "debajo" : "arriba")} de {target:0.##} (precio {spot:0.##}) en el vencimiento {expirationDate}");
                    break;
                }
                case "FIXED_STRIKE":
                    row = withSymbol.FirstOrDefault(s => Math.Abs(s.Strike - p.Strike!.Value) < 1e-9);
                    if (row == null)
                        return (null, $"no hay strike {p.Strike} de {name} en el vencimiento {expirationDate}");
                    break;
                case "OFFSET_FROM_LEG":
                {
                    var from = resolved[p.FromLeg!];
                    double wanted = from.Row.Strike + p.Offset!.Value;
                    row = rows.OrderBy(s => Math.Abs(s.Strike - wanted)).FirstOrDefault();
                    if (row == null || Math.Abs(row.Strike - wanted) > p.Tolerance + 1e-9)
                        return (null, $"no hay strike para la {(isPut ? "pata" : "call")} {p.SideWord} cerca de {wanted}");
                    // Con un offset menor que el paso de strikes, el más cercano puede ser la misma pata (o quedar del
                    // lado equivocado): no sería un spread de riesgo definido.
                    if (p.Offset < 0 ? row.Strike >= from.Row.Strike : row.Strike <= from.Row.Strike)
                        return (null, $"la pata {p.SideWord} ({row.Strike}) no queda {(p.Offset < 0 ? "debajo" : "arriba")} de la {from.Plan.SideWord} ({from.Row.Strike}); ancho {Math.Abs(p.Offset!.Value)} menor que el paso de strikes");
                    break;
                }
                default:
                    return (null, $"el selector de strike '{p.Method}' no está soportado");
            }

            string? streamer = Streamer(row);
            // El OCC de la cadena trae la raíz real (SPXW); sin cadena se arma con el subyacente.
            string occ = (isPut ? row.PutOcc : row.CallOcc)
                ?? CascadeUtils.BuildOccSymbol(symbol, expirationDate, row.Strike, isPut ? 'P' : 'C');
            return (new Resolved(p, row, streamer ?? "", occ, Delta(row)), null);
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
