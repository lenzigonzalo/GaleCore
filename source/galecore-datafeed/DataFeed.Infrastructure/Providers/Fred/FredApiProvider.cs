using Microsoft.Extensions.Configuration;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using DataFeed.Infrastructure.Providers;
using DataFeed.Infrastructure.Providers.Fred.Models;

namespace DataFeed.Infrastructure.Providers.Fred
{
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
                    body = await JsonSerializer.DeserializeAsync<FredReleaseDatesResponseModel>(
                        await response.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
                }
                catch (HttpRequestException ex)
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
    }
}
