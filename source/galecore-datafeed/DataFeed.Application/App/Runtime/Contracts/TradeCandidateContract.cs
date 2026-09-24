namespace DataFeed.Application.App.Runtime.Contracts
{
    /// <summary>
    /// Candidato a trade construido por el runtime tras pasar gates y antes de hard risk (P0 §8).
    /// No es una orden: es una propuesta que todavía tiene que pasar validación de riesgo.
    /// </summary>
    public record TradeCandidate
    {
        public string CandidateId { get; init; } = "";
        public string InstanceId { get; init; } = "";
        public string Symbol { get; init; } = "";
        /// <summary>"put_credit_spread" — de structure.default_structure del spec.</summary>
        public string Structure { get; init; } = "put_credit_spread";
        public List<CandidateLeg> Legs { get; init; } = new();

        public double Credit { get; init; }
        public double MaxRisk { get; init; }
        public double Width { get; init; }
        public int Dte { get; init; }
        public double DeltaShort { get; init; }

        /// <summary>Snapshot de mercado al momento de construcción.</summary>
        public MarketSnapshot Snapshot { get; init; } = new();
        public DateTime CreatedAt { get; init; }
    }

    public record CandidateLeg
    {
        /// <summary>"SELL" | "BUY"</summary>
        public string Side { get; init; } = "";
        /// <summary>"PUT" | "CALL"</summary>
        public string Type { get; init; } = "";
        public double Strike { get; init; }
        public string? Expiration { get; init; }
        public string? OccSymbol { get; init; }
        /// <summary>Símbolo con el que se cotiza la pata en el streamer (DXLink).</summary>
        public string? StreamerSymbol { get; init; }
        public double? Delta { get; init; }
        public double? Bid { get; init; }
        public double? Ask { get; init; }
    }

    public record MarketSnapshot
    {
        public double? UnderlyingPrice { get; init; }
        public double? Vix { get; init; }
        public double? IvRank { get; init; }
        /// <summary>Cuándo el runtime recibió los datos del snapshot (reloj del runtime, no del mercado).</summary>
        public DateTime AsOf { get; init; }
        /// <summary>
        /// Hora de publicación de la cotización más vieja de las patas, según el proveedor; null si el
        /// proveedor no la informa (DXLink puede mandar Quote sin hora). Es lo que mide la frescura.
        /// </summary>
        public DateTime? OldestQuoteAt { get; init; }
    }
}
