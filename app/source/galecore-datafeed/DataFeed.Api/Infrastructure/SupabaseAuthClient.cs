using System.Text;
using System.Text.Json;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// El intercambio de mail + contraseña por una sesión de Supabase (el `grant_type=password` de
    /// GoTrue). Es lo que hace posible entrar con USUARIO en vez de con mail: el front manda el
    /// username, la API lo resuelve contra la tabla `users` y autentica con el mail que encontró.
    ///
    /// ALCANZA CON LA ANON KEY, que es pública por diseño —viaja en el bundle del tablero— y no da
    /// ningún permiso por sí sola: lo que autoriza es la contraseña. La service_role
    /// (<see cref="SupabaseAdminClient"/>) hace falta para CREAR usuarios, no para loguearlos, y
    /// usarla acá sería pagar con la llave maestra una operación que no la necesita.
    ///
    /// POR QUÉ PASA POR LA API Y NO VA DIRECTO DESDE EL NAVEGADOR: el front no conoce el mail, solo
    /// el username. La alternativa —un endpoint público que traduzca username → mail y que el front
    /// le pegue a Supabase— dejaría una ruta sin autenticar que devuelve direcciones de correo a
    /// quien adivine un nombre de usuario. Acá el mail no sale nunca del servidor.
    /// </summary>
    public class SupabaseAuthClient
    {
        private readonly IHttpClientFactory _http;
        private readonly ILogger<SupabaseAuthClient> _logger;
        private readonly string _tokenUrl;
        private readonly string _anonKey;

        public SupabaseAuthClient(
            IHttpClientFactory http, IConfiguration config, ILogger<SupabaseAuthClient> logger)
        {
            _http = http;
            _logger = logger;

            var issuer = (config["Supabase:Issuer"] ?? string.Empty).TrimEnd('/');
            _tokenUrl = string.IsNullOrWhiteSpace(issuer)
                ? string.Empty
                : $"{issuer}/token?grant_type=password";
            _anonKey = config["Supabase:AnonKey"] ?? string.Empty;
        }

        public bool Configured => !string.IsNullOrWhiteSpace(_tokenUrl)
                               && !string.IsNullOrWhiteSpace(_anonKey);

        /// <summary>
        /// La sesión recién emitida. Solo los dos tokens: es todo lo que `supabase.auth.setSession`
        /// necesita para tomar la sesión y renovarla sola de ahí en más.
        /// </summary>
        public record Session(string AccessToken, string RefreshToken);

        /// <summary>
        /// Autentica contra Supabase. Devuelve null si las credenciales no sirven — SIN DISTINGUIR
        /// por qué, que es deliberado: quien llama contesta el mismo error para "no existe" y para
        /// "contraseña mala", o el formulario se convierte en un detector de qué usuarios existen.
        /// </summary>
        public async Task<Session?> SignInAsync(string email, string password, CancellationToken ct)
        {
            if (!Configured) return null;

            var body = JsonSerializer.Serialize(new { email, password });

            using var req = new HttpRequestMessage(HttpMethod.Post, _tokenUrl);
            req.Headers.TryAddWithoutValidation("apikey", _anonKey);
            req.Content = new StringContent(body, Encoding.UTF8, "application/json");

            try
            {
                var client = _http.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(15);

                using var res = await client.SendAsync(req, ct);
                var texto = await res.Content.ReadAsStringAsync(ct);

                if (!res.IsSuccessStatusCode)
                {
                    // Se loguea el código, NO el cuerpo: en un fallo de login el cuerpo puede traer
                    // el mail, y el request que lo originó traía la contraseña. Un 400 acá es lo
                    // normal (credenciales mal); un 401 o un 500 hablan de la configuración.
                    _logger.LogInformation("Supabase rechazó el login con {Status}.", (int)res.StatusCode);
                    return null;
                }

                using var doc = JsonDocument.Parse(texto);
                var access = doc.RootElement.TryGetProperty("access_token", out var a) ? a.GetString() : null;
                var refresh = doc.RootElement.TryGetProperty("refresh_token", out var r) ? r.GetString() : null;

                if (string.IsNullOrEmpty(access) || string.IsNullOrEmpty(refresh))
                {
                    _logger.LogError("Supabase aceptó el login pero la respuesta no trae los dos tokens.");
                    return null;
                }

                return new Session(access, refresh);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "No se pudo contactar a Supabase Auth para autenticar.");
                return null;
            }
        }
    }
}
