namespace DataFeed.Repositories.Entities
{
    /// <summary>
    /// Cuenta de bróker de un usuario.
    ///
    /// **CADA OPERADOR PUEDE TRAER SU PROPIA APLICACIÓN OAuth** (2026-09-01). Hasta ese día acá no
    /// vivía el client_secret, con este argumento: es de la aplicación registrada y no del usuario,
    /// así que duplicarlo por fila sería esparcir un secreto de aplicación en N lugares. El
    /// argumento era correcto mientras hubiera UNA aplicación para todos; deja de serlo cuando cada
    /// operador registra la suya en su perfil de Tastytrade, porque entonces el par
    /// (refresh token, client_secret) es UNA credencial y separarla en dos lugares garantiza que no
    /// coincidan — que es exactamente el error que Tastytrade contesta como
    /// `invalid_grant / Client secret mismatch`.
    ///
    /// El de configuración no desaparece: es el fallback de la fila que no trae uno propio, y el
    /// que usa la cuenta de sistema.
    /// </summary>
    public class Account
    {
        public Guid Id { get; set; }

        public Guid UserId { get; set; }
        public User? User { get; set; }

        /// <summary>
        /// Hoy siempre "tastytrade". Existe desde el día uno porque el sub-prefijo por cuenta ya
        /// está previsto en la taxonomía de la API para cuando se sume un segundo bróker.
        /// </summary>
        public string Broker { get; set; } = "tastytrade";

        public string AccountNumber { get; set; } = "";

        /// <summary>
        /// Refresh token de OAuth del usuario, CIFRADO. El nombre lleva el sufijo a propósito: es un
        /// token de una cuenta de bróker real y guardarlo en claro convierte un leak de la base en
        /// un leak de dinero ajeno. Quien escriba acá tiene que cifrar; quien lea, descifrar.
        /// </summary>
        public string RefreshTokenEncrypted { get; set; } = "";

        /// <summary>
        /// client_secret de la aplicación OAuth del operador, CIFRADO con la misma clave que el
        /// refresh token. **NULL significa "usar el de configuración"**, que es la aplicación OAuth
        /// de la plataforma.
        ///
        /// Es nullable y no requerido a propósito: las filas que ya existían —y la de sistema, que
        /// es de la app de la plataforma— siguen andando sin que nadie las toque. Quien trae su
        /// propia aplicación llena las dos mitades de su credencial; quien usa la de GaleCore, solo
        /// el refresh token.
        ///
        /// Va cifrado por lo mismo que el token: en claro, un leak de la base entrega las dos
        /// mitades juntas y con eso se emiten access tokens de una cuenta de bróker real.
        /// </summary>
        public string? ClientSecretEncrypted { get; set; }

        /// <summary>
        /// Marca la cuenta que usan los procesos de fondo para pedir DATOS DE MERCADO (el ingestor,
        /// RpfLoopService, SkewSnapshotService). Esos corren en un timer, sin
        /// request y sin usuario logueado, así que necesitan una credencial que no sea de nadie en
        /// particular.
        ///
        /// Es la mitad "mercado compartido" de la división del doc de arquitectura: SPY es SPY para
        /// todos, así que se pide UNA vez con esta cuenta. Los datos de CUENTA (posiciones, balances)
        /// nunca pasan por acá: van siempre con la credencial del usuario que pregunta.
        ///
        /// Un índice único parcial garantiza que haya como máximo una.
        /// </summary>
        public bool IsSystem { get; set; }

        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
    }
}
