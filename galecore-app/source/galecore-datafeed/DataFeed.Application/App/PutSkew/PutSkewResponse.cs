namespace DataFeed.Application.App.PutSkew
{
    /// <summary>
    /// Snapshot del skew 25Δ put. Definición (rules JSON definitions.put_skew_25d):
    /// putSkew25d = iv_put_25delta / iv_atm.
    /// RoC 5d y percentil 252d requieren historial de IV-por-delta (no persistido aún) → null.
    /// </summary>
    public class PutSkewResponse
    {
        public string Symbol { get; set; }
        public double Spot { get; set; }
        public int Dte { get; set; }
        public string Expiration { get; set; }

        /// <summary>Delta objetivo solicitado (magnitud, ej 0.25).</summary>
        public double TargetDelta { get; set; }

        // ATM
        public double AtmStrike { get; set; }
        public double AtmIV { get; set; }

        // Put 25Δ (strike con delta más cercano a -target)
        public double Put25DeltaStrike { get; set; }
        public double Put25DeltaActualDelta { get; set; }
        public double Put25DeltaIV { get; set; }

        /// <summary>Ratio iv_put_25delta / iv_atm. >1 = cola sobrepreciada vs ATM.</summary>
        public double? PutSkew25d { get; set; }

        /// <summary>
        /// Semáforo de NIVEL (proxy interino hasta tener RoC 5d): true = skew en zona calma (≤ threshold),
        /// false = cola repreciada (> threshold). NO es el gate real del JSON (que es RoC 5d ≤ 8%).
        /// </summary>
        public bool? LevelOk { get; set; }

        /// <summary>Umbral del nivel para el semáforo interino (ratio). Por encima = cola elevada.</summary>
        public double LevelThreshold { get; set; }

        // Pendientes de historial (snapshot-only):
        public double? Roc5d { get; set; }
        public double? Percentile252d { get; set; }

        public string Note { get; set; }
    }
}
