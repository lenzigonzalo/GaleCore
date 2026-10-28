using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace DataFeed.Infrastructure.Providers.Tastytrade.Models
{
    public class GreeksModel
    {
        [JsonProperty("type")]
        public string Type { get; set; }

        [JsonProperty("channel")]
        public int Channel { get; set; }

        [JsonProperty("data")]
        public List<GreeksEvent> Data { get; set; }
    }

    public class GreeksEvent
    {
        [JsonProperty("eventType")]
        public string EventType { get; set; }

        [JsonProperty("eventSymbol")]
        public string EventSymbol { get; set; }

        [JsonProperty("eventTime")]
        public long EventTime { get; set; }

        [JsonProperty("time")]
        public long Time { get; set; }

        [JsonProperty("index")]
        public long Index { get; set; }

        [JsonProperty("price")]
        public double Price { get; set; } // Precio teórico de la opción

        [JsonProperty("volatility")]
        public double Volatility { get; set; } // IV (Volatilidad Implícita)

        [JsonProperty("delta")]
        public double Delta { get; set; }

        [JsonProperty("gamma")]
        public double Gamma { get; set; }

        [JsonProperty("theta")]
        public double Theta { get; set; }

        [JsonProperty("rho")]
        public double Rho { get; set; }

        [JsonProperty("vega")]
        public double Vega { get; set; }

        public DateTime TimeStamp
        {
            get
            {
                return DateTimeOffset.FromUnixTimeMilliseconds(Time).DateTime;
            }
        }
    }
}