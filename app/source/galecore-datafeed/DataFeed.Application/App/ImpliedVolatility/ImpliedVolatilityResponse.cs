namespace DataFeed.Application.App.ImpliedVolatility
{
    public class ImpliedVolatilityResponse
    {
        public string Symbol { get; set; }

        public double Spot { get; set; }

        /// <summary>
        /// Volatilidad implícita a 9 días DTE (% anualizado, equivalente a VIX9D).
        /// Fuente: interpolación de expirationImpliedVolatilities de /market-metrics
        /// </summary>
        public double? IV30_9d { get; set; }

        /// <summary>
        /// Volatilidad implícita a 30 días DTE (% anualizado, equivalente a VIX).
        /// Fuente: interpolación de expirationImpliedVolatilities de /market-metrics
        /// </summary>
        public double? IV30_30d { get; set; }

        /// <summary>
        /// Volatilidad implícita a 90 días DTE (% anualizado, equivalente a VIX3M).
        /// Fuente: interpolación de expirationImpliedVolatilities de /market-metrics
        /// </summary>
        public double? IV30_90d { get; set; }

        /// <summary>
        /// Movimiento diario esperado = IV30_30d / sqrt(252)
        /// </summary>
        public double? DailyMove { get; set; }

        /// <summary>
        /// Movimiento diario esperado en dólares = Spot * DailyMove / 100
        /// </summary>
        public double? DailyMoveDollar { get; set; }

        /// <summary>
        /// IV30 actual — impliedVolatilityIndex de /market-metrics (decimal x 100).
        /// </summary>
        public double? IV30_0d { get; set; }

        /// <summary>
        /// IV30 de hace 5 sesiones — reconstruido desde impliedVolatilityIndex - impliedVolatilityIndex5DayChange.
        /// </summary>
        public double? IV30_5d { get; set; }

        /// <summary>
        /// Tasa de cambio de la IV30 en 5 sesiones = ((IV30_0d - IV30_5d) / IV30_5d) x 100.
        /// Usado como metrica de iv_momentum en Capa 1. Si > 12% indica expansion de vol.
        /// </summary>
        public double? IV30RocPct { get; set; }
    }
}
