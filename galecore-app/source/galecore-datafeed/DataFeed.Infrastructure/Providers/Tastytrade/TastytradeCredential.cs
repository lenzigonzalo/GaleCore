using System.Threading;
using System.Threading.Tasks;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    /// <summary>
    /// Credencial con la que se le habla a Tastytrade.
    ///
    /// SON DOS MITADES DE UNA MISMA COSA: el refresh token y el client_secret de la aplicación OAuth
    /// que lo emitió. Tienen que ser de la misma aplicación o el canje falla, así que viajan juntas.
    /// Hasta 2026-09-01 el client_secret no estaba acá —había uno solo para toda la plataforma, en
    /// configuración— y separarlas era gratis porque no había dos aplicaciones posibles.
    /// </summary>
    /// <param name="Id">
    /// Clave de cache de los access token. Es el id de la fila de `accounts`, o "config" cuando la
    /// credencial sale de appsettings. Dos credenciales distintas NO pueden compartir cache: el
    /// access token de una no sirve para la cuenta de la otra.
    /// </param>
    /// <param name="Source">"db" o "config" — para que el log diga de dónde salió.</param>
    /// <param name="IsSystem">
    /// La credencial de la plataforma (la fila `is_system`, o la de appsettings), contra la de un
    /// usuario. NO es lo mismo que <paramref name="Source"/>: las dos pueden salir de la base.
    ///
    /// Lo que decide es DE QUIÉN es el problema cuando Tastytrade la rechaza. La de un usuario la
    /// arregla su dueño y sale como 409 `broker_credential_invalid`; la de sistema no tiene dueño a
    /// quien pedirle nada —y encima viaja en endpoints de MERCADO, donde el que pregunta puede no
    /// tener ni cuenta vinculada— así que sigue siendo un 500. Sin esta marca, un rechazo de la
    /// credencial de sistema le pediría a cualquiera que estuviera mirando precios que re-vinculara
    /// una cuenta que no tiene nada que ver.
    /// </param>
    /// <param name="ClientSecret">
    /// El client_secret de la aplicación OAuth que emitió este refresh token, o **null para usar el
    /// de configuración** — que es la aplicación de la plataforma.
    ///
    /// Null no es "no hay": es "la de siempre". Por eso el que trae su propia aplicación lo llena y
    /// el que usa la de GaleCore no, sin que ninguno de los dos caminos sea el excepcional.
    /// </param>
    public sealed record TastytradeCredential(
        string Id,
        string RefreshToken,
        string? AccountNumber,
        string Source,
        bool IsSystem = false,
        string? ClientSecret = null);

    /// <summary>
    /// De dónde salen las credenciales. Implementa la división del doc de arquitectura §5.4:
    /// los datos de MERCADO usan una credencial de sistema (SPY es SPY para todos) y los de CUENTA
    /// la del usuario que pregunta (las posiciones no son de todos).
    /// </summary>
    public interface ITastytradeCredentialStore
    {
        /// <summary>
        /// Credencial para datos de mercado. Sale de la cuenta marcada `is_system`; si no hay base
        /// configurada o no hay ninguna marcada, cae a appsettings — que es exactamente lo que la
        /// plataforma hacía antes de existir la base.
        ///
        /// La usan los procesos de fondo (el loop de RPF, el barrido de la cadena, los snapshots de
        /// skew, el flow): corren en un timer, sin request y sin usuario logueado, así que no tienen
        /// de quién tomar una credencial.
        /// </summary>
        Task<TastytradeCredential> GetSystemAsync(CancellationToken ct = default);

        /// <summary>
        /// Credencial de un usuario para pedir SUS datos de cuenta. null si el usuario no tiene
        /// cuenta de bróker vinculada — el llamador decide si eso es 404 o "todavía no vinculaste".
        /// </summary>
        Task<TastytradeCredential?> GetForUserAsync(Guid userId, CancellationToken ct = default);
    }

    /// <summary>
    /// Cifra y descifra los refresh token antes de que toquen la base. Son credenciales de cuentas
    /// de bróker reales: guardarlas en claro convierte un leak de la base en un leak de dinero ajeno.
    /// </summary>
    public interface ITokenProtector
    {
        string Protect(string plaintext);
        string Unprotect(string ciphertext);
    }
}
