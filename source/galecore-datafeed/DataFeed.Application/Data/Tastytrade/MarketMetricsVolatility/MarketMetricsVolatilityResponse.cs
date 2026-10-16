using System.Collections.Generic;

namespace DataFeed.Application.Data.Tastytrade.MarketMetricsVolatility
{
    public class MarketMetricsVolatilityResponse
    {
        public List<MarketMetricsVolatilityDto> Items { get; set; }
    }

    public class MarketMetricsVolatilityDto
    {
        public string Symbol { get; set; }

        // IV index (equivalente al VIX para el símbolo)
        public decimal? ImpliedVolatilityIndex { get; set; }
        public decimal? ImpliedVolatilityIndex5DayChange { get; set; }
        public decimal? ImpliedVolatilityPercentile { get; set; }
        public string ImpliedVolatilityUpdatedAt { get; set; }

        // IV por plazo
        public decimal? ImpliedVolatility30Day { get; set; }
        public decimal? ImpliedVolatility60Day { get; set; }
        public decimal? ImpliedVolatility90Day { get; set; }
        public decimal? ImpliedVolatility180Day { get; set; }
        public decimal? ImpliedVolatility360Day { get; set; }

        // HV histórica por plazo
        public decimal? HistoricalVolatility30Day { get; set; }
        public decimal? HistoricalVolatility60Day { get; set; }
        public decimal? HistoricalVolatility90Day { get; set; }
        public decimal? HistoricalVolatility180Day { get; set; }
        public decimal? HistoricalVolatility360Day { get; set; }

        // IV - HV diferencia por plazo
        public decimal? IvHv30DayDifference { get; set; }
        public decimal? IvHv60DayDifference { get; set; }
        public decimal? IvHv90DayDifference { get; set; }

        // Otros indicadores de mercado
        public decimal? Beta { get; set; }
        /// <summary>Capitalización de mercado en USD (Tastytrade), para pesar el aporte al índice.</summary>
        public decimal? MarketCap { get; set; }
        public decimal? CorrSpy3Month { get; set; }
        public decimal? LiquidityRank { get; set; }
        public int? LiquidityRating { get; set; }

        public string UpdatedAt { get; set; }

        public List<ExpirationImpliedVolatilityDto> ExpirationImpliedVolatilities { get; set; }

        // Próximo balance y consenso (Tastytrade). Null en ETF e índices.
        public EarningsDto Earnings { get; set; }

        // Perfil
        public string Sector { get; set; }
        public string Industry { get; set; }
        public string ListedMarket { get; set; }
        public decimal? EarningsPerShare { get; set; }
        public decimal? PriceEarningsRatio { get; set; }

        // Dividendos: ExDate es el ÚLTIMO ex-dividendo, no el próximo (dividend-next-date viene viejo y no se usa)
        public string DividendExDate { get; set; }
        public string DividendPayDate { get; set; }
        public decimal? DividendRatePerShare { get; set; }
        public decimal? DividendYield { get; set; }
    }

    public class EarningsDto
    {
        public string ExpectedReportDate { get; set; }
        /// <summary>BMO = antes de la apertura, AMC = después del cierre.</summary>
        public string TimeOfDay { get; set; }
        /// <summary>true si la fecha es una estimación del proveedor y no está confirmada.</summary>
        public bool? Estimated { get; set; }
        public string QuarterEndDate { get; set; }
        public decimal? ConsensusEps { get; set; }
        /// <summary>Campo actual-eps del proveedor. En AAPL (16/10/2026) coincide con el EPS reportado en oct-2025, es decir el trimestre comparable del año anterior; no es el último reportado. Para eso, EarningsHistory.</summary>
        public decimal? ActualEps { get; set; }
    }

    public class ExpirationImpliedVolatilityDto
    {
        public string ExpirationDate { get; set; }
        public decimal? LowVolatility { get; set; }
        public decimal? HighVolatility { get; set; }
        public decimal? ImpliedVolatility { get; set; }
        public string OptionUpdatedAt { get; set; }
    }
}
