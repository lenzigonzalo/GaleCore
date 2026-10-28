using DataFeed.Application.Dtos;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using System;
using System.Collections.Generic;
using System.Text;

namespace DataFeed.Application.Data.Tastytrade.MarketDataTrade
{
    public class MarketDataTradeResponse
    {
        public string Type { get; set; }
        public int Channel { get; set; }
        public List<TradeEvent> Data { get; set; }
    }

    public class TradeEvent
    {
        public string EventType { get; set; }
        public string EventSymbol { get; set; }
        public long EventTime { get; set; }
        public long Time { get; set; }
        public int TimeNanoPart { get; set; }
        public long Sequence { get; set; }
        public string ExchangeCode { get; set; }
        public double Price { get; set; }
        public double Change { get; set; }
        public double Size { get; set; }
        public int DayId { get; set; }
        public double DayVolume { get; set; }
        public double DayTurnover { get; set; }
        public string TickDirection { get; set; }
        public bool ExtendedTradingHours { get; set; }

        public DateTime TimeStamp
        {
            get
            {
                return DateTimeOffset.FromUnixTimeMilliseconds(Time).DateTime;
            }
        }
    }
}