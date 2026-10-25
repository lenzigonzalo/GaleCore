using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.Shared;
using DataFeed.Application.Data.Tastytrade.MarketDataCandle;
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
    ///   "capability:compute.ema_spread.{SYMBOL}.{fast}.{slow}" → velas diarias → EMA(fast) − EMA(slow) (WS-0061)
    ///   "capability:compute.ema.{SYMBOL}.{n}" / "capability:compute.sma.{SYMBOL}.{n}" → velas diarias → EMA / SMA de n cierres (WS-0062 inc.5)
    ///
    /// Cada metric_ref se parsea y se despacha al handler MediatR correspondiente.
    /// Si el handler falla o no devuelve datos, el valor queda null → el gate lo trata según on_no_data.
    /// </summary>
    public class MetricResolver
    {
        /// <summary>Los patrones de metric_ref que ResolveSingleAsync entiende (los publica POST /App/Runtime/Specs/Check). Mantener junto al despacho de abajo.</summary>
        public static readonly IReadOnlyList<string> Patterns = new[]
        {
            "capability:market_data.quote.{SYMBOL}.price",
            "capability:market_data.trade.{SYMBOL}.price",
            "capability:compute.gamma_exposure.{SYMBOL}.net_gex",
            "capability:compute.ema_spread.{SYMBOL}.{fast}.{slow}",
            "capability:compute.ema.{SYMBOL}.{n}",
            "capability:compute.sma.{SYMBOL}.{n}",
        };

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

            // compute.ema_spread.{SYMBOL}.{fast}.{slow}
            if (parts.Length == 5 && parts[0] == "compute" && parts[1] == "ema_spread"
                && int.TryParse(parts[3], out var fast) && int.TryParse(parts[4], out var slow))
            {
                return await ResolveEmaSpread(parts[2], fast, slow, ct);
            }

            // compute.ema.{SYMBOL}.{n} y compute.sma.{SYMBOL}.{n}
            if (parts.Length == 4 && parts[0] == "compute" && (parts[1] == "ema" || parts[1] == "sma")
                && int.TryParse(parts[3], out var period))
            {
                return await ResolveMovingAverage(parts[1], parts[2], period, ct);
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
            var price = UsableQuotePrice(quote, _nowUtc, _maxAge);
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
        /// El mid de la cotización, o null si la cotización no sirve (QuoteRules.IsUsable), el mid no es
        /// positivo y finito, o la hora del proveedor es vieja o futura. Una cotización de un solo lado
        /// (bid 0, ask 20) daría un mid de 10 que no existe; dos precios finitos enormes suman
        /// infinito (Codex C2). Sin hora (ni bidTime/askTime ni EventTime) no sirve, como en las patas.
        /// </summary>
        public static double? UsableQuotePrice(QuoteEvent? quote, DateTime nowUtc, TimeSpan? maxAge)
        {
            if (quote == null || !QuoteRules.IsUsable(quote.BidPrice, quote.AskPrice)) return null;
            var quotedAt = DataFreshness.QuoteTime(quote.BidTime, quote.AskTime, quote.EventTime);
            if (DataFreshness.Problem(quotedAt, nowUtc, maxAge) != null) return null;
            var mid = quote.MidPrice;
            return double.IsFinite(mid) && mid > 0 ? mid : null;
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

        private async Task<double?> ResolveEmaSpread(string symbol, int fast, int slow, CancellationToken ct)
        {
            if (fast <= 0 || slow <= fast) return null;
            var (candles, fetched, key) = await LoadDailyCandles(symbol, slow, ct);
            var spread = UsableEmaSpread(candles, fast, slow, _nowUtc);
            CacheIfUsable(fetched, spread, key, candles);
            if (spread == null)
                _logger.LogDebug("MetricResolver: velas diarias insuficientes para ema_spread {Symbol} {Fast}/{Slow}", symbol, fast, slow);
            return spread;
        }

        private async Task<double?> ResolveMovingAverage(string kind, string symbol, int period, CancellationToken ct)
        {
            if (period <= 0) return null;
            var (candles, fetched, key) = await LoadDailyCandles(symbol, period, ct);
            var value = kind == "ema" ? UsableEma(candles, period, _nowUtc) : UsableSma(candles, period, _nowUtc);
            CacheIfUsable(fetched, value, key, candles);
            if (value == null)
                _logger.LogDebug("MetricResolver: velas diarias insuficientes para {Kind} {Symbol} {Period}", kind, symbol, period);
            return value;
        }

        /// <summary>
        /// Velas diarias para una media de hasta <paramref name="longestPeriod"/> cierres, con el caché compartido por
        /// (símbolo, intervalo, días): ema_spread, ema y sma del mismo símbolo y período no repiden el pedido.
        /// slow×6 días corridos (≈ 4 ruedas por cada una de slow: la EMA converge y sobran para los feriados), piso 250.
        /// </summary>
        private async Task<(List<CandleData>? Candles, bool Fetched, (string, string, int) Key)> LoadDailyCandles(
            string symbol, int longestPeriod, CancellationToken ct)
        {
            int days = Math.Max(250, longestPeriod * 6);
            var key = (symbol, "1d", days);
            if (DailyCandleCache.TryGetValue(key, out var hit) && _nowUtc - hit.At < DailyCandleTtl && _nowUtc >= hit.At)
                return (hit.Candles, false, key);
            var response = await _mediator.Send(new MarketDataCandleRequest
            {
                Symbol = symbol,
                Interval = "1d",
                FromTime = _nowUtc.AddDays(-days),
            }, ct);
            return (response?.data, true, key);
        }

        /// <summary>Sólo se guarda un resultado utilizable: velas parciales o con la última vieja se reintentan en el tick siguiente.</summary>
        private void CacheIfUsable(bool fetched, double? value, (string, string, int) key, List<CandleData>? candles)
        {
            if (fetched && value != null && candles != null) DailyCandleCache[key] = (_nowUtc, candles);
        }

        /// <summary>
        /// Caché de velas diarias por (símbolo, intervalo, días): la entrada (60 s) y la salida por métrica (30 s)
        /// no necesitan pedir 250 días a Tastytrade en cada tick. Vence a los 10 min (el cierre diario no cambia).
        /// </summary>
        public static readonly TimeSpan DailyCandleTtl = TimeSpan.FromMinutes(10);
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<(string, string, int), (DateTime At, List<CandleData> Candles)>
            DailyCandleCache = new();
        public static void ClearDailyCandleCache() => DailyCandleCache.Clear();

        /// <summary>Días corridos máximos entre la última vela diaria y ahora (fin de semana largo + margen).</summary>
        public const int MaxLastCandleAgeDays = 7;

        /// <summary>
        /// EMA(fast) − EMA(slow) sobre los cierres diarios, o null si no hay datos suficientes: menos de slow×2 velas
        /// con cierre positivo (la EMA arranca con una SMA de slow y necesita historia para estabilizarse) o la última
        /// vela es vieja. Nunca se completa con ceros.
        /// </summary>
        public static double? UsableEmaSpread(IEnumerable<CandleData>? candles, int fast, int slow, DateTime nowUtc)
        {
            if (fast <= 0 || slow <= fast) return null;
            var list = UsableCloses(candles, slow * 2, nowUtc);
            if (list == null) return null;
            var spread = CascadeUtils.ComputeEMA(list, fast) - CascadeUtils.ComputeEMA(list, slow);
            return double.IsFinite(spread) ? spread : null;
        }

        /// <summary>EMA de <paramref name="period"/> cierres diarios (mismo cálculo y mismas exigencias de datos que ema_spread), o null.</summary>
        public static double? UsableEma(IEnumerable<CandleData>? candles, int period, DateTime nowUtc)
        {
            if (period <= 0) return null;
            var list = UsableCloses(candles, period * 2, nowUtc);
            if (list == null) return null;
            var ema = CascadeUtils.ComputeEMA(list, period);
            return double.IsFinite(ema) ? ema : null;
        }

        /// <summary>SMA de los últimos <paramref name="period"/> cierres diarios, con las mismas exigencias de datos que la EMA, o null.</summary>
        public static double? UsableSma(IEnumerable<CandleData>? candles, int period, DateTime nowUtc)
        {
            if (period <= 0) return null;
            var list = UsableCloses(candles, period * 2, nowUtc);
            if (list == null) return null;
            var sma = list.TakeLast(period).Average(c => c.Close);
            return double.IsFinite(sma) ? sma : null;
        }

        /// <summary>
        /// Velas con cierre positivo y ordenadas, o null si hay menos de <paramref name="minCount"/> (la EMA arranca con una SMA y
        /// necesita historia para estabilizarse), alguna sin hora o futura, o la última es vieja. Nunca se completa con ceros.
        /// </summary>
        private static List<CandleData>? UsableCloses(IEnumerable<CandleData>? candles, int minCount, DateTime nowUtc)
        {
            if (candles == null) return null;
            var list = candles.Where(c => c.Close > 0 && double.IsFinite(c.Close)).OrderBy(c => c.Time).ToList();
            if (list.Count < minCount) return null;
            // Una vela sin hora o con hora futura es dato malformado: no se descarta en silencio, el resultado no sirve.
            if (list[0].Time <= 0 || DateTimeOffset.FromUnixTimeMilliseconds(list[^1].Time).UtcDateTime > nowUtc + DataFreshness.ClockSkew)
                return null;
            var last = DateTimeOffset.FromUnixTimeMilliseconds(list[^1].Time).UtcDateTime;
            if (nowUtc - last > TimeSpan.FromDays(MaxLastCandleAgeDays)) return null;
            return list;
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
        ///
        /// La cobertura del OI NO se exige completa (decisión del owner, 24/09): en vivo vuelve OI para
        /// ~30% de las patas de la banda de delta y el handler descarta el OI 0, así que no se sabe si el
        /// resto es cero o no llegó. Queda declarado y visible en CallOi/PutOi Requested/Received de la
        /// respuesta; la causa se investiga en BL-014.
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
