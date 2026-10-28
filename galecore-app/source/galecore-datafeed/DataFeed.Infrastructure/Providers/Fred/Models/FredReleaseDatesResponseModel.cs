using System.Text.Json.Serialization;

namespace DataFeed.Infrastructure.Providers.Fred.Models
{
    /// <summary>Respuesta de fred/releases/dates (una página).</summary>
    public class FredReleaseDatesResponseModel
    {
        [JsonPropertyName("count")]
        public int Count { get; set; }

        [JsonPropertyName("offset")]
        public int Offset { get; set; }

        [JsonPropertyName("limit")]
        public int Limit { get; set; }

        [JsonPropertyName("release_dates")]
        public List<FredReleaseDate> ReleaseDates { get; set; } = new();
    }

    public class FredReleaseDate
    {
        [JsonPropertyName("release_id")]
        public int ReleaseId { get; set; }

        [JsonPropertyName("release_name")]
        public string ReleaseName { get; set; } = "";

        [JsonPropertyName("date")]
        public string Date { get; set; } = "";
    }
}
