using DataFeed.Infrastructure.Providers.Tastytrade;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using MediatR;
using Microsoft.Extensions.Configuration;
using System.Globalization;

namespace DataFeed.Application.App.ImpliedVolatility
{
    public class ImpliedVolatilityHandler : IRequestHandler<ImpliedVolatilityRequest, ImpliedVolatilityResponse>
    {
        private readonly IConfiguration _config;
        private readonly ITastytradeOAuth _auth;
        private readonly IHttpClientFactory _client;

        private static readonly int[] TARGET_DAYS = { 9, 30, 90 };

        public ImpliedVolatilityHandler(IConfiguration config, ITastytradeOAuth auth, IHttpClientFactory client)
        {
            _config = config;
            _auth = auth;
            _client = client;
        }

        public async Task<ImpliedVolatilityResponse> Handle(ImpliedVolatilityRequest request, CancellationToken cancellationToken)
        {
            try
            {
                var apiProvider = new TastytradeApiProvider(_config, _auth, _client);

                // ═══════════════════════════════════════════════════════════
                // PASO 1: Spot price vía REST
                // ═══════════════════════════════════════════════════════════
                var marketData = await apiProvider.GetMarketDataByTypeAsync(request.Symbol, cancellationToken);
                double spot = marketData?.Data?.Items?.FirstOrDefault()?.Mark ?? 0;
                if (spot <= 0)
                    spot = marketData?.Data?.Items?.FirstOrDefault()?.Last ?? 0;
                if (spot <= 0)
                    throw new Exception($"No se pudo obtener el precio spot de {request.Symbol}");

                // ═══════════════════════════════════════════════════════════
                // PASO 2: Market metrics vía REST (una sola llamada)
                // Trae: impliedVolatilityIndex (IV30 actual),
                //        impliedVolatilityIndex5DayChange (delta 5d),
                //        impliedVolatility30Day,
                //        expirationImpliedVolatilities (IV por expiración)
                // ═══════════════════════════════════════════════════════════
                var metrics = await apiProvider.GetMarketMetricsVolatilityAsync(request.Symbol, cancellationToken);
                var item = metrics?.Data?.Items?.FirstOrDefault();
                if (item == null)
                    throw new Exception($"No se encontraron market metrics para {request.Symbol}");

                var response = new ImpliedVolatilityResponse
                {
                    Symbol = request.Symbol,
                    Spot = spot
                };

                // ═══════════════════════════════════════════════════════════
                // PASO 3: IV por tenor (9d, 30d, 90d)
                // Interpolar desde expirationImpliedVolatilities
                // ═══════════════════════════════════════════════════════════
                var today = DateTime.UtcNow.Date;
                var expirations = item.ExpirationImpliedVolatilities?
                    .Where(e => !string.IsNullOrEmpty(e.ImpliedVolatility)
                             && !string.IsNullOrEmpty(e.ExpirationDate)
                             && double.TryParse(e.ImpliedVolatility, NumberStyles.Any, CultureInfo.InvariantCulture, out var v) && v > 0)
                    .Select(e => (
                        DTE: (DateTime.Parse(e.ExpirationDate) - today).Days,
                        IV: double.Parse(e.ImpliedVolatility, NumberStyles.Any, CultureInfo.InvariantCulture) * 100
                    ))
                    .Where(e => e.DTE > 0)
                    .OrderBy(e => e.DTE)
                    .ToList();

                if (expirations != null && expirations.Count > 0)
                {
                    foreach (var target in TARGET_DAYS)
                    {
                        double? iv = InterpolateFromExpirations(target, expirations);
                        if (iv.HasValue)
                        {
                            double rounded = Math.Round(iv.Value, 2);
                            switch (target)
                            {
                                case 9:  response.IV30_9d  = rounded; break;
                                case 30: response.IV30_30d = rounded; break;
                                case 90: response.IV30_90d = rounded; break;
                            }
                        }
                    }
                }

                // Fallback: si IV30_30d no se pudo interpolar, usar impliedVolatility30Day
                if (!response.IV30_30d.HasValue)
                {
                    double iv30 = ParseDoubleOrZero(item.ImpliedVolatility30Day);
                    if (iv30 > 0)
                        response.IV30_30d = Math.Round(iv30, 2);
                }

                // ═══════════════════════════════════════════════════════════
                // PASO 4: Movimiento diario esperado
                // ═══════════════════════════════════════════════════════════
                if (response.IV30_30d.HasValue)
                {
                    response.DailyMove = Math.Round(response.IV30_30d.Value / Math.Sqrt(252), 2);
                    response.DailyMoveDollar = Math.Round(spot * (response.DailyMove.Value / 100), 2);
                }

                // ═══════════════════════════════════════════════════════════
                // PASO 5: IV momentum (5 días) vía market-metrics REST
                // IV30_0d  = impliedVolatilityIndex (decimal → ×100)
                // IV30_5d  = IV30_0d reconstruido desde el 5DayChange
                // IV30RocPct = ((IV30_0d - IV30_5d) / IV30_5d) × 100
                // ═══════════════════════════════════════════════════════════
                double ivIndex = ParseDoubleOrZero(item.ImpliedVolatilityIndex);
                double ivIndex5dChange = ParseDoubleOrZero(item.ImpliedVolatilityIndex5DayChange);

                if (ivIndex > 0)
                {
                    response.IV30_0d = Math.Round(ivIndex * 100, 2);

                    double iv5dAgo = ivIndex - ivIndex5dChange;
                    if (iv5dAgo > 0)
                    {
                        response.IV30_5d = Math.Round(iv5dAgo * 100, 2);
                        response.IV30RocPct = Math.Round((ivIndex5dChange / iv5dAgo) * 100, 2);
                    }
                }

                return response;
            }
            catch (Exception ex)
            {
                throw new Exception($"ImpliedVolatilityHandler Error: {ex.Message}");
            }
        }

        private double? InterpolateFromExpirations(int targetDays, List<(int DTE, double IV)> expirations)
        {
            var near = expirations.Where(e => e.DTE <= targetDays).LastOrDefault();
            var next = expirations.Where(e => e.DTE > targetDays).FirstOrDefault();

            bool hasNear = near.DTE > 0 || near.IV > 0;
            bool hasNext = next.DTE > 0 || next.IV > 0;

            if (hasNear && hasNext && near.DTE != next.DTE)
            {
                double t1 = near.DTE;
                double t2 = next.DTE;
                double w = (targetDays - t1) / (t2 - t1);
                return near.IV + w * (next.IV - near.IV);
            }

            if (hasNear) return near.IV;
            if (hasNext) return next.IV;
            return null;
        }

        private static double ParseDoubleOrZero(string value)
        {
            if (string.IsNullOrWhiteSpace(value) || value.Trim() == "NaN")
                return 0;
            return double.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out double result) ? result : 0;
        }
    }
}
