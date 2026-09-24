using System.Collections.Concurrent;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Estado vivo del runtime SHADOW — singleton in-memory.
    /// Patrón: ConcurrentDictionary como RpfStateStore (§4.2).
    ///
    /// Guarda: instancias, posiciones, historial de evaluaciones y eventos.
    /// Write-through a DB es responsabilidad de quien escribe (el loop), no del store.
    /// Thread-safe por ConcurrentDictionary; operaciones compuestas con lock por entrada.
    ///
    /// GC-0002: no hay borrado. Apagar el runtime pausa entradas y conserva todo lo registrado
    /// (decisión del owner, 24/09). El estado vive en memoria (W-2): un reinicio lo pierde. El
    /// historial de evaluaciones y los eventos se acotan por instancia para no crecer sin límite;
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

        /// <summary>Eventos que no se descartan al llegar al tope: sin ellos no se puede reconstruir qué pasó.</summary>
        public static readonly IReadOnlySet<string> LifecycleEventTypes =
            new HashSet<string> { "INSTANCE_CREATED", "POSITION_OPENED", "POSITION_CLOSED" };

        // ── Specs ──

        public void RegisterSpec(string name, StrategySpec spec)
            => _specs[name] = spec;

        public StrategySpec? GetSpec(string name)
            => _specs.TryGetValue(name, out var s) ? s : null;

        public IReadOnlyCollection<StrategySpec> AllSpecs()
            => _specs.Values.ToList().AsReadOnly();

        // ── Instances ──

        public void SetInstance(string instanceId, StrategyInstance instance)
            => _instances[instanceId] = instance;

        public StrategyInstance? GetInstance(string instanceId)
            => _instances.TryGetValue(instanceId, out var i) ? i : null;

        public IReadOnlyCollection<StrategyInstance> AllInstances()
            => _instances.Values.ToList().AsReadOnly();

        /// <summary>Devuelve la primera instancia RUNNING, o null si no hay ninguna.</summary>
        public StrategyInstance? ActiveInstance()
            => _instances.Values.FirstOrDefault(i => i.LifecycleState == "RUNNING");

        public void UpdateInstanceState(string instanceId, string lifecycleState, string? schedulerState = null)
        {
            if (_instances.TryGetValue(instanceId, out var inst))
            {
                _instances[instanceId] = inst with
                {
                    LifecycleState = lifecycleState,
                    SchedulerState = schedulerState ?? inst.SchedulerState,
                    UpdatedAt = DateTime.UtcNow
                };
            }
        }

        // ── Positions ──

        public void AddPosition(ShadowPosition position)
            => _positions[position.PositionId] = position;

        public void UpdatePosition(ShadowPosition position)
            => _positions[position.PositionId] = position;

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
