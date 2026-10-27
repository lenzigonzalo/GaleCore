using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace DataFeed.Infrastructure.Providers.Tastytrade.Models
{
    public class OAuthRequestLoginAPIModel
    {
        [JsonPropertyName("grant_type")]
        public string GrantType { get; set; }

        [JsonPropertyName("refresh_token")]
        public string RefreshToken { get; set; }

        [JsonPropertyName("client_secret")]
        public string ClientSecret { get; set; }
    }
}
