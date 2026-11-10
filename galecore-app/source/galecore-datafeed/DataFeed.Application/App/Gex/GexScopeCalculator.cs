using DataFeed.Application.App.GammaExposure;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;

namespace DataFeed.Application.App.Gex
{
    /// <summary>
    /// Agregado GEX de un subconjunto de vencimientos (GET /App/Gex/Scope). Parte del barrido ya
    /// hecho (cache del handler / disco) y usa los MISMOS helpers que el GEX global de
    /// GammaExposureHandler: no vuelve a barrer la cadena.
    /// </summary>
    public static class GexScopeCalculator
    {
        /// <summary>
        /// null si no hay barrido del símbolo. Los vencimientos pedidos que no estén en el barrido se
        /// ignoran; <c>ExpirationsIncluded</c> dice cuántos entraron.
        /// </summary>
        public static GexScope? ComputeFromLast(string symbol, IEnumerable<string> expirations)
        {
            var analysis = GexAnalysisHandler.TryGetLast(symbol);
            return analysis == null ? null : Compute(analysis, expirations);
        }

        public static GexScope Compute(GexAnalysisResponse analysis, IEnumerable<string> expirations)
        {
            var wanted = new HashSet<string>(expirations.Select(e => e.Trim()), StringComparer.Ordinal);
            var picked = analysis.Gex.ByExpiry.Where(e => wanted.Contains(e.Expiration)).ToList();

            var byExpiry = new Dictionary<string, Dictionary<double, GammaExposureStrike>>();
            foreach (var e in picked)
                byExpiry[e.Expiration] = e.Strikes.ToDictionary(s => s.Strike, ToEngineStrike);

            var exps = picked
                .Select(e => new Expiration { ExpirationDate = e.Expiration, DaysToExpiration = e.Dte })
                .ToList();

            double spot = analysis.SpotPrice;
            var strikes = GammaExposureHandler.AggregateStrikes(exps, byExpiry);

            // Mismas sumas y redondeos que GammaExposureResponse.CallGEX / PutGEX / NetGEX.
            double callGex = Math.Round(strikes.Sum(s => s.CallGEX), 4);
            double putGex = Math.Round(strikes.Sum(s => s.PutGEX), 4);

            return new GexScope
            {
                Spot = spot,
                CallGex = callGex,
                PutGex = putGex,
                NetGex = Math.Round((callGex + putGex) / 1000, 1),
                GammaZeroLevel = GammaExposureHandler.CalculateGammaZero(strikes, spot),
                CallWall = GammaExposureHandler.SelectCallWall(strikes, spot),
                PutWall = GammaExposureHandler.SelectPutWall(strikes, spot),
                ExpirationsIncluded = picked.Count,
                ExpirationsRequested = wanted.Count,
                CoveragePct = analysis.Gex.Global.CoveragePct,
                Strikes = strikes.Select(s => new GexStrike
                {
                    Strike = s.Strike, CallGEX = s.CallGEX, PutGEX = s.PutGEX, NetGEX = s.NetGEX,
                    CallOI = s.CallOI, PutOI = s.PutOI, CallDelta = s.CallDelta, PutDelta = s.PutDelta,
                    CallIV = s.CallIV, PutIV = s.PutIV,
                }).ToList(),
            };
        }

        private static GammaExposureStrike ToEngineStrike(GexStrike s) => new()
        {
            Strike = s.Strike, CallGEX = s.CallGEX, PutGEX = s.PutGEX,
            CallOI = s.CallOI, PutOI = s.PutOI, CallDelta = s.CallDelta, PutDelta = s.PutDelta,
            CallIV = s.CallIV, PutIV = s.PutIV,
        };
    }
}
