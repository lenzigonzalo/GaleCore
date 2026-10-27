using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// De qué claim sale la identidad de una conexión del hub, para poder mandarle un mensaje a UN
    /// usuario (`Clients.User(id)`) en vez de a un grupo.
    ///
    /// Hace falta un provider propio porque el de SignalR busca ClaimTypes.NameIdentifier, y este
    /// proyecto tiene `MapInboundClaims = false` (Program.cs): los claims conservan el nombre que
    /// les puso Supabase, así que el uuid está en `sub` y NameIdentifier no existe. Con el provider
    /// por defecto, `Clients.User(...)` no encontraría a nadie y el mensaje se perdería en silencio
    /// — sin excepción y sin log, que es la peor forma de fallar.
    ///
    /// Lo usa el aviso del switch por usuario: cuando alguien apaga la estrategia PARA ÉL, el resto
    /// de los tableros no tiene que enterarse de nada.
    /// </summary>
    public class SubUserIdProvider : IUserIdProvider
    {
        public string? GetUserId(HubConnectionContext connection)
            => connection.User?.FindFirst("sub")?.Value
            ?? connection.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
    }
}
