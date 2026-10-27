namespace DataFeed.Application.App.Runtime.Contracts
{
    /// <summary>
    /// Evento operacional del runtime — evidencia observable de lo que pasó y por qué.
    /// Append-only: nunca se modifica ni se borra.
    /// </summary>
    public record OperationalEvent
    {
        public string EventId { get; init; } = "";
        public string InstanceId { get; init; } = "";
        /// <summary>
        /// Tipo de evento:
        /// INSTANCE_CREATED, INSTANCE_STARTED, INSTANCE_STOPPED,
        /// EVALUATION_COMPLETED, CANDIDATE_CREATED, CANDIDATE_REJECTED,
        /// POSITION_OPENED, POSITION_CLOSED, EXIT_TRIGGERED,
        /// RISK_CHECK_FAILED, SWITCH_TOGGLED, ERROR
        /// </summary>
        public string EventType { get; init; } = "";
        public string? Symbol { get; init; }
        /// <summary>Payload específico del evento (JSON serializable).</summary>
        public Dictionary<string, object?> Payload { get; init; } = new();
        public DateTime Timestamp { get; init; }
    }
}
