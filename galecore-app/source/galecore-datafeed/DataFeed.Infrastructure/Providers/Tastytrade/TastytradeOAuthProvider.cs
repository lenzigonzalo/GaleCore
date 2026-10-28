using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    /// <summary>
    /// Canjea refresh token por access token contra Tastytrade, cacheando POR CREDENCIAL.
    ///
    /// Hasta 2026-08-11 esta clase tenía UN solo juego de tokens, porque la plataforma tenía un solo
    /// operador. Con multi-usuario eso deja de servir: cada uno tiene su cuenta, y un access token
    /// no sirve para la cuenta de otro. El cache pasó a estar indexado por
    /// <see cref="TastytradeCredential.Id"/> — mezclar dos credenciales en una misma entrada le
    /// mostraría a un usuario las posiciones del otro, que es el peor error posible acá.
    ///
    /// El client_secret sale de la credencial cuando la trae, y de configuración cuando no. Desde
    /// 2026-09-01 cada operador puede registrar SU aplicación OAuth en su perfil de Tastytrade, y
    /// entonces el par (refresh token, client_secret) es indivisible: el secreto de la aplicación de
    /// la plataforma no canjea un token emitido por otra.
    ///
    /// De qué credencial se trata lo decide <see cref="ITastytradeCredentialStore"/>: sistema para
    /// mercado, usuario para cuenta. Ver docs/GaleCore-arquitectura-datos.md §5.4.
    /// </summary>
    public class TastytradeOAuth : ITastytradeOAuth
    {
        private readonly HttpClient _client;
        private readonly IConfiguration _config;
        private readonly ITastytradeCredentialStore _credentials;
        private readonly ILogger<TastytradeOAuth> _logger;

        // Un access token por credencial. El lock también es por credencial: si fuera uno solo, el
        // refresh de un usuario bloquearía a todos los demás.
        private readonly ConcurrentDictionary<string, OAuthResponseAPIModel> _apiTokens = new();
        private readonly ConcurrentDictionary<string, SemaphoreSlim> _apiLocks = new();

        private OAuthResponseWSModel? _wsToken;
        private readonly SemaphoreSlim _wsTokenLock = new(1, 1);

        public TastytradeOAuth(IConfiguration config, IHttpClientFactory client,
            ITastytradeCredentialStore credentials, ILogger<TastytradeOAuth> logger)
        {
            _config = config;
            _credentials = credentials;
            _logger = logger;
            _client = client.CreateClient();
            _client.BaseAddress = new Uri(_config["Tastytrade:BaseUrl"]!);
            // Headers fijos — se configuran una sola vez para evitar duplicados en cada refresh
            _client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            _client.DefaultRequestHeaders.UserAgent.ParseAdd("PostmanRuntime/7.36.0");
        }

        public async Task<HttpRequestMessage> CreateOAuthApiRequestAsync(string endpoint)
            => await CreateOAuthApiRequestAsync(endpoint, await _credentials.GetSystemAsync());

        public async Task<HttpRequestMessage> CreateOAuthApiRequestAsync(string endpoint, TastytradeCredential credential)
        {
            var token = await GetOAuthApiAsync(credential);
            var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.AccessToken);
            return request;
        }

        private async Task<OAuthResponseAPIModel> GetOAuthApiAsync(TastytradeCredential credential)
        {
            // Verificación rápida sin lock (happy path)
            if (_apiTokens.TryGetValue(credential.Id, out var cached) &&
                cached.ExpiresAt > DateTime.UtcNow.AddMinutes(1))
                return cached;

            var gate = _apiLocks.GetOrAdd(credential.Id, _ => new SemaphoreSlim(1, 1));
            await gate.WaitAsync();
            try
            {
                // Re-verificar dentro del lock — otro thread pudo haber refrescado mientras esperábamos
                if (_apiTokens.TryGetValue(credential.Id, out cached) &&
                    cached.ExpiresAt > DateTime.UtcNow.AddMinutes(1))
                    return cached;

                var baseUrl = _config["Tastytrade:BaseUrl"]!;
                var request = new OAuthRequestLoginAPIModel
                {
                    GrantType = _config["Tastytrade:OAuth:grant_type"]!,
                    RefreshToken = credential.RefreshToken,

                    // Las dos mitades salen de la MISMA credencial cuando el operador trae su propia
                    // aplicación OAuth. El de configuración es el fallback —la aplicación de la
                    // plataforma— y no al revés: mezclar el refresh token de una app con el
                    // client_secret de otra es el `Client secret mismatch` de manual.
                    ClientSecret = credential.ClientSecret ?? _config["Tastytrade:OAuth:client_secret"]!,
                };

                var json = JsonSerializer.Serialize(request);
                var content = new StringContent(json, Encoding.UTF8, "application/json");
                var response = await _client.PostAsync(baseUrl + "/oauth/token", content);
                var responseText = await response.Content.ReadAsStringAsync();
                if (!response.IsSuccessStatusCode)
                    throw Rechazo(credential, response.StatusCode, responseText);

                var auth = JsonSerializer.Deserialize<OAuthResponseAPIModel>(responseText)!;
                // Usar UtcNow consistentemente para evitar errores de zona horaria
                auth.ExpiresAt = DateTime.UtcNow.AddSeconds(auth.ExpiresIn - 60);
                _apiTokens[credential.Id] = auth;
                return auth;
            }
            finally
            {
                gate.Release();
            }
        }

        /// <summary>
        /// Traduce un canje fallido, separando las dos cosas que /oauth/token puede estar diciendo.
        ///
        /// **La credencial de un USUARIO no sirve** (400/401): el refresh token está revocado,
        /// vencido, o lo emitió otra aplicación OAuth. Eso no lo arregla nadie del lado del servidor
        /// — lo arregla el dueño de la cuenta volviendo a generarlo—, así que sale con su propio tipo
        /// y el controller lo convierte en 409. Hasta hoy salía indistinguible de una caída.
        ///
        /// La de SISTEMA rechazada NO entra por ahí, aunque el status sea el mismo: no tiene dueño a
        /// quien mandar a re-vincular y viaja en los endpoints de mercado, donde el que pregunta
        /// puede no tener ni cuenta. Ese 409 le pediría a cualquiera que estuviera mirando precios
        /// que arreglara algo que no es suyo. Es un 500 y un log de error para el operador de la
        /// plataforma.
        ///
        /// **Tastytrade tiene un problema** (todo lo demás: 5xx, 429, un timeout que llegó como
        /// error): la credencial puede estar perfecta y el reintento de dentro de un minuto anda. Eso
        /// SÍ es un 500, y decirle al operador que re-vincule lo mandaría a romper lo que funciona.
        ///
        /// El cuerpo de la respuesta se loguea entero: es donde viene el `error_description` que
        /// distingue "Client secret mismatch" de un token revocado, y no viaja al front.
        /// </summary>
        private Exception Rechazo(TastytradeCredential credential, System.Net.HttpStatusCode status, string body)
        {
            var esCredencial = !credential.IsSystem
                            && (status == System.Net.HttpStatusCode.BadRequest
                             || status == System.Net.HttpStatusCode.Unauthorized);

            if (!esCredencial)
            {
                _logger.LogError(
                    "Tastytrade no pudo emitir un access token para la credencial {Source} (id {Id}). " +
                    "Status {Status}. Respuesta: {Body}",
                    credential.Source, credential.Id, status, body);

                return new Exception(
                    $"No se pudo autenticar con Tastytrade (credencial {credential.Source}). Status: {status}");
            }

            _logger.LogWarning(
                "Tastytrade RECHAZÓ el refresh token de la credencial {Source} (id {Id}, cuenta {AccountNumber}). " +
                "Status {Status}. Respuesta: {Body}",
                credential.Source, credential.Id, credential.AccountNumber ?? "sin número", status, body);

            return new BrokerCredentialInvalidException(body);
        }

        public async Task<OAuthResponseWSModel> GetWsOAuthApiAsync()
        {
            if (_wsToken != null && _wsToken.Data.ExpiresAt > DateTime.UtcNow.AddMinutes(1))
                return _wsToken;

            await _wsTokenLock.WaitAsync();
            try
            {
                if (_wsToken != null && _wsToken.Data.ExpiresAt > DateTime.UtcNow.AddMinutes(1))
                    return _wsToken;

                // Siempre con la credencial de sistema: hay UNA conexión DXLink para toda la
                // plataforma y el feed de mercado es compartido.
                var system = await _credentials.GetSystemAsync();
                var request = await CreateOAuthApiRequestAsync("/api-quote-tokens", system);
                var response = await _client.SendAsync(request);
                response.EnsureSuccessStatusCode();

                var content = await response.Content.ReadAsStringAsync();
                _wsToken = JsonSerializer.Deserialize<OAuthResponseWSModel>(content)!;
                return _wsToken;
            }
            finally
            {
                _wsTokenLock.Release();
            }
        }
    }
}
