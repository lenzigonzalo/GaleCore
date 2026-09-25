using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Persistencia del runtime SHADOW (GC-0004, I3). La implementación vive en la API (EF Core sobre
    /// PostgreSQL); acá sólo el contrato, para que el store y la recuperación se prueben sin base.
    ///
    /// Las escrituras son sincrónicas y el store las hace ANTES de tocar la memoria: si la base falla,
    /// la excepción sube y en memoria no queda nada que no esté guardado (write-through, AC-02).
    /// Todas son idempotentes por identidad: guardar dos veces lo mismo no duplica filas.
    /// </summary>
    public interface IShadowRuntimeRepository
    {
        /// <summary>Guarda la spec por su content hash, con el JSON exacto del que salió el hash.</summary>
        void SaveSpec(StrategySpec spec, string specJson);
        void SaveDeployment(StrategyDeployment deployment);
        void SaveInstance(StrategyInstance instance);
        /// <summary>Guarda la posición y, si viene, su evento de ciclo de vida en la misma transacción.</summary>
        void SavePosition(ShadowPosition position, OperationalEvent? lifecycleEvent = null);
        void AddEvaluation(EvaluationResult evaluation);
        void AddEvent(OperationalEvent evt);

        /// <summary>
        /// Todo lo necesario para retomar: instancias, posiciones, y las últimas evaluaciones y eventos
        /// de cada instancia (hasta los topes que se pasan; lo más viejo sigue en la base).
        /// </summary>
        ShadowRuntimeSnapshot Load(int maxEvaluationsPerInstance, int maxEventsPerInstance);

        /// <summary>JSON guardado de una spec, o null si esa versión nunca se guardó.</summary>
        string? GetSpecJson(string contentHash);

        /// <summary>Los insumos de las métricas, una entrada por versión de spec desplegada.</summary>
        IReadOnlyList<SpecVersionRecord> LoadMetricsInputs();
    }

    public record ShadowRuntimeSnapshot
    {
        public List<StrategyInstance> Instances { get; init; } = new();
        public List<ShadowPosition> Positions { get; init; } = new();
        /// <summary>De la más vieja a la más nueva, por instancia.</summary>
        public List<EvaluationResult> Evaluations { get; init; } = new();
        /// <summary>De la más vieja a la más nueva, por instancia.</summary>
        public List<OperationalEvent> Events { get; init; } = new();
    }

    /// <summary>Lo que la base sabe de una versión de spec: conteos completos, no la ventana en memoria.</summary>
    public record SpecVersionRecord
    {
        public string ContentHash { get; init; } = "";
        public string SpecName { get; init; } = "";
        public string SpecVersion { get; init; } = "";
        public int Instances { get; init; }
        public int Evaluations { get; init; }
        public int EvaluationsPassed { get; init; }
        public DateTime? FirstEvaluationAt { get; init; }
        public DateTime? LastEvaluationAt { get; init; }
        /// <summary>Cantidad de eventos por tipo (sólo los tipos presentes).</summary>
        public Dictionary<string, int> EventCounts { get; init; } = new();
        public List<ShadowPosition> Positions { get; init; } = new();
    }

    /// <summary>
    /// La base rechazó una segunda instancia RUNNING (índice único parcial): otro proceso desplegó
    /// primero. El invariante "una sola instancia RUNNING" vale aunque haya más de una API.
    /// </summary>
    public class ShadowRuntimeConflictException : Exception
    {
        public ShadowRuntimeConflictException(string message, Exception inner) : base(message, inner) { }
    }

    /// <summary>Resultado de ShadowRuntimeStore.DeployOrGetRunning.</summary>
    public record DeployResult(string Kind, StrategyInstance? Instance)
    {
        public const string KindCreated = "CREATED", KindExisting = "EXISTING", KindConflict = "CONFLICT";
        public static DeployResult Created(StrategyInstance i) => new(KindCreated, i);
        /// <summary>Ya corre esa misma versión: es esa instancia.</summary>
        public static DeployResult Existing(StrategyInstance i) => new(KindExisting, i);
        /// <summary>Corre otra instancia; <see cref="Instance"/> es la que corre (null si la creó otro proceso).</summary>
        public static DeployResult Conflict(StrategyInstance? running) => new(KindConflict, running);
    }

    /// <summary>Resultado de ShadowRuntimeStore.Stop.</summary>
    public record StopResult(string Kind, StrategyInstance? Instance)
    {
        public const string KindStopped = "STOPPED", KindAlreadyStopped = "ALREADY_STOPPED", KindNotFound = "NOT_FOUND";
        public static StopResult Stopped(StrategyInstance i) => new(KindStopped, i);
        /// <summary>No estaba RUNNING: no se tocó nada.</summary>
        public static StopResult AlreadyStopped(StrategyInstance i) => new(KindAlreadyStopped, i);
        public static StopResult NotFound() => new(KindNotFound, null);
    }

    /// <summary>Qué se recuperó al arrancar y qué no se pudo (AC-04).</summary>
    public record ShadowRecoveryReport
    {
        public int Instances { get; init; }
        public int OpenPositions { get; init; }
        public int ClosedPositions { get; init; }
        public int Evaluations { get; init; }
        public int Events { get; init; }
        /// <summary>Versiones de spec que ya no están en archivo y se reconstruyeron del JSON guardado.</summary>
        public List<string> SpecsRebuilt { get; init; } = new();
        /// <summary>Instancias que no pueden seguir porque su versión de spec no se pudo recuperar.</summary>
        public List<string> Problems { get; init; } = new();
    }

    /// <summary>
    /// Arranque durable del runtime: recarga lo guardado en el store, guarda las specs de archivo y, si
    /// una instancia corre una versión que ya no está en archivo, la reconstruye del JSON guardado
    /// verificando el hash. Recién al final conecta el repositorio al store: desde ahí cada cambio se
    /// guarda antes de quedar en memoria.
    ///
    /// Si algo de esto falla, la excepción sube y el store queda sin repositorio: el runtime no puede
    /// desplegar nada (AC-03) y la API sigue sirviendo todo lo demás.
    /// </summary>
    public static class ShadowRuntimeRecovery
    {
        public static ShadowRecoveryReport Recover(
            ShadowRuntimeStore store, IShadowRuntimeRepository repository,
            IReadOnlyDictionary<string, SpecLoadResult> fileSpecs)
        {
            // Las specs de archivo se guardan antes de registrarse en memoria (AC-02): el store no
            // ofrece una spec que no esté en la base.
            var valid = fileSpecs.Where(f => f.Value is { Success: true, Spec: not null, Json: not null }).ToList();
            foreach (var (_, result) in valid) repository.SaveSpec(result.Spec!, result.Json!);
            var fileHashes = valid.Select(f => f.Value.ContentHash).ToHashSet();

            // Todas las lecturas de la base van antes de tocar la memoria: si una falla, el store queda
            // como estaba (sin instancias recuperadas que corran sin persistencia).
            var snapshot = repository.Load(ShadowRuntimeStore.MaxEvaluationsPerInstance, ShadowRuntimeStore.MaxEventsPerInstance);

            var rebuiltSpecs = new List<StrategySpec>();
            var problems = new List<string>();
            foreach (var hash in snapshot.Instances.Select(i => i.VersionHash).Where(h => !string.IsNullOrEmpty(h)).Distinct())
            {
                if (fileHashes.Contains(hash) || store.GetSpecByHash(hash) != null) continue;

                var json = repository.GetSpecJson(hash);
                var loaded = json == null ? null : StrategySpecLoader.LoadFromJson(json);
                if (loaded is { Success: true, Spec: not null } && loaded.ContentHash == hash)
                {
                    rebuiltSpecs.Add(loaded.Spec);
                }
                else
                {
                    var why = json == null ? "no está guardada"
                        : loaded is { Success: true } ? $"el JSON guardado da otro hash ({loaded.ContentHash})"
                        : $"el JSON guardado no es válido: {string.Join("; ", loaded?.Errors ?? new List<string>())}";
                    problems.Add($"spec {hash}: {why}");
                }
            }

            foreach (var (name, result) in valid) store.RegisterSpec(name, result.Spec!);
            store.Hydrate(snapshot);
            foreach (var spec in rebuiltSpecs) store.RegisterSpecVersion(spec);
            store.AttachRepository(repository);
            return new ShadowRecoveryReport
            {
                Instances = snapshot.Instances.Count,
                OpenPositions = snapshot.Positions.Count(p => p.Status == "OPEN"),
                ClosedPositions = snapshot.Positions.Count(p => p.Status == "CLOSED"),
                Evaluations = snapshot.Evaluations.Count,
                Events = snapshot.Events.Count,
                SpecsRebuilt = rebuiltSpecs.Select(s => s.ContentHash!).ToList(),
                Problems = problems,
            };
        }
    }
}
