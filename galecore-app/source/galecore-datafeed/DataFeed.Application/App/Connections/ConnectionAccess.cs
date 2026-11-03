namespace DataFeed.Application.App.Connections
{
    public enum WriteAccess { Allowed, Unauthorized, Forbidden }

    /// <summary>Reglas de permiso de las claves (WS-0080), puras para poder probarlas sin la API.</summary>
    public static class ConnectionAccess
    {
        /// <summary>
        /// Lo que muestra la pantalla (mismo criterio que CanManagePlatformAsync): sin base o sin usuario (API key de
        /// máquina) se puede; con usuario, sólo si es admin.
        /// </summary>
        public static async Task<bool> CanEditAsync(bool databaseConfigured, Guid? userId, Func<Guid, Task<bool>> isAdmin)
        {
            if (!databaseConfigured) return true;
            if (userId == null) return true;
            return await isAdmin(userId.Value);
        }

        /// <summary>Regla estricta de PUT/DELETE (como administrar usuarios): sin usuario 401, no admin 403.</summary>
        public static async Task<WriteAccess> CheckWriteAsync(Guid? userId, Func<Guid, Task<bool>> isAdmin)
        {
            if (userId == null) return WriteAccess.Unauthorized;
            return await isAdmin(userId.Value) ? WriteAccess.Allowed : WriteAccess.Forbidden;
        }
    }
}
