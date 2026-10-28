using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace DataFeed.Infrastructure.Providers.Tastytrade.Models
{
    /// <summary>
    /// Respuesta de GET /symbols/search/{symbol} de Tastytrade: los instrumentos cuyo símbolo o
    /// descripción matchean el texto buscado.
    ///
    /// **Los atributos son de System.Text.Json, no de Newtonsoft.** El provider deserializa con
    /// JsonSerializer, así que un [JsonProperty] de Newtonsoft acá sería decorativo: los campos
    /// kebab-case ("instrument-type") llegarían en null sin que nada falle y sin que nadie se
    /// entere. Le pasa hoy a ByTypeModel, donde esa propiedad no la lee ninguna pantalla.
    /// </summary>
    public class SymbolSearchModel
    {
        [JsonPropertyName("data")]
        public SymbolSearchData? Data { get; set; }
    }

    public class SymbolSearchData
    {
        [JsonPropertyName("items")]
        public List<SymbolSearchItem>? Items { get; set; }
    }

    public class SymbolSearchItem
    {
        [JsonPropertyName("symbol")]
        public string? Symbol { get; set; }

        [JsonPropertyName("description")]
        public string? Description { get; set; }

        /// <summary>
        /// "Equity", "Equity Option", "Future", "Cryptocurrency", "Index"… Es el campo con el que
        /// quien busca acota el resultado a lo que puede analizar. Tastytrade no lo manda siempre:
        /// si viene null, el filtro por tipo lo deja pasar en vez de esconderlo.
        /// </summary>
        [JsonPropertyName("instrument-type")]
        public string? InstrumentType { get; set; }

        [JsonPropertyName("listed-market")]
        public string? ListedMarket { get; set; }
    }
}
