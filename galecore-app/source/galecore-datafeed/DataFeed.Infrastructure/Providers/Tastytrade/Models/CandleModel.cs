using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace DataFeed.Infrastructure.Providers.Tastytrade.Models
{
    public class CandleModel
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
        public string Open { get; set; }
        public string High { get; set; }
        public string Low { get; set; }
        public string Close { get; set; }
        public string Volume { get; set; }
        public string Vwap { get; set; }
        public string BidVolume { get; set; }
        public string AskVolume { get; set; }
        public string ImpVolatility { get; set; }
        public string OpenInterest { get; set; }

        public DateTime TimeStamp
        {
            get
            {
                return DateTimeOffset.FromUnixTimeMilliseconds(Time).DateTime;
            }
        }
    }
}