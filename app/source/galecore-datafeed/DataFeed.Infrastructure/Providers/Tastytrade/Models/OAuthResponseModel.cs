using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace DataFeed.Infrastructure.Providers.Tastytrade.Models
{
    public class OAuthResponseAPIModel
    {
        [JsonPropertyName("access_token")]
        public string AccessToken { get; set; }

        [JsonPropertyName("token_type")]
        public string TokenType { get; set; }

        [JsonPropertyName("expires_in")]
        public int ExpiresIn { get; set; }

        [JsonPropertyName("id_token")]
        public string SessionToken { get; set; }

        //EML
        public DateTime ExpiresAt { get; set; }
    }

    public class OAuthResponseWSModel
    {
        [JsonPropertyName("data")]
        public AuthData Data { get; set; }

        public class AuthData
        {
            [JsonPropertyName("dxlink-url")]
            public string DxlinkUrl { get; set; }

            [JsonPropertyName("expires-at")]
            public DateTime ExpiresAt { get; set; }

            [JsonPropertyName("issued-at")]
            public DateTime IssuedAt { get; set; }

            [JsonPropertyName("level")]
            public string Api { get; set; }

            [JsonPropertyName("token")]
            public string Token { get; set; }
        }
    }
}
