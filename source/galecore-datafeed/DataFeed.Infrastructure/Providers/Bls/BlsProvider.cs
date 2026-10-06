using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;

namespace DataFeed.Infrastructure.Providers.Bls
{
    /// <summary>Una observación del BLS. Period: M01..M12 (mensual), Q01..Q04, A01 (anual); Value null = sin dato («-»).</summary>
    public record BlsObservation(int Year, string Period, string PeriodName, decimal? Value, bool Latest, IReadOnlyList<string> Footnotes);

    public record BlsSeries(string SeriesId, IReadOnlyList<BlsObservation> Observations);

    /// <summary>
    /// Valores oficiales del BLS (CPI, empleo…) por la API v2 (WS-0014, HANDOFF-GALECORE-FUENTES B3). Funciona sin clave con
    /// topes bajos (pocas consultas por día, 25 series y 10 años por pedido); con <c>Bls:Key</c> (gratis) se amplían. Las fechas
    /// de publicación no salen de acá (el calendario del BLS bloquea a los programas): salen de FRED. Cada respuesta se guarda
    /// unas horas para no gastar el cupo diario.
    /// </summary>
    public class BlsProvider
    {
        public const string Url = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
        public const int MaxSeries = 25;
        public static readonly TimeSpan CacheFor = TimeSpan.FromHours(6);

        private static readonly ConcurrentDictionary<string, (DateTime RetrievedAt, string Sha256, List<BlsSeries> Series)> Cache = new();

        private readonly HttpClient _httpClient;
        private readonly string? _key;

        public BlsProvider(IConfiguration config, HttpClient httpClient)
        {
            _httpClient = httpClient;
            _key = config["Bls:Key"];
        }

        public bool HasKey => !string.IsNullOrWhiteSpace(_key);

        public async Task<(List<BlsSeries> Series, string Sha256, DateTime RetrievedAt, bool FromCache)> GetSeriesAsync(
            IReadOnlyList<string> ids, int startYear, int endYear, CancellationToken cancellationToken)
        {
            var cacheKey = $"{string.Join(",", ids)}|{startYear}|{endYear}";
            if (Cache.TryGetValue(cacheKey, out var cached) && DateTime.UtcNow - cached.RetrievedAt < CacheFor)
                return (cached.Series, cached.Sha256, cached.RetrievedAt, true);

            var body = new Dictionary<string, object> { ["seriesid"] = ids, ["startyear"] = $"{startYear}", ["endyear"] = $"{endYear}" };
            if (HasKey)
                body["registrationkey"] = _key!;
            string json;
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, Url)
                {
                    Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
                };
                var response = await _httpClient.SendAsync(request, cancellationToken);
                if (!response.IsSuccessStatusCode)
                    throw new UpstreamSourceException("bls", $"timeseries respondió {(int)response.StatusCode}");
                json = await response.Content.ReadAsStringAsync(cancellationToken);
            }
            catch (HttpRequestException ex)
            {
                throw new UpstreamSourceException("bls", $"sin respuesta ({ex.Message})");
            }
            var series = Parse(json, ids);
            var entry = (DateTime.UtcNow, "sha256:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))).ToLowerInvariant(), series);
            Cache[cacheKey] = entry;
            return (series, entry.Item2, entry.Item1, false);
        }

        /// <summary>
        /// Lee la respuesta. El BLS contesta 200 aunque rechace el pedido (cupo diario, serie inexistente): status distinto de
        /// REQUEST_SUCCEEDED, o una serie pedida que no vuelve o vuelve sin datos, es error con el mensaje del BLS.
        /// </summary>
        public static List<BlsSeries> Parse(string json, IReadOnlyList<string> ids)
        {
            try
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                var messages = root.TryGetProperty("message", out var m) ? m.EnumerateArray().Select(x => x.GetString() ?? "").ToList() : new List<string>();
                if (root.GetProperty("status").GetString() != "REQUEST_SUCCEEDED")
                    throw new UpstreamSourceException("bls", $"rechazó el pedido: {string.Join(" | ", messages)}");
                var result = root.GetProperty("Results").GetProperty("series").EnumerateArray().Select(s => new BlsSeries(
                    s.GetProperty("seriesID").GetString()!,
                    s.GetProperty("data").EnumerateArray().Select(o =>
                    {
                        var value = o.GetProperty("value").GetString()!;
                        return new BlsObservation(int.Parse(o.GetProperty("year").GetString()!, CultureInfo.InvariantCulture),
                            o.GetProperty("period").GetString()!, o.GetProperty("periodName").GetString() ?? "",
                            decimal.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : null,
                            o.TryGetProperty("latest", out var l) && l.GetString() == "true",
                            o.GetProperty("footnotes").EnumerateArray()
                                .Select(f => f.TryGetProperty("text", out var t) ? t.GetString() : null)
                                .Where(t => !string.IsNullOrEmpty(t)).Select(t => t!).ToList());
                    }).OrderBy(o => o.Year).ThenBy(o => o.Period).ToList())).ToList();
                var missing = ids.Where(id => !result.Any(s => s.SeriesId == id && s.Observations.Count > 0)).ToList();
                if (missing.Count > 0)
                    throw new UpstreamSourceException("bls", $"sin datos para {string.Join(", ", missing)}"
                        + (messages.Count > 0 ? $" ({string.Join(" | ", messages)})" : ""));
                return result;
            }
            catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException or FormatException)
            {
                throw new UpstreamSourceException("bls", $"la respuesta cambió de forma ({ex.Message})");
            }
        }

        /// <summary>Sólo para tests: vacía la caché entre casos.</summary>
        public static void ClearCache() => Cache.Clear();
    }
}
