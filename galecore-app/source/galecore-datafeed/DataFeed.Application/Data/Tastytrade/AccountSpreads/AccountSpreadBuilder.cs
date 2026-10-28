using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using DataFeed.Application.Data.Tastytrade.AccountPositions;
using DataFeed.Application.Shared;

namespace DataFeed.Application.Data.Tastytrade.AccountSpreads
{
    /// <summary>Lo que se sabe hoy de una pata, por símbolo streamer.</summary>
    public record LegMarket(double? Bid, double? Ask, double? Delta, double? Gamma, double? Theta, double? Vega, double? Iv);

    /// <summary>
    /// Arma los spreads de crédito a partir de las patas sueltas de la cuenta y les calcula riesgo,
    /// POP y griegas netas. Agrupa por subyacente y vencimiento y empareja las patas por strike
    /// y cantidad (put vendido + put comprado más abajo → PUT_CS, call vendido + call comprado más arriba → CALL_CS, los dos
    /// de igual cantidad → IC); varios spreads del mismo vencimiento salen separados y lo que no empareja se declara. Puro, sin red: el handler
    /// le pasa las cotizaciones.
    /// </summary>
    public static class AccountSpreadBuilder
    {
        private sealed record Leg(AccountPositionDto Position, string Underlying, string Expiration, char Type, double Strike, string StreamerSymbol)
        {
            public bool IsShort => string.Equals(Position.QuantityDirection, "Short", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>Un lado armado: la vendida y la comprada de la misma cantidad.</summary>
        private sealed record Pair(Leg Short, Leg Long);

        public static List<AccountSpreadDto> Build(IEnumerable<AccountPositionDto> positions, IReadOnlyDictionary<string, LegMarket> market) =>
            Analyze(positions, market).Spreads;

        /// <summary>
        /// Los spreads y, aparte, las patas que no pudo emparejar (sin la otra punta o con otra cantidad): lo que no se
        /// arma se declara, no se descarta en silencio ni se suma mal.
        /// </summary>
        public static (List<AccountSpreadDto> Spreads, List<string> Unpaired) Analyze(
            IEnumerable<AccountPositionDto> positions, IReadOnlyDictionary<string, LegMarket> market)
        {
            var legs = positions
                .Where(p => p.Symbol != null && TastytradeHelper.IsOptionSymbol(p.Symbol))
                .Select(ToLeg)
                .ToList();

            var spreads = new List<AccountSpreadDto>();
            var unpaired = new List<string>();
            foreach (var group in legs.GroupBy(l => (l.Underlying, l.Expiration)))
            {
                var puts = PairSide(group.Where(l => l.Type == 'P').ToList(), isPut: true, unpaired);
                var calls = PairSide(group.Where(l => l.Type == 'C').ToList(), isPut: false, unpaired);

                // Un iron condor es un put spread y un call spread de la misma cantidad; lo que sobra queda como spread simple.
                var built = new List<(Pair? Put, Pair? Call)>();
                foreach (var put in puts)
                {
                    var call = calls.FirstOrDefault(c => c.Short.Position.Quantity == put.Short.Position.Quantity);
                    if (call != null) calls.Remove(call);
                    built.Add((put, call));
                }
                built.AddRange(calls.Select(c => ((Pair?)null, (Pair?)c)));

                foreach (var (put, call) in built)
                    spreads.Add(BuildSpread(put, call, market, unique: built.Count > 1));
            }
            return (spreads, unpaired);
        }

        /// <summary>
        /// Empareja cada vendida con la comprada de igual cantidad más cercana del lado que protege (put: strike menor;
        /// call: mayor). Las vendidas más cerca del dinero eligen primero. Lo que no encuentra pareja va a `unpaired`.
        /// </summary>
        private static List<Pair> PairSide(List<Leg> legs, bool isPut, List<string> unpaired)
        {
            var longs = legs.Where(l => !l.IsShort).ToList();
            var shorts = legs.Where(l => l.IsShort);
            var pairs = new List<Pair>();
            foreach (var s in (isPut ? shorts.OrderByDescending(l => l.Strike) : shorts.OrderBy(l => l.Strike)).ToList())
            {
                var candidates = longs.Where(l => l.Position.Quantity == s.Position.Quantity && (isPut ? l.Strike < s.Strike : l.Strike > s.Strike));
                var match = (isPut ? candidates.OrderByDescending(l => l.Strike) : candidates.OrderBy(l => l.Strike)).FirstOrDefault();
                if (match == null) { unpaired.Add(Describe(s)); continue; }
                longs.Remove(match);
                pairs.Add(new Pair(s, match));
            }
            unpaired.AddRange(longs.Select(Describe));
            return pairs;
        }

        private static string Describe(Leg l) =>
            $"{l.Underlying} {l.Expiration} {(l.Type == 'P' ? "put" : "call")} {l.Strike.ToString("0.##", CultureInfo.InvariantCulture)} {(l.IsShort ? "vendido" : "comprado")} ×{l.Position.Quantity:0.##}";

        private static AccountSpreadDto BuildSpread(Pair? putPair, Pair? callPair, IReadOnlyDictionary<string, LegMarket> market, bool unique)
        {
            var shortPut = putPair?.Short; var longPut = putPair?.Long;
            var shortCall = callPair?.Short; var longCall = callPair?.Long;
            var hasPut = putPair != null;
            var hasCall = callPair != null;

            var structure = hasPut && hasCall ? "IC" : hasPut ? "PUT_CS" : "CALL_CS";
            var used = new[] { shortPut, longPut, shortCall, longCall }.Where(l => l != null).Select(l => l!).ToList();

            var shortLeg = (hasPut ? shortPut : shortCall)!;
            var contracts = (double)shortLeg.Position.Quantity;
            var multiplier = shortLeg.Position.Multiplier > 0 ? (double)shortLeg.Position.Multiplier : 100;
            var size = contracts * multiplier;

            double Sign(Leg l) => l.IsShort ? -1 : 1;

            // Crédito por acción: lo cobrado por las vendidas menos lo pagado por las compradas.
            var initialCredit = used.Sum(l => -Sign(l) * (double)l.Position.AverageOpenPrice);

            var putWidth = hasPut ? Math.Abs(shortPut!.Strike - longPut!.Strike) : 0;
            var callWidth = hasCall ? Math.Abs(longCall!.Strike - shortCall!.Strike) : 0;
            var width = Math.Max(putWidth, callWidth);

            double? Mid(Leg l) => market.TryGetValue(l.StreamerSymbol, out var m) ? MidOf(m.Bid, m.Ask) : null;
            var hasLive = used.Where(l => l.IsShort).All(l => Mid(l) != null);
            var currentPrices = used.Select(l => Mid(l) ?? (l.Position.ClosePrice > 0 ? (double)l.Position.ClosePrice : (double?)null)).ToList();
            double? currentCredit = currentPrices.All(p => p != null)
                ? used.Select((l, i) => -Sign(l) * currentPrices[i]!.Value).Sum()
                : null;

            var closes = used.Select(l => l.Position.ClosePrice > 0 ? (double)l.Position.ClosePrice : (double?)null).ToList();
            double? previousCredit = closes.All(c => c != null) ? used.Select((l, i) => -Sign(l) * closes[i]!.Value).Sum() : null;
            double? openPnl = hasLive && currentCredit != null ? (initialCredit - currentCredit.Value) * size : null;
            double? dayPnl = hasLive && currentCredit != null && previousCredit != null ? (previousCredit.Value - currentCredit.Value) * size : null;

            var popCredit = hasLive && currentCredit != null ? currentCredit.Value : initialCredit;
            double? pop = width > 0 ? Clamp((1 - popCredit / width) * 100) : null;

            // Con un solo spread por subyacente y vencimiento el id es el de siempre; con varios, se suman los strikes
            // para que ninguno pise a otro.
            static string K(double v) => v.ToString("0.##", CultureInfo.InvariantCulture);
            var id = $"{shortLeg.Underlying}|{shortLeg.Expiration}";
            if (unique)
                id += (hasPut ? $"|P{K(shortPut!.Strike)}-{K(longPut!.Strike)}" : "") + (hasCall ? $"|C{K(shortCall!.Strike)}-{K(longCall!.Strike)}" : "");

            return new AccountSpreadDto
            {
                Id = id,
                UnderlyingSymbol = shortLeg.Underlying,
                Expiration = shortLeg.Expiration,
                Structure = structure,
                Contracts = shortLeg.Position.Quantity,
                Multiplier = (decimal)multiplier,
                Width = width,
                ShortPutStrike = hasPut ? shortPut!.Strike : null,
                LongPutStrike = hasPut ? longPut!.Strike : null,
                ShortCallStrike = hasCall ? shortCall!.Strike : null,
                LongCallStrike = hasCall ? longCall!.Strike : null,
                InitialCredit = Round(initialCredit, 4),
                CurrentNetCredit = currentCredit == null ? null : Round(currentCredit.Value, 4),
                HasLiveQuote = hasLive,
                PreviousNetCredit = previousCredit == null ? null : Round(previousCredit.Value, 4),
                OpenPnl = openPnl == null ? null : Round(openPnl.Value, 2),
                DayPnl = dayPnl == null ? null : Round(dayPnl.Value, 2),
                MaxProfit = Round(initialCredit * size, 2),
                MaxLoss = Round(Math.Max(0, width - initialCredit) * size, 2),
                Pop = pop == null ? null : Round(pop.Value, 1),
                Pop50 = pop == null ? null : Round(Clamp((100 + pop.Value) / 2), 1),
                PopBasis = hasLive && currentCredit != null ? "vivo" : "entrada",
                Greeks = NetGreeks(used, market, Sign, size, shortLeg),
            };
        }

        /// <summary>Acciones y ETFs (no opciones), con su resultado si hay cotización.</summary>
        public static List<AccountEquityDto> Equities(IEnumerable<AccountPositionDto> positions, IReadOnlyDictionary<string, LegMarket> market) =>
            positions.Where(p => p.Symbol != null && !TastytradeHelper.IsOptionSymbol(p.Symbol) && p.Quantity != 0
                                 && string.Equals(p.InstrumentType, "Equity", StringComparison.OrdinalIgnoreCase))
                .Select(p =>
                {
                    var qty = (double)p.Quantity * (string.Equals(p.QuantityDirection, "Short", StringComparison.OrdinalIgnoreCase) ? -1 : 1);
                    var mid = market.TryGetValue(p.Symbol, out var m) ? MidOf(m.Bid, m.Ask) : null;
                    return new AccountEquityDto
                    {
                        Symbol = p.Symbol, Quantity = qty, AverageOpenPrice = (double)p.AverageOpenPrice, ClosePrice = (double)p.ClosePrice,
                        Mid = mid,
                        OpenPnl = mid == null ? null : Round((mid.Value - (double)p.AverageOpenPrice) * qty, 2),
                        DayPnl = mid == null || p.ClosePrice <= 0 ? null : Round((mid.Value - (double)p.ClosePrice) * qty, 2),
                    };
                }).ToList();

        private static SpreadGreeksDto? NetGreeks(List<Leg> legs, IReadOnlyDictionary<string, LegMarket> market, Func<Leg, double> sign, double size, Leg shortLeg)
        {
            var withGreeks = legs.Select(l => (Leg: l, M: market.TryGetValue(l.StreamerSymbol, out var m) ? m : null)).ToList();
            if (withGreeks.Any(x => x.M?.Delta == null)) return null;

            double Sum(Func<LegMarket, double?> field) => Round(withGreeks.Sum(x => sign(x.Leg) * (field(x.M!) ?? 0)) * size, 2);
            return new SpreadGreeksDto
            {
                Delta = Sum(m => m.Delta),
                Gamma = Sum(m => m.Gamma),
                Theta = Sum(m => m.Theta),
                Vega = Sum(m => m.Vega),
                ShortLegIv = market.TryGetValue(shortLeg.StreamerSymbol, out var s) ? s.Iv : null,
            };
        }

        private static Leg ToLeg(AccountPositionDto p)
        {
            var expiration = DateTime.ParseExact(p.Symbol.Substring(6, 6), "yyMMdd", CultureInfo.InvariantCulture).ToString("yyyy-MM-dd");
            return new Leg(p, p.Symbol.Substring(0, 6).Trim(), expiration, p.Symbol[12],
                (double)TastytradeHelper.GetStrikeFromTicker(p.Symbol), TastytradeHelper.GetOptionSymbolFromTicker(p.Symbol));
        }

        /// <summary>Mid si las dos puntas son válidas; si no, null (no se inventa precio).</summary>
        public static double? MidOf(double? bid, double? ask) =>
            bid is double b && ask is double a && double.IsFinite(b) && double.IsFinite(a) && b >= 0 && a > 0 && a >= b ? (b + a) / 2 : null;

        private static double Clamp(double pct) => Math.Max(0, Math.Min(100, pct));
        private static double Round(double v, int d) => Math.Round(v, d, MidpointRounding.AwayFromZero);
    }
}
