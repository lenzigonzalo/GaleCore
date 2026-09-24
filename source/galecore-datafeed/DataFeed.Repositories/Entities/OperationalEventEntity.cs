namespace DataFeed.Repositories.Entities
{
    /// <summary>
    /// Evento operacional del runtime — append-only.
    /// </summary>
    public class OperationalEventEntity
    {
        public Guid Id { get; set; }
        public Guid InstanceId { get; set; }
        public StrategyInstanceEntity? Instance { get; set; }
        public string EventType { get; set; } = "";
        public string? Symbol { get; set; }
        /// <summary>Payload serializado como JSON.</summary>
        public string PayloadJson { get; set; } = "{}";
        public DateTime Timestamp { get; set; }
        /// <summary>
        /// Orden de llegada, lo pone la base (GC-0004). Varias filas de un mismo tick comparten la hora:
        /// sin esto, al recargar tras un reinicio se pierde en qué orden pasaron.
        /// </summary>
        public long Seq { get; set; }
    }
}
