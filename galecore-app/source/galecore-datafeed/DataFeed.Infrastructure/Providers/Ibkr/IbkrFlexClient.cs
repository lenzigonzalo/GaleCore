using System.Collections.Concurrent;
using System.Xml.Linq;
using Microsoft.Extensions.Logging;

namespace DataFeed.Infrastructure.Providers.Ibkr
{
    /// <summary>Lectura del reporte Flex de IBKR por usuario (WS-0108). Interfaz para probar el servicio sin red.</summary>
    public interface IIbkrFlexClient
    {
        /// <summary>
        /// Trae el reporte (SendRequest + GetStatement). Con <paramref name="useCache"/> reutiliza el de los últimos 10 minutos.
        /// <see cref="IbkrCredentialInvalidException"/> si IBKR rechaza el token o la Query ID.
        /// </summary>
        Task<IbkrFlexReport> GetReportAsync(Guid userId, IbkrCredentials credentials, bool useCache, CancellationToken ct);

        /// <summary>Olvida el reporte guardado del usuario (al cambiar o borrar su credencial).</summary>
        void Forget(Guid userId);
    }

    /// <summary>
    /// Cliente del Flex Web Service de IBKR (v3): <c>SendRequest</c> devuelve un código de referencia y <c>GetStatement</c>
    /// el XML del reporte; si IBKR todavía lo está generando (1019) o limita los pedidos (1018) se reintenta con esperas
    /// cortas. El token viaja en la query string: el cliente HTTP se registra sin loguear URIs y ningún mensaje de
    /// excepción ni log incluye la URL ni el token. El reporte parseado se guarda 10 minutos por usuario (es dato de cierre
    /// e IBKR limita los pedidos).
    /// </summary>
    public sealed class IbkrFlexClient : IIbkrFlexClient
    {
        public const string Source = "IBKR";
        public const string HttpClientName = "ibkr";
        public const string SendRequestUrl = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest";
        public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(20);
        public static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(10);
        /// <summary>≈25 s en total antes de rendirse.</summary>
        public static readonly TimeSpan[] DefaultWaits =
            { TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(3), TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(5) };

        private sealed record Cached(string QueryId, DateTime At, IbkrFlexReport Report);

        private readonly IHttpClientFactory _http;
        private readonly ILogger<IbkrFlexClient>? _logger;
        private readonly TimeSpan[] _waits;
        private readonly Func<DateTime> _now;
        private readonly ConcurrentDictionary<Guid, Cached> _cache = new();

        /// <param name="waits">Esperas entre reintentos de GetStatement (los tests pasan ceros).</param>
        public IbkrFlexClient(IHttpClientFactory http, ILogger<IbkrFlexClient>? logger = null, TimeSpan[]? waits = null, Func<DateTime>? now = null)
        {
            _http = http;
            _logger = logger;
            _waits = waits ?? DefaultWaits;
            _now = now ?? (() => DateTime.UtcNow);
        }

        public void Forget(Guid userId) => _cache.TryRemove(userId, out _);

        public async Task<IbkrFlexReport> GetReportAsync(Guid userId, IbkrCredentials credentials, bool useCache, CancellationToken ct)
        {
            if (useCache && _cache.TryGetValue(userId, out var hit) && hit.QueryId == credentials.QueryId && _now() - hit.At < CacheTtl)
                return hit.Report;

            var (reference, getUrl) = await SendRequestAsync(credentials, ct);
            var report = await GetStatementAsync(credentials, reference, getUrl, ct);
            _cache[userId] = new Cached(credentials.QueryId, _now(), report);
            return report;
        }

        private async Task<(string Reference, string Url)> SendRequestAsync(IbkrCredentials c, CancellationToken ct)
        {
            var url = $"{SendRequestUrl}?t={Uri.EscapeDataString(c.Token)}&q={Uri.EscapeDataString(c.QueryId)}&v=3";
            var status = StatusOf(await FetchAsync(url, ct));
            if (status.Ok && !string.IsNullOrEmpty(status.Reference))
                return (status.Reference, string.IsNullOrEmpty(status.Url) ? SendRequestUrl.Replace("SendRequest", "GetStatement") : status.Url);
            throw Fail(status);
        }

