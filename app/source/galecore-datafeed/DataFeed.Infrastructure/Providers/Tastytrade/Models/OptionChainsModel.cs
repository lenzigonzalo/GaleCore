using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace DataFeed.Infrastructure.Providers.Tastytrade.Models
{
    public class OptionChainsModel
    {
        public OptionChain data { get; set; }
        public string context { get; set; }
    }

    public class OptionChain
    {
        public List<Item> items { get; set; }
    }

    public class Item
    {
        [JsonPropertyName("underlying-symbol")]
        public string UnderlyingSymbol { get; set; }

        [JsonPropertyName("root-symbol")]
        public string RootSymbol { get; set; }

        [JsonPropertyName("option-chain-type")]
        public string OptionChainType { get; set; }

        [JsonPropertyName("shares-per-contract")]
        public int SharesPerContract { get; set; }

        [JsonPropertyName("tick-sizes")]
        public List<TickSize> TickSizes { get; set; }

        public List<Deliverable> deliverables { get; set; }

        public List<Expiration> expirations { get; set; }
    }

    public class TickSize
    {
        public string threshold { get; set; }
        public string value { get; set; }
    }

    public class Deliverable
    {
        public int id { get; set; }
        public string amount { get; set; }
        [JsonPropertyName("deliverable-type")]
        public string DeliverableType { get; set; }
        public string description { get; set; }
        [JsonPropertyName("instrument-type")]
        public string InstrumentType { get; set; }
        public string percent { get; set; }
        [JsonPropertyName("root-symbol")]
        public string RootSymbol { get; set; }
        public string symbol { get; set; }
    }

    public class Expiration
    {
        [JsonPropertyName("expiration-type")]
        public string ExpirationType { get; set; }

        [JsonPropertyName("expiration-date")]
        public string ExpirationDate { get; set; }

        [JsonPropertyName("days-to-expiration")]
        public int DaysToExpiration { get; set; }

        [JsonPropertyName("settlement-type")]
        public string SettlementType { get; set; }

        public List<Strike> strikes { get; set; }
    }

    public class Strike
    {
        [JsonPropertyName("strike-price")]
        public string StrikePrice { get; set; }
        public string call { get; set; }
        [JsonPropertyName("call-streamer-symbol")]
        public string CallStreamerSymbol { get; set; }
        public string put { get; set; }
        [JsonPropertyName("put-streamer-symbol")]
        public string PutStreamerSymbol { get; set; }
    }
}
