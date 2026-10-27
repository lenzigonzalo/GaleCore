using System.Text.Json.Nodes;
using DataFeed.Application.App.Shared;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Switch ON/OFF de los servicios de PLATAFORMA: los procesos que corren solos y no son de
    /// ninguna estrategia (hoy <see cref="SkewSnapshotService"/>).
    ///
    /// Misma regla que las estrategias —todo lo que corra solo se tiene que poder cortar en el acto
    /// desde el front, sin reiniciar la API— con dos diferencias que salen de qué son:
    ///
    ///   * NO tienen nivel de usuario. Una estrategia trabaja para alguien; estos no: el flow va a
    ///     quien se haya suscrito y el skew escribe un archivo compartido. Que un operador lo apague
    ///     "para él" no significaría nada, así que son solo dos niveles (reglas y plataforma) y
    ///     tocarlos es cosa de admin.
    ///   * Comparten UN archivo de estado en la raíz de Files/, no una carpeta por servicio: la
    ///     convención Files/&lt;Prefijo&gt;/ es de estrategias, y en la raíz es donde ya vive lo que no
    ///     es de ninguna (galecore_rules_core.json, pop_calibration.json, skew25_history.json).
    ///
    /// El nivel de reglas es `services[].enabled` de galecore_rules_core.json, que es la config de la
    /// aplicación: un servicio que no figura ahí no existe para este switch, y su id se rechaza en
    /// vez de crear una clave suelta en el archivo de estado.
    /// </summary>
    public class PlatformServiceSwitch
    {
        private readonly IWebHostEnvironment _env;
        private readonly ILogger<PlatformServiceSwitch> _logger;
        private static readonly object _fileLock = new();

        // El sufijo _switch_state.json no es cosmético: es lo que hace que el .gitignore lo cubra
        // con su glob (Files/**/*_switch_state.json), que existe justamente para que "la próxima que
        // sume switch quede cubierta sola". Versionarlo haría que un deploy pise la decisión del
        // operador.
        private const string StateFile = "platform_services_switch_state.json";
        private const string ConfigFile = "galecore_rules_core.json";

        public PlatformServiceSwitch(IWebHostEnvironment env, ILogger<PlatformServiceSwitch> logger)
        {
            _env = env;
            _logger = logger;
        }

        private string StatePath => Path.Combine(_env.ContentRootPath, "Files", StateFile);
        private string ConfigPath => Path.Combine(_env.ContentRootPath, "Files", ConfigFile);

        /// <summary>¿Este id está declarado en services[] de la config de la aplicación?</summary>
        public bool IsDeclared(string serviceId) => ReadRulesEnabled(serviceId).HasValue;

        /// <summary>
        /// Estado efectivo del servicio y qué nivel lo decidió ("platform" o "rules"). Un id que no
        /// está declarado devuelve null: no es un servicio de esta plataforma.
        /// </summary>
        public (bool Enabled, string Source)? Resolve(string serviceId)
        {
            var rules = ReadRulesEnabled(serviceId);
            if (rules == null) return null;

            return StrategyEnablement.Resolve(rules.Value, ReadOverride(serviceId));
        }

        /// <summary>
        /// Lo que el proceso pregunta en cada tick. Un id no declarado se considera prendido: el
        /// servicio existe en el código y quedarse callado porque falta una entrada en un JSON sería
        /// apagarlo por accidente.
        /// </summary>
        public bool IsEnabled(string serviceId) => Resolve(serviceId)?.Enabled ?? true;

        /// <summary>Override del operador, o null si nunca se tocó el switch de este servicio.</summary>
        public bool? ReadOverride(string serviceId)
        {
            lock (_fileLock)
            {
                try
                {
                    if (!File.Exists(StatePath)) return null;
                    var root = JsonNode.Parse(File.ReadAllText(StatePath))?.AsObject();
                    return (bool?)root?[serviceId]?["enabled"];
                }
                catch
                {
                    // Archivo corrupto: se ignora el override en vez de dejar los servicios
                    // inservibles. Mismo criterio que los switches de estrategia.
                    return null;
                }
            }
        }

        /// <summary>Lo que declara services[] de la config, o null si el id no está declarado.</summary>
        public bool? ReadRulesEnabled(string serviceId)
        {
            try
            {
                var root = JsonNode.Parse(File.ReadAllText(ConfigPath))?.AsObject();
                var services = root?["services"]?.AsArray();
                if (services == null) return null;

                foreach (var s in services)
                {
                    if ((string?)s?["id"] == serviceId)
                        return (bool?)s?["enabled"] ?? true;
                }
                return null;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "No se pudo leer services[] de {File}.", ConfigFile);
                return null;
            }
        }

        public void Set(string serviceId, bool enabled)
        {
            lock (_fileLock)
            {
                JsonObject root;
                try
                {
                    root = File.Exists(StatePath)
                        ? JsonNode.Parse(File.ReadAllText(StatePath))?.AsObject() ?? new JsonObject()
                        : new JsonObject();
                }
                catch { root = new JsonObject(); }

                root[serviceId] = new JsonObject
                {
                    ["enabled"] = enabled,
                    ["updatedAt"] = DateTime.UtcNow.ToString("o"),
                };

                Directory.CreateDirectory(Path.GetDirectoryName(StatePath)!);
                File.WriteAllText(StatePath,
                    root.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
            }

            _logger.LogInformation("Servicio de plataforma {ServiceId} → {State}", serviceId, enabled ? "ON" : "OFF");
        }
    }
}
