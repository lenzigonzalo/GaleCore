using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.Data.Tastytrade.MarketDataQuote;
using DataFeed.Application.Data.Tastytrade.MarketDataTrade;
using MediatR;
using Microsoft.Extensions.Logging;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Resuelve metric_ref strings del StrategySpec a valores reales vía MediatR.
    ///
    /// Convención de metric_ref:
    ///   "capability:market_data.quote.{SYMBOL}.price"   → MarketDataQuoteRequest → MidPrice
    ///   "capability:market_data.trade.{SYMBOL}.price"   → MarketDataTradeRequest → Price (último trade)
    ///   "capability:compute.gamma_exposure.{SYMBOL}.net_gex" → GammaExposureRequest → NetGEX
    ///
    /// Cada metric_ref se parsea y se despacha al handler MediatR correspondiente.
    /// Si el handler falla o no devuelve datos, el valor queda null → el gate lo trata según on_no_data.
    /// </summary>
    public class MetricResolver
    {
        private readonly IMediator _mediator;
        private readonly ILogger _logger;
        private DateTime _nowUtc = DateTime.UtcNow;
        private TimeSpan? _maxAge;

        public MetricResolver(IMediator mediator, ILogger logger)
        {
            _mediator = mediator;
            _logger = logger;
        }

        /// <summary>
        /// Resuelve una lista de metric_refs a sus valores actuales.
        /// Las keys del resultado son los metric_ref originales; null = sin dato.
        /// </summary>
        public async Task<Dictionary<string, double?>> ResolveAsync(
            IEnumerable<string> metricRefs, CancellationToken ct = default, DateTime? nowUtc = null, TimeSpan? maxAge = null)
        {
            _nowUtc = nowUtc ?? DateTime.UtcNow;
            _maxAge = maxAge;
            var result = new Dictionary<string, double?>();

            foreach (var metricRef in metricRefs.Distinct())
            {
                try
                {
                    result[metricRef] = await ResolveSingleAsync(metricRef, ct);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "MetricResolver: error resolviendo {MetricRef}", metricRef);
                    result[metricRef] = null;
                }
            }

            return result;
        }

        private async Task<double?> ResolveSingleAsync(string metricRef, CancellationToken ct)
        {
            // Formato: "capability:<domain>.<sub>.<symbol>.<field>"
            if (!metricRef.StartsWith("capability:"))
            {
                _logger.LogWarning("MetricResolver: metric_ref no reconocido: {Ref}", metricRef);
                return null;
            }

            var path = metricRef["capability:".Length..];
            var parts = path.Split('.');

            // market_data.quote.{SYMBOL}.price
            if (parts.Length == 4 && parts[0] == "market_data" && parts[1] == "quote" && parts[3] == "price")
            {
                return await ResolveQuotePrice(parts[2], ct);
            }

            // market_data.trade.{SYMBOL}.price — para índices como VIX, que DXLink publica sin bid/ask
            if (parts.Length == 4 && parts[0] == "market_data" && parts[1] == "trade" && parts[3] == "price")
            {
                var trade = await _mediator.Send(new MarketDataTradeRequest { Symbol = parts[2] }, ct);
                return UsableTradePrice(trade?.Data?.FirstOrDefault(), _nowUtc, _maxAge);
            }

            // compute.gamma_exposure.{SYMBOL}.net_gex
            if (parts.Length == 4 && parts[0] == "compute" && parts[1] == "gamma_exposure" && parts[3] == "net_gex")
            {
                return await ResolveNetGex(parts[2], ct);
            }

            _logger.LogWarning("MetricResolver: capability path no soportado: {Path}", path);
            return null;
        }

        private async Task<double?> ResolveQuotePrice(string symbol, CancellationToken ct)
        {
            var response = await _mediator.Send(new MarketDataQuoteRequest { Symbol = symbol }, ct);

            if (response?.Data == null || response.Data.Count == 0)
            {
                _logger.LogDebug("MetricResolver: sin datos de quote para {Symbol}", symbol);
                return null;
            }

            var quote = response.Data[0];
            var price = UsableQuotePrice(quote);
            if (price == null)
            {
                _logger.LogDebug("MetricResolver: cotización no utilizable para {Symbol}: bid={Bid} ask={Ask}",
                    symbol, quote?.BidPrice, quote?.AskPrice);
                return null;
            }

            _logger.LogDebug("MetricResolver: {Symbol} price={Price}", symbol, price);
            return price;
        }

        /// <summary>
        /// El mid de la cotización, o null si la cotización no sirve (QuoteRules.IsUsable) o el mid no es
        /// positivo. Una cotización de un solo lado (bid 0, ask 20) daría un mid de 10 que no existe.
        /// </summary>
        public static double? UsableQuotePrice(QuoteEvent? quote)
        {
            if (quote == null || !QuoteRules.IsUsable(quote.BidPrice, quote.AskPrice)) return null;
            var mid = quote.MidPrice;
            return mid > 0 ? mid : null;
        }

        /// <summary>
        /// El precio del último trade, o null si no hay trade, el precio no es positivo y finito, el
        /// proveedor no informa cuándo fue, o fue hace más de <paramref name="maxAge"/> (o "en el
        /// futuro") respecto de <paramref name="nowUtc"/>: un VIX viejo debajo de 30 pasaría el gate
        /// (Codex C1). Es la fuente de VIX: DXLink publica el Quote del índice sin bid/ask
        /// (verificado en vivo el 24/09, GC-0002 AC-08).
        /// </summary>
        public static double? UsableTradePrice(TradeEvent? trade, DateTime nowUtc, TimeSpan? maxAge)
        {
            if (trade == null || trade.Time <= 0) return null;
            var tradedAt = DateTimeOffset.FromUnixTimeMilliseconds(trade.Time).UtcDateTime;
            if (DataFreshness.Problem(tradedAt, nowUtc, maxAge) != null) return null;
            var price = trade.Price;
            return double.IsFinite(price) && price > 0 ? price : null;
        }

        private async Task<double?> ResolveNetGex(string symbol, CancellationToken ct)
        {
            var response = await _mediator.Send(new GammaExposureRequest { Symbol = symbol }, ct);
            var netGex = UsableNetGex(response);

            if (netGex == null)
            {
                _logger.LogDebug("MetricResolver: sin GEX utilizable para {Symbol}", symbol);
                return null;
            }

            _logger.LogDebug("MetricResolver: {Symbol} NetGEX={NetGEX}", symbol, netGex);
            return netGex;
        }

        /// <summary>
        /// El net GEX de la respuesta, o null si no se calculó con datos reales y completos. NetGEX es
        /// una suma sobre los strikes: sin strikes, sin griegas o sin open interest da 0, y un 0
        /// inventado pasa el gate "GEX >= 0" (R1-B1). Una cobertura parcial es igual de peligrosa: sin
        /// las puts queda sólo el gamma de las calls, positivo (Codex C1). Se exige que todos los
        /// símbolos pedidos hayan devuelto griegas y que haya OI de calls y de puts; en vivo el 24/09
        /// SPY dio 442/442 en tres corridas seguidas.
        /// </summary>
        public static double? UsableNetGex(GammaExposureResponse? response)
        {
            if (response?.Strikes == null || response.Strikes.Count == 0) return null;
            if (response.SymbolsRequested <= 0 || response.SymbolsWithGreeks < response.SymbolsRequested) return null;
            if (!response.Strikes.Any(s => s.CallOI > 0) || !response.Strikes.Any(s => s.PutOI > 0)) return null;
            var net = response.NetGEX;
            return double.IsNaN(net) || double.IsInfinity(net) ? null : net;
        }
    }
}
