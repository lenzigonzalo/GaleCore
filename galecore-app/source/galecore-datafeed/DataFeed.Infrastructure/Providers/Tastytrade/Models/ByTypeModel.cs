using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace DataFeed.Infrastructure.Providers.Tastytrade.Models
{
    public class ByTypeModel
    {
        [JsonProperty("data")]
        public QuoteData Data { get; set; }

        [JsonProperty("pagination")]
        public object Pagination { get; set; }
    }

    public class QuoteData
    {
        [JsonProperty("items")]
        public List<QuoteItem> Items { get; set; }
    }

    public class QuoteItem
    {
        [JsonProperty("symbol")]
        public string Symbol { get; set; }

        [JsonProperty("instrument-type")]
        public string InstrumentType { get; set; }

        [JsonProperty("updated-at")]
        public DateTime UpdatedAt { get; set; }

        [JsonProperty("bid")]
        public double Bid { get; set; }

        [JsonProperty("bid-size")]
        public double BidSize { get; set; }

        [JsonProperty("ask")]
        public double Ask { get; set; }

        [JsonProperty("ask-size")]
        public double AskSize { get; set; }

        [JsonProperty("mid")]
        public double Mid { get; set; }

        [JsonProperty("mark")]
        public double Mark { get; set; }

        [JsonProperty("last")]
        public double Last { get; set; }

        [JsonProperty("last-mkt")]
        public double LastMkt { get; set; }

        [JsonProperty("beta")]
        public double Beta { get; set; }

        [JsonProperty("dividend-amount")]
        public double DividendAmount { get; set; }

        [JsonProperty("dividend-frequency")]
        public double DividendFrequency { get; set; }

        [JsonProperty("open")]
        public double Open { get; set; }

        [JsonProperty("day-high-price")]
        public double DayHighPrice { get; set; }

        [JsonProperty("day-low-price")]
        public double DayLowPrice { get; set; }

        [JsonProperty("close-price-type")]
        public string ClosePriceType { get; set; }

        [JsonProperty("prev-close")]
        public double PrevClose { get; set; }

        [JsonProperty("prev-close-price-type")]
        public string PrevClosePriceType { get; set; }

        [JsonProperty("summary-date")]
        public string SummaryDate { get; set; }

        [JsonProperty("prev-close-date")]
        public string PrevCloseDate { get; set; }

        [JsonProperty("low-limit-price")]
        public double LowLimitPrice { get; set; }

        [JsonProperty("high-limit-price")]
        public double HighLimitPrice { get; set; }

        [JsonProperty("is-trading-halted")]
        public bool IsTradingHalted { get; set; }

        [JsonProperty("halt-start-time")]
        public int HaltStartTime { get; set; }

        [JsonProperty("halt-end-time")]
        public int HaltEndTime { get; set; }

        [JsonProperty("year-low-price")]
        public double YearLowPrice { get; set; }

        [JsonProperty("year-high-price")]
        public double YearHighPrice { get; set; }

        [JsonProperty("volume")]
        public double Volume { get; set; }
    }
}