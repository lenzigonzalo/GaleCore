using System;
using System.Collections.Generic;

namespace DataFeed.Application.Data.Tastytrade.MarketDataTradeQuoteGreeks
{
    public class MarketDataTradeQuoteGreeksResponse
    {
        public string Symbol { get; set; }
        public TradeData Trade { get; set; }
        public QuoteData Quote { get; set; }
        public GreeksData Greeks { get; set; }
    }

    public class TradeData
    {
        public string EventSymbol { get; set; }
        public long Time { get; set; }
        public double Price { get; set; }
        public double Change { get; set; }
        public double Size { get; set; }
        public double DayVolume { get; set; }
        public double DayTurnover { get; set; }
        public string TickDirection { get; set; }
        public bool ExtendedTradingHours { get; set; }

        public DateTime TimeStamp => DateTimeOffset.FromUnixTimeMilliseconds(Time).DateTime;
    }

    public class QuoteData
    {
        public string EventSymbol { get; set; }
        public double BidPrice { get; set; }
        public double BidSize { get; set; }
        public double AskPrice { get; set; }
        public double AskSize { get; set; }
        public double MidPrice => (BidPrice + AskPrice) / 2;
    }

    public class GreeksData
    {
        public string EventSymbol { get; set; }
        public long Time { get; set; }
        public double Price { get; set; }
        public double Volatility { get; set; }
        public double Delta { get; set; }
        public double Gamma { get; set; }
        public double Theta { get; set; }
        public double Rho { get; set; }
        public double Vega { get; set; }

        public DateTime TimeStamp => DateTimeOffset.FromUnixTimeMilliseconds(Time).DateTime;
    }
}
