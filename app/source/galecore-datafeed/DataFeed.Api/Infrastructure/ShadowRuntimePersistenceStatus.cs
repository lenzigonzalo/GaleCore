using DataFeed.Application.App.Runtime;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Si el runtime SHADOW persiste, y si no, por qué (GC-0004). Lo decide el arranque: base local
    /// (ShadowPersistenceGuard) y recuperación de lo guardado (ShadowRuntimeRecovery). Sin persistencia
    /// no se despliega nada (AC-03) y la pantalla lo muestra.
    /// </summary>
    public class ShadowRuntimePersistenceStatus
    {
        public bool Available { get; private set; }
        public string? Reason { get; private set; } = "el arranque todavía no evaluó la persistencia";
        public ShadowRecoveryReport? Recovery { get; private set; }
        public DateTime? RecoveredAt { get; private set; }
        /// <summary>Para leer las métricas desde la base; null sin persistencia.</summary>
        public IShadowRuntimeRepository? Repository { get; private set; }

        public void MarkAvailable(ShadowRecoveryReport recovery, IShadowRuntimeRepository repository)
        {
            Recovery = recovery;
            Repository = repository;
            RecoveredAt = DateTime.UtcNow;
            Reason = null;
            Available = true;
        }

        public void MarkUnavailable(string reason)
        {
            Available = false;
            Repository = null;
            Reason = reason;
        }
    }
}
