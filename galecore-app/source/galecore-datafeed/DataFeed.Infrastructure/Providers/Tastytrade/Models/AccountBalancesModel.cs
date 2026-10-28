using System.Text.Json.Serialization;

namespace DataFeed.Infrastructure.Providers.Tastytrade.Models
{
    public class AccountBalancesModel
    {
        [JsonPropertyName("data")]
        public AccountBalancesData Data { get; set; }
    }

    public class AccountBalancesData
    {
        [JsonPropertyName("account-number")]
        public string AccountNumber { get; set; }

        [JsonPropertyName("cash-balance")]
        public decimal CashBalance { get; set; }

        [JsonPropertyName("long-equity-value")]
        public decimal LongEquityValue { get; set; }

        [JsonPropertyName("short-equity-value")]
        public decimal ShortEquityValue { get; set; }

        [JsonPropertyName("long-derivative-value")]
        public decimal LongDerivativeValue { get; set; }

        [JsonPropertyName("short-derivative-value")]
        public decimal ShortDerivativeValue { get; set; }

        [JsonPropertyName("margin-equity")]
        public decimal MarginEquity { get; set; }

        [JsonPropertyName("equity-buying-power")]
        public decimal EquityBuyingPower { get; set; }

        [JsonPropertyName("derivative-buying-power")]
        public decimal DerivativeBuyingPower { get; set; }

        [JsonPropertyName("day-trading-buying-power")]
        public decimal DayTradingBuyingPower { get; set; }

        [JsonPropertyName("net-liquidating-value")]
        public decimal NetLiquidatingValue { get; set; }

        [JsonPropertyName("cash-available-to-withdraw")]
        public decimal CashAvailableToWithdraw { get; set; }

        [JsonPropertyName("maintenance-requirement")]
        public decimal MaintenanceRequirement { get; set; }

        [JsonPropertyName("maintenance-excess")]
        public decimal MaintenanceExcess { get; set; }

        [JsonPropertyName("available-trading-funds")]
        public decimal AvailableTradingFunds { get; set; }

        [JsonPropertyName("pending-cash")]
        public decimal PendingCash { get; set; }

        [JsonPropertyName("snapshot-date")]
        public string SnapshotDate { get; set; }

        [JsonPropertyName("updated-at")]
        public string UpdatedAt { get; set; }
    }
}
