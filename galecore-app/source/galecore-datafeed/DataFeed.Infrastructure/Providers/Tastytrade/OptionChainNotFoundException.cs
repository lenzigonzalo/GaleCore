using System;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    /// <summary>
    /// El símbolo existe, pero no tiene cadena de opciones que se pueda analizar: o no lista
    /// opciones en absoluto, o las que lista no sirven (todas vencidas, o ninguna dentro de la
    /// ventana de DTE pedida).
    ///
    /// NO ES UN ERROR DEL SERVIDOR, por la misma razón que
    /// <see cref="BrokerAccountNotLinkedException"/>: con el buscador de símbolos el operador puede
    /// elegir cualquier cosa que Tastytrade conozca —un ADR ilíquido, un índice, un ticker sin
    /// opciones listadas— y que ese símbolo no se pueda analizar es una respuesta legítima, no una
    /// caída. Sin su propio tipo terminaba en 500 y la pantalla mostraba el error crudo, que no le
    /// dice a nadie que el problema es el símbolo que eligió.
    ///
    /// <see cref="DataFeed.Controllers.DataFeedControllerBase"/> la mapea a 409 con
    /// <see cref="Code"/>, que es contra lo que el front decide el mensaje.
    /// </summary>
    public sealed class OptionChainNotFoundException : Exception
    {
        /// <summary>Lo que el front matchea. Estable: cambiarlo rompe el mensaje del tablero.</summary>
        public const string Code = "option_chain_not_found";

        /// <summary>El símbolo que se pidió analizar, para que el front lo nombre en el mensaje.</summary>
        public string Symbol { get; }

        public OptionChainNotFoundException(string symbol, string reason)
            : base(reason)
        {
            Symbol = symbol;
        }
    }
}
