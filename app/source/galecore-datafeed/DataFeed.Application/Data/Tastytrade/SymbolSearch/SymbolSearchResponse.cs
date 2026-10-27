using System.Collections.Generic;

namespace DataFeed.Application.Data.Tastytrade.SymbolSearch
{
    /// <summary>
    /// Resultado de la búsqueda, ya normalizado: `data.items` de Tastytrade aplanado a una lista
    /// con los cuatro campos que se muestran, en camelCase como el resto de la API.
    /// </summary>
    public class SymbolSearchResponse
    {
        /// <summary>El texto que se buscó, normalizado a mayúsculas.</summary>
        public string Query { get; set; } = "";

        public List<SymbolSearchResult> Items { get; set; } = new();

        public int Count => Items.Count;
    }

    public class SymbolSearchResult
    {
        public string Symbol { get; set; } = "";

        /// <summary>Nombre del instrumento ("APPLE INC"). Puede venir vacío.</summary>
        public string? Description { get; set; }

        /// <summary>
        /// "Equity", "Equity Option", "Future", "Cryptocurrency", "Index"…
        ///
        /// **No dice si el símbolo tiene cadena de opciones.** Un Equity puede no listar opciones, y
        /// eso recién se sabe al pedir la cadena — ahí el barrido responde
        /// `option_chain_not_found`. Este campo sirve para sacar de la lista lo que seguro no se
        /// puede analizar (futuros, cripto, contratos sueltos), no para prometer que el resto sí.
        /// </summary>
        public string? InstrumentType { get; set; }

        public string? ListedMarket { get; set; }
    }
}
