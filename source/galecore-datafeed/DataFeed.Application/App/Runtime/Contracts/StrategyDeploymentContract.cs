namespace DataFeed.Application.App.Runtime.Contracts
{
    /// <summary>
    /// Acto de desplegar un StrategyVersion a un modo (P0 §5.3).
    /// Owner: GaleCore. Contiene la referencia al content_hash, no una copia del spec.
    /// </summary>
    public record StrategyDeployment
    {
        public string DeploymentId { get; init; } = "";
        /// <summary>SHA-256 del StrategySpec desplegado — identidad criptográfica exacta.</summary>
        public string VersionHash { get; init; } = "";
        /// <summary>"SHADOW" | "PAPER" | "LIVE". P0-MINIMUM: solo SHADOW.</summary>
        public string Mode { get; init; } = "SHADOW";
        public DateTime DeployedAt { get; init; }
        /// <summary>Actor que desplegó (user_id o "SYSTEM").</summary>
        public string DeployedBy { get; init; } = "SYSTEM";
        /// <summary>Nombre legible del spec (para logs/UI, no para identidad).</summary>
        public string SpecName { get; init; } = "";
        public string SpecVersion { get; init; } = "";
    }
}
