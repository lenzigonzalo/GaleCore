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
