namespace DataFeed.Application.App.IVRank
{
    public class IVRankResponse
    {
        /// <summary>
        /// Símbolo del subyacente
        /// </summary>
        public string Symbol { get; set; }

        /// <summary>
        /// IV actual (última lectura)
        /// </summary>
        public double CurrentIV { get; set; }

        /// <summary>
        /// IV máxima en los últimos 252 días
        /// </summary>
        public double HighIV { get; set; }

        /// <summary>
        /// IV mínima en los últimos 252 días
        /// </summary>
        public double LowIV { get; set; }

        /// <summary>
        /// IV Rank = (CurrentIV - LowIV) / (HighIV - LowIV) × 100
        /// Indica dónde se ubica la IV actual respecto al rango de 252 días
        /// </summary>
        public double IVRank { get; set; }

        /// <summary>
        /// IV Percentile = % de días en que la IV fue menor a la actual
        /// </summary>
        public double IVPercentile { get; set; }

        /// <summary>
        /// Cantidad de días con datos válidos de IV
        /// </summary>
        public int TradingDays { get; set; }

        /// <summary>
        /// Historial diario de IV (252 días, ordenado cronológicamente)
        /// </summary>
        public List<IVRankDay> History { get; set; } = new();
    }

    public class IVRankDay
    {
        /// <summary>
        /// Fecha del dato
        /// </summary>
        public string Date { get; set; }

        /// <summary>
        /// Volatilidad implícita del día
        /// </summary>
        public double IV { get; set; }

        /// <summary>
        /// Precio de cierre del día
        /// </summary>
        public double Close { get; set; }
    }
}
