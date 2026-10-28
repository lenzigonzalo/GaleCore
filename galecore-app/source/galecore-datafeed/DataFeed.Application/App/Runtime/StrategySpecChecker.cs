using DataFeed.Application.App.Shared;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    public record SpecCatalogEventType(string Type, string Description, bool PerSymbol, string Precision, string Source);

    public record SpecCatalog(
        IReadOnlyList<SpecCatalogEventType> EventTypes, IReadOnlyList<string> MetricPatterns, IReadOnlyList<string> Structures,
        IReadOnlyList<string> LegSelectors, IReadOnlyList<string> FillModels);

    public record SpecCheckResult(
        bool Valid, IReadOnlyList<string> Errors, string? ContentHash,
        IReadOnlyList<string> ExecutedPaths, IReadOnlyList<string> InertPaths, SpecCatalog Catalog);

    /// <summary>
    /// POST /App/Runtime/Specs/Check (WS-0062 inc.8a): lo que el deploy diría de una spec, sin guardar nada. Mismos errores (cargador + validador),
    /// mismo hash, y qué partes de ESTA spec ejecuta el runtime según <see cref="StrategySpecExecutionMap"/>.
    /// </summary>
    public static class StrategySpecChecker
    {
        public static readonly JsonSerializerOptions Json = new()
        {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        };

        public static SpecCatalog Catalog() => new(
            EventCatalog.Builtin.Select(t => new SpecCatalogEventType(t.Type, t.Description, t.PerSymbol, t.Precision.ToString().ToLowerInvariant(), t.Source)).ToList(),
            MetricResolver.Patterns, RuntimeStructures.Supported, RuntimeStructures.CustomLegMethods,
            new[] { ExecutionTerms.Natural, ExecutionTerms.Mid, ExecutionTerms.MidSlippage });

        public static SpecCheckResult Check(string specJson)
        {
            var load = StrategySpecLoader.LoadFromJson(specJson);
            if (!load.Success)
                return new SpecCheckResult(false, load.Errors, null, Array.Empty<string>(), Array.Empty<string>(), Catalog());

            var executed = new SortedSet<string>(StringComparer.Ordinal);
            var inert = new SortedSet<string>(StringComparer.Ordinal);
            foreach (var path in PresentPaths(JsonNode.Parse(specJson)))
            {
                var found = StrategySpecExecutionMap.Find(StrategySpecExecutionMap.Normalize(path));
                if (found is not var (key, kind)) continue;
                (kind == StrategySpecExecutionMap.Kind.Executed ? executed : inert).Add(ConcretePrefix(path, key));
            }
            return new SpecCheckResult(true, load.Errors, load.ContentHash, executed.ToList(), inert.ToList(), Catalog());
        }

        /// <summary>Rutas (con índices reales) de cada valor no nulo; las listas y objetos vacíos no cuentan como presentes.</summary>
        private static IEnumerable<string> PresentPaths(JsonNode? node, string prefix = "")
        {
            switch (node)
            {
                case JsonObject obj:
                    foreach (var (k, v) in obj)
                        foreach (var p in PresentPaths(v, prefix.Length == 0 ? k : prefix + "." + k)) yield return p;
                    break;
                case JsonArray arr when arr.Any(x => x is JsonObject or JsonArray):
                    for (int i = 0; i < arr.Count; i++)
                        foreach (var p in PresentPaths(arr[i], $"{prefix}[{i}]")) yield return p;
                    break;
                case JsonArray arr:
                    if (arr.Count > 0) yield return prefix;
                    break;
                case null:
                    break;
                default:
                    yield return prefix;
                    break;
            }
        }

        /// <summary>El prefijo más corto de la ruta concreta cuya forma normalizada es la clave del mapa.</summary>
        private static string ConcretePrefix(string path, string key)
        {
            for (int i = 1; i <= path.Length; i++)
                if ((i == path.Length || path[i] is '.' or '[')
                    && StrategySpecExecutionMap.Normalize(path[..i]).Equals(key, StringComparison.OrdinalIgnoreCase))
                    return path[..i];
            return path;
        }
    }
}
