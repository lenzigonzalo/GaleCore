using System.Security.Cryptography;
using System.Text;

namespace DataFeed.Infrastructure
{
    public class ApiKeyMiddleware
    {
        private readonly RequestDelegate _next;
        private const string ApiKeyHeaderName = "X-API-KEY";

        public ApiKeyMiddleware(RequestDelegate next)
        {
            _next = next;
        }

        public async Task InvokeAsync(HttpContext context, IConfiguration configuration)
        {
            var path = context.Request.Path.Value ?? string.Empty;

            // /mcp NO está exento (WS-0048): sus herramientas leen datos de mercado y cuenta, así que pide clave o JWT como el resto.
            // /swagger sólo existe en Development (Program.cs); en otros entornos la ruta ni se publica.
            if (path.StartsWith("/swagger") || path.StartsWith("/favicon.ico") || path.StartsWith("/hubs"))
            {
                await _next(context);
                return;
            }

            // El login es la PUERTA: quien todavía no entró no tiene JWT, y exigirle además la API
            // key sería pedirle la credencial que el login vino a reemplazar — el tablero volvería
            // a necesitarla en su bundle, o sea pública, solo para poder mostrar la pantalla de
            // entrada. Que quede sin ninguna de las dos capas es a propósito y por eso es el único
            // endpoint con rate limit (política "login" en Program.cs).
            //
            // Comparación exacta y no StartsWith: con el prefijo, cualquier ruta futura que empiece
            // igual (/App/GaleCore/Auth/Loginentero) heredaría la exención sin que nadie lo note.
            if (string.Equals(path, "/App/GaleCore/Auth/Login", StringComparison.OrdinalIgnoreCase))
            {
                await _next(context);
                return;
            }

            // Un JWT válido ya identifica a una persona, que es MÁS de lo que prueba una clave
            // compartida: la clave dice "alguien que la tiene", el token dice quién. Aceptarlo es lo
            // que permite que el tablero deje de cargar una API key en su bundle.
            //
            // La clave sigue valiendo para lo que no puede loguearse: llamadas de máquina a máquina,
            // pruebas con curl, y el propio tablero hasta que termine de migrar al login.
            if (context.User?.Identity?.IsAuthenticated == true)
            {
                await _next(context);
                return;
            }

            if (!context.Request.Headers.TryGetValue(ApiKeyHeaderName, out var apiKeyHeader))
            {
                context.Response.StatusCode = 401;
                await context.Response.WriteAsync("API Key header is missing");
                return;
            }

            var configuredKey = configuration.GetValue<string>("ApiKey");

            // Tiempo constante (WS-0087): con Equals, cuánto tarda en fallar dice cuántos caracteres del principio acertaron.
            if (string.IsNullOrEmpty(configuredKey) || !CryptographicOperations.FixedTimeEquals(
                    Encoding.UTF8.GetBytes(configuredKey), Encoding.UTF8.GetBytes(apiKeyHeader.ToString().Trim())))
            {
                context.Response.StatusCode = 401;
                await context.Response.WriteAsync("Invalid API Key");
                return;
            }

            await _next(context);
        }
    }
}
