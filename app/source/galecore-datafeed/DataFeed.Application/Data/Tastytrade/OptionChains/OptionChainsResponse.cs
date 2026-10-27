using DataFeed.Application.Dtos;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Json.Serialization;

namespace DataFeed.Application.Data.Tastytrade.OptionChains
{
    public class OptionChainsResponse
    {
        public string Symbol { get; set; } = string.Empty;
        public List<Expiration> expirations { get; set; }
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