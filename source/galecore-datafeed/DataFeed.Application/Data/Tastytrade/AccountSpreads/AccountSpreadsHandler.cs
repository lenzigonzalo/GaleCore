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

            var symbols = positions
                .Where(p => p.Symbol != null && TastytradeHelper.IsOptionSymbol(p.Symbol))
                .Select(p => TastytradeHelper.GetOptionSymbolFromTicker(p.Symbol))
                .Distinct()
                .ToList();

            var market = await SnapshotAsync(symbols, cancellationToken);
            return new AccountSpreadsResponse
            {
                Spreads = AccountSpreadBuilder.Build(positions, market),
                AsOf = DateTime.UtcNow,
            };
        }

        /// <summary>
        /// Quote y Greeks de cada pata en un solo pedido. Lo que no llega antes del timeout queda
        /// afuera y el spread sale con esos campos en null (fuera de horario, por ejemplo): mejor
        /// un dato faltante declarado que la página esperando.
        /// </summary>
        private async Task<IReadOnlyDictionary<string, LegMarket>> SnapshotAsync(List<string> symbols, CancellationToken ct)
        {
            var result = new Dictionary<string, LegMarket>();
            if (symbols.Count == 0) return result;

            var subs = symbols.SelectMany(s => new[] { (s, "Quote", (long?)null), (s, "Greeks", (long?)null) }).ToList();
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
