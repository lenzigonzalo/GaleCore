using System;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    /// <summary>
    /// El usuario TIENE una cuenta de bróker vinculada, pero Tastytrade rechaza su refresh token: la
    /// credencial guardada no sirve para pedir nada.
    ///
    /// Es el hermano de <see cref="BrokerAccountNotLinkedException"/> y existe por la misma razón,
    /// un escalón más adelante: aquella cubre "todavía no cargaste nada" y esta cubre "cargaste algo
    /// que no se puede canjear". Sin su propio tipo terminaba en 500 —el <see cref="Exception"/>
    /// genérico que arma el handler— y el tablero mostraba "Request failed with status code 500",
    /// que manda al operador a buscar una caída del servidor cuando el problema está en el token que
    /// él mismo pegó.
    ///
    /// **El caso que la hizo nacer** (2026-09-01): hasta ese día había un solo `client_secret` para
    /// toda la plataforma, en configuración, y un refresh token emitido por OTRA aplicación OAuth
    /// —la que el operador se creó en su propio perfil de Tastytrade— se guardaba y se descifraba
    /// sin problema, pero el canje contestaba `400 invalid_grant / Client secret mismatch`.
    ///
    /// Ese caso puntual dejó de ser un error el mismo día: ahora cada cuenta puede traer el
    /// `client_secret` de SU aplicación (ver <see cref="TastytradeCredential"/>). Lo que sigue
    /// llegando acá es la credencial que de verdad no sirve — revocada, vencida, o con las dos
    /// mitades de aplicaciones distintas—, y por eso el mensaje habla de las dos mitades y no de
    /// una aplicación en particular.
    ///
    /// NO cubre que Tastytrade esté caído: eso sí es una falla del servidor y sigue saliendo 500.
    /// La frontera la decide <see cref="TastytradeOAuth"/> por el status de la respuesta.
    ///
    /// <see cref="DataFeed.Controllers.DataFeedControllerBase"/> la mapea a 409 con
    /// <see cref="Code"/>, que es contra lo que el front decide el mensaje.
    /// </summary>
    public sealed class BrokerCredentialInvalidException : Exception
    {
        /// <summary>Lo que el front matchea. Estable: cambiarlo rompe el mensaje del tablero.</summary>
        public const string Code = "broker_credential_invalid";

        /// <summary>
        /// Lo que contestó Tastytrade (`invalid_grant / Client secret mismatch`, por ejemplo).
        ///
        /// NO viaja en la respuesta HTTP a propósito: al operador no le sirve y es vocabulario del
        /// proveedor. Va al log, que es donde se mira cuando alguien pregunta por qué su cuenta no
        /// trae datos — sin esto, distinguir "token de otra app OAuth" de "token revocado" obliga a
        /// reproducir el canje a mano contra la base.
        /// </summary>
        public string Detail { get; }

        public BrokerCredentialInvalidException(string detail)
            : base("Tastytrade rechaza la credencial de la cuenta de bróker vinculada. Revisá en " +
                   "Mi Cuenta › Cuenta de bróker que el refresh token y el client secret sean de la " +
                   "MISMA aplicación OAuth, y que el token siga vigente.")
        {
            Detail = detail;
        }
    }
}
