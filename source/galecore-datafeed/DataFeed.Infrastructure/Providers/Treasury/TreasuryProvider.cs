using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace DataFeed.Infrastructure.Providers.Treasury
{
    /// <summary>Un día de la curva par del Tesoro: tasa en % por plazo («1M», «1.5M», «1Y», «30Y»…); un plazo que ese año no se publicaba no figura.</summary>
    public record TreasuryCurveDay(DateOnly Date, IReadOnlyDictionary<string, decimal> Rates);

    /// <summary>Una subasta anunciada del Tesoro. OfferingAmount en USD; vacío si todavía no se anunció el monto.</summary>
    public record TreasuryAuction(string SecurityType, string SecurityTerm, DateOnly AuctionDate, DateOnly IssueDate,
        DateOnly? AnnouncementDate, decimal? OfferingAmount, string Cusip, bool Reopening, DateOnly RecordDate);

    /// <summary>
    /// Tesoro de EE. UU., sin clave (WS-0014, HANDOFF-GALECORE-FUENTES B2): la curva par diaria oficial (un CSV por año en
    /// home.treasury.gov) y las subastas próximas (Fiscal Data). Si una respuesta cambia de forma, error explícito.
    /// </summary>
    public class TreasuryProvider
    {
        public const string UpcomingAuctionsUrl =
            "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/upcoming_auctions?sort=-record_date&page%5Bsize%5D=100";
        public static readonly TimeSpan CacheFor = TimeSpan.FromHours(6);

        private static readonly ConcurrentDictionary<int, (DateTime RetrievedAt, string Sha256, List<TreasuryCurveDay> Days)> CurveCache = new();
        private static readonly Regex Tenor = new(@"^(\d+(?:\.\d+)?) (Mo|Month|Yr)$");

        private readonly HttpClient _httpClient;

        public TreasuryProvider(HttpClient httpClient)
        {
            _httpClient = httpClient;
        }

        public static string CurveUrl(int year) =>
            $"https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve&field_tdr_date_value={year}&page&_format=csv";

        /// <summary>La curva de un año, el sha256 del CSV, cuándo se leyó y si salió de la caché.</summary>
        public async Task<(List<TreasuryCurveDay> Days, string Sha256, DateTime RetrievedAt, bool FromCache)> GetCurveYearAsync(
            int year, CancellationToken cancellationToken)
        {
            if (CurveCache.TryGetValue(year, out var cached) && DateTime.UtcNow - cached.RetrievedAt < CacheFor)
                return (cached.Days, cached.Sha256, cached.RetrievedAt, true);
            var csv = await GetAsync(CurveUrl(year), $"curva {year}", cancellationToken);
            // Al empezar el año el CSV del año en curso llega vacío hasta la primera publicación; en un año pasado es error.
            var days = string.IsNullOrWhiteSpace(csv) && year == DateTime.UtcNow.Year ? new List<TreasuryCurveDay>() : ParseCurve(csv);
            var entry = (DateTime.UtcNow, Sha(csv), days);
            CurveCache[year] = entry;
            return (days, entry.Item2, entry.Item1, false);
        }

        /// <summary>Lee «Date,"1 Mo",…,"30 Yr"» con fechas MM/dd/yyyy; las columnas cambian entre años y se leen por nombre.</summary>
        public static List<TreasuryCurveDay> ParseCurve(string csv)
        {
            var lines = csv.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (lines.Length < 2)
                throw new UpstreamSourceException("treasury", "la curva llegó sin filas");
            var header = lines[0].Split(',').Select(h => h.Trim('"')).ToArray();
            if (header[0] != "Date" || header.Length < 2)
                throw new UpstreamSourceException("treasury", $"la curva cambió de forma (cabecera '{lines[0]}')");
            var tenors = header.Skip(1).Select(h =>
            {
                var m = Tenor.Match(h);
                if (!m.Success)
                    throw new UpstreamSourceException("treasury", $"plazo no reconocido en la curva: '{h}'");
                return m.Groups[1].Value + (m.Groups[2].Value == "Yr" ? "Y" : "M");
            }).ToArray();

            var days = new List<TreasuryCurveDay>(lines.Length - 1);
            foreach (var line in lines.Skip(1))
            {
                var cells = line.Split(',');
                if (cells.Length != header.Length
                    || !DateOnly.TryParseExact(cells[0], "MM/dd/yyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
                    throw new UpstreamSourceException("treasury", $"fila de la curva no reconocida '{line}'");
                var rates = new Dictionary<string, decimal>();
                for (var i = 1; i < cells.Length; i++)
                {
                    if (cells[i].Length == 0)
                        continue;
                    if (!decimal.TryParse(cells[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var rate))
                        throw new UpstreamSourceException("treasury", $"tasa no reconocida en '{line}'");
                    rates[tenors[i - 1]] = rate;
                }
                days.Add(new TreasuryCurveDay(date, rates));
            }
            return days.OrderBy(d => d.Date).ToList();
        }

        /// <summary>Las subastas del último registro publicado (la tabla guarda también los registros anteriores) y el sha256.</summary>
        public async Task<(List<TreasuryAuction> Auctions, string Sha256)> GetUpcomingAuctionsAsync(CancellationToken cancellationToken)
        {
            var json = await GetAsync(UpcomingAuctionsUrl, "subastas próximas", cancellationToken);
            return (ParseAuctions(json), Sha(json));
        }

        public static List<TreasuryAuction> ParseAuctions(string json)
        {
            List<TreasuryAuction> rows;
            try
            {
                using var doc = JsonDocument.Parse(json);
                rows = doc.RootElement.GetProperty("data").EnumerateArray().Select(r => new TreasuryAuction(
                    Text(r, "security_type"), Text(r, "security_term"), Date(r, "auction_date")!.Value, Date(r, "issue_date")!.Value,
                    Date(r, "announcemt_date"),
                    decimal.TryParse(Text(r, "offering_amt"), NumberStyles.Float, CultureInfo.InvariantCulture, out var amt) ? amt : null,
                    Text(r, "cusip"), Text(r, "reopening") == "Yes", Date(r, "record_date")!.Value)).ToList();
            }
            catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException or FormatException)
            {
                throw new UpstreamSourceException("treasury", $"las subastas cambiaron de forma ({ex.Message})");
            }
            if (rows.Count == 0)
                throw new UpstreamSourceException("treasury", "las subastas llegaron sin filas");
            var latest = rows.Max(r => r.RecordDate);
            return rows.Where(r => r.RecordDate == latest).OrderBy(r => r.AuctionDate).ThenBy(r => r.SecurityTerm).ToList();
        }

        private static string Text(JsonElement row, string name) => row.GetProperty(name).GetString() ?? "";

        private static DateOnly? Date(JsonElement row, string name)
        {
            var text = Text(row, name);
            if (text is "" or "null")
                return null;
            return DateOnly.ParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        private async Task<string> GetAsync(string url, string what, CancellationToken cancellationToken)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, url);
                request.Headers.UserAgent.ParseAdd("GaleCore-DataFeed/1.0 (treasury, read-only)");
                var response = await _httpClient.SendAsync(request, cancellationToken);
                if (!response.IsSuccessStatusCode)
                    throw new UpstreamSourceException("treasury", $"{what} respondió {(int)response.StatusCode}");
                return await response.Content.ReadAsStringAsync(cancellationToken);
            }
            catch (HttpRequestException ex)
            {
                throw new UpstreamSourceException("treasury", $"{what}: sin respuesta ({ex.Message})");
            }
        }

        private static string Sha(string text) =>
            "sha256:" + Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(text))).ToLowerInvariant();

        /// <summary>Sólo para tests: vacía la caché entre casos.</summary>
        public static void ClearCache() => CurveCache.Clear();
    }
}
