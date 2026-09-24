namespace DataFeed.Application.App.Runtime.Contracts
{
    /// <summary>
    /// Posición SHADOW: fill simulado al mid-price, determinístico (P0 §8.6).
    /// No hay llamada al broker. El fill es inmediato y siempre resuelve.
    /// </summary>
    public record ShadowPosition
    {
        public string PositionId { get; init; } = "";
        public string InstanceId { get; init; } = "";
        public string CandidateId { get; init; } = "";
        public string Symbol { get; init; } = "";
        public string Structure { get; init; } = "put_credit_spread";
        public List<ShadowLeg> Legs { get; init; } = new();

        /// <summary>"OPEN" | "CLOSED"</summary>
        public string Status { get; init; } = "OPEN";

        // Entry
        public double EntryCredit { get; init; }
        public double MaxRisk { get; init; }
        public double Width { get; init; }
        public int EntryDte { get; init; }
        public DateTime EntryAt { get; init; }

        // Exit (populated on close)
        public double? ExitDebit { get; init; }
        public DateTime? ExitAt { get; init; }
        /// <summary>"TAKE_PROFIT" | "STOP_LOSS" | "TIME_EXIT" | "MANUAL" | "KILL_SWITCH"</summary>
        public string? ExitReason { get; init; }

        // P&L
        public double? RealizedPnl { get; init; }
        /// <summary>Unrealized P&L basado en mid-price actual (solo cuando OPEN).</summary>
        public double? UnrealizedPnl { get; init; }

        // Última valuación con precios reales de las patas (null si nunca se pudo valuar)
        /// <summary>Débito para cerrar la posición a mid real de sus patas.</summary>
        public double? LastSpreadValue { get; init; }
        public int? CurrentDte { get; init; }
        public DateTime? LastValuedAt { get; init; }
        /// <summary>Por qué la última valuación no se pudo hacer (null si la última se hizo).</summary>
        public List<string>? ValuationProblems { get; init; }

        public DateTime CreatedAt { get; init; }
        public DateTime UpdatedAt { get; init; }
    }

    public record ShadowLeg
    {
        public string Side { get; init; } = "";
        public string Type { get; init; } = "";
        public double Strike { get; init; }
        public string? Expiration { get; init; }
        public string? OccSymbol { get; init; }
        /// <summary>Símbolo con el que se cotiza la pata en el streamer (DXLink); necesario para valuarla.</summary>
        public string? StreamerSymbol { get; init; }
        public double EntryPrice { get; init; }
        public double? ExitPrice { get; init; }
        public double? Delta { get; init; }
    }
}
