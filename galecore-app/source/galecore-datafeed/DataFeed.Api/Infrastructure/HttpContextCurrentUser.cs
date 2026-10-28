using System.Security.Claims;
using DataFeed.Infrastructure.Providers.Tastytrade;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Lee el usuario del JWT validado del request en curso.
    ///
    /// Se apoya en que MapInboundClaims está apagado, así que el claim se llama `sub` como lo emite
    /// Supabase y no la URI de WS-Federation. Igual se busca el nombre mapeado como respaldo, para
    /// que un cambio de esa opción no rompa la autorización en silencio.
    ///
    /// Fuera de un request (procesos de fondo) el accessor devuelve null y esta clase también:
    /// es el caso normal, no una falla.
    /// </summary>
    public class HttpContextCurrentUser : ICurrentUser
    {
        private readonly IHttpContextAccessor _accessor;

        public HttpContextCurrentUser(IHttpContextAccessor accessor) => _accessor = accessor;

        private ClaimsPrincipal? Principal => _accessor.HttpContext?.User;

        public Guid? UserId
        {
            get
            {
                var raw = Principal?.FindFirst("sub")?.Value
                       ?? Principal?.FindFirst(ClaimTypes.NameIdentifier)?.Value;

                return Guid.TryParse(raw, out var id) ? id : null;
            }
        }

        public string? Email
            => Principal?.FindFirst("email")?.Value
            ?? Principal?.FindFirst(ClaimTypes.Email)?.Value;
    }
}
