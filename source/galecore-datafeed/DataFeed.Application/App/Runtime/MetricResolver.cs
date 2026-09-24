using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.Data.Tastytrade.MarketDataQuote;
using MediatR;
using Microsoft.Extensions.Logging;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Resuelve metric_ref strings del StrategySpec a valores reales vía MediatR.
    ///
    /// Convención de metric_ref:
    ///   "capability:market_data.quote.{SYMBOL}.price"   → MarketDataQuoteRequest → MidPrice
    ///   "capability:compute.gamma_exposure.{SYMBOL}.net_gex" → GammaExposureRequest → NetGEX
    ///
    /// Cada metric_ref se parsea y se despacha al handler MediatR correspondiente.
    /// Si el handler falla o no devuelve datos, el valor queda null → el gate lo trata según on_no_data.
    /// </summary>
    public class MetricResolver
    {
        private readonly IMediator _mediator;
        private readonly ILogger _logger;

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
            IEnumerable<string> metricRefs, CancellationToken ct = default)
        {
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
        /// El net GEX de la respuesta, o null si no se calculó con datos reales. NetGEX es una suma
        /// sobre los strikes: sin strikes, sin símbolos con griegas o sin ningún open interest da 0,
        /// y un 0 inventado pasa el gate "GEX >= 0" (GC-0002, R1-B1). Esos casos son NO_DATA.
        /// </summary>
        public static double? UsableNetGex(GammaExposureResponse? response)
        {
            if (response?.Strikes == null || response.Strikes.Count == 0) return null;
            if (response.SymbolsWithGreeks <= 0) return null;
            if (response.StrikesWithOI <= 0) return null;
            var net = response.NetGEX;
            return double.IsNaN(net) || double.IsInfinity(net) ? null : net;
        }
    }
}
