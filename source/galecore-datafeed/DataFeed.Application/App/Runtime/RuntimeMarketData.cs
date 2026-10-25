using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Application.Data.Tastytrade.MarketDataCandle;
using DataFeed.Application.Data.Tastytrade.MarketDataQuote;
using DataFeed.Application.Data.Tastytrade.MarketDataTrade;
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

        /// <summary>
        /// Precio del subyacente con su hora, para elegir strikes por puntos o %. Por defecto, el medio de su cotización; la
        /// implementación real prefiere el último trade (los índices no publican hora en la cotización).
        /// </summary>
        async Task<UnderlyingQuote?> GetUnderlyingAsync(string symbol, CancellationToken ct)
        {
            var q = await GetQuoteAsync(symbol, ct);
            return q == null ? null : new UnderlyingQuote(q.Mid, q.AsOf);
        }
    }

    /// <summary>Precio del subyacente y cuándo lo publicó el proveedor (null si no lo informa).</summary>
    public record UnderlyingQuote(double Price, DateTime? AsOf);

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

        /// <summary>
        /// Cierre oficial del subyacente en la fecha <paramref name="sessionDate"/> (vela diaria de ESA fecha), o null si
        /// no hay una. Sirve para liquidar vencimientos (WS-0062 inc.3); nunca se infiere de opciones ni se completa.
        /// </summary>
        Task<double?> GetOfficialCloseAsync(string symbol, DateTime sessionDate, CancellationToken ct) => Task.FromResult<double?>(null);

        /// <summary>Calendario de eventos para las event_gates de la spec (WS-0062 inc.5); null = sin calendario (las condiciones quedan NO_DATA).</summary>
        IEventCalendar? Events => null;
    }

    public static class OfficialClose
    {
        /// <summary>
        /// Cierre de la vela diaria cuya fecha es <paramref name="sessionDate"/>, o null. La fecha de la vela es la fecha UTC de
        /// su hora: coincide con la fecha de la rueda sea cual sea la convención del proveedor (medianoche UTC, medianoche ET
        /// o el cierre). Una vela sin hora, con cierre no finito o no positivo no sirve.
        /// </summary>
        public static double? FromCandles(IEnumerable<CandleData>? candles, DateTime sessionDate)
        {
            var candle = candles?
                .Where(c => c.Time > 0 && DateTimeOffset.FromUnixTimeMilliseconds(c.Time).UtcDateTime.Date == sessionDate.Date)
                .OrderByDescending(c => c.Time).FirstOrDefault();
            return candle != null && double.IsFinite(candle.Close) && candle.Close > 0 ? candle.Close : null;
        }
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
    /// Una cotización sin hora (null) no se puede medir y NO sirve: bloquea la entrada y deja la
    /// valuación de una posición abierta en NO_DATA (sin cierre inventado). La hora sale de
    /// QuoteTime: la más nueva de bidTime/askTime (cada una marca el último cambio de ese lado; un lado
    /// quieto sigue vigente); DXLink manda EventTime 0 (verificado el 24/09).
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

        /// <summary>
        /// Hora de una cotización (epoch ms): la MÁS NUEVA de bidTime y askTime que sean > 0; si
        /// ninguna, eventTime > 0; si nada, null (sin hora).
        /// </summary>
        public static DateTime? QuoteTime(long bidTime, long askTime, long eventTime)
        {
            long ms = 0;
            if (bidTime > 0 && askTime > 0) ms = Math.Max(bidTime, askTime);
            else if (bidTime > 0) ms = bidTime;
            else if (askTime > 0) ms = askTime;
            else if (eventTime > 0) ms = eventTime;
            return ms > 0 ? DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime : null;
        }

        /// <summary>null si el dato sirve; si no, por qué (sin hora, viejo o con hora en el futuro).</summary>
        public static string? Problem(DateTime? asOf, DateTime nowUtc, TimeSpan? maxAge)
        {
            if (asOf is not DateTime t) return "cotización sin hora";
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

        public IEventCalendar? Events => new MediatorEventCalendar(_mediator, _logger);

        public Task<Dictionary<string, double?>> ResolveMetricsAsync(
            IEnumerable<string> metricRefs, DateTime nowUtc, TimeSpan? maxAge, CancellationToken ct)
            => new MetricResolver(_mediator, _logger).ResolveAsync(metricRefs, ct, nowUtc, maxAge);

        public Task<CandidateBuildResult> BuildCandidateAsync(
            StrategyInstance instance, StrategySpec spec, string symbol, double? vixPrice, DateTime nowUtc,
            CancellationToken ct)
            => spec.Structure.DefaultStructure == RuntimeStructures.LongEquity
                ? LongEquityCandidateBuilder.BuildAsync(GetQuoteAsync, instance, spec, symbol, nowUtc, ct)
                : new CreditSpreadCandidateBuilder(this).BuildAsync(instance, spec, symbol, vixPrice, nowUtc, ct);

        public async Task<double?> GetOfficialCloseAsync(string symbol, DateTime sessionDate, CancellationToken ct)
        {
            var response = await _mediator.Send(new MarketDataCandleRequest
            {
                Symbol = symbol,
                Interval = "1d",
                FromTime = DateTime.SpecifyKind(sessionDate.Date.AddDays(-3), DateTimeKind.Utc),
            }, ct);
            return OfficialClose.FromCandles(response?.data, sessionDate);
        }

        public async Task<List<Expiration>?> GetExpirationsAsync(string symbol, CancellationToken ct)
            => (await _mediator.Send(new OptionChainsRequest { Symbol = symbol }, ct))?.expirations;

        public async Task<GammaExposureResponse?> GetGammaExposureAsync(GammaExposureRequest request, CancellationToken ct)
            => await _mediator.Send(request, ct);

        public async Task<UnderlyingQuote?> GetUnderlyingAsync(string symbol, CancellationToken ct)
        {
            try
            {
                var trade = (await _mediator.Send(new MarketDataTradeRequest { Symbol = symbol }, ct))?.Data?.FirstOrDefault();
                if (trade != null && double.IsFinite(trade.Price) && trade.Price > 0 && trade.Time > 0)
                    return new UnderlyingQuote(trade.Price, DateTimeOffset.FromUnixTimeMilliseconds(trade.Time).UtcDateTime);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogDebug(ex, "RuntimeMarketData: sin trade de {Symbol}, se prueba la cotización", symbol);
            }
            var q = await GetQuoteAsync(symbol, ct);
            return q == null ? null : new UnderlyingQuote(q.Mid, q.AsOf);
        }

        public async Task<LegQuote?> GetQuoteAsync(string streamerSymbol, CancellationToken ct)
        {
            var response = await _mediator.Send(new MarketDataQuoteRequest { Symbol = streamerSymbol }, ct);
            var q = response?.Data?.FirstOrDefault();
            if (q == null || !QuoteRules.IsUsable(q.BidPrice, q.AskPrice) || !double.IsFinite(q.BidPrice + q.AskPrice))
            {
                _logger.LogDebug("RuntimeMarketData: sin cotización utilizable para {Symbol}", streamerSymbol);
                return null;
            }
            var asOf = DataFreshness.QuoteTime(q.BidTime, q.AskTime, q.EventTime);
            return new LegQuote(q.BidPrice, q.AskPrice, asOf);
        }
    }
}
