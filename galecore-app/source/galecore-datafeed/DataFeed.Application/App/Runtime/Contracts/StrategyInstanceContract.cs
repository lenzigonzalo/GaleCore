namespace DataFeed.Application.App.Runtime.Contracts
{
    /// <summary>
    /// Estado operativo en ejecución que referencia un content_hash (P0 §5.3).
    /// Owner: GaleCore. Lifecycle: PENDING → RUNNING → STOPPED | FAILED.
    /// </summary>
    public record StrategyInstance
    {
        public string InstanceId { get; init; } = "";
        public string DeploymentId { get; init; } = "";
        /// <summary>SHA-256 del StrategySpec — la instancia ejecuta exactamente esta versión.</summary>
        public string VersionHash { get; init; } = "";
        /// <summary>"PENDING" | "RUNNING" | "STOPPED" | "FAILED"</summary>
        public string LifecycleState { get; init; } = "PENDING";
        /// <summary>"IDLE" | "EVALUATING" | "WAITING" | "ERROR"</summary>
        public string SchedulerState { get; init; } = "IDLE";
        public DateTime CreatedAt { get; init; }
        public DateTime UpdatedAt { get; init; }
        /// <summary>Nombre legible del spec (para logs/UI).</summary>
        public string SpecName { get; init; } = "";
        public string Mode { get; init; } = "SHADOW";
        /// <summary>Quién la desplegó (userId, o "SYSTEM" si no tiene dueño). Es el mismo valor que el de su deployment.</summary>
        public string DeployedBy { get; init; } = "SYSTEM";
    }
}
