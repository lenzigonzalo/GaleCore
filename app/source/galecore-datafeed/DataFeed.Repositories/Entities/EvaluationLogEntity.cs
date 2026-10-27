namespace DataFeed.Repositories.Entities
{
    /// <summary>
    /// Log de evaluación de gates — para trazabilidad operacional.
    /// </summary>
    public class EvaluationLogEntity
    {
        public Guid Id { get; set; }
        public Guid InstanceId { get; set; }
        public StrategyInstanceEntity? Instance { get; set; }
        public string Symbol { get; set; } = "";
        public bool OverallPass { get; set; }
        /// <summary>Gate results serializados como JSON.</summary>
        public string ResultsJson { get; set; } = "[]";
        public DateTime EvaluatedAt { get; set; }
        /// <summary>
        /// Orden de llegada, lo pone la base (GC-0004). Varias filas de un mismo tick comparten la hora:
        /// sin esto, al recargar tras un reinicio se pierde en qué orden pasaron.
        /// </summary>
        public long Seq { get; set; }
    }
}