        private async Task<IbkrFlexReport> GetStatementAsync(IbkrCredentials c, string reference, string getUrl, CancellationToken ct)
        {
            var url = $"{getUrl}?q={Uri.EscapeDataString(reference)}&t={Uri.EscapeDataString(c.Token)}&v=3";
            for (var attempt = 0; ; attempt++)
            {
                var doc = await FetchAsync(url, ct);
                if (doc.Root?.Name.LocalName == "FlexQueryResponse") return IbkrFlexParser.ParseReport(doc);
                var status = StatusOf(doc);
                if (status.Code is "1019" or "1018")
                {
                    if (attempt >= _waits.Length)
                        throw new UpstreamSourceException(Source, "IBKR todavía está generando el reporte; probá en un minuto.");
                    if (_waits[attempt] > TimeSpan.Zero) await Task.Delay(_waits[attempt], ct);
                    continue;
                }
                throw Fail(status);
            }
        }

        // ── errores ───────────────────────────────────────────────────────────────────────────────────────────

        private sealed record Status(bool Ok, string? Reference, string? Url, string? Code, string? Message);

        private static Status StatusOf(XDocument doc)
        {
            var root = doc.Root;
            string? Get(string n) => root?.Element(n)?.Value.Trim();
            var ok = string.Equals(Get("Status"), "Success", StringComparison.OrdinalIgnoreCase);
            return new Status(ok, Get("ReferenceCode"), Get("Url"), Get("ErrorCode"), Get("ErrorMessage"));
        }

        /// <summary>Credencial rechazada o caída de IBKR. El mensaje es de IBKR y nunca lleva la URL ni el token.</summary>
        private static Exception Fail(Status s) => s.Code switch
        {
            "1012" => new IbkrCredentialInvalidException("El token de Flex de IBKR venció; generá uno nuevo en el portal."),
            "1015" => new IbkrCredentialInvalidException("IBKR no reconoce el token de Flex. Revisalo en Configuración › Conexiones › Brokers."),
            "1014" => new IbkrCredentialInvalidException("IBKR no encontró esa Query ID. Revisala en Configuración › Conexiones › Brokers."),
            "1013" => new IbkrCredentialInvalidException("El token de Flex de IBKR tiene restricción de IP y este servidor no está permitido; quitala en el portal."),
            _ => new UpstreamSourceException(Source, string.IsNullOrWhiteSpace(s.Message)
                ? "devolvió una respuesta que no se entiende."
                : $"{s.Message}{(s.Code == null ? "" : $" (código {s.Code})")}"),
        };

        // ── HTTP ──────────────────────────────────────────────────────────────────────────────────────────────

        private async Task<XDocument> FetchAsync(string url, CancellationToken ct)
        {
            string body;
            int status;
            try
            {
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(Timeout);
                using var request = new HttpRequestMessage(HttpMethod.Get, url);
                // IBKR rechaza los pedidos sin User-Agent.
                request.Headers.TryAddWithoutValidation("User-Agent", "GaleCore/1.0");
                using var response = await _http.CreateClient(HttpClientName).SendAsync(request, cts.Token);
                status = (int)response.StatusCode;
                body = await response.Content.ReadAsStringAsync(cts.Token);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                throw new UpstreamSourceException(Source, $"sin respuesta en {(int)Timeout.TotalSeconds} s.");
            }
            catch (HttpRequestException)
            {
                // El texto de la excepción puede traer la URL (con el token): no se usa.
                throw new UpstreamSourceException(Source, "no se pudo conectar.");
            }

            if (status is < 200 or >= 300)
            {
                _logger?.LogWarning("IBKR Flex respondió {Status}.", status);
                throw new UpstreamSourceException(Source, $"respondió {status}.");
            }
            try { return IbkrFlexParser.Load(body); }
            catch (System.Xml.XmlException) { throw new UpstreamSourceException(Source, "devolvió una respuesta ilegible."); }
        }
    }
}
