namespace DataFeed.Application.App.Runtime.Contracts
{
    /// <summary>
    /// Resultado de una evaluación de gates del spec contra métricas de mercado.
    /// Registra qué pasó y qué no para trazabilidad operacional.
    /// </summary>
    public record EvaluationResult
    {
        public string EvaluationId { get; init; } = "";
        public string InstanceId { get; init; } = "";
        public string Symbol { get; init; } = "";
        /// <summary>true si todos los gates requeridos pasaron.</summary>
        public bool OverallPass { get; init; }
        public List<GateResult> GateResults { get; init; } = new();
        public DateTime EvaluatedAt { get; init; }
    }

    public record GateResult
    {
        public string GateId { get; init; } = "";
        public string Label { get; init; } = "";
        /// <summary>"PASS" | "FAIL" | "NO_DATA" | "SKIPPED"</summary>
        public string Status { get; init; } = "";
        public double? Value { get; init; }
        public double? Threshold { get; init; }
        public string Operator { get; init; } = "";
        public string OnFail { get; init; } = "";
    }
}
