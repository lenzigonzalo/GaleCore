using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Extensions.Configuration;

namespace DataFeed.Infrastructure.Providers.Sec
{
    public record SecCompany(string Cik, string Ticker, string Name);

    /// <summary>Una presentación ante la SEC. Items: en un 8-K, los ítems del formulario (2.02 = resultados).</summary>
    public record SecFiling(string Form, string FilingDate, string? ReportDate, string AcceptanceDateTime, string AccessionNumber,
        string PrimaryDocument, string? PrimaryDocDescription, string Url, IReadOnlyList<string> Items);

    /// <summary>Un valor XBRL reportado por la empresa (companyconcept): período, valor, en qué formulario y cuándo.</summary>
    public record SecFact(string Unit, string? Start, string End, decimal Value, string Form, int? FiscalYear, string? FiscalPeriod,
        string Filed, string? Frame, string Accession);

    public record SecCompanyFilings(string Cik, string Name, string? Sic, string? SicDescription, IReadOnlyList<string> Tickers,
        IReadOnlyList<SecFiling> Filings);

    public record SecCompanyConcept(string Cik, string EntityName, string Taxonomy, string Tag, string? Label, string? Description,
        IReadOnlyList<SecFact> Facts);

    /// <summary>
    /// SEC EDGAR, sin clave (WS-0014, HANDOFF-GALECORE-FUENTES B1). Política de la SEC: User-Agent con nombre y correo de
    /// contacto (configuración <c>SecEdgar:UserAgent</c>, nunca en el código) y como mucho 10 pedidos por segundo. Una falla
    /// o un JSON que cambió de forma es error explícito.
    /// </summary>
    public class SecEdgarProvider
    {
        public const string TickersUrl = "https://www.sec.gov/files/company_tickers.json";
        public static readonly TimeSpan TickersCacheFor = TimeSpan.FromHours(24);

        // Una referencia a un objeto inmutable: se lee y se reemplaza entera, sin lecturas a medias entre requests.
        private sealed record TickerList(DateTime RetrievedAt, Dictionary<string, SecCompany> ByTicker);
        private static volatile TickerList? _tickers;
        private static readonly SemaphoreSlim OneAtATime = new(1, 1);

        private readonly HttpClient _httpClient;
        private readonly string? _userAgent;

        public SecEdgarProvider(IConfiguration config, HttpClient httpClient)
        {
            _httpClient = httpClient;
            _userAgent = config["SecEdgar:UserAgent"];
        }

        public static string SubmissionsUrl(string cik) => $"https://data.sec.gov/submissions/CIK{cik}.json";

        public static string ConceptUrl(string cik, string taxonomy, string tag) =>
            $"https://data.sec.gov/api/xbrl/companyconcept/CIK{cik}/{taxonomy}/{tag}.json";

        /// <summary>CIK con ceros a la izquierda (10 dígitos), como lo usa data.sec.gov.</summary>
        public static string PadCik(long cik) => cik.ToString("D10", CultureInfo.InvariantCulture);

        public async Task<SecCompany?> FindTickerAsync(string ticker, CancellationToken cancellationToken)
        {
            var cached = _tickers;
            if (cached is null || DateTime.UtcNow - cached.RetrievedAt >= TickersCacheFor)
            {
                var json = await GetAsync(TickersUrl, "company_tickers", cancellationToken);
                cached = new TickerList(DateTime.UtcNow, ParseTickers(json));
                _tickers = cached;
            }
            return cached.ByTicker.GetValueOrDefault(ticker.ToUpperInvariant());
        }

        public static Dictionary<string, SecCompany> ParseTickers(string json)
        {
            return Shape("company_tickers", () =>
            {
                using var doc = JsonDocument.Parse(json);
                var result = new Dictionary<string, SecCompany>();
                foreach (var row in doc.RootElement.EnumerateObject().Select(p => p.Value))
                {
                    var ticker = row.GetProperty("ticker").GetString()!.ToUpperInvariant();
                    result.TryAdd(ticker, new SecCompany(PadCik(row.GetProperty("cik_str").GetInt64()), ticker, row.GetProperty("title").GetString()!));
                }
                if (result.Count == 0)
                    throw new FormatException("sin empresas");
                return result;
            });
        }

        public async Task<(SecCompanyFilings Filings, string Sha256)> GetFilingsAsync(string cik, CancellationToken cancellationToken)
        {
            var json = await GetAsync(SubmissionsUrl(cik), "submissions", cancellationToken);
            return (ParseSubmissions(json), Sha(json));
        }

