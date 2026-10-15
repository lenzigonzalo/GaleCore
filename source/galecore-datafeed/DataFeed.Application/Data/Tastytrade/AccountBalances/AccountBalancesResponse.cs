namespace DataFeed.Application.Data.Tastytrade.AccountBalances
{
    public class AccountBalancesResponse
    {
        public string AccountNumber { get; set; }
        public decimal CashBalance { get; set; }
        public decimal LongEquityValue { get; set; }
        public decimal ShortEquityValue { get; set; }
        public decimal LongDerivativeValue { get; set; }
        public decimal ShortDerivativeValue { get; set; }
        public decimal MarginEquity { get; set; }
        public decimal EquityBuyingPower { get; set; }
        public decimal DerivativeBuyingPower { get; set; }
        public decimal DayTradingBuyingPower { get; set; }
        public decimal NetLiquidatingValue { get; set; }
        public decimal CashAvailableToWithdraw { get; set; }
        public decimal MaintenanceRequirement { get; set; }
        public decimal MaintenanceExcess { get; set; }
        public decimal AvailableTradingFunds { get; set; }
        public decimal PendingCash { get; set; }
        public string SnapshotDate { get; set; }
        public string UpdatedAt { get; set; }
        /// <summary>Valor de la cuenta al cierre de cada día del último año (sólo con WithHistory); null si no se pudo leer.</summary>
        public List<NetLiqPoint>? NetLiqHistory { get; set; }
    }

    public record NetLiqPoint(DateTime Time, decimal Close);
}
