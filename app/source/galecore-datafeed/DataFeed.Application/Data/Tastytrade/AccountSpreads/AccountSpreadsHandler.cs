using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using DataFeed.Application.Data.Tastytrade.AccountPositions;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers.Tastytrade;
using MediatR;
using Newtonsoft.Json.Linq;

namespace DataFeed.Application.Data.Tastytrade.AccountSpreads
{
    public class AccountSpreadsHandler : IRequestHandler<AccountSpreadsRequest, AccountSpreadsResponse>
    {
        private readonly IMediator _mediator;
        private readonly IDxLinkStreamingService _streaming;

        public AccountSpreadsHandler(IMediator mediator, IDxLinkStreamingService streaming)
        {
            _mediator = mediator;
            _streaming = streaming;
        }

        public async Task<AccountSpreadsResponse> Handle(AccountSpreadsRequest request, CancellationToken cancellationToken)
        {
            // Las posiciones salen del mismo handler que /Account/Positions: misma credencial, mismos
            // 409 (cuenta sin vincular o credencial rechazada), que pasan sin envolver.
            var positions = (await _mediator.Send(new AccountPositionsRequest { AccountNumber = request.AccountNumber }, cancellationToken))
                .Positions ?? new List<AccountPositionDto>();

            var options = positions.Where(p => p.Symbol != null && TastytradeHelper.IsOptionSymbol(p.Symbol)).ToList();
            var optionSymbols = options.Select(p => TastytradeHelper.GetOptionSymbolFromTicker(p.Symbol)).Distinct().ToList();
            // Acciones y subyacentes: sólo cotización (no tienen Greeks; pedirlos haría esperar todo el timeout).
            var quoteOnly = positions.Where(p => p.Symbol != null && !TastytradeHelper.IsOptionSymbol(p.Symbol)
                                                 && string.Equals(p.InstrumentType, "Equity", StringComparison.OrdinalIgnoreCase))
                .Select(p => p.Symbol)
                .Concat(options.Select(p => p.Symbol.Substring(0, 6).Trim()))
                .Distinct()
                .ToList();

            var market = await SnapshotAsync(optionSymbols, quoteOnly, cancellationToken);
            var (spreads, unpaired) = AccountSpreadBuilder.Analyze(positions, market);
            return new AccountSpreadsResponse
            {
                Spreads = spreads,
                Unpaired = unpaired,
                Equities = AccountSpreadBuilder.Equities(positions, market),
                UnderlyingPrices = quoteOnly
                    .Select(s => (s, Mid: market.TryGetValue(s, out var m) ? AccountSpreadBuilder.MidOf(m.Bid, m.Ask) : null))
                    .Where(x => x.Mid != null)
                    .ToDictionary(x => x.s, x => x.Mid!.Value),
                AsOf = DateTime.UtcNow,
            };
        }

        /// <summary>
        /// Quote y Greeks de cada pata en un solo pedido. Lo que no llega antes del timeout queda
        /// afuera y el spread sale con esos campos en null (fuera de horario, por ejemplo): mejor
        /// un dato faltante declarado que la página esperando.
        /// </summary>
        private async Task<IReadOnlyDictionary<string, LegMarket>> SnapshotAsync(List<string> options, List<string> quoteOnly, CancellationToken ct)
        {
            var result = new Dictionary<string, LegMarket>();
            var symbols = options.Concat(quoteOnly).Distinct().ToList();
            if (symbols.Count == 0) return result;

            var subs = options.SelectMany(s => new[] { (s, "Quote", (long?)null), (s, "Greeks", (long?)null) })
                .Concat(quoteOnly.Select(s => (s, "Quote", (long?)null)))
                .ToList();
            var items = await _streaming.RequestSnapshotAsync(subs, isSymbolComplete: _ => true, timeout: TimeSpan.FromSeconds(6), cancellationToken: ct);

            var quotes = new Dictionary<string, JObject>();
            var greeks = new Dictionary<string, JObject>();
            foreach (var it in items)
            {
                var sym = it["eventSymbol"]?.ToString();
                if (string.IsNullOrEmpty(sym)) continue;
                var type = it["eventType"]?.ToString();
                if (type == "Quote") quotes[sym] = it;
                else if (type == "Greeks") greeks[sym] = it;
            }

            foreach (var sym in symbols)
            {
                quotes.TryGetValue(sym, out var q);
                greeks.TryGetValue(sym, out var g);
                result[sym] = new LegMarket(Num(q, "bidPrice"), Num(q, "askPrice"),
                    Num(g, "delta"), Num(g, "gamma"), Num(g, "theta"), Num(g, "vega"), Num(g, "volatility"));
            }
            return result;
        }

        private static double? Num(JObject? o, string key)
        {
            var token = o?[key];
            if (token == null || token.Type == JTokenType.Null) return null;
            try
            {
                var v = token.Value<double>();
                return double.IsFinite(v) ? v : null;
            }
            catch (FormatException)
            {
                return null;
            }
        }
    }
}