        /// <summary>Lee el bloque «recent» de submissions (las ~1000 presentaciones más nuevas; columnas paralelas).</summary>
        public static SecCompanyFilings ParseSubmissions(string json)
        {
            return Shape("submissions", () =>
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                var cik = root.GetProperty("cik").GetString()!;
                var recent = root.GetProperty("filings").GetProperty("recent");
                string[] Column(string name) => recent.GetProperty(name).EnumerateArray().Select(e => e.GetString() ?? "").ToArray();
                var form = Column("form");
                var filed = Column("filingDate");
                var report = Column("reportDate");
                var accepted = Column("acceptanceDateTime");
                var accession = Column("accessionNumber");
                var doc1 = Column("primaryDocument");
                var desc = Column("primaryDocDescription");
                var items = Column("items");
                var n = form.Length;
                if (new[] { filed, report, accepted, accession, doc1, desc, items }.Any(c => c.Length != n))
                    throw new FormatException("columnas de distinto largo");
                var cikNumber = long.Parse(cik, CultureInfo.InvariantCulture);
                var filings = Enumerable.Range(0, n).Select(i => new SecFiling(form[i], filed[i], Empty(report[i]), accepted[i], accession[i],
                    doc1[i], Empty(desc[i]),
                    $"https://www.sec.gov/Archives/edgar/data/{cikNumber}/{accession[i].Replace("-", "")}/{doc1[i]}",
                    items[i].Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))).ToList();
                return new SecCompanyFilings(PadCik(cikNumber), root.GetProperty("name").GetString()!, Opt(root, "sic"), Opt(root, "sicDescription"),
                    root.GetProperty("tickers").EnumerateArray().Select(t => t.GetString()!).ToList(), filings);
            });
        }

        public async Task<(SecCompanyConcept Concept, string Sha256)> GetConceptAsync(string cik, string taxonomy, string tag, CancellationToken cancellationToken)
        {
            var json = await GetAsync(ConceptUrl(cik, taxonomy, tag), "companyconcept", cancellationToken);
            return (ParseConcept(json), Sha(json));
        }

        public static SecCompanyConcept ParseConcept(string json)
        {
            return Shape("companyconcept", () =>
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                var facts = root.GetProperty("units").EnumerateObject().SelectMany(unit => unit.Value.EnumerateArray().Select(f => new SecFact(
                    unit.Name, Opt(f, "start"), f.GetProperty("end").GetString()!, f.GetProperty("val").GetDecimal(), f.GetProperty("form").GetString()!,
                    f.TryGetProperty("fy", out var fy) && fy.ValueKind == JsonValueKind.Number ? fy.GetInt32() : null, Opt(f, "fp"),
                    f.GetProperty("filed").GetString()!, Opt(f, "frame"), f.GetProperty("accn").GetString()!))).ToList();
                return new SecCompanyConcept(PadCik(root.GetProperty("cik").GetInt64()), root.GetProperty("entityName").GetString()!,
                    root.GetProperty("taxonomy").GetString()!, root.GetProperty("tag").GetString()!, Opt(root, "label"), Opt(root, "description"), facts);
            });
        }

        /// <summary>El documento principal de una presentación (HTML de sec.gov), con su hash (WS-0045: leer el 10-K).</summary>
        public async Task<(string Html, string Sha256)> GetDocumentAsync(string url, CancellationToken cancellationToken)
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Host != "www.sec.gov")
                throw new UpstreamSourceException("sec", $"documento fuera de sec.gov: {url}");
            var html = await GetAsync(url, "documento", cancellationToken);
            return (html, Sha(html));
        }

        private async Task<string> GetAsync(string url, string what, CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(_userAgent))
                throw new UpstreamSourceException("sec", "falta SecEdgar:UserAgent en la configuración (la SEC exige nombre y correo de contacto)");
            // Uno por vez y con una pausa corta: muy por debajo del tope de 10 pedidos por segundo de la SEC.
            await OneAtATime.WaitAsync(cancellationToken);
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, url);
                // La SEC pide «Nombre correo@dominio»; un correo suelto no es un producto válido para .NET.
                request.Headers.TryAddWithoutValidation("User-Agent", _userAgent);
                var response = await _httpClient.SendAsync(request, cancellationToken);
                if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
                    throw new UpstreamSourceException("sec", $"{what}: la SEC no tiene ese dato (404)");
                if (!response.IsSuccessStatusCode)
                    throw new UpstreamSourceException("sec", $"{what} respondió {(int)response.StatusCode}");
                return await response.Content.ReadAsStringAsync(cancellationToken);
            }
            catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !cancellationToken.IsCancellationRequested))
            {
                throw new UpstreamSourceException("sec", $"{what}: sin respuesta ({ex.Message})");
            }
            finally
            {
                await Task.Delay(150, CancellationToken.None);
                OneAtATime.Release();
            }
        }

        private static T Shape<T>(string what, Func<T> parse)
        {
            try
            {
                return parse();
            }
            catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException or FormatException or NullReferenceException)
            {
                throw new UpstreamSourceException("sec", $"{what} cambió de forma ({ex.Message})");
            }
        }

        private static string? Opt(JsonElement e, string name) =>
            e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String && v.GetString() is { Length: > 0 } s ? s : null;

        private static string? Empty(string s) => s.Length == 0 ? null : s;

        private static string Sha(string text) =>
            "sha256:" + Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(text))).ToLowerInvariant();

        /// <summary>Sólo para tests: vacía la caché de tickers.</summary>
        public static void ClearCache() => _tickers = null;
    }
}
