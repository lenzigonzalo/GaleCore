namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    /// <summary>
    /// Quién está haciendo el request, si es que hay alguien.
    ///
    /// Es una abstracción y no `IHttpContextAccessor` directo porque los handlers viven en la capa
    /// de Application, que no tiene por qué saber de HTTP — y porque los procesos de fondo (el loop
    /// de RPF, el barrido de la cadena, los snapshots) corren SIN request: para ellos
    /// <see cref="UserId"/> es null, y eso no es un error sino su condición normal.
    ///
    /// Null significa "nadie autenticado", que hoy es el caso del tablero: entra con API key y sin
    /// token. Mientras eso siga así, los datos de cuenta salen por la credencial de sistema, igual
    /// que siempre.
    /// </summary>
    public interface ICurrentUser
    {
        /// <summary>uuid del usuario en Supabase (claim `sub`), o null si el request no está autenticado.</summary>
        Guid? UserId { get; }

        string? Email { get; }
    }
}
