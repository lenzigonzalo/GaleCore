using System;
using System.Linq;
using DataFeed.Application.App.GammaExposure;

namespace DataFeed.Application.App.PutSkew
{
    /// <summary>
    /// Calcula el snapshot del skew 25Δ put a partir de una respuesta de GammaExposure ya obtenida.
    /// Compartido por PutSkewHandler (endpoint standalone) y RpfTickHandler (embebido en su
    /// respuesta, para no disparar una segunda llamada pesada a GammaExposure).
    /// </summary>
    public static class PutSkewCalculator
    {
        /// <summary>Umbral de NIVEL para el semáforo interino (proxy hasta tener RoC 5d real).</summary>
        public const double LevelThreshold = 1.30;

        public static PutSkewResponse Compute(GammaExposureResponse gex, double targetDelta = 0.25)
        {
            var target = Math.Abs(targetDelta <= 0 ? 0.25 : targetDelta);

            var resp = new PutSkewResponse
            {
                Symbol         = gex.Symbol,
                Spot           = gex.Spot,
                Dte            = gex.DTE,
                Expiration     = gex.Expiration,
                TargetDelta    = target,
                LevelThreshold = LevelThreshold,
            };

            var strikes = gex.Strikes ?? new System.Collections.Generic.List<GammaExposureStrike>();

            // ATM: strike más cercano al spot con IV válida. iv_atm = promedio call/put IV disponibles.
            var atm = strikes
                .Where(s => s.CallIV > 0 || s.PutIV > 0)
                .OrderBy(s => Math.Abs(s.Strike - gex.Spot))
                .FirstOrDefault();

            // Put 25Δ: put con delta más cercano a -target, con IV válida.
            var put25 = strikes
                .Where(s => s.PutIV > 0 && s.PutDelta < 0)
                .OrderBy(s => Math.Abs(s.PutDelta + target))
                .FirstOrDefault();

            if (atm == null || put25 == null)
            {
                resp.Note = "Datos insuficientes: no se resolvió ATM o put 25Δ con IV válida.";
                return resp;
            }

            double atmIv = AvgPositive(atm.CallIV, atm.PutIV);

            resp.AtmStrike             = atm.Strike;
            resp.AtmIV                 = Math.Round(atmIv, 4);
            resp.Put25DeltaStrike      = put25.Strike;
            resp.Put25DeltaActualDelta = Math.Round(put25.PutDelta, 4);
            resp.Put25DeltaIV          = Math.Round(put25.PutIV, 4);

            if (atmIv > 0)
            {
                resp.PutSkew25d = Math.Round(put25.PutIV / atmIv, 4);
                resp.LevelOk    = resp.PutSkew25d <= LevelThreshold;
            }

            resp.Note = "Snapshot. RoC 5d y percentil 252d requieren historial de IV-por-delta (no persistido aún).";
            return resp;
        }

        private static double AvgPositive(double a, double b)
        {
            if (a > 0 && b > 0) return (a + b) / 2.0;
            return a > 0 ? a : b;
        }
    }
}
