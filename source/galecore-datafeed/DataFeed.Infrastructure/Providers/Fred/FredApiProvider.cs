using Microsoft.Extensions.Configuration;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using DataFeed.Infrastructure.Providers;
using DataFeed.Infrastructure.Providers.Fred.Models;

namespace DataFeed.Infrastructure.Providers.Fred
{
    /// <summary>Una observación de FRED; Value null = sin dato («.» en FRED).</summary>
    public record FredObservation(string Date, decimal? Value);

    /// <summary>Serie de FRED con metadatos y el vintage leído (RealtimeStart/RealtimeEnd).</summary>
    public record FredSeriesData(string Id, string Title, string Units, string Frequency, string SeasonalAdjustment,
        string LastUpdated, string RealtimeStart, string RealtimeEnd, List<FredObservation> Observations);

    public class FredApiProvider : ApiProviderBase, IFredApiProvider
    {
        private readonly string _apiKey;

        public FredApiProvider(IConfiguration config, HttpClient client) : base(client)
        {
            _apiKey = config["FredApi:Key"];
        }

        public async Task<FredSerieResponseModel?> GetSeriesAsync(string seriesId, CancellationToken cancellationToken)
        {
            var url = $"https://api.stlouisfed.org/fred/series?series_id={seriesId}&api_key={_apiKey}&file_type=json";
            var response = await _httpClient.GetAsync(url);

            response.EnsureSuccessStatusCode();

            var contentStream = await response.Content.ReadAsStreamAsync();
            return await JsonSerializer.DeserializeAsync<FredSerieResponseModel>(contentStream, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
        }

        public async Task<FredObservationResponseModel?> GetObservationsAsync(string observationId, DateTime? fromTime, DateTime? toTime, CancellationToken cancellationToken)
        {
            // ej: fred/series/observations?series_id=DGS1&observation_start=2025-08-11&observation_end=2025-08-12

            DateTime firstDayOfMonth = new DateTime(DateTime.Now.Year, 1, 1);
            string startObs = (fromTime ?? firstDayOfMonth).ToString("yyyy-MM-dd");
            string endObs = (toTime ?? DateTime.Now).ToString("yyyy-MM-dd");

            var url = $"https://api.stlouisfed.org/fred/series/observations?series_id={observationId}&observation_start={startObs}&observation_end={endObs}&api_key={_apiKey}&file_type=json";
            var response = await _httpClient.GetAsync(url);

            response.EnsureSuccessStatusCode();

            var contentStream = await response.Content.ReadAsStreamAsync();
            return await JsonSerializer.DeserializeAsync<FredObservationResponseModel>(contentStream, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
        }

        /// <summary>
        /// Fechas programadas de publicaciones macro en [from, to] (fred/releases/dates), paginado de a 1000 filas.
        /// Devuelve la URL consultada SIN la clave, para la procedencia. Una falla de FRED sale como
        /// <see cref="UpstreamSourceException"/>, nunca como lista vacía.
        /// </summary>
        public async Task<(List<FredReleaseDate> Rows, string UpstreamUrl)> GetReleaseDatesAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
        {
            const int pageSize = 1000, maxPages = 10;
            var baseUrl = "https://api.stlouisfed.org/fred/releases/dates"
                + $"?realtime_start={from:yyyy-MM-dd}&realtime_end={to:yyyy-MM-dd}"
                + $"&include_release_dates_with_no_data=true&sort_order=asc&limit={pageSize}&file_type=json";
            if (string.IsNullOrWhiteSpace(_apiKey))
                throw new UpstreamSourceException("fred", "falta FredApi:Key en la configuración");

            var rows = new List<FredReleaseDate>();
            for (var page = 0; page < maxPages; page++)
            {
                FredReleaseDatesResponseModel? body;
                try
                {
                    var response = await _httpClient.GetAsync($"{baseUrl}&offset={page * pageSize}&api_key={_apiKey}", cancellationToken);
                    if (!response.IsSuccessStatusCode)
                        throw new UpstreamSourceException("fred", $"releases/dates respondió {(int)response.StatusCode}");
                    ThrowIfHtml(response, "releases/dates");
                    body = await JsonSerializer.DeserializeAsync<FredReleaseDatesResponseModel>(
                        await response.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
                }
                catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !cancellationToken.IsCancellationRequested))
                {
                    throw new UpstreamSourceException("fred", $"sin respuesta ({ex.Message})");
                }
                catch (JsonException)
                {
                    throw new UpstreamSourceException("fred", "releases/dates cambió de forma (JSON no reconocido)");
                }
                if (body == null)
                    throw new UpstreamSourceException("fred", "releases/dates respondió vacío");
                rows.AddRange(body.ReleaseDates);
                if (rows.Count >= body.Count || body.ReleaseDates.Count < pageSize)
                    return (rows, baseUrl);
            }
            throw new UpstreamSourceException("fred", $"el rango pide más de {maxPages * pageSize} filas: acortalo");
        }

        /// <summary>
        /// Fechas de UNA publicación en [from, to] (fred/release/dates) con su nombre (fred/release). Para pocas
        /// publicaciones es mucho más liviano que <see cref="GetReleaseDatesAsync"/>, que trae todas (las diarias suman
        /// cientos por semana) y FRED corta con 504 en rangos de meses. Devuelve la URL de las fechas SIN la clave.
        /// </summary>
        public async Task<(List<FredReleaseDate> Rows, string UpstreamUrl)> GetReleaseDatesAsync(int releaseId, DateOnly from, DateOnly to, CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(_apiKey))
                throw new UpstreamSourceException("fred", "falta FredApi:Key en la configuración");
            var datesUrl = $"https://api.stlouisfed.org/fred/release/dates?release_id={releaseId}"
                + $"&realtime_start={from:yyyy-MM-dd}&realtime_end={to:yyyy-MM-dd}"
                + "&include_release_dates_with_no_data=true&sort_order=asc&limit=10000&file_type=json";
            using var meta = await GetJsonAsync($"https://api.stlouisfed.org/fred/release?release_id={releaseId}&file_type=json", "release", cancellationToken);
            using var dates = await GetJsonAsync(datesUrl, "release/dates", cancellationToken);
            try
            {
                var name = meta.RootElement.GetProperty("releases")[0].GetProperty("name").GetString() ?? "";
                var rows = dates.RootElement.GetProperty("release_dates").EnumerateArray()
                    .Select(d => new FredReleaseDate { ReleaseId = releaseId, ReleaseName = name, Date = d.GetProperty("date").GetString() ?? "" })
                    .ToList();
                return (rows, datesUrl);
            }
            catch (Exception ex) when (ex is KeyNotFoundException || ex is InvalidOperationException || ex is IndexOutOfRangeException)
            {
                throw new UpstreamSourceException("fred", "release/dates cambió de forma (JSON no reconocido)");
            }
        }

