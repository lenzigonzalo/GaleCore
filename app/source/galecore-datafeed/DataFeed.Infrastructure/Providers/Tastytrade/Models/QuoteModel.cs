using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using static System.Runtime.InteropServices.JavaScript.JSType;

namespace DataFeed.Infrastructure.Providers.Tastytrade.Models
{
    public class QuoteModel
    {
        [JsonProperty("type")]
        public string Type { get; set; }

        [JsonProperty("channel")]
        public int Channel { get; set; }

        [JsonProperty("data")]
        public List<QuoteEvent> Data { get; set; }
    }

    public class QuoteEvent
    {
        [JsonProperty("eventType")]
        public string EventType { get; set; }

        [JsonProperty("eventSymbol")]
        public string EventSymbol { get; set; }

        [JsonProperty("eventTime")]
        public long EventTime { get; set; }

        [JsonProperty("sequence")]
        public long Sequence { get; set; }

        [JsonProperty("bidPrice")]
        public double BidPrice { get; set; }

        [JsonProperty("bidSize")]
        public double BidSize { get; set; }

        [JsonProperty("askPrice")]
        public double AskPrice { get; set; }

        [JsonProperty("askSize")]
        public double AskSize { get; set; }

        [JsonProperty("bidExchangeCode")]
        public string BidExchangeCode { get; set; }

        [JsonProperty("askExchangeCode")]
        public string AskExchangeCode { get; set; }

        /// <summary>
        /// Hora (epoch ms) del último cambio del bid / del ask, según DXLink; 0 = no vino. Es la hora
        /// del último CAMBIO: una cotización quieta no está vieja (BL-013).
        /// </summary>
        [JsonProperty("bidTime")]
        public long BidTime { get; set; }

        [JsonProperty("askTime")]
        public long AskTime { get; set; }

        // Campo calculado para el precio medio (Mid)
        public double MidPrice => (BidPrice + AskPrice) / 2;
    }
}