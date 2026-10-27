using System.Collections.Generic;

namespace DataFeed.Application.Data.Tastytrade.AccountPositions
{
    public class AccountPositionsResponse
    {
        public List<AccountPositionDto> Positions { get; set; }
    }

    public class AccountPositionDto
    {
        public string AccountNumber { get; set; }
        public string Symbol { get; set; }
        public string InstrumentType { get; set; }
        public string UnderlyingSymbol { get; set; }
        public decimal Quantity { get; set; }
        public string QuantityDirection { get; set; }
        public decimal ClosePrice { get; set; }
        public decimal AverageOpenPrice { get; set; }
        public decimal Multiplier { get; set; }
        public string CostEffect { get; set; }
        public bool IsSuppressed { get; set; }
        public bool IsFrozen { get; set; }
        public decimal RestrictedQuantity { get; set; }
        public decimal RealizedDayGain { get; set; }
        public string RealizedDayGainEffect { get; set; }
        public decimal RealizedToday { get; set; }
        public string RealizedTodayEffect { get; set; }
        public string CreatedAt { get; set; }
        public string UpdatedAt { get; set; }
    }
}