        /// <summary>
        /// Metadatos de una serie (fred/series) y sus observaciones en [from, to] (fred/series/observations), con el vintage
        /// leído (realtime_start/realtime_end) y las URLs consultadas SIN la clave. «.» de FRED (sin dato) sale como null.
        /// Una falla, una serie que no existe o un JSON que cambió de forma es <see cref="UpstreamSourceException"/>.
        /// </summary>
        public async Task<(FredSeriesData Series, string UpstreamUrl, string Sha256)> GetSeriesObservationsAsync(
            string seriesId, DateOnly from, DateOnly to, CancellationToken cancellationToken)
        {
            const int maxRows = 10000;
            if (string.IsNullOrWhiteSpace(_apiKey))
                throw new UpstreamSourceException("fred", "falta FredApi:Key en la configuración");
            var seriesUrl = $"https://api.stlouisfed.org/fred/series?series_id={seriesId}&file_type=json";
            var obsUrl = $"https://api.stlouisfed.org/fred/series/observations?series_id={seriesId}"
                + $"&observation_start={from:yyyy-MM-dd}&observation_end={to:yyyy-MM-dd}&limit={maxRows}&file_type=json";

            var meta = await GetJsonAsync(seriesUrl, "series", cancellationToken);
            var obs = await GetJsonAsync(obsUrl, "series/observations", cancellationToken);
            try
            {
                var s = meta.RootElement.GetProperty("seriess")[0];
                string Text(JsonElement e, string name) => e.GetProperty(name).GetString() ?? "";
                var root = obs.RootElement;
                if (root.GetProperty("count").GetInt32() > maxRows)
                    throw new UpstreamSourceException("fred", $"el rango pide más de {maxRows} observaciones: acortalo");
                var observations = root.GetProperty("observations").EnumerateArray().Select(o =>
                {
                    var value = Text(o, "value");
                    return new FredObservation(Text(o, "date"),
                        value == "." ? null : decimal.Parse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture));
                }).ToList();
                var data = new FredSeriesData(Text(s, "id"), Text(s, "title"), Text(s, "units"), Text(s, "frequency"),
                    Text(s, "seasonal_adjustment"), Text(s, "last_updated"), Text(root, "realtime_start"), Text(root, "realtime_end"), observations);
                var sha = "sha256:" + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
                    System.Text.Encoding.UTF8.GetBytes(meta.RootElement.GetRawText() + obs.RootElement.GetRawText()))).ToLowerInvariant();
                return (data, obsUrl, sha);
            }
            catch (Exception ex) when (ex is KeyNotFoundException or InvalidOperationException or IndexOutOfRangeException or FormatException)
            {
                throw new UpstreamSourceException("fred", $"la serie {seriesId} cambió de forma ({ex.GetType().Name})");
            }
            finally
            {
                meta.Dispose();
                obs.Dispose();
            }
        }

        /// <summary>FRED en mantenimiento responde 200 con una página HTML: se dice así, no como «cambió de forma».</summary>
        private static void ThrowIfHtml(HttpResponseMessage response, string what)
        {
            if (response.Content.Headers.ContentType?.MediaType?.Contains("html", StringComparison.OrdinalIgnoreCase) == true)
                throw new UpstreamSourceException("fred", $"{what} respondió una página HTML (FRED en mantenimiento o sin servicio): reintentar más tarde");
        }

        private async Task<JsonDocument> GetJsonAsync(string url, string what, CancellationToken cancellationToken)
        {
            try
            {
                var response = await _httpClient.GetAsync($"{url}&api_key={_apiKey}", cancellationToken);
                if (!response.IsSuccessStatusCode)
                    // FRED responde 400 cuando la serie no existe: el motivo viene en error_message, sin la clave.
                    throw new UpstreamSourceException("fred", $"{what} respondió {(int)response.StatusCode}"
                        + (await ErrorMessage(response, cancellationToken) is { } m ? $": {m}" : ""));
                ThrowIfHtml(response, what);
                return await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
            }
            catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !cancellationToken.IsCancellationRequested))
            {
                throw new UpstreamSourceException("fred", $"sin respuesta ({ex.Message})");
            }
            catch (JsonException)
            {
                throw new UpstreamSourceException("fred", $"{what} cambió de forma (JSON no reconocido)");
            }
        }

        private static async Task<string?> ErrorMessage(HttpResponseMessage response, CancellationToken cancellationToken)
        {
            try
            {
                using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
                return doc.RootElement.TryGetProperty("error_message", out var m) ? m.GetString() : null;
            }
            catch (JsonException)
            {
                return null;
            }
        }
    }
}
