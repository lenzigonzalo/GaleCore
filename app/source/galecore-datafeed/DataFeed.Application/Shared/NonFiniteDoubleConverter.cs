using System.Text.Json;
using System.Text.Json.Serialization;

namespace DataFeed.Application.Shared
{
    /// <summary>
    /// Escribe <c>NaN</c> e <c>Infinity</c> como <c>null</c> en vez de romper la serialización.
    ///
    /// Por qué existe: dxFeed manda <c>NaN</c> en los campos que no aplican al instrumento — un índice
    /// como VIX o VIX9D no tiene Size, DayVolume ni DayTurnover. El DTO los declara <c>double</c> no
    /// nullable y Newtonsoft (que es quien deserializa el FEED_DATA) acepta <c>NaN</c> sin chistar, así
    /// que el valor entra al objeto. Después System.Text.Json se niega a escribirlo, con razón: NaN e
    /// Infinity NO son JSON válido. Resultado: los tools MCP de market data fallaban para CUALQUIER
    /// símbolo con datos reales, mientras el mismo dato viajaba al tablero por Newtonsoft — que sí lo
    /// serializa, como el string "NaN".
    ///
    /// O sea: el MCP no estaba roto, era lo único que detectaba el problema. El resto del sistema lo
    /// tragaba en silencio.
    ///
    /// Se elige <c>null</c> y no el string "NaN": null significa "este campo no aplica", que es
    /// exactamente lo que dxFeed quiere decir, y cualquier cliente JSON lo entiende sin convenciones
    /// especiales. Un "NaN" string obligaría a cada consumidor a saber que a veces el número no es un
    /// número.
    ///
    /// Esto es un saneo EN EL BORDE, no el arreglo de fondo. Lo correcto sería que esos campos fueran
    /// <c>double?</c> y que el NaN se mapeara a null al deserializar, lo que además sacaría el "NaN"
    /// string del contrato REST. Eso toca el DTO que usa el broadcast del hub — el camino de precios en
    /// vivo — y se dejó para poder verificarlo con mercado abierto.
    ///
    /// System.Text.Json aplica un converter de <c>double</c> también a <c>double?</c>: para el nullable
    /// desenvuelve y delega, así que registrar este alcanza para los dos.
    /// </summary>
    public sealed class NonFiniteDoubleConverter : JsonConverter<double>
    {
        public override double Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
            // Vuelta simétrica: lo que se escribió como null era un no-finito.
            => reader.TokenType == JsonTokenType.Null ? double.NaN : reader.GetDouble();

        public override void Write(Utf8JsonWriter writer, double value, JsonSerializerOptions options)
        {
            if (double.IsFinite(value)) writer.WriteNumberValue(value);
            else writer.WriteNullValue();
        }
    }
}
