using DataFeed.Infrastructure.Providers.Tastytrade;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using MediatR;
using Microsoft.Extensions.Configuration;
using System.Globalization;

namespace DataFeed.Application.App.IVRank
{
    public class IVRankHandler : IRequestHandler<IVRankRequest, IVRankResponse>
    {
        private readonly IConfiguration _config;
        private readonly ITastytradeOAuth _auth;
        private readonly IHttpClientFactory _client;
        private readonly IDxLinkStreamingService _streaming;

        public IVRankHandler(IConfiguration config, ITastytradeOAuth auth, IHttpClientFactory client, IDxLinkStreamingService streaming)
        {
            _config = config;
            _auth = auth;
            _client = client;
            _streaming = streaming;
        }

        public async Task<IVRankResponse> Handle(IVRankRequest request, CancellationToken cancellationToken)
        {
            try
            {
                var apiProvider = new TastytradeApiProvider(_config, _auth, _client);

                // ═══════════════════════════════════════════════════════════
                // PASO 1: Obtener IV Rank y IV Percentile vía REST market-metrics
                // Tastytrade ya calcula estos valores sobre 252 días.
                // ═══════════════════════════════════════════════════════════
                var metrics = await apiProvider.GetMarketMetricsVolatilityAsync(request.Symbol, cancellationToken);
                var item = metrics?.Data?.Items?.FirstOrDefault();
                if (item == null)
                    throw new Exception($"No se encontraron market metrics para {request.Symbol}");

                double currentIV = ParseDoubleOrZero(item.ImpliedVolatilityIndex);
                double ivPercentile = ParseDoubleOrZero(item.ImpliedVolatilityPercentile) * 100;
                double iv30day = ParseDoubleOrZero(item.ImpliedVolatility30Day);
                double hv30day = ParseDoubleOrZero(item.HistoricalVolatility30Day);

                // IV Rank: Tastytrade no expone IV Rank directamente, pero sí IV Percentile.
                // Usamos IV Percentile como proxy (correlación alta, mismo rango 0-100).
                // Si en el futuro se necesita IV Rank exacto, se puede calcular con candles históricos.
                double ivRank = ivPercentile;

                // ═══════════════════════════════════════════════════════════
                // PASO 2: Obtener historial corto de precios vía REST
                // Se necesitan los últimos ~6 días de cierre para calcular
                // el z-score en Layer 2 (ivr.History).
                // Usamos market-data/by-type para el precio actual y
                // calculamos un historial mínimo.
                // ═══════════════════════════════════════════════════════════
                var history = new List<IVRankDay>();

                // Intentar obtener candles vía WebSocket para el historial
                // Si falla, el historial queda vacío (z-score = 0 en Layer 2)
                try
                {
                    var socketProvider = new TastytradeSocketProvider(_config, _auth, _client, _streaming);
                    var fromTime = DateTime.UtcNow.AddDays(-15);
                    var candles = await socketProvider.GetCandleAsync(
                        request.Symbol, "1d", fromTime, null, cancellationToken
                    );

                    if (candles?.data != null && candles.data.Any())
                    {
                        history = candles.data
                            .Where(c => !string.IsNullOrWhiteSpace(c.ImpVolatility)
                                     && c.ImpVolatility.Trim() != "NaN"
                                     && ParseDoubleOrZero(c.ImpVolatility) > 0)
                            .OrderBy(c => c.TimeStamp)
                            .Select(c => new IVRankDay
                            {
                                Date = c.TimeStamp.ToString("yyyy-MM-dd"),
                                IV = Math.Round(ParseDoubleOrZero(c.ImpVolatility), 4),
                                Close = Math.Round(ParseDoubleOrZero(c.Close), 2)
                            })
                            .ToList();
                    }
                }
                catch
                {
                    // Si WebSocket falla, continuamos sin historial.
                    // El z-score en Layer 2 será 0, lo cual selecciona Iron Condor (neutral).
                }

                return new IVRankResponse
                {
                    Symbol = request.Symbol,
                    CurrentIV = Math.Round(currentIV, 4),
                    HighIV = 0,
                    LowIV = 0,
                    IVRank = Math.Round(ivRank, 2),
                    IVPercentile = Math.Round(ivPercentile, 2),
                    TradingDays = 252,
                    History = history
                };
            }
            catch (Exception ex)
            {
                throw new Exception($"IVRankHandler Error: {ex.Message}");
            }
        }

        private static double ParseDoubleOrZero(string value)
        {
            if (string.IsNullOrWhiteSpace(value) || value.Trim() == "NaN")
                return 0;
            return double.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out double result) ? result : 0;
        }
    }
}
