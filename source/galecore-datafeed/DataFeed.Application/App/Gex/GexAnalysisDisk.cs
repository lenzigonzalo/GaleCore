using System.Text.Json;

namespace DataFeed.Application.App.Gex
{
    /// <summary>
    /// Último barrido completo de cada símbolo, en disco, para que sobreviva a un reinicio de la API:
    /// el primer pedido devuelve esto al instante en vez de esperar un barrido en frío.
    /// </summary>
    public static class GexAnalysisDisk
    {
        private static readonly JsonSerializerOptions Options = new() { PropertyNameCaseInsensitive = true };

        private static string PathFor(string symbol)
            => Path.Combine(Path.GetTempPath(), "galecore-gex-analysis", symbol + ".json");

        public static void Save(string symbol, GexAnalysisResponse response)
        {
            try
            {
                var path = PathFor(symbol);
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                var tmp = path + ".tmp";
                File.WriteAllText(tmp, JsonSerializer.Serialize(response, Options));
                File.Move(tmp, path, overwrite: true);
            }
            catch
            {
                // Es un acelerador: si no se puede guardar, el cache en memoria sigue andando.
            }
        }

        public static GexAnalysisResponse? Load(string symbol)
        {
            try
            {
                var path = PathFor(symbol);
                return File.Exists(path)
                    ? JsonSerializer.Deserialize<GexAnalysisResponse>(File.ReadAllText(path), Options)
                    : null;
            }
            catch
            {
                return null;
            }
        }
    }
}
