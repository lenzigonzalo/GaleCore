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

        /// <summary>
        /// Server-Sent Events que no terminan (A3 web): abre con ResponseHeadersRead, lee líneas hasta el <c>event: {event}</c> y su
        /// <c>data:</c>, corta la conexión y devuelve el JSON de ese data. Sin snapshot en <paramref name="timeout"/> (10 s por defecto)
        /// o si el stream cierra antes, es UpstreamSourceException. Misma caché/sha256 que GetAsync.
        /// </summary>
        public async Task<ArgentinaFetch> GetSseSnapshotAsync(string source, string url, TimeSpan cacheFor, CancellationToken cancellationToken,
            string @event = "snapshot", TimeSpan? timeout = null)
        {
            var cacheKey = $"{source}|SSE:{@event}|{url}";
            if (Cache.TryGetValue(cacheKey, out var cached) && DateTime.UtcNow - cached.RetrievedAt < cacheFor)
                return new ArgentinaFetch(Parse(source, cached.Body), cached.Sha256, cached.RetrievedAt, true);

            var limit = timeout ?? TimeSpan.FromSeconds(10);
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(limit);
            string? data = null;
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, url);
                request.Headers.Accept.ParseAdd("text/event-stream");
                using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeoutCts.Token);
                if (!response.IsSuccessStatusCode)
                    throw new UpstreamSourceException(source, $"respondió {(int)response.StatusCode}");
                using var stream = await response.Content.ReadAsStreamAsync(timeoutCts.Token);
                using var reader = new StreamReader(stream, Encoding.UTF8);
                var inEvent = false;
                string? line;
                while ((line = await reader.ReadLineAsync(timeoutCts.Token)) is not null)
                {
                    if (line.StartsWith("event:", StringComparison.Ordinal))
                        inEvent = line[6..].Trim() == @event;
                    else if (inEvent && line.StartsWith("data:", StringComparison.Ordinal))
                    {
                        data = line[5..].Trim();
                        break;
                    }
                }
            }
            catch (HttpRequestException ex)
            {
                throw new UpstreamSourceException(source, $"sin respuesta ({ex.Message})");
            }
            catch (IOException ex)
            {
                throw new UpstreamSourceException(source, $"sin respuesta ({ex.Message})");
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                throw new UpstreamSourceException(source, $"sin {@event} del stream en {limit.TotalSeconds:0} s");
            }
            if (string.IsNullOrWhiteSpace(data))
                throw new UpstreamSourceException(source, $"el stream cerró sin {@event}");
            var json = Parse(source, data);
            var sha = "sha256:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(data))).ToLowerInvariant();
            var now = DateTime.UtcNow;
            Cache[cacheKey] = (now, sha, data);
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
