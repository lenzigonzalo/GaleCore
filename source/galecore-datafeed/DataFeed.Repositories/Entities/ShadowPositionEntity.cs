namespace DataFeed.Repositories.Entities
{
    /// <summary>
    /// Posición SHADOW persistida. Write-through desde ShadowRuntimeStore.
    /// </summary>
    public class ShadowPositionEntity
    {
        public Guid Id { get; set; }
        public Guid InstanceId { get; set; }
        public StrategyInstanceEntity? Instance { get; set; }
        public string CandidateId { get; set; } = "";
        public string Symbol { get; set; } = "";
        public string Structure { get; set; } = "put_credit_spread";
        /// <summary>Legs serializados como JSON.</summary>
        public string LegsJson { get; set; } = "[]";
        /// <summary>"OPEN" | "CLOSED"</summary>
        public string Status { get; set; } = "OPEN";

        public double EntryCredit { get; set; }
        public double MaxRisk { get; set; }
        public double Width { get; set; }
        public int EntryDte { get; set; }
        public DateTime EntryAt { get; set; }

        public double? ExitDebit { get; set; }
        public DateTime? ExitAt { get; set; }
        public string? ExitReason { get; set; }
        public double? RealizedPnl { get; set; }

        // Última valuación con precios reales de las patas (GC-0004): sin esto, un reinicio mostraría
        // la posición como nunca valuada hasta el próximo tick del monitor.
        public double? UnrealizedPnl { get; set; }
        public double? LastSpreadValue { get; set; }
        public int? CurrentDte { get; set; }
        public DateTime? LastValuedAt { get; set; }
        /// <summary>Por qué la última valuación no se pudo hacer, como JSON (null si se hizo).</summary>
        public string? ValuationProblemsJson { get; set; }

        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
    }
}
