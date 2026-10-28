using System.Text.Json.Serialization;

namespace DataFeed.Infrastructure.Providers.Tastytrade.Models
{
    /// <summary>GET /instruments/futures: contratos listados por producto (sólo los campos que se usan).</summary>
    public class FuturesModel
    {
        public FuturesData? Data { get; set; }
    }

    public class FuturesData
    {
        public List<FutureItem> Items { get; set; } = new();
    }

    public class FutureItem
    {
        public string Symbol { get; set; } = "";
        [JsonPropertyName("product-code")] public string ProductCode { get; set; } = "";
        [JsonPropertyName("streamer-symbol")] public string? StreamerSymbol { get; set; }
        [JsonPropertyName("expiration-date")] public string? ExpirationDate { get; set; }
        [JsonPropertyName("active-month")] public bool ActiveMonth { get; set; }
        [JsonPropertyName("next-active-month")] public bool NextActiveMonth { get; set; }
        [JsonPropertyName("is-tradeable")] public bool IsTradeable { get; set; }
    }
}
