using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Application.Data.Tastytrade.MarketDataQuote;
using DataFeed.Application.Data.Tastytrade.OptionChains;
using MediatR;
using Microsoft.Extensions.Logging;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Cotización real de una pata: bid, ask y cuándo la publicó el proveedor (null si no lo informa).
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
    /// Los datos de mercado que necesita el constructor de candidatos: vencimientos, griegas de un
    /// vencimiento y cotizaciones. Separado para poder probar el constructor sin proveedor.
    /// </summary>
    public interface IPcsMarketSource
    {
        /// <summary>Vencimientos de la cadena de opciones, o null si no hay cadena.</summary>
        Task<List<Expiration>?> GetExpirationsAsync(string symbol, CancellationToken ct);

        /// <summary>Griegas y OI por strike del vencimiento que pide el request, o null.</summary>
        Task<GammaExposureResponse?> GetGammaExposureAsync(GammaExposureRequest request, CancellationToken ct);

        /// <summary>Cotización utilizable de un símbolo de streamer, o null si no la hay.</summary>
        Task<LegQuote?> GetQuoteAsync(string streamerSymbol, CancellationToken ct);
    }

    /// <summary>
    /// Lo único que el runtime le pide al mercado. Separa las decisiones del runtime de cómo se
    /// obtienen los datos, para poder probar las decisiones sin proveedor.
    /// </summary>
    public interface IRuntimeMarketData
    {
        /// <summary>
        /// metric_ref → valor real, o null si no hay dato. Un dato con hora vieja o futura respecto de
        /// <paramref name="nowUtc"/> (tolerancia <paramref name="maxAge"/>) también es null.
        /// </summary>
        Task<Dictionary<string, double?>> ResolveMetricsAsync(
            IEnumerable<string> metricRefs, DateTime nowUtc, TimeSpan? maxAge, CancellationToken ct);

        Task<CandidateBuildResult> BuildCandidateAsync(
            StrategyInstance instance, StrategySpec spec, string symbol, double? vixPrice, DateTime nowUtc,
            CancellationToken ct);

        /// <summary>Cotización utilizable de un símbolo de streamer, o null si no la hay.</summary>
        Task<LegQuote?> GetQuoteAsync(string streamerSymbol, CancellationToken ct);
    }

    public static class QuoteRules
    {
        /// <summary>
        /// Una cotización sirve si bid y ask son finitos, el ask es positivo, el bid no negativo y no
        /// está cruzada. Un bid 0 es real (una put muy fuera del dinero puede no tener comprador); un
        /// ask 0 no. Infinito tampoco: dos mids infinitos dan un crédito NaN que ninguna comparación
        /// rechaza (Codex C1).
        /// </summary>
        public static bool IsUsable(double bid, double ask) =>
            double.IsFinite(bid) && double.IsFinite(ask) && ask > 0 && bid >= 0 && ask >= bid;
    }

    /// <summary>
    /// Frescura de un dato con hora del proveedor. SHADOW tolera 10 veces
    /// data_quality.max_quote_age_seconds (con 15 s en la spec: 150 s).
    ///
    /// Una hora desconocida (null) no se puede medir y hoy se acepta: DXLink manda el Quote con
    /// EventTime 0 (verificado en vivo el 24/09), así que exigir hora dejaría al runtime sin poder
    /// cotizar ninguna pata. Es una limitación declarada del item; la protección que queda es no
    /// simular fills ni cierres fuera de sesión.
    /// </summary>
    public static class DataFreshness
    {
        public const int ShadowAgeFactor = 10;
        /// <summary>Diferencia de relojes tolerada antes de declarar una hora "en el futuro".</summary>
        public static readonly TimeSpan ClockSkew = TimeSpan.FromSeconds(5);

        public static TimeSpan? MaxAge(StrategySpec spec) =>
            spec.DataQuality.MaxQuoteAgeSeconds > 0
                ? TimeSpan.FromSeconds(spec.DataQuality.MaxQuoteAgeSeconds * ShadowAgeFactor)
                : null;

        /// <summary>null si el dato sirve; si no, por qué (viejo o con hora en el futuro).</summary>
        public static string? Problem(DateTime? asOf, DateTime nowUtc, TimeSpan? maxAge)
        {
            if (asOf is not DateTime t) return null;
            if (t > nowUtc + ClockSkew) return $"hora en el futuro ({t:o})";
            if (maxAge is TimeSpan max && nowUtc - t > max)
                return $"dato viejo ({(nowUtc - t).TotalSeconds:F0}s, límite {max.TotalSeconds:F0}s)";
            return null;
        }
    }

    /// <summary>
    /// Implementación con los handlers MediatR de GaleCore (Tastytrade/DXLink).
    /// </summary>
    public class MediatorRuntimeMarketData : IRuntimeMarketData, IPcsMarketSource
    {
        private readonly IMediator _mediator;
        private readonly ILogger _logger;

        public MediatorRuntimeMarketData(IMediator mediator, ILogger logger)
        {
            _mediator = mediator;
            _logger = logger;
        }

        public Task<Dictionary<string, double?>> ResolveMetricsAsync(
            IEnumerable<string> metricRefs, DateTime nowUtc, TimeSpan? maxAge, CancellationToken ct)
            => new MetricResolver(_mediator, _logger).ResolveAsync(metricRefs, ct, nowUtc, maxAge);

        public Task<CandidateBuildResult> BuildCandidateAsync(
            StrategyInstance instance, StrategySpec spec, string symbol, double? vixPrice, DateTime nowUtc,
            CancellationToken ct)
            => new PcsCandidateBuilder(this).BuildAsync(instance, spec, symbol, vixPrice, nowUtc, ct);

        public async Task<List<Expiration>?> GetExpirationsAsync(string symbol, CancellationToken ct)
            => (await _mediator.Send(new OptionChainsRequest { Symbol = symbol }, ct))?.expirations;

        public async Task<GammaExposureResponse?> GetGammaExposureAsync(GammaExposureRequest request, CancellationToken ct)
            => await _mediator.Send(request, ct);

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
