using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Application.Data.Tastytrade.MarketDataQuote;
using MediatR;
using Microsoft.Extensions.Logging;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Cotización real de una pata: bid, ask y cuándo la publicó el proveedor.
    /// </summary>
    public record LegQuote(double Bid, double Ask, DateTime? AsOf)
    {
        public double Mid => Math.Round((Bid + Ask) / 2.0, 4);
    }

    /// <summary>
    /// Resultado de intentar construir un candidato: el candidato real, o la razón por la que no hay.
    /// Nunca hay candidato sin datos reales (GC-0002, decisión W-1).
    /// </summary>
    public record CandidateBuildResult(TradeCandidate? Candidate, string? RejectReason)
    {
        public static CandidateBuildResult Rejected(string reason) => new(null, reason);
        public static CandidateBuildResult Built(TradeCandidate candidate) => new(candidate, null);
    }

    /// <summary>
    /// Lo único que el runtime le pide al mercado. Separa las decisiones del runtime de cómo se
    /// obtienen los datos, para poder probar las decisiones sin proveedor.
    /// </summary>
    public interface IRuntimeMarketData
    {
        /// <summary>metric_ref → valor real, o null si no hay dato.</summary>
        Task<Dictionary<string, double?>> ResolveMetricsAsync(IEnumerable<string> metricRefs, CancellationToken ct);

        Task<CandidateBuildResult> BuildCandidateAsync(
            StrategyInstance instance, StrategySpec spec, string symbol, double? vixPrice, CancellationToken ct);

        /// <summary>Cotización utilizable de un símbolo de streamer, o null si no la hay.</summary>
        Task<LegQuote?> GetQuoteAsync(string streamerSymbol, CancellationToken ct);
    }

    public static class QuoteRules
    {
        /// <summary>
        /// Una cotización sirve si tiene ask positivo, bid no negativo y no está cruzada.
        /// Un bid 0 es real (una put muy fuera del dinero puede no tener comprador); un ask 0 no.
        /// </summary>
        public static bool IsUsable(double bid, double ask) =>
            !double.IsNaN(bid) && !double.IsNaN(ask) && ask > 0 && bid >= 0 && ask >= bid;
    }

    /// <summary>
    /// Implementación con los handlers MediatR de GaleCore (Tastytrade/DXLink).
    /// </summary>
    public class MediatorRuntimeMarketData : IRuntimeMarketData
    {
        private readonly IMediator _mediator;
        private readonly ILogger _logger;

        public MediatorRuntimeMarketData(IMediator mediator, ILogger logger)
        {
            _mediator = mediator;
            _logger = logger;
        }

        public Task<Dictionary<string, double?>> ResolveMetricsAsync(IEnumerable<string> metricRefs, CancellationToken ct)
            => new MetricResolver(_mediator, _logger).ResolveAsync(metricRefs, ct);

        public Task<CandidateBuildResult> BuildCandidateAsync(
            StrategyInstance instance, StrategySpec spec, string symbol, double? vixPrice, CancellationToken ct)
            => new PcsCandidateBuilder(_mediator, _logger, this).BuildAsync(instance, spec, symbol, vixPrice, ct);

        public async Task<LegQuote?> GetQuoteAsync(string streamerSymbol, CancellationToken ct)
        {
            var response = await _mediator.Send(new MarketDataQuoteRequest { Symbol = streamerSymbol }, ct);
            var q = response?.Data?.FirstOrDefault();
            if (q == null || !QuoteRules.IsUsable(q.BidPrice, q.AskPrice))
            {
                _logger.LogDebug("RuntimeMarketData: sin cotización utilizable para {Symbol}", streamerSymbol);
                return null;
            }
            DateTime? asOf = q.EventTime > 0 ? DateTimeOffset.FromUnixTimeMilliseconds(q.EventTime).UtcDateTime : null;
            return new LegQuote(q.BidPrice, q.AskPrice, asOf);
        }
    }
}
