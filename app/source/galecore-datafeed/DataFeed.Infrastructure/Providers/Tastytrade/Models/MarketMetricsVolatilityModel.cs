using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace DataFeed.Infrastructure.Providers.Tastytrade.Models
{
    public class MarketMetricsVolatilityModel
    {
        [JsonPropertyName("data")]
        public MarketMetricsVolatilityData Data { get; set; }
    }

    public class MarketMetricsVolatilityData
    {
        [JsonPropertyName("items")]
        public List<MarketMetricsVolatilityItem> Items { get; set; }
    }

    public class MarketMetricsVolatilityItem
    {
        [JsonPropertyName("symbol")]
        public string Symbol { get; set; }

        [JsonPropertyName("implied-volatility-index")]
        public string ImpliedVolatilityIndex { get; set; }

        [JsonPropertyName("implied-volatility-index-5-day-change")]
        public string ImpliedVolatilityIndex5DayChange { get; set; }

        [JsonPropertyName("implied-volatility-percentile")]
        public string ImpliedVolatilityPercentile { get; set; }

        [JsonPropertyName("implied-volatility-updated-at")]
        public string ImpliedVolatilityUpdatedAt { get; set; }

        [JsonPropertyName("implied-volatility-30-day")]
        public string ImpliedVolatility30Day { get; set; }

        [JsonPropertyName("implied-volatility-60-day")]
        public string ImpliedVolatility60Day { get; set; }

        [JsonPropertyName("implied-volatility-90-day")]
        public string ImpliedVolatility90Day { get; set; }

        [JsonPropertyName("implied-volatility-180-day")]
        public string ImpliedVolatility180Day { get; set; }

        [JsonPropertyName("implied-volatility-360-day")]
        public string ImpliedVolatility360Day { get; set; }

        [JsonPropertyName("historical-volatility-30-day")]
        public string HistoricalVolatility30Day { get; set; }

        [JsonPropertyName("historical-volatility-60-day")]
        public string HistoricalVolatility60Day { get; set; }

        [JsonPropertyName("historical-volatility-90-day")]
        public string HistoricalVolatility90Day { get; set; }

        [JsonPropertyName("historical-volatility-180-day")]
        public string HistoricalVolatility180Day { get; set; }

        [JsonPropertyName("historical-volatility-360-day")]
        public string HistoricalVolatility360Day { get; set; }

        [JsonPropertyName("iv-hv-30-day-difference")]
        public string IvHv30DayDifference { get; set; }

        [JsonPropertyName("iv-hv-60-day-difference")]
        public string IvHv60DayDifference { get; set; }

        [JsonPropertyName("iv-hv-90-day-difference")]
        public string IvHv90DayDifference { get; set; }

        [JsonPropertyName("beta")]
        public string Beta { get; set; }

        [JsonPropertyName("market-cap")]
        public decimal? MarketCap { get; set; }

        [JsonPropertyName("corr-spy-3month")]
        public string CorrSpy3Month { get; set; }

        [JsonPropertyName("liquidity-value")]
        public string LiquidityValue { get; set; }

        [JsonPropertyName("liquidity-rank")]
        public string LiquidityRank { get; set; }

        [JsonPropertyName("liquidity-rating")]
        public int? LiquidityRating { get; set; }

        [JsonPropertyName("updated-at")]
        public string UpdatedAt { get; set; }

        [JsonPropertyName("option-expiration-implied-volatilities")]
        public List<ExpirationImpliedVolatility> ExpirationImpliedVolatilities { get; set; }

        [JsonPropertyName("earnings")]
        public MarketMetricsEarnings Earnings { get; set; }

        [JsonPropertyName("sector")]
        public string Sector { get; set; }

        [JsonPropertyName("industry")]
        public string Industry { get; set; }

        [JsonPropertyName("listed-market")]
        public string ListedMarket { get; set; }

        [JsonPropertyName("earnings-per-share")]
        public string EarningsPerShare { get; set; }

        [JsonPropertyName("price-earnings-ratio")]
        public string PriceEarningsRatio { get; set; }

        [JsonPropertyName("dividend-ex-date")]
        public string DividendExDate { get; set; }

        [JsonPropertyName("dividend-pay-date")]
        public string DividendPayDate { get; set; }

        [JsonPropertyName("dividend-rate-per-share")]
        public string DividendRatePerShare { get; set; }

        [JsonPropertyName("dividend-yield")]
        public string DividendYield { get; set; }
    }

    public class MarketMetricsEarnings
    {
        [JsonPropertyName("visible")]
        public bool? Visible { get; set; }

        [JsonPropertyName("expected-report-date")]
        public string ExpectedReportDate { get; set; }

        /// <summary>BMO (antes de la apertura), AMC (después del cierre) o similar.</summary>
        [JsonPropertyName("time-of-day")]
        public string TimeOfDay { get; set; }

        [JsonPropertyName("estimated")]
        public bool? Estimated { get; set; }

        [JsonPropertyName("quarter-end-date")]
        public string QuarterEndDate { get; set; }

        [JsonPropertyName("consensus-estimate")]
        public string ConsensusEstimate { get; set; }

        [JsonPropertyName("actual-eps")]
        public string ActualEps { get; set; }
    }

    public class EarningsReportsModel
    {
        [JsonPropertyName("data")]
        public EarningsReportsData Data { get; set; }
    }

    public class EarningsReportsData
    {
        [JsonPropertyName("items")]
        public List<EarningsReportItem> Items { get; set; }
    }

    public class EarningsReportItem
    {
        [JsonPropertyName("occurred-date")]
        public string OccurredDate { get; set; }

        [JsonPropertyName("eps")]
        public string Eps { get; set; }
    }

    public class ExpirationImpliedVolatility
    {
        [JsonPropertyName("expiration-date")]
        public string ExpirationDate { get; set; }

        [JsonPropertyName("option-updated-at")]
        public string OptionUpdatedAt { get; set; }

        [JsonPropertyName("low-volatility")]
        public string LowVolatility { get; set; }

        [JsonPropertyName("high-volatility")]
        public string HighVolatility { get; set; }

        [JsonPropertyName("implied-volatility")]
        public string ImpliedVolatility { get; set; }
    }
}
