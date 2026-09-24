using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Application.App.Shared;
using DataFeed.Application.Data.Tastytrade.MarketDataQuote;
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
    /// Específico para PCS. Se generaliza cuando haya más estructuras.
    /// </summary>
    public class PcsCandidateBuilder
    {
        private readonly IMediator _mediator;
        private readonly ILogger _logger;

        public PcsCandidateBuilder(IMediator mediator, ILogger logger)
        {
            _mediator = mediator;
            _logger = logger;
        }

        /// <summary>
        /// Construye un TradeCandidate PCS real o null si no hay candidato viable.
        /// </summary>
        public async Task<TradeCandidate?> BuildAsync(
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
                _logger.LogWarning("PcsCandidateBuilder: spec no tiene legs SELL PUT + BUY PUT");
                return null;
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
                _logger.LogWarning("PcsCandidateBuilder: sin cadena de opciones para {Symbol}", symbol);
                return null;
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
                _logger.LogDebug("PcsCandidateBuilder: sin expiración en DTE [{Min},{Max}] para {Symbol}",
                    minDte, maxDte, symbol);
                return null;
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
                _logger.LogWarning("PcsCandidateBuilder: sin strikes GEX para {Symbol} DTE={Dte}", symbol, dte);
                return null;
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
                _logger.LogDebug("PcsCandidateBuilder: sin puts OTM con delta válido para {Symbol}", symbol);
                return null;
            }

            var shortPutStrike = putStrikes.First();

            // Verificar que el delta está dentro de la tolerancia
            if (Math.Abs(shortPutStrike.PutDelta - targetDelta) > deltaTolerance)
            {
                _logger.LogDebug(
                    "PcsCandidateBuilder: delta más cercano {Delta} fuera de tolerancia ±{Tol} para target {Target}",
                    shortPutStrike.PutDelta, deltaTolerance, targetDelta);
                return null;
            }

            // ── 4. Long put = short strike - width ──
            double longPutStrikePrice = shortPutStrike.Strike - width;
            var longPutStrike = gexResponse.Strikes
                .OrderBy(s => Math.Abs(s.Strike - longPutStrikePrice))
                .FirstOrDefault();

            if (longPutStrike == null || Math.Abs(longPutStrike.Strike - longPutStrikePrice) > 1.0)
            {
                _logger.LogDebug("PcsCandidateBuilder: no hay strike para long put en {Price}", longPutStrikePrice);
                return null;
            }

            // ── 5. Obtener quotes para ambas patas ──
            // Usar streamer symbols del GEX response para pedir quotes
            string? shortSymbol = shortPutStrike.PutStreamerSymbol;
            string? longSymbol = longPutStrike.PutStreamerSymbol;

            double shortBid = 0, shortAsk = 0, longBid = 0, longAsk = 0;

            if (!string.IsNullOrEmpty(shortSymbol))
            {
                var shortQuote = await _mediator.Send(new MarketDataQuoteRequest { Symbol = shortSymbol }, ct);
                if (shortQuote?.Data?.Count > 0)
                {
                    shortBid = shortQuote.Data[0].BidPrice;
                    shortAsk = shortQuote.Data[0].AskPrice;
                }
            }

            if (!string.IsNullOrEmpty(longSymbol))
            {
                var longQuote = await _mediator.Send(new MarketDataQuoteRequest { Symbol = longSymbol }, ct);
                if (longQuote?.Data?.Count > 0)
                {
                    longBid = longQuote.Data[0].BidPrice;
                    longAsk = longQuote.Data[0].AskPrice;
                }
            }

            // Credit = short mid - long mid
            double shortMid = (shortBid + shortAsk) / 2;
            double longMid = (longBid + longAsk) / 2;
            double credit = Math.Round(shortMid - longMid, 2);

            if (credit < minCredit)
            {
                _logger.LogDebug("PcsCandidateBuilder: crédito {Credit} < mínimo {Min} para {Symbol}",
                    credit, minCredit, symbol);
                return null;
            }

            double actualWidth = shortPutStrike.Strike - longPutStrike.Strike;
            double maxRisk = Math.Round((actualWidth - credit) * 100, 2);

            // ── 6. Construir OCC symbols ──
            string shortOcc = CascadeUtils.BuildOccSymbol(symbol, expirationDate, shortPutStrike.Strike, 'P');
            string longOcc = CascadeUtils.BuildOccSymbol(symbol, expirationDate, longPutStrike.Strike, 'P');

            // ── 7. Armar TradeCandidate ──
            return new TradeCandidate
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
                        Delta = shortPutStrike.PutDelta,
                        Bid = shortBid,
                        Ask = shortAsk
                    },
                    new()
                    {
                        Side = "BUY",
                        Type = "PUT",
                        Strike = longPutStrike.Strike,
                        Expiration = expirationDate,
                        OccSymbol = longOcc,
                        Delta = longPutStrike.PutDelta,
                        Bid = longBid,
                        Ask = longAsk
                    }
                },
                Snapshot = new MarketSnapshot
                {
                    UnderlyingPrice = spot,
                    Vix = vixPrice,
                    AsOf = DateTime.UtcNow
                },
                CreatedAt = DateTime.UtcNow
            };
        }
    }
}
