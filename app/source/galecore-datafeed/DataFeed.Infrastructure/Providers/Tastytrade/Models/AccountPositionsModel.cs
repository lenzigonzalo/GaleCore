using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace DataFeed.Infrastructure.Providers.Tastytrade.Models
{
    public class AccountPositionsModel
    {
        [JsonPropertyName("data")]
        public AccountPositionsData Data { get; set; }
    }

    public class AccountPositionsData
    {
        [JsonPropertyName("items")]
        public List<AccountPositionItem> Items { get; set; }
    }

    public class AccountPositionItem
    {
        [JsonPropertyName("account-number")]
        public string AccountNumber { get; set; }

        [JsonPropertyName("symbol")]
        public string Symbol { get; set; }

        [JsonPropertyName("instrument-type")]
        public string InstrumentType { get; set; }

        [JsonPropertyName("underlying-symbol")]
        public string UnderlyingSymbol { get; set; }

        [JsonPropertyName("quantity")]
        public decimal Quantity { get; set; }

        [JsonPropertyName("quantity-direction")]
        public string QuantityDirection { get; set; }

        [JsonPropertyName("close-price")]
        public decimal ClosePrice { get; set; }

        [JsonPropertyName("average-open-price")]
        public decimal AverageOpenPrice { get; set; }

        [JsonPropertyName("multiplier")]
        public decimal Multiplier { get; set; }

        [JsonPropertyName("cost-effect")]
        public string CostEffect { get; set; }

        [JsonPropertyName("is-suppressed")]
        public bool IsSuppressed { get; set; }

        [JsonPropertyName("is-frozen")]
        public bool IsFrozen { get; set; }

        [JsonPropertyName("restricted-quantity")]
        public decimal RestrictedQuantity { get; set; }

        [JsonPropertyName("realized-day-gain")]
        public decimal RealizedDayGain { get; set; }

        [JsonPropertyName("realized-day-gain-effect")]
        public string RealizedDayGainEffect { get; set; }

        [JsonPropertyName("realized-today")]
        public decimal RealizedToday { get; set; }

        [JsonPropertyName("realized-today-effect")]
        public string RealizedTodayEffect { get; set; }

        [JsonPropertyName("created-at")]
        public string CreatedAt { get; set; }

        [JsonPropertyName("updated-at")]
        public string UpdatedAt { get; set; }
    }
}
