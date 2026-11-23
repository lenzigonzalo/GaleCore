using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace DataFeed.Infrastructure.Providers.Iol
{
    /// <summary>Lecturas de IOL por usuario (WS-0108). Interfaz para probar el servicio sin red.</summary>
    public interface IIolClient
    {
        /// <summary>Login con usuario y contraseña (guarda el token en memoria). <see cref="IolCredentialInvalidException"/> si IOL lo rechaza.</summary>
        Task LoginAsync(Guid userId, IolCredentials credentials, CancellationToken ct);

        /// <summary>Saldos del país (<c>AR</c> trae ARS y USD; <c>US</c> sólo USD).</summary>
        Task<IolBalances> GetBalancesAsync(Guid userId, IolCredentials credentials, string country, CancellationToken ct);

        /// <summary>Posiciones del país (<c>AR</c> | <c>US</c>), sin <c>valuation_currency</c>.</summary>
        Task<IolPositions> GetPositionsAsync(Guid userId, IolCredentials credentials, string country, CancellationToken ct);

        /// <summary>Olvida el token del usuario (al cambiar o borrar su credencial).</summary>
        void Forget(Guid userId);
    }

    /// <summary>
    /// Cliente de sólo lectura de la API nueva de IOL (<c>api.iolinversiones.com</c>, respuestas envueltas en
    /// <c>{ meta, data, error }</c>). Password grant en <c>POST /auth/token</c>; el bearer se guarda en memoria por usuario:
    /// se renueva con el refresh token antes de vencer y, si el refresh falla, se vuelve a pedir con usuario y contraseña.
    /// Un 5xx, un timeout o una respuesta ilegible salen como <see cref="UpstreamSourceException"/>. Nada de lo que loguea
    /// ni lanza incluye la contraseña ni los tokens (sí el <c>trace_id</c> de IOL).
    /// </summary>
    public sealed class IolClient : IIolClient
    {
        public const string Source = "IOL";
        public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(20);
        private static readonly TimeSpan Margin = TimeSpan.FromSeconds(60);
        private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

        private sealed record TokenState(string Username, string Access, string? Refresh, DateTime ExpiresAt);

        /// <summary>Respuesta cruda; <c>Detail</c> = «: mensaje (trace X)» del sobre de error, sin credenciales.</summary>
        private sealed record Raw(HttpStatusCode Status, string Body, string Detail);

        private readonly IHttpClientFactory _http;
        private readonly ILogger<IolClient>? _logger;
        private readonly string _baseUrl;
        private readonly Func<DateTime> _now;
        private readonly ConcurrentDictionary<Guid, TokenState> _tokens = new();
        private readonly ConcurrentDictionary<Guid, SemaphoreSlim> _locks = new();

        public IolClient(IHttpClientFactory http, IConfiguration config, ILogger<IolClient>? logger = null, Func<DateTime>? now = null)
        {
            _http = http;
            _logger = logger;
            var url = config["Iol:BaseUrl"];
            _baseUrl = (string.IsNullOrWhiteSpace(url) ? "https://api.iolinversiones.com" : url).TrimEnd('/');
            _now = now ?? (() => DateTime.UtcNow);
        }

        public void Forget(Guid userId) => _tokens.TryRemove(userId, out _);

        public async Task LoginAsync(Guid userId, IolCredentials credentials, CancellationToken ct)
        {
            var gate = _locks.GetOrAdd(userId, _ => new SemaphoreSlim(1, 1));
            await gate.WaitAsync(ct);
            try { await PasswordLoginAsync(userId, credentials, ct); }
            finally { gate.Release(); }
        }

        public Task<IolBalances> GetBalancesAsync(Guid userId, IolCredentials credentials, string country, CancellationToken ct) =>
            GetAsync<IolBalances>(userId, credentials, $"/broker/accounts/{country}/balances", ct);

        public Task<IolPositions> GetPositionsAsync(Guid userId, IolCredentials credentials, string country, CancellationToken ct) =>
            GetAsync<IolPositions>(userId, credentials, $"/broker/accounts/{country}/positions", ct);

        // ── lecturas ──────────────────────────────────────────────────────────────────────────────────────────

        private async Task<T> GetAsync<T>(Guid userId, IolCredentials credentials, string path, CancellationToken ct) where T : class, new()
        {
            var token = await EnsureTokenAsync(userId, credentials, ct);
            var res = await SendAsync(HttpMethod.Get, path, null, token, ct);
            if (res.Status == HttpStatusCode.Unauthorized)
            {
                // El bearer venció o IOL lo invalidó: se descarta y se pide uno nuevo una sola vez.
                _tokens.TryRemove(userId, out _);
                token = await EnsureTokenAsync(userId, credentials, ct);
                res = await SendAsync(HttpMethod.Get, path, null, token, ct);
            }
            if (res.Status == HttpStatusCode.Unauthorized) throw new IolCredentialInvalidException();
            if ((int)res.Status >= 400) throw new UpstreamSourceException(Source, $"respondió {(int)res.Status} al leer {path}{res.Detail}.");
            try { return JsonSerializer.Deserialize<IolEnvelope<T>>(res.Body, JsonOptions)?.Data ?? new T(); }
            catch (JsonException) { throw new UpstreamSourceException(Source, $"devolvió una respuesta ilegible en {path}."); }
        }

        // ── token ─────────────────────────────────────────────────────────────────────────────────────────────

        private async Task<string> EnsureTokenAsync(Guid userId, IolCredentials credentials, CancellationToken ct)
        {
            if (_tokens.TryGetValue(userId, out var cached) && cached.Username == credentials.Username && cached.ExpiresAt - Margin > _now())
                return cached.Access;

            var gate = _locks.GetOrAdd(userId, _ => new SemaphoreSlim(1, 1));
            await gate.WaitAsync(ct);
            try
            {
                if (_tokens.TryGetValue(userId, out cached) && cached.Username == credentials.Username)
                {
                    if (cached.ExpiresAt - Margin > _now()) return cached.Access; // otro pedido ya lo renovó
                    if (cached.Refresh != null)
                    {
                        var renewed = await TryRefreshAsync(userId, credentials.Username, cached.Refresh, ct);
                        if (renewed != null) return renewed;
                    }
                }
                return await PasswordLoginAsync(userId, credentials, ct);
            }
            finally { gate.Release(); }
        }

        private async Task<string?> TryRefreshAsync(Guid userId, string username, string refresh, CancellationToken ct)
        {
            var res = await SendAsync(HttpMethod.Post, "/auth/token", new { grant_type = "refresh_token", refresh_token = refresh }, null, ct);
            if ((int)res.Status >= 500) throw new UpstreamSourceException(Source, $"respondió {(int)res.Status} al renovar la sesión{res.Detail}.");
            if (res.Status != HttpStatusCode.OK) return null; // refresh vencido o rechazado: se vuelve a pedir con la contraseña
            return Store(userId, username, res.Body);
        }

        private async Task<string> PasswordLoginAsync(Guid userId, IolCredentials credentials, CancellationToken ct)
        {
            var res = await SendAsync(HttpMethod.Post, "/auth/token",
                new { grant_type = "password", username = credentials.Username, password = credentials.Password }, null, ct);
            if (res.Status is HttpStatusCode.BadRequest or HttpStatusCode.Unauthorized) throw new IolCredentialInvalidException();
            if ((int)res.Status >= 400) throw new UpstreamSourceException(Source, $"respondió {(int)res.Status} al iniciar sesión{res.Detail}.");
            return Store(userId, credentials.Username, res.Body)
                ?? throw new UpstreamSourceException(Source, "no devolvió un token de acceso.");
        }

        private string? Store(Guid userId, string username, string body)
        {
            IolTokenData? token;
            try { token = JsonSerializer.Deserialize<IolEnvelope<IolTokenData>>(body, JsonOptions)?.Data; }
            catch (JsonException) { return null; }
            if (string.IsNullOrEmpty(token?.AccessToken)) return null;
            var seconds = token.ExpiresIn is > 0 ? token.ExpiresIn.Value : 900;
            _tokens[userId] = new TokenState(username, token.AccessToken, token.RefreshToken, _now().AddSeconds(seconds));
            return token.AccessToken;
        }

        // ── HTTP ──────────────────────────────────────────────────────────────────────────────────────────────

        private async Task<Raw> SendAsync(HttpMethod method, string path, object? json, string? bearer, CancellationToken ct)
        {
            try
            {
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(Timeout);
                // El Cloudflare de IOL bloquea (403 con página HTML) la primera conexión TLS del proceso y todo lo que
                // viaje por ella; una conexión nueva pasa (probado 23/11). Por eso cada pedido cierra su conexión y,
                // ante ese bloqueo, se reintenta una vez.
                HttpResponseMessage response = null!;
                string body = "";
                for (var attempt = 0; attempt < 2; attempt++)
                {
                    using var request = new HttpRequestMessage(method, _baseUrl + path);
                    if (json != null) request.Content = new StringContent(JsonSerializer.Serialize(json), Encoding.UTF8, "application/json");
                    if (bearer != null) request.Headers.TryAddWithoutValidation("Authorization", "Bearer " + bearer);
                    // Sin User-Agent, Cloudflare también lo bloquea (HttpClient no manda ninguno).
                    request.Headers.TryAddWithoutValidation("User-Agent", "GaleCore/1.0");
                    request.Headers.ConnectionClose = true;
                    response?.Dispose();
                    response = await _http.CreateClient("iol").SendAsync(request, cts.Token);
                    body = await response.Content.ReadAsStringAsync(cts.Token);
                    if (response.StatusCode != HttpStatusCode.Forbidden || !IsHtml(body)) break;
                }
                using var _ = response;
                var detail = "";
                if (!response.IsSuccessStatusCode)
                {
                    detail = ErrorDetail(body);
                    _logger?.LogWarning("IOL {Method} {Path} respondió {Status}{Detail}", method.Method, path, (int)response.StatusCode, detail);
                }
                return new Raw(response.StatusCode, body, detail);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                throw new UpstreamSourceException(Source, $"sin respuesta en {(int)Timeout.TotalSeconds} s.");
            }
            catch (HttpRequestException)
            {
                // El texto de la excepción puede traer la URL: no se usa.
                throw new UpstreamSourceException(Source, "no se pudo conectar.");
            }
        }

        /// <summary>«: mensaje (trace X)» del sobre de error, o vacío. El mensaje es del proveedor y no lleva credenciales.</summary>
        private static string ErrorDetail(string body)
        {
            // Una página HTML no es de la API: es el Cloudflare que está delante de IOL bloqueando el pedido.
            if (IsHtml(body)) return ": bloqueado por el Cloudflare de IOL" + CloudflareRay(body);
            try
            {
                var env = JsonSerializer.Deserialize<IolEnvelope<JsonElement?>>(body, JsonOptions);
                var msg = env?.Error?.Message;
                var trace = env?.Meta?.TraceId;
                if (string.IsNullOrWhiteSpace(msg) && string.IsNullOrWhiteSpace(trace)) return "";
                return $": {msg}{(string.IsNullOrWhiteSpace(trace) ? "" : $" (trace {trace})")}";
            }
            catch (JsonException) { return ""; }
        }

        private static bool IsHtml(string body) => body.TrimStart().StartsWith("<");

        /// <summary>« (ray X)» si la página de Cloudflare trae su Ray ID, para pedirle a IOL que lo revise.</summary>
        private static string CloudflareRay(string html)
        {
            var m = System.Text.RegularExpressions.Regex.Match(html, @"Ray ID:\s*<strong[^>]*>([0-9a-f]+)<");
            return m.Success ? $" (ray {m.Groups[1].Value})" : "";
        }
    }
}
