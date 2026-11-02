using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace DataFeed.Infrastructure.Providers.Argentina
{
    public record ArgentinaFetch(JToken Json, string Sha256, DateTime RetrievedAt, bool FromCache);

    /// <summary>
    /// Lector común de las fuentes argentinas (WS-0077, BL-036): DolarAPI, ArgentinaDatos, BCRA, INDEC (datos.gob.ar), BYMA y A3/MAE.
    /// Mismo molde que BLS: HttpClient, caché en memoria con TTL por pedido, sha256 del cuerpo y UpstreamSourceException ante
    /// cualquier falla (nunca datos inventados). La clave (sólo A3) viaja en el header y nunca entra en la caché, el error ni la URL.
    /// </summary>
    public class ArgentinaFetcher
    {
        private static readonly ConcurrentDictionary<string, (DateTime RetrievedAt, string Sha256, string Body)> Cache = new();

        private readonly HttpClient _httpClient;

        public ArgentinaFetcher(HttpClient httpClient) => _httpClient = httpClient;

        public async Task<ArgentinaFetch> GetAsync(string source, string url, TimeSpan cacheFor, CancellationToken cancellationToken,
            string? postBody = null, string? apiKey = null)
        {
            var cacheKey = $"{source}|{(postBody is null ? "GET" : "POST")}|{url}|{postBody}";
            if (Cache.TryGetValue(cacheKey, out var cached) && DateTime.UtcNow - cached.RetrievedAt < cacheFor)
                return new ArgentinaFetch(Parse(source, cached.Body), cached.Sha256, cached.RetrievedAt, true);

            string body;
            try
            {
                using var request = new HttpRequestMessage(postBody is null ? HttpMethod.Get : HttpMethod.Post, url);
                if (postBody is not null)
                    request.Content = new StringContent(postBody, Encoding.UTF8, "application/json");
                if (apiKey is not null)
                    request.Headers.Add("x-api-key", apiKey);
                var response = await _httpClient.SendAsync(request, cancellationToken);
                if (!response.IsSuccessStatusCode)
                    throw new UpstreamSourceException(source, $"respondió {(int)response.StatusCode}");
                body = await response.Content.ReadAsStringAsync(cancellationToken);
            }
            catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !cancellationToken.IsCancellationRequested))
            {
                throw new UpstreamSourceException(source, $"sin respuesta ({ex.Message})");
            }
            var json = Parse(source, body);
            var sha = "sha256:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(body))).ToLowerInvariant();
            var now = DateTime.UtcNow;
            Cache[cacheKey] = (now, sha, body);
            return new ArgentinaFetch(json, sha, now, false);
        }

        /// <summary>JSON sin convertir fechas (las fuentes mandan «2026-10-30» como texto y así se devuelven).</summary>
        public static JToken Parse(string source, string body)
        {
            try
            {
                using var reader = new JsonTextReader(new StringReader(body)) { DateParseHandling = DateParseHandling.None };
                return JToken.Load(reader);
            }
            catch (JsonException ex)
            {
                throw new UpstreamSourceException(source, $"la respuesta cambió de forma ({ex.Message})");
            }
        }

        /// <summary>Sólo para tests: vacía la caché entre casos.</summary>
        public static void ClearCache() => Cache.Clear();
    }
}
