using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Application.App.Shared;
using DataFeed.Application.Data.Tastytrade.OptionChains;
using MediatR;
using Microsoft.Extensions.Logging;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Construye un TradeCandidate para un Put Credit Spread (PCS) usando datos de mercado reales.
    ///
    /// Pipeline:
    ///   1. OptionChains → expirations → filtrar por DTE del spec
    ///   2. GammaExposure con TargetDte → deltas por strike → short put por delta
    ///   3. Long put = short put strike - width
    ///   4. Quotes de ambas patas → credit = short mid - long mid
    ///   5. Armar TradeCandidate con snapshot real
    ///
    /// Datos reales o nada (GC-0002, W-1): si falta la cadena, un strike, un delta o una cotización
    /// utilizable de cualquiera de las patas, no hay candidato y el resultado dice por qué. Nunca se
    /// completa un precio con cero.
    ///
    /// Específico para PCS. Se generaliza cuando haya más estructuras.
    /// </summary>
    public class PcsCandidateBuilder
    {
        private readonly IMediator _mediator;
        private readonly ILogger _logger;
        private readonly IRuntimeMarketData _quotes;

        public PcsCandidateBuilder(IMediator mediator, ILogger logger, IRuntimeMarketData quotes)
        {
            _mediator = mediator;
            _logger = logger;
            _quotes = quotes;
        }

        /// <summary>
        /// Construye un TradeCandidate PCS real, o el motivo por el que no hay candidato viable.
        /// </summary>
        public async Task<CandidateBuildResult> BuildAsync(
            StrategyInstance instance,
            StrategySpec spec,
            string symbol,
            double? vixPrice,
            CancellationToken ct = default)
        {
            var cc = spec.CandidateConstruction;

            // Leer parámetros del spec
            var sellLeg = cc.Legs.FirstOrDefault(l => l.Side == "SELL" && l.Type == "PUT");
            var buyLeg = cc.Legs.FirstOrDefault(l => l.Side == "BUY" && l.Type == "PUT");
            if (sellLeg == null || buyLeg == null)
            {
                return Reject("la spec no declara una pata SELL PUT y una BUY PUT");
            }

            double targetDelta = sellLeg.StrikeSelection.TargetDelta ?? -0.16;
            double deltaTolerance = sellLeg.StrikeSelection.DeltaTolerance ?? 0.04;
            double width = buyLeg.StrikeSelection.Width ?? 5.0;
            int minDte = cc.Constraints.MinDte ?? 30;
            int maxDte = cc.Constraints.MaxDte ?? 50;
            double minCredit = cc.Constraints.MinCredit ?? 0.10;

            // ── 1. Option chain → encontrar expiración en rango DTE ──
            var chainResponse = await _mediator.Send(new OptionChainsRequest { Symbol = symbol }, ct);
            if (chainResponse?.expirations == null || chainResponse.expirations.Count == 0)
            {
                return Reject($"sin cadena de opciones para {symbol}");
            }

            // Filtrar expiraciones regulares en rango DTE, la más cercana al centro
            int midDte = (minDte + maxDte) / 2;
            var validExpirations = chainResponse.expirations
                .Where(e => e.DaysToExpiration >= minDte && e.DaysToExpiration <= maxDte)
                .Where(e => e.ExpirationType == "Regular" || e.ExpirationType == "Weekly")
                .OrderBy(e => Math.Abs(e.DaysToExpiration - midDte))
                .ToList();

            if (validExpirations.Count == 0)
            {
                return Reject($"sin vencimiento regular o weekly con DTE entre {minDte} y {maxDte}");
            }

            var expiration = validExpirations.First();
            int dte = expiration.DaysToExpiration;
            string expirationDate = expiration.ExpirationDate;

            // ── 2. GammaExposure con TargetDte → deltas por strike ──
            var gexResponse = await _mediator.Send(new GammaExposureRequest
            {
                Symbol = symbol,
                TargetDte = dte,
                MaxDTE = maxDte + 10
            }, ct);

            if (gexResponse?.Strikes == null || gexResponse.Strikes.Count == 0)
            {
                return Reject($"sin strikes con griegas para el vencimiento {expirationDate} (DTE {dte})");
            }

            double spot = gexResponse.Spot;

            // ── 3. Encontrar short put por delta ──
            // Buscar puts OTM (strike < spot) con delta cercano al target
            // Put delta es negativo, target es negativo (ej: -0.16)
            var putStrikes = gexResponse.Strikes
                .Where(s => s.Strike < spot && s.PutDelta < 0 && s.PutDelta > -0.5)
                .OrderBy(s => Math.Abs(s.PutDelta - targetDelta))
                .ToList();

            if (putStrikes.Count == 0)
            {
                return Reject("sin puts fuera del dinero con delta válido");
            }

            var shortPutStrike = putStrikes.First();

            // Verificar que el delta está dentro de la tolerancia
            if (Math.Abs(shortPutStrike.PutDelta - targetDelta) > deltaTolerance)
            {
                return Reject($"el delta más cercano ({shortPutStrike.PutDelta:0.000}) está fuera de ±{deltaTolerance} "
                              + $"del objetivo {targetDelta}");
            }

            // ── 4. Long put = short strike - width ──
            double longPutStrikePrice = shortPutStrike.Strike - width;
            var longPutStrike = gexResponse.Strikes
                .OrderBy(s => Math.Abs(s.Strike - longPutStrikePrice))
                .FirstOrDefault();

            if (longPutStrike == null || Math.Abs(longPutStrike.Strike - longPutStrikePrice) > 1.0)
            {
                return Reject($"no hay strike para la pata comprada cerca de {longPutStrikePrice}");
            }

            // ── 5. Cotizaciones reales de ambas patas (por símbolo de streamer) ──
            string? shortSymbol = shortPutStrike.PutStreamerSymbol;
            string? longSymbol = longPutStrike.PutStreamerSymbol;
            if (string.IsNullOrEmpty(shortSymbol) || string.IsNullOrEmpty(longSymbol))
                return Reject("falta el símbolo de streamer de una pata; no se puede cotizar");

            var shortQuote = await _quotes.GetQuoteAsync(shortSymbol, ct);
            if (shortQuote == null)
                return Reject($"sin cotización utilizable para la pata vendida {shortSymbol}");
            var longQuote = await _quotes.GetQuoteAsync(longSymbol, ct);
            if (longQuote == null)
                return Reject($"sin cotización utilizable para la pata comprada {longSymbol}");

            // Credit = short mid - long mid
            double credit = Math.Round(shortQuote.Mid - longQuote.Mid, 2);

            if (credit < minCredit)
                return Reject($"crédito {credit} menor al mínimo {minCredit}");

            double actualWidth = shortPutStrike.Strike - longPutStrike.Strike;
            double maxRisk = Math.Round((actualWidth - credit) * 100, 2);

            // ── 6. Construir OCC symbols ──
            string shortOcc = CascadeUtils.BuildOccSymbol(symbol, expirationDate, shortPutStrike.Strike, 'P');
            string longOcc = CascadeUtils.BuildOccSymbol(symbol, expirationDate, longPutStrike.Strike, 'P');

            // ── 7. Armar TradeCandidate ──
            return CandidateBuildResult.Built(new TradeCandidate
            {
                CandidateId = Guid.NewGuid().ToString(),
                InstanceId = instance.InstanceId,
                Symbol = symbol,
                Structure = spec.Structure.DefaultStructure,
                Credit = credit,
                MaxRisk = maxRisk,
                Width = actualWidth,
                Dte = dte,
                DeltaShort = shortPutStrike.PutDelta,
                Legs = new List<CandidateLeg>
                {
                    new()
                    {
                        Side = "SELL",
                        Type = "PUT",
                        Strike = shortPutStrike.Strike,
                        Expiration = expirationDate,
                        OccSymbol = shortOcc,
                        StreamerSymbol = shortSymbol,
                        Delta = shortPutStrike.PutDelta,
                        Bid = shortQuote.Bid,
                        Ask = shortQuote.Ask
                    },
                    new()
                    {
                        Side = "BUY",
                        Type = "PUT",
                        Strike = longPutStrike.Strike,
                        Expiration = expirationDate,
                        OccSymbol = longOcc,
                        StreamerSymbol = longSymbol,
                        Delta = longPutStrike.PutDelta,
                        Bid = longQuote.Bid,
                        Ask = longQuote.Ask
                    }
                },
                Snapshot = new MarketSnapshot
                {
                    UnderlyingPrice = spot,
                    Vix = vixPrice,
                    AsOf = DateTime.UtcNow
                },
                CreatedAt = DateTime.UtcNow
            });
        }

        private CandidateBuildResult Reject(string reason)
        {
            _logger.LogDebug("PcsCandidateBuilder: sin candidato: {Reason}", reason);
            return CandidateBuildResult.Rejected(reason);
        }
    }
}
