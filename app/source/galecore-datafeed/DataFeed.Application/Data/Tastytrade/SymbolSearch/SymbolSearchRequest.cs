using MediatR;

namespace DataFeed.Application.Data.Tastytrade.SymbolSearch
{
    /// <summary>
    /// Request de GET /Data/Tastytrade/Symbols/Search — búsqueda de símbolos por texto.
    /// </summary>
    public class SymbolSearchRequest : IRequest<SymbolSearchResponse>
    {
        /// <summary>Texto a buscar: un símbolo o parte de él ("aap", "SPY").</summary>
        public string Symbol { get; set; } = "";

        /// <summary>
        /// Tipos de instrumento a devolver, separados por coma ("Equity,Index"). Vacío = todos.
        ///
        /// Es un PARÁMETRO, no una política: qué tipos sirven lo decide quien busca, y en el caso de
        /// GEX eso lo declara su JSON de reglas. Este endpoint es de plataforma (Data.Api) y lo
        /// consume cualquiera, así que no puede tener cableado el universo de una estrategia.
        /// </summary>
        public string? InstrumentTypes { get; set; }
    }
}
