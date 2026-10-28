using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// La parte de la identidad que solo puede hacer un administrador: crear, editar y borrar
    /// usuarios en Supabase Auth (la admin API de GoTrue, bajo <c>{Issuer}/admin/users</c>).
    ///
    /// 🔑 USA LA SERVICE_ROLE KEY, que es la llave maestra del proyecto: saltea las políticas RLS y
    /// puede todo. Por eso vive SOLO del lado servidor —user-secrets en local, App Settings en
    /// Azure— y jamás en appsettings.json ni, por supuesto, en el bundle del tablero. La que viaja
    /// al navegador es la anon key, que es otra cosa.
    ///
    /// SIN LA CLAVE CONFIGURADA, <see cref="Configured"/> es false y el ABM no está disponible: la
    /// API arranca igual y todo lo demás anda, como con la base. Es la misma decisión de siempre —
    /// que falte un secreto no puede tumbar el feed.
    ///
    /// NO ADMINISTRA PERMISOS DE GALECORE. `is_admin` es de la tabla `users` y no de Supabase: acá
    /// se maneja la identidad (mail y contraseña), allá lo que la plataforma deja hacer.
    /// </summary>
    public class SupabaseAdminClient
    {
        private readonly IHttpClientFactory _http;
        private readonly ILogger<SupabaseAdminClient> _logger;
        private readonly string _adminUrl;
        private readonly string _serviceRoleKey;

        public SupabaseAdminClient(
            IHttpClientFactory http, IConfiguration config, ILogger<SupabaseAdminClient> logger)
        {
            _http = http;
            _logger = logger;

            // El issuer ya apunta a .../auth/v1, que es la raíz de GoTrue: la admin API cuelga de
            // ahí. Reusarlo evita una segunda URL de configuración que se pueda desincronizar de la
            // que valida los JWT — apuntando cada una a un proyecto distinto, el alta crearía al
            // usuario en un lado y su token sería rechazado por el otro.
            var issuer = (config["Supabase:Issuer"] ?? string.Empty).TrimEnd('/');
            _adminUrl = string.IsNullOrWhiteSpace(issuer) ? string.Empty : $"{issuer}/admin/users";
            _serviceRoleKey = config["Supabase:ServiceRoleKey"] ?? string.Empty;
        }

        /// <summary>¿Se puede administrar la identidad desde acá? Sin service_role key, no.</summary>
        public bool Configured => !string.IsNullOrWhiteSpace(_adminUrl)
                               && !string.IsNullOrWhiteSpace(_serviceRoleKey);

        /// <summary>
        /// Lo que salió mal, en un formato que el endpoint pueda devolver tal cual. `Message` es
        /// para que lo lea el admin, no para el log.
        /// </summary>
        public record Result(bool Ok, string? Message = null, Guid? UserId = null);

        /// <summary>
        /// Crea el usuario en Supabase Auth con una contraseña inicial y el mail YA CONFIRMADO.
        ///
        /// El `email_confirm: true` es deliberado: sin él, Supabase manda un mail de confirmación y
        /// el usuario no puede entrar hasta abrirlo — que con el servicio de mail por defecto (unos
        /// pocos envíos por hora, sin SMTP propio) es una espera que puede no terminar nunca. La
        /// contraseña inicial la pone el admin y la persona la cambia después desde su pantalla.
        /// </summary>
        public async Task<Result> CreateUserAsync(string email, string password, CancellationToken ct)
        {
            if (!Configured) return NotConfigured();

            var body = JsonSerializer.Serialize(new
            {
                email,
                password,
                email_confirm = true,
            });

            using var req = Request(HttpMethod.Post, _adminUrl, body);
            return await SendAsync(req, "crear el usuario", leerId: true, ct);
        }

        /// <summary>
        /// Cambia el mail o la contraseña de un usuario en Supabase Auth. Los nulos no se tocan.
        ///
        /// El mail se confirma de nuevo (`email_confirm: true`) por el mismo motivo que en el alta:
        /// si no, cambiarle el mail a alguien lo deja sin poder entrar hasta que abra un correo.
        /// </summary>
        public async Task<Result> UpdateUserAsync(Guid id, string? email, string? password, CancellationToken ct)
        {
            if (!Configured) return NotConfigured();
            if (email == null && password == null) return new Result(true);

            var payload = new Dictionary<string, object>();
            if (email != null)
            {
                payload["email"] = email;
                payload["email_confirm"] = true;
            }
            if (password != null) payload["password"] = password;

            using var req = Request(HttpMethod.Put, $"{_adminUrl}/{id}", JsonSerializer.Serialize(payload));
            return await SendAsync(req, "actualizar el usuario", leerId: false, ct);
        }

        /// <summary>
        /// Borra el usuario de Supabase Auth. Es irreversible: se va la identidad entera, no una
        /// sesión.
        ///
        /// Se usa también para COMPENSAR un alta a medio hacer — creado en auth pero sin fila en
        /// `users` —, así que tiene que poder correr sobre un usuario que quizá ya no está. Un 404
        /// se toma como éxito: el estado final es el que se quería.
        /// </summary>
        public async Task<Result> DeleteUserAsync(Guid id, CancellationToken ct)
        {
            if (!Configured) return NotConfigured();

            using var req = Request(HttpMethod.Delete, $"{_adminUrl}/{id}", body: null);
            return await SendAsync(req, "borrar el usuario", leerId: false, ct, okSiNoExiste: true);
        }

        private Result NotConfigured() => new(false,
            "Falta la service_role key de Supabase (Supabase:ServiceRoleKey), así que la aplicación " +
            "no puede administrar la identidad. Va en user-secrets (local) o en App Settings (Azure), " +
            "nunca en appsettings.json.");

        private HttpRequestMessage Request(HttpMethod method, string url, string? body)
        {
            var req = new HttpRequestMessage(method, url);

            // GoTrue pide las dos: `apikey` identifica al proyecto y el Bearer da el permiso.
            req.Headers.TryAddWithoutValidation("apikey", _serviceRoleKey);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _serviceRoleKey);

            if (body != null)
                req.Content = new StringContent(body, Encoding.UTF8, "application/json");

            return req;
        }

        private async Task<Result> SendAsync(
            HttpRequestMessage req, string accion, bool leerId, CancellationToken ct, bool okSiNoExiste = false)
        {
            try
            {
                var client = _http.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(15);

                using var res = await client.SendAsync(req, ct);
                var texto = await res.Content.ReadAsStringAsync(ct);

                if (okSiNoExiste && res.StatusCode == System.Net.HttpStatusCode.NotFound)
                    return new Result(true);

                if (!res.IsSuccessStatusCode)
                {
                    // El cuerpo del error de GoTrue trae el motivo real ("email already exists",
                    // "password should be at least 6 characters"), que es justo lo que el admin
                    // necesita leer. Se loguea entero y se devuelve el mensaje, nunca la clave.
                    _logger.LogWarning("Supabase Auth rechazó {Accion}: {Status} {Cuerpo}",
                        accion, (int)res.StatusCode, texto);

                    return new Result(false, MensajeDeError(texto) ?? $"Supabase rechazó {accion}.");
                }

                if (!leerId) return new Result(true);

                using var doc = JsonDocument.Parse(texto);
                if (doc.RootElement.TryGetProperty("id", out var idProp)
                    && Guid.TryParse(idProp.GetString(), out var id))
                    return new Result(true, UserId: id);

                _logger.LogError("Supabase creó el usuario pero la respuesta no trae un id: {Cuerpo}", texto);
                return new Result(false, "Supabase respondió sin el id del usuario creado.");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "No se pudo {Accion} en Supabase Auth.", accion);
                return new Result(false, $"No se pudo contactar a Supabase Auth para {accion}.");
            }
        }

        /// <summary>
        /// El motivo que manda GoTrue, que viene en `msg` o en `error_description` según el caso.
        /// </summary>
        private static string? MensajeDeError(string cuerpo)
        {
            try
            {
                using var doc = JsonDocument.Parse(cuerpo);
                foreach (var campo in new[] { "msg", "message", "error_description", "error" })
                    if (doc.RootElement.TryGetProperty(campo, out var v) && v.ValueKind == JsonValueKind.String)
                        return v.GetString();
            }
            catch { /* no siempre es JSON */ }

            return null;
        }
    }
}
