namespace DataFeed.Api.Controllers.Dtos
{
    /// <summary>
    /// Vincula la cuenta de bróker del usuario autenticado.
    ///
    /// Es un REEMPLAZO COMPLETO de la credencial, no un parche campo por campo: lo que llega es lo
    /// que queda. Importa por <see cref="ClientSecret"/>, que es opcional — mandarlo vacío no
    /// significa "dejá el que estaba" sino "esta credencial es de la aplicación OAuth de la
    /// plataforma". Un PATCH acá dejaría convivir un refresh token nuevo con el client_secret viejo
    /// de otra aplicación, que es la mitad-y-mitad que Tastytrade rechaza.
    /// </summary>
    public class LinkBrokerAccountRequest
    {
        /// <summary>Número de cuenta en Tastytrade (ej. 5WZ50196).</summary>
        public string AccountNumber { get; set; } = "";

        /// <summary>Refresh token OAuth del usuario. Se cifra antes de tocar la base.</summary>
        public string RefreshToken { get; set; } = "";

        /// <summary>
        /// client_secret de la aplicación OAuth del operador, si registró la suya en su perfil de
        /// Tastytrade. Se cifra igual que el refresh token y nunca vuelve a salir por HTTP.
        ///
        /// Vacío o ausente = usar el de la plataforma. Los dos casos son normales: quien tiene su
        /// propia aplicación manda las dos mitades, quien entra por la de GaleCore manda una sola.
        /// </summary>
        public string? ClientSecret { get; set; }
    }
}
