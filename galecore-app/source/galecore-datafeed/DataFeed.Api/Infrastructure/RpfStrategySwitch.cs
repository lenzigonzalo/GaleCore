using System.Text.Json.Nodes;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Switch de la estrategia RPF (regla "switch por estrategia" de CLAUDE.md). Permite al operador
    /// cortar TODA la actividad de la estrategia en el acto desde el front, sin reiniciar la API.
    ///
    /// Se llamaba RpfWorkerSwitch hasta 2026-08-10. El nombre "workers" describía la implementación
    /// (había un BackgroundService) y no lo que el operador hace con él: apagar la estrategia entera —
    /// loop, sockets, refresh y tablero.
    ///
    /// El estado vive en Files/Rpf/rpf_switch_state.json, NO en galecore_rules_rpf.json: el JSON de
    /// reglas es fuente de verdad y se edita deliberadamente, no en runtime. El archivo de estado
    /// es un override sobre lo que el JSON declara en state_machine.enabled.
    ///
    /// Persiste a disco a propósito: un kill switch que vuelve solo a ON después de un restart o un
    /// crash es un agujero de seguridad. Si el archivo no existe, manda el JSON de reglas.
    /// </summary>
    public class RpfStrategySwitch
    {
        private readonly IWebHostEnvironment _env;
        private readonly ILogger<RpfStrategySwitch> _logger;
        private static readonly object _fileLock = new();

        // Archivos propios de RPF bajo Files/Rpf/ (regla "archivos por estrategia" de CLAUDE.md).
        private const string StateFile = "Rpf/rpf_switch_state.json";

        // Nombre anterior al renombre de 2026-08-10. Se lee como fallback porque el archivo está
        // gitignoreado y vive solo en la máquina del operador: sin esto, el renombre dejaría el
        // override huérfano, ReadOverride devolvería null y mandaría state_machine.enabled del JSON
        // de reglas — que es true. Una estrategia apagada A PROPÓSITO habría vuelto sola a ON, que es
        // justamente el agujero que este archivo existe para evitar.
        // Se puede borrar cuando no queden entornos con el nombre viejo.
        private const string LegacyStateFile = "Rpf/rpf_workers_state.json";

        public RpfStrategySwitch(IWebHostEnvironment env, ILogger<RpfStrategySwitch> logger)
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
                        "RPF: override leído del archivo de estado con nombre viejo ({Legacy}). Se migra al tocar el switch.",
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
                // Archivo corrupto: se ignora el override en vez de tumbar el loop.
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
            _logger.LogInformation("RPF switch → {State}", enabled ? "ON" : "OFF");
        }
    }
}
