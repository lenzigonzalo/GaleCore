using System;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    /// <summary>
    /// El usuario autenticado pidió datos de SU cuenta y todavía no vinculó ninguna.
    ///
    /// NO ES UN ERROR DEL SERVIDOR: es el estado normal de un operador recién dado de alta, y por
    /// eso tiene su propio tipo. Salía como un <see cref="Exception"/> pelado que terminaba en 500,
    /// y el tablero no tenía con qué distinguirlo de una caída: mostraba "Request failed with status
    /// code 500" en la barra lateral, que no le dice a nadie que le falta vincular su cuenta.
    ///
    /// <see cref="DataFeed.Controllers.DataFeedControllerBase"/> la mapea a 409 con
    /// <see cref="Code"/>, que es contra lo que el front decide el mensaje.
    /// </summary>
    public sealed class BrokerAccountNotLinkedException : Exception
    {
        /// <summary>Lo que el front matchea. Estable: cambiarlo rompe el mensaje del tablero.</summary>
        public const string Code = "broker_account_not_linked";

        public BrokerAccountNotLinkedException()
            : base("El usuario autenticado no tiene una cuenta de bróker vinculada.")
        {
        }
    }
}
