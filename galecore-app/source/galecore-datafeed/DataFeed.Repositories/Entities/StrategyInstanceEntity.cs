namespace DataFeed.Repositories.Entities
{
    /// <summary>
    /// Instancia operativa de una estrategia desplegada.
    /// </summary>
    public class StrategyInstanceEntity
    {
        public Guid Id { get; set; }
        public Guid DeploymentId { get; set; }
        public StrategyDeploymentEntity? Deployment { get; set; }
        public string VersionHash { get; set; } = "";
        /// <summary>"PENDING" | "RUNNING" | "STOPPED" | "FAILED"</summary>
        public string LifecycleState { get; set; } = "PENDING";
        /// <summary>"IDLE" | "EVALUATING" | "WAITING" | "ERROR"</summary>
        public string SchedulerState { get; set; } = "IDLE";
        public string SpecName { get; set; } = "";
        public string Mode { get; set; } = "SHADOW";
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
    }
}
