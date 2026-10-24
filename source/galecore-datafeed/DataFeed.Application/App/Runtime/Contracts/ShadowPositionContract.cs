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
        /// <summary>"TAKE_PROFIT" | "STOP_LOSS" | "METRIC_EXIT" | "TIME_EXIT" | "MANUAL" | "KILL_SWITCH"</summary>
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

        /// <summary>
        /// Contexto de mercado al abrir (WS-0033): lo que la spec evaluó y las cotizaciones de las patas.
        /// null en posiciones anteriores a este campo: no se reconstruye.
        /// </summary>
        public EntryContext? EntryContext { get; init; }
        /// <summary>Cotizaciones de las patas al cerrar. null si sigue abierta o es anterior a este campo.</summary>
        public ExitContext? ExitContext { get; init; }

        public DateTime CreatedAt { get; init; }
        public DateTime UpdatedAt { get; init; }
    }

    /// <summary>Bid y ask de una pata en un momento. Con eso se mide cuánto cuesta ejecutar contra el mid simulado.</summary>
    public record LegQuoteSnapshot
    {
        public string Side { get; init; } = "";
        public string Type { get; init; } = "";
        public double Strike { get; init; }
        public double? Bid { get; init; }
        public double? Ask { get; init; }
    }

    /// <summary>
    /// Qué miró la spec para decidir entrar. Los gates traen valor, umbral y resultado tal como los resolvió
    /// el motor; VIX, IV Rank y subyacente salen del snapshot del candidato. Nada que la spec no use.
    /// </summary>
    public record EntryContext
    {
        public string? EvaluationId { get; init; }
        public List<GateResult> Gates { get; init; } = new();
        public double? Vix { get; init; }
        public double? IvRank { get; init; }
        public double? UnderlyingPrice { get; init; }
        public DateTime? SnapshotAt { get; init; }
        public List<LegQuoteSnapshot> Legs { get; init; } = new();
    }

    public record ExitContext
    {
        public DateTime CapturedAt { get; init; }
        public int? Dte { get; init; }
        public List<LegQuoteSnapshot> Legs { get; init; } = new();
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
        /// <summary>Acciones de la pata (sólo long_equity); null en opciones. Va dentro de legs_json: sin migración.</summary>
        public int? Quantity { get; init; }
    }
}
