using DataFeed.Application.Dtos;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using System;
using System.Collections.Generic;
using System.Text;

namespace DataFeed.Application.Data.Tastytrade.MarketDataCandle
{
    public class MarketDataCandleResponse
    {
        public string type { get; set; }
        public int channel { get; set; }
        public List<CandleData> data { get; set; }
    }

    public class CandleData
    {
        public string EventType { get; set; }
        public string EventSymbol { get; set; }
        public long EventTime { get; set; }
        public int EventFlags { get; set; }
        public long Index { get; set; }
        public long Time { get; set; }
        public int Sequence { get; set; }
        public int Count { get; set; }
        public double Open { get; set; }
        public double High { get; set; }
        public double Low { get; set; }
        public double Close { get; set; }
        public long Volume { get; set; }
        public double Vwap { get; set; }
        public long BidVolume { get; set; }
        public long AskVolume { get; set; }
        public double ImpVolatility { get; set; }
        public long OpenInterest { get; set; }

        public DateTime TimeStamp
        {
            get
            {
                return DateTimeOffset.FromUnixTimeMilliseconds(Time).DateTime;
            }
        }

        public double? Delta { get; set; }
        public double? Gamma { get; set; }
        public double? Theta { get; set; }
    }
}