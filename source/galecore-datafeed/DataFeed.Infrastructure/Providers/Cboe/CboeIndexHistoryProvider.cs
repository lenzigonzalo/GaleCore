using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;

namespace DataFeed.Infrastructure.Providers.Cboe
{
    /// <summary>Un día de un índice de CBOE. VVIX y SKEW publican sólo el cierre: Open, High y Low vienen vacíos.</summary>
    public record CboeIndexDay(DateOnly Date, decimal? Open, decimal? High, decimal? Low, decimal Close);

    /// <summary>Historia completa de un índice, tal como se leyó, con su sha256 y cuándo se bajó.</summary>
    public record CboeIndexHistory(string Index, string Url, string Sha256, DateTime RetrievedAt, IReadOnlyList<CboeIndexDay> Days);

    /// <summary>
    /// Historia diaria de índices de CBOE (VIX desde 1990, VVIX desde 2006, SKEW desde 1990) desde los CSV públicos, sin
    /// clave (WS-0014, HANDOFF-GALECORE-FUENTES B4). Cada CSV es el archivo completo (~470 KB el de VIX): se baja una vez y
    /// se guarda en memoria unas horas. Si el archivo cambia de forma, error explícito; nunca una lista vacía.
    /// </summary>
    public class CboeIndexHistoryProvider
    {
        public static readonly IReadOnlyList<string> Indices = new[] { "VIX", "VVIX", "SKEW" };
        public static readonly TimeSpan CacheFor = TimeSpan.FromHours(6);

        private static readonly ConcurrentDictionary<string, CboeIndexHistory> Cache = new();

        private readonly HttpClient _httpClient;

        public CboeIndexHistoryProvider(HttpClient httpClient)
        {
            _httpClient = httpClient;
        }

        // cdn.cboe.com responde 307 a cdn-api.cboe.com; HttpClient sigue la redirección (verificado el 06/10).
        public static string Url(string index) => $"https://cdn.cboe.com/api/global/us_indices/daily_prices/{index}_History.csv";

        /// <summary>La historia del índice y si salió de la caché.</summary>
        public async Task<(CboeIndexHistory History, bool FromCache)> GetHistoryAsync(string index, CancellationToken cancellationToken)
        {
            if (Cache.TryGetValue(index, out var cached) && DateTime.UtcNow - cached.RetrievedAt < CacheFor)
                return (cached, true);

            string csv;
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, Url(index));
                request.Headers.UserAgent.ParseAdd("GaleCore-DataFeed/1.0 (cboe index history, read-only)");
                var response = await _httpClient.SendAsync(request, cancellationToken);
                if (!response.IsSuccessStatusCode)
                    throw new UpstreamSourceException("cboe", $"{index}_History.csv respondió {(int)response.StatusCode}");
                csv = await response.Content.ReadAsStringAsync(cancellationToken);
            }
            catch (HttpRequestException ex)
            {
                throw new UpstreamSourceException("cboe", $"sin respuesta ({ex.Message})");
            }
            var sha = "sha256:" + Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(csv))).ToLowerInvariant();
            var history = new CboeIndexHistory(index, Url(index), sha, DateTime.UtcNow, Parse(index, csv));
            Cache[index] = history;
            return (history, false);
        }

        /// <summary>
        /// Lee el CSV: «DATE,OPEN,HIGH,LOW,CLOSE» (VIX) o «DATE,&lt;INDICE&gt;» (VVIX, SKEW), fechas MM/dd/yyyy. Una cabecera
        /// distinta, una fila que no se entiende o un archivo sin filas es error, no se saltea.
        /// </summary>
        public static List<CboeIndexDay> Parse(string index, string csv)
        {
            var lines = csv.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (lines.Length < 2)
                throw new UpstreamSourceException("cboe", $"{index}_History.csv llegó sin filas");
            var header = lines[0].ToUpperInvariant();
            var ohlc = header == "DATE,OPEN,HIGH,LOW,CLOSE";
            if (!ohlc && header != $"DATE,{index}")
                throw new UpstreamSourceException("cboe", $"{index}_History.csv cambió de forma (cabecera '{lines[0]}')");

            var days = new List<CboeIndexDay>(lines.Length - 1);
            foreach (var line in lines.Skip(1))
            {
                var cells = line.Split(',');
                if (cells.Length != (ohlc ? 5 : 2)
                    || !DateOnly.TryParseExact(cells[0], "MM/dd/yyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
                    throw new UpstreamSourceException("cboe", $"{index}_History.csv: fila no reconocida '{line}'");
                var values = new decimal[cells.Length - 1];
                for (var i = 1; i < cells.Length; i++)
                    if (!decimal.TryParse(cells[i], NumberStyles.Float, CultureInfo.InvariantCulture, out values[i - 1]))
                        throw new UpstreamSourceException("cboe", $"{index}_History.csv: valor no reconocido en '{line}'");
                days.Add(ohlc
                    ? new CboeIndexDay(date, values[0], values[1], values[2], values[3])
                    : new CboeIndexDay(date, null, null, null, values[0]));
            }
            return days;
        }

        /// <summary>Sólo para tests: vacía la caché entre casos.</summary>
        public static void ClearCache() => Cache.Clear();
    }
}
