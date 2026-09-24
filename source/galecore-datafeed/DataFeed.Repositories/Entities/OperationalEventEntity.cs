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
    }
}
