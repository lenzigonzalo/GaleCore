using System.Collections.Concurrent;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Estado vivo del runtime SHADOW — singleton in-memory.
    /// Patrón: ConcurrentDictionary como RpfStateStore (§4.2).
    ///
    /// Guarda: instancias activas, posiciones abiertas, últimas evaluaciones.
    /// Write-through a DB es responsabilidad de quien escribe (el loop), no del store.
    /// Thread-safe por ConcurrentDictionary; operaciones compuestas con lock por entrada.
    /// </summary>
    public class ShadowRuntimeStore
    {
        private readonly ConcurrentDictionary<string, StrategyInstance> _instances = new();
        private readonly ConcurrentDictionary<string, ShadowPosition> _positions = new();
        private readonly ConcurrentDictionary<string, EvaluationResult> _lastEvaluations = new();
        private readonly ConcurrentDictionary<string, List<OperationalEvent>> _events = new();
        private readonly ConcurrentDictionary<string, StrategySpec> _specs = new();

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

        public void SetLastEvaluation(string key, EvaluationResult evaluation)
            => _lastEvaluations[key] = evaluation;

        public EvaluationResult? GetLastEvaluation(string key)
            => _lastEvaluations.TryGetValue(key, out var e) ? e : null;

        public IReadOnlyCollection<EvaluationResult> AllEvaluations()
            => _lastEvaluations.Values.ToList().AsReadOnly();

        // ── Events ──

        public void AddEvent(OperationalEvent evt)
        {
            var list = _events.GetOrAdd(evt.InstanceId, _ => new List<OperationalEvent>());
            lock (list) { list.Add(evt); }
        }

        public IReadOnlyCollection<OperationalEvent> GetEvents(string instanceId)
        {
            if (!_events.TryGetValue(instanceId, out var list)) return Array.Empty<OperationalEvent>();
            lock (list) { return list.ToList().AsReadOnly(); }
        }

        // ── Clear ──

        /// <summary>Borra todo el estado — se usa al apagar el runtime.</summary>
        public void Clear()
        {
            _instances.Clear();
            _positions.Clear();
            _lastEvaluations.Clear();
            _events.Clear();
            // No limpia _specs: se recargan del disco, no del estado.
        }
    }
}
