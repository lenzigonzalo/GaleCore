namespace DataFeed.Repositories.Entities
{
    /// <summary>
    /// Acto de desplegar un StrategySpec a un modo.
    /// </summary>
    public class StrategyDeploymentEntity
    {
        public Guid Id { get; set; }
        public Guid SpecId { get; set; }
        public StrategySpecEntity? Spec { get; set; }
        public string VersionHash { get; set; } = "";
        /// <summary>"SHADOW" | "PAPER" | "LIVE"</summary>
        public string Mode { get; set; } = "SHADOW";
        public string DeployedBy { get; set; } = "SYSTEM";
        public DateTime DeployedAt { get; set; }
    }
}
