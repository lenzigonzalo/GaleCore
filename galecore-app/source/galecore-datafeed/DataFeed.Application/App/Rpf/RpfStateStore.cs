using System.Collections.Concurrent;

namespace DataFeed.Application.App.Rpf
{
    /// <summary>Estado vivo de un símbolo dentro del loop RPF.</summary>
    public class RpfSymbolStatus
    {
        public string Symbol { get; set; } = "";
        public RpfState State { get; set; } = RpfState.Dormant;
        public DateTime? CooldownUntil { get; set; }
        public TradeSuggestion? Suggestion { get; set; }
        /// <summary>null | "accepted" | "dismissed" | "expired"</summary>
        public string? AckStatus { get; set; }
        public DateTime UpdatedAt { get; set; }
    }

    /// <summary>
    /// Memoria del loop RPF (diseño Fase 5 §4.2). Singleton in-memory: guarda SOLO lo que no es
    /// recomputable de los gates — estado actual, timers de cooldown y la sugerencia vigente con su ack.
    /// Todo lo demás (Tier A, edge, cupo, posición) el loop lo recomputa en cada tick.
    ///
    /// Al reiniciar el proceso el estado se reconstruye en el primer tick; el cooldown perdido es
    /// refinamiento menor (definición §6) e IN_POSITION reaparece de las posiciones de cuenta.
    /// Thread-safe: ConcurrentDictionary + lock por entrada para las operaciones compuestas.
    /// </summary>
    public class RpfStateStore
    {
        private readonly ConcurrentDictionary<string, RpfSymbolStatus> _states = new(StringComparer.OrdinalIgnoreCase);
        /// <summary>suggestionId -> symbol, para resolver el ack por id (idempotencia).</summary>
        private readonly ConcurrentDictionary<string, string> _suggestionIndex = new();

        private RpfSymbolStatus Entry(string symbol)
            => _states.GetOrAdd(symbol.ToUpperInvariant(), s => new RpfSymbolStatus { Symbol = s, UpdatedAt = DateTime.UtcNow });

        public RpfSymbolStatus Get(string symbol) => Entry(symbol);

        public IReadOnlyCollection<RpfSymbolStatus> All() => _states.Values.ToList().AsReadOnly();

        /// <summary>
        /// Borra todo el estado — se usa al apagar la estrategia: con el loop inerte, un estado viejo
        /// en memoria haría que un tablero que se conecta después vea datos que ya nadie actualiza.
        /// Al reactivar, el primer tick lo reconstruye.
        /// </summary>
        public void Clear()
        {
            _states.Clear();
            _suggestionIndex.Clear();
        }

        /// <summary>Fija el estado. Devuelve true si cambió (el loop emite RpfStateUpdate solo en cambio).</summary>
        public bool SetState(string symbol, RpfState state)
        {
            var e = Entry(symbol);
            lock (e)
            {
                bool changed = e.State != state;
                e.State = state;
                e.UpdatedAt = DateTime.UtcNow;
                return changed;
            }
        }

        // ── Cooldown (anti-doble-emisión) ──

        public bool InCooldown(string symbol, DateTime now)
        {
            var e = Entry(symbol);
            lock (e) return e.CooldownUntil.HasValue && e.CooldownUntil.Value > now;
        }

        public void StartCooldown(string symbol, int seconds, DateTime now)
        {
            var e = Entry(symbol);
            lock (e) e.CooldownUntil = now.AddSeconds(seconds);
        }

        public int? CooldownRemainingSec(string symbol, DateTime now)
        {
            var e = Entry(symbol);
            lock (e)
            {
                if (!e.CooldownUntil.HasValue || e.CooldownUntil.Value <= now) return null;
                return (int)Math.Ceiling((e.CooldownUntil.Value - now).TotalSeconds);
            }
        }

        // ── Sugerencia vigente ──

        public TradeSuggestion? CurrentSuggestion(string symbol)
        {
            var e = Entry(symbol);
            lock (e) return e.Suggestion;
        }

        /// <summary>Guarda la sugerencia vigente (reemplaza la anterior) y la indexa por id para el ack.</summary>
        public void SetSuggestion(string symbol, TradeSuggestion suggestion)
        {
            var e = Entry(symbol);
            lock (e)
            {
                if (e.Suggestion != null) _suggestionIndex.TryRemove(e.Suggestion.Id, out _);
                e.Suggestion = suggestion;
                e.AckStatus = null;
                e.UpdatedAt = DateTime.UtcNow;
            }
            _suggestionIndex[suggestion.Id] = symbol.ToUpperInvariant();
        }

        /// <summary>Descarta la sugerencia vigente (TTL vencido o el símbolo dejó de disparar).</summary>
        public void ClearSuggestion(string symbol, string reason)
        {
            var e = Entry(symbol);
            lock (e)
            {
                if (e.Suggestion != null) _suggestionIndex.TryRemove(e.Suggestion.Id, out _);
                e.Suggestion = null;
                e.AckStatus = reason;
                e.UpdatedAt = DateTime.UtcNow;
            }
        }

        /// <summary>true si la sugerencia vigente ya venció su TTL.</summary>
        public bool SuggestionExpired(string symbol, DateTime now)
        {
            var e = Entry(symbol);
            lock (e)
            {
                if (e.Suggestion == null) return false;
                return e.Suggestion.CreatedAt.AddSeconds(e.Suggestion.TtlSeconds) <= now;
            }
        }

        // ── Ack del operador (idempotente por id) ──

        /// <summary>
        /// Registra el ack. Accept: confirma intención + arranca cooldown (NO ejecuta: la apertura es
        /// manual e IN_POSITION lo confirma la cuenta). Dismiss: descarta + cooldown.
        /// Devuelve el símbolo afectado, o null si el id no corresponde a una sugerencia vigente
        /// (vencida o reemplazada) — en cuyo caso el ack se ignora.
        /// </summary>
        public string? Ack(string suggestionId, bool accepted, int cooldownSeconds, DateTime now)
        {
            if (!_suggestionIndex.TryGetValue(suggestionId, out var symbol)) return null;

            var e = Entry(symbol);
            lock (e)
            {
                if (e.Suggestion == null || e.Suggestion.Id != suggestionId) return null;

                e.AckStatus = accepted ? "accepted" : "dismissed";
                e.CooldownUntil = now.AddSeconds(cooldownSeconds);
                e.Suggestion = null;
                e.UpdatedAt = now;
            }
            _suggestionIndex.TryRemove(suggestionId, out _);
            return symbol;
        }
    }
}
