using System.Collections.Concurrent;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Estado vivo del runtime SHADOW — singleton in-memory.
    /// Patrón: ConcurrentDictionary como RpfStateStore (§4.2).
    ///
    /// Guarda: instancias, posiciones, historial de evaluaciones y eventos.
    /// Thread-safe por ConcurrentDictionary; operaciones compuestas con lock por entrada.
    ///
    /// GC-0004 (I3): con un repositorio conectado (ShadowRuntimeRecovery), cada cambio se guarda en
    /// la base ANTES de quedar en memoria; si la base falla, la excepción sube y la memoria no cambia.
    /// Sin repositorio es el store en memoria de GC-0002 (lo usan los tests del motor).
    ///
    /// GC-0002: no hay borrado. Apagar el runtime pausa entradas y conserva todo lo registrado
    /// (decisión del owner, 24/09). El historial en memoria de evaluaciones y eventos se acota por
    /// instancia para no crecer sin límite (lo completo queda en la base);
    /// cuando se llega al tope se descarta lo más viejo, salvo los eventos de ciclo de vida
    /// (instancia creada, posición abierta o cerrada), que no se descartan nunca.
    /// </summary>
    public class ShadowRuntimeStore
    {
        private readonly ConcurrentDictionary<string, StrategyInstance> _instances = new();
        private readonly ConcurrentDictionary<string, ShadowPosition> _positions = new();
        private readonly ConcurrentDictionary<string, List<EvaluationResult>> _evaluationHistory = new();

        /// <summary>
        /// Tope de evaluaciones guardadas por instancia. Sólo se evalúa en sesión (390 minutos), a un
        /// tick por minuto y por símbolo: con un símbolo alcanza para ~7 sesiones.
        /// </summary>
        public const int MaxEvaluationsPerInstance = 3000;
        /// <summary>Tope de eventos guardados por instancia (los de ciclo de vida no cuentan para descartar).</summary>
        public const int MaxEventsPerInstance = 20000;
        private readonly ConcurrentDictionary<string, List<OperationalEvent>> _events = new();
        private readonly ConcurrentDictionary<string, StrategySpec> _specs = new();
        private readonly ConcurrentDictionary<string, StrategySpec> _specsByHash = new();
        private IShadowRuntimeRepository? _repository;

        /// <summary>true si cada cambio se guarda en la base antes de quedar en memoria.</summary>
        public bool IsDurable => _repository != null;

        /// <summary>Conecta la persistencia. Lo hace ShadowRuntimeRecovery después de recargar lo guardado.</summary>
        public void AttachRepository(IShadowRuntimeRepository repository) => _repository = repository;

        /// <summary>
        /// Carga en memoria lo recuperado de la base, sin volver a guardarlo. Las identidades se
        /// conservan, así que recargar dos veces no duplica nada.
        /// </summary>
        public void Hydrate(ShadowRuntimeSnapshot snapshot)
        {
            foreach (var i in snapshot.Instances) _instances[i.InstanceId] = i;
            foreach (var p in snapshot.Positions) _positions[p.PositionId] = p;
            foreach (var group in snapshot.Evaluations.GroupBy(e => e.InstanceId))
            {
                var list = _evaluationHistory.GetOrAdd(group.Key, _ => new List<EvaluationResult>());
                lock (list)
                {
                    var known = list.Select(e => e.EvaluationId).ToHashSet();
                    list.AddRange(group.Where(e => known.Add(e.EvaluationId)));
                    list.Sort((a, b) => a.EvaluatedAt.CompareTo(b.EvaluatedAt));
                    if (list.Count > MaxEvaluationsPerInstance) list.RemoveRange(0, list.Count - MaxEvaluationsPerInstance);
                }
            }
            foreach (var group in snapshot.Events.GroupBy(e => e.InstanceId))
            {
                var list = _events.GetOrAdd(group.Key, _ => new List<OperationalEvent>());
                lock (list)
                {
                    var known = list.Select(e => e.EventId).ToHashSet();
                    list.AddRange(group.Where(e => known.Add(e.EventId)));
                    list.Sort((a, b) => a.Timestamp.CompareTo(b.Timestamp));
                }
            }
        }

        /// <summary>Eventos que no se descartan al llegar al tope: sin ellos no se puede reconstruir qué pasó.</summary>
        public static readonly IReadOnlySet<string> LifecycleEventTypes =
            new HashSet<string> { "INSTANCE_CREATED", "POSITION_OPENED", "POSITION_CLOSED" };

        // ── Specs ──

        public void RegisterSpec(string name, StrategySpec spec)
        {
            _specs[name] = spec;
            if (!string.IsNullOrEmpty(spec.ContentHash)) _specsByHash[spec.ContentHash] = spec;
        }

        /// <summary>
        /// Registra una versión de spec sólo por su hash (una versión vieja reconstruida de la base): la
        /// instancia que la corre la encuentra, pero no reemplaza a la spec vigente de ese nombre.
        /// </summary>
        public void RegisterSpecVersion(StrategySpec spec)
        {
            if (string.IsNullOrEmpty(spec.ContentHash)) throw new ArgumentException("la spec no tiene content hash", nameof(spec));
            _specsByHash[spec.ContentHash] = spec;
        }

        public StrategySpec? GetSpecByHash(string contentHash)
            => _specsByHash.TryGetValue(contentHash, out var s) ? s : null;

        /// <summary>
        /// La spec que ejecuta la instancia: la de su hash (corre exactamente esa versión, AC-04). Una
        /// instancia sin hash —sólo en tests— se resuelve por nombre.
        /// </summary>
        public StrategySpec? SpecFor(StrategyInstance instance)
            => string.IsNullOrEmpty(instance.VersionHash) ? GetSpec(instance.SpecName) : GetSpecByHash(instance.VersionHash);

        public StrategySpec? GetSpec(string name)
            => _specs.TryGetValue(name, out var s) ? s : null;

        public IReadOnlyCollection<StrategySpec> AllSpecs()
            => _specs.Values.ToList().AsReadOnly();

        // ── Instances ──

        public void SetInstance(string instanceId, StrategyInstance instance)
        {
            _repository?.SaveInstance(instance);
            _instances[instanceId] = instance;
        }

        private readonly object _deployGate = new();

        /// <summary>
        /// Despliega, con una sola instancia RUNNING a la vez (el loop de entrada evalúa una):
        /// si ya corre esa misma versión, devuelve esa instancia sin crear otra; si corre otra versión,
        /// no despliega (Conflict). Chequeo y alta bajo el mismo lock: dos deploys simultáneos no crean
        /// dos instancias. Guarda el deployment, la instancia y su evento INSTANCE_CREATED, en ese orden,
        /// cada uno en su propia escritura: si una falla, lo anterior queda guardado (p. ej. una instancia
        /// sin su evento), pero en memoria nunca hay algo que no esté en la base.
        /// </summary>
        public DeployResult DeployOrGetRunning(StrategyDeployment deployment, StrategyInstance instance, OperationalEvent created)
        {
            lock (_deployGate)
            {
                var running = ActiveInstance();
                if (running != null)
                    return running.VersionHash == instance.VersionHash ? DeployResult.Existing(running) : DeployResult.Conflict(running);
                _repository?.SaveDeployment(deployment);
                SetInstance(instance.InstanceId, instance);
                AddEvent(created);
                return DeployResult.Created(instance);
            }
        }

        public StrategyInstance? GetInstance(string instanceId)
            => _instances.TryGetValue(instanceId, out var i) ? i : null;

        public IReadOnlyCollection<StrategyInstance> AllInstances()
            => _instances.Values.ToList().AsReadOnly();

        /// <summary>
        /// La instancia RUNNING más vieja, o null si no hay ninguna. Determinística (GC-0004): el orden
        /// de un ConcurrentDictionary no lo es, y tras un reinicio podría cambiar cuál evalúa.
        /// </summary>
        public StrategyInstance? ActiveInstance()
            => _instances.Values.Where(i => i.LifecycleState == "RUNNING")
                .OrderBy(i => i.CreatedAt).ThenBy(i => i.InstanceId, StringComparer.Ordinal).FirstOrDefault();

        public void UpdateInstanceState(string instanceId, string lifecycleState, string? schedulerState = null)
        {
            if (_instances.TryGetValue(instanceId, out var inst))
            {
                // El loop lo llama en cada tick: si el estado no cambió no se toca nada, ni en memoria
                // ni en la base (así no divergen).
                var scheduler = schedulerState ?? inst.SchedulerState;
                if (lifecycleState == inst.LifecycleState && scheduler == inst.SchedulerState) return;
                var updated = inst with { LifecycleState = lifecycleState, SchedulerState = scheduler, UpdatedAt = DateTime.UtcNow };
                _repository?.SaveInstance(updated);
                _instances[instanceId] = updated;
            }
        }

        // ── Positions ──

        public void AddPosition(ShadowPosition position)
        {
            _repository?.SavePosition(position);
            _positions[position.PositionId] = position;
        }

        // Serializa el cambio del switch del runtime con el registro de una posición nueva: si el
        // switch se apaga, ninguna entrada que ya estaba en curso puede registrarse después (Codex C2).
        private readonly object _commitGate = new();

        /// <summary>Corre <paramref name="action"/> (el cambio del switch) sin que se registre una posición en el medio.</summary>
        public void UnderCommitGate(Action action)
        {
            lock (_commitGate) action();
        }

        /// <summary>
        /// Registra la posición sólo si <paramref name="canOpen"/> sigue siendo true, en el mismo lock
        /// que el cambio del switch. Devuelve false si no la registró.
        /// </summary>
        public bool TryAddPosition(ShadowPosition position, Func<bool> canOpen)
        {
            lock (_commitGate)
            {
                if (!canOpen()) return false;
                AddPosition(position);
                return true;
            }
        }

        public void UpdatePosition(ShadowPosition position)
        {
            _repository?.SavePosition(position);
            _positions[position.PositionId] = position;
        }

        public ShadowPosition? GetPosition(string positionId)
            => _positions.TryGetValue(positionId, out var p) ? p : null;

        public IReadOnlyCollection<ShadowPosition> AllPositions()
            => _positions.Values.ToList().AsReadOnly();

        public IReadOnlyCollection<ShadowPosition> OpenPositions(string? instanceId = null)
            => _positions.Values
                .Where(p => p.Status == "OPEN" && (instanceId == null || p.InstanceId == instanceId))
                .ToList().AsReadOnly();

        public int OpenPositionCount(string instanceId)
            => _positions.Values.Count(p => p.Status == "OPEN" && p.InstanceId == instanceId);

        // ── Evaluations ──

        /// <summary>Registra una evaluación en el historial de su instancia.</summary>
        public void AddEvaluation(EvaluationResult evaluation)
        {
            _repository?.AddEvaluation(evaluation);
            var list = _evaluationHistory.GetOrAdd(evaluation.InstanceId, _ => new List<EvaluationResult>());
            lock (list)
            {
                list.Add(evaluation);
                if (list.Count > MaxEvaluationsPerInstance) list.RemoveRange(0, list.Count - MaxEvaluationsPerInstance);
            }
        }

        /// <summary>Historial de evaluaciones de una instancia, de la más vieja a la más nueva.</summary>
        public IReadOnlyCollection<EvaluationResult> GetEvaluations(string instanceId)
        {
            if (!_evaluationHistory.TryGetValue(instanceId, out var list)) return Array.Empty<EvaluationResult>();
            lock (list) { return list.ToList().AsReadOnly(); }
        }

        // ── Events ──

        public void AddEvent(OperationalEvent evt)
        {
            _repository?.AddEvent(evt);
            var list = _events.GetOrAdd(evt.InstanceId, _ => new List<OperationalEvent>());
            lock (list)
            {
                list.Add(evt);
                if (list.Count > MaxEventsPerInstance)
                {
                    int oldest = list.FindIndex(e => !LifecycleEventTypes.Contains(e.EventType));
                    if (oldest >= 0) list.RemoveAt(oldest);
                }
            }
        }

        public IReadOnlyCollection<OperationalEvent> GetEvents(string instanceId)
        {
            if (!_events.TryGetValue(instanceId, out var list)) return Array.Empty<OperationalEvent>();
            lock (list) { return list.ToList().AsReadOnly(); }
        }

    }
}
