using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Canonicalización RFC 8785 (JCS) + SHA-256 para StrategySpec (P0 §4.4).
    /// Dos specs con contenido idéntico producen hashes idénticos independientemente del formateo.
    /// El campo content_hash se excluye del cálculo (el hash no puede incluirse a sí mismo).
    /// </summary>
    public static class StrategySpecHasher
    {
        /// <summary>
        /// Calcula el content_hash de un StrategySpec serializado como JSON.
        /// 1. Parsea el JSON a un JsonNode
        /// 2. Remueve content_hash (no puede incluirse a sí mismo)
        /// 3. Canonicaliza con JCS (RFC 8785): claves ordenadas, sin whitespace
        /// 4. SHA-256 sobre los bytes UTF-8
        /// </summary>
        public static string ComputeHash(string specJson)
        {
            var node = JsonNode.Parse(specJson)
                ?? throw new ArgumentException("Invalid JSON");

            // Remover content_hash antes de hashear
            if (node is JsonObject obj)
                obj.Remove("content_hash");

            var canonical = Canonicalize(node);
            var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(canonical));
            return "sha256:" + Convert.ToHexString(bytes).ToLowerInvariant();
        }

        /// <summary>
        /// RFC 8785 JCS: serialización canónica.
        /// - Objetos: claves ordenadas lexicográficamente (UTF-16 code units)
        /// - Sin whitespace
        /// - Números en formato JSON canónico (System.Text.Json lo hace por defecto)
        /// </summary>
        public static string Canonicalize(JsonNode node)
        {
            using var stream = new MemoryStream();
            using var writer = new Utf8JsonWriter(stream, new JsonWriterOptions
            {
                Indented = false,
                // System.Text.Json escapes por defecto; JCS requiere minimal escaping.
                // UnsafeRelaxedJsonEscaping es lo más cercano al spec.
                Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
            });

            WriteCanonical(writer, node);
            writer.Flush();

            return Encoding.UTF8.GetString(stream.ToArray());
        }

        private static void WriteCanonical(Utf8JsonWriter writer, JsonNode? node)
        {
            if (node is null)
            {
                writer.WriteNullValue();
                return;
            }

            switch (node)
            {
                case JsonObject obj:
                    writer.WriteStartObject();
                    // JCS: claves ordenadas lexicográficamente por UTF-16 code units
                    foreach (var kvp in obj.OrderBy(x => x.Key, StringComparer.Ordinal))
                    {
                        writer.WritePropertyName(kvp.Key);
                        WriteCanonical(writer, kvp.Value);
                    }
                    writer.WriteEndObject();
                    break;

                case JsonArray arr:
                    writer.WriteStartArray();
                    foreach (var item in arr)
                        WriteCanonical(writer, item);
                    writer.WriteEndArray();
                    break;

                case JsonValue val:
                    val.WriteTo(writer);
                    break;
            }
        }
    }
}
