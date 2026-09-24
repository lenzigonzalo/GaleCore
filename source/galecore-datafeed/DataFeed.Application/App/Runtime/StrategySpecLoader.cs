using System.Text.Json;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Carga, valida y hashea StrategySpecs desde archivos JSON.
    /// El hash se calcula sobre el JSON original (sin content_hash), no sobre el objeto deserializado,
    /// para garantizar que el hash sea del contenido exacto del archivo.
    /// </summary>
    public class StrategySpecLoader
    {
        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            PropertyNameCaseInsensitive = true,
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
        };

        /// <summary>
        /// Carga un spec desde un archivo JSON. Valida y calcula el content_hash.
        /// </summary>
        public static SpecLoadResult LoadFromFile(string filePath)
        {
            if (!File.Exists(filePath))
                return SpecLoadResult.Fail($"File not found: {filePath}");

            var json = File.ReadAllText(filePath);
            return LoadFromJson(json);
        }

        /// <summary>
        /// Carga un spec desde un string JSON. Valida y calcula el content_hash.
        /// </summary>
        public static SpecLoadResult LoadFromJson(string json)
        {
            StrategySpec spec;
            try
            {
                spec = JsonSerializer.Deserialize<StrategySpec>(json, JsonOptions)
                    ?? throw new JsonException("Deserialized to null");
            }
            catch (JsonException ex)
            {
                return SpecLoadResult.Fail($"JSON parse error: {ex.Message}");
            }

            var validation = StrategySpecValidator.Validate(spec);
            if (!validation.IsValid)
                return SpecLoadResult.Fail(validation.Errors);

            var hash = StrategySpecHasher.ComputeHash(json);
            spec = spec with { ContentHash = hash };

            return SpecLoadResult.Ok(spec, hash);
        }

        /// <summary>
        /// Carga todos los specs de un directorio.
        /// </summary>
        public static Dictionary<string, SpecLoadResult> LoadAll(string directory)
        {
            var results = new Dictionary<string, SpecLoadResult>();
            if (!Directory.Exists(directory)) return results;

            foreach (var file in Directory.GetFiles(directory, "*.json"))
            {
                var name = Path.GetFileNameWithoutExtension(file);
                results[name] = LoadFromFile(file);
            }
            return results;
        }
    }

    public record SpecLoadResult
    {
        public bool Success { get; init; }
        public StrategySpec? Spec { get; init; }
        public string? ContentHash { get; init; }
        public List<string> Errors { get; init; } = new();

        public static SpecLoadResult Ok(StrategySpec spec, string hash) => new()
        {
            Success = true,
            Spec = spec,
            ContentHash = hash
        };

        public static SpecLoadResult Fail(string error) => new()
        {
            Success = false,
            Errors = new List<string> { error }
        };

        public static SpecLoadResult Fail(List<string> errors) => new()
        {
            Success = false,
            Errors = errors
        };
    }
}
