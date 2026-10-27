using System.Text.Json.Nodes;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Switch de la estrategia GEX (regla "switch por estrategia" de CLAUDE.md).
    ///
    /// GEX no corre un BackgroundService: lo que apaga este switch es el barrido de la cadena.
    /// En OFF, /App/Gex/Analysis no toca DXLink ni siquiera a pedido — devuelve lo último que
    /// quedó en cache, marcado como congelado. Es un kill switch para que la estrategia deje de
    /// competir por el feed con RPF o con Main.
    ///
    /// Se llamaba GexWorkerSwitch hasta 2026-08-10. El nombre "workers" describía una implementación
    /// que en GEX ni siquiera existe (no hay BackgroundService), y no lo que el operador hace con él:
    /// apagar la estrategia entera.
    ///
    /// El estado vive en Files/Gex/gex_switch_state.json, NO en galecore_rules_gex.json: el JSON de
    /// reglas es fuente de verdad y se edita deliberadamente, no en runtime. El archivo de estado
    /// es un override sobre lo que el JSON declara en gex.enabled.
    ///
    /// Persiste a disco a propósito: un kill switch que vuelve solo a ON después de un restart o un
    /// crash es un agujero de seguridad. Si el archivo no existe, manda el JSON de reglas.
    /// </summary>
    public class GexStrategySwitch
    {
        private readonly IWebHostEnvironment _env;
        private readonly ILogger<GexStrategySwitch> _logger;
        private static readonly object _fileLock = new();

        // Archivo propio de GEX bajo Files/Gex/ (regla "archivos por estrategia" de CLAUDE.md).
        private const string StateFile = "Gex/gex_switch_state.json";

        // Nombre anterior al renombre de 2026-08-10. Se lee como fallback porque el archivo está
        // gitignoreado y vive solo en la máquina del operador: sin esto el renombre dejaría el
        // override huérfano y una estrategia apagada a propósito volvería sola a ON.
        // Se puede borrar cuando no queden entornos con el nombre viejo.
        private const string LegacyStateFile = "Gex/gex_workers_state.json";

        public GexStrategySwitch(IWebHostEnvironment env, ILogger<GexStrategySwitch> logger)
        {
            _env = env;
            _logger = logger;
        }

        private string Path_ => Path.Combine(_env.ContentRootPath, "Files", StateFile);
        private string LegacyPath_ => Path.Combine(_env.ContentRootPath, "Files", LegacyStateFile);

        /// <summary>Override del operador, o null si nunca se tocó el switch (manda el JSON de reglas).</summary>
        public bool? ReadOverride()
        {
            lock (_fileLock)
            {
                var fromNew = TryRead(Path_);
                if (fromNew.HasValue) return fromNew;

                var fromLegacy = TryRead(LegacyPath_);
                if (fromLegacy.HasValue)
                    _logger.LogInformation(
                        "GEX: override leído del archivo de estado con nombre viejo ({Legacy}). Se migra al tocar el switch.",
                        LegacyStateFile);

                return fromLegacy;
            }
        }

        private static bool? TryRead(string path)
        {
            try
            {
                if (!File.Exists(path)) return null;
                var root = JsonNode.Parse(File.ReadAllText(path))?.AsObject();
                return (bool?)root?["enabled"];
            }
            catch
            {
                // Archivo corrupto: se ignora el override en vez de dejar la estrategia inservible.
                return null;
            }
        }

        public void Set(bool enabled)
        {
            lock (_fileLock)
            {
                var root = new JsonObject
                {
                    ["enabled"] = enabled,
                    ["updatedAt"] = DateTime.UtcNow.ToString("o"),
                };
                Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path_)!);
                File.WriteAllText(Path_, root.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));

                // Se borra el viejo para que no quede una segunda fuente de verdad contradiciendo.
                try { if (File.Exists(LegacyPath_)) File.Delete(LegacyPath_); } catch { }
            }
            _logger.LogInformation("GEX switch → {State}", enabled ? "ON" : "OFF");
        }
    }
}
