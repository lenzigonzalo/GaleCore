namespace DataFeed.Application.App.Rpf
{
    /// <summary>Una pata del spread sugerido. streamerSymbol en formato DXLink (.SPY260717P695), como strikeEngine.legSymbols.</summary>
    public class TradeSuggestionLeg
    {
        /// <summary>"sell" | "buy"</summary>
        public string Action { get; set; } = "";
        public string? StreamerSymbol { get; set; }
        public double Strike { get; set; }
        /// <summary>Delta del leg (negativo en puts). Solo se puebla en el short.</summary>
        public double? Delta { get; set; }
    }

    /// <summary>
    /// Contrato TradeSuggestion (diseño Fase 5 §5). Lo emite el backend al grupo SignalR "rpf"
    /// cuando la máquina entra en TRIGGERED. El sistema SUGIERE, nunca ejecuta: la apertura sigue
    /// siendo manual. `State` es una foto de TRIGGERED; los cambios posteriores viajan como RpfStateUpdate.
    /// </summary>
    public class TradeSuggestion
    {
        /// <summary>GUID para idempotencia del ack (Accept/Dismiss).</summary>
        public string Id { get; set; } = "";
        public string Symbol { get; set; } = "";
        public string Structure { get; set; } = "put_credit_spread";
        public List<TradeSuggestionLeg> Legs { get; set; } = new();

        public double Credit { get; set; }
        public double Width { get; set; }
        /// <summary>credit / width. Display (piso anti-pennies ≥ 0.10).</summary>
        public double? CreditRatio { get; set; }
        /// <summary>edge_emp con POP empírica.</summary>
        public double? EdgeEmp { get; set; }
        /// <summary>min_edge del régimen vigente (barra que el edge cruzó).</summary>
        public double? Bar { get; set; }
        public string Regime { get; set; } = "";

        public double DeltaShort { get; set; }
        public int Dte { get; set; }

        public double? RiskPerTradePct { get; set; }
        /// <summary>true ⇒ banda high_risk (5–8%): aprobación explícita obligatoria en el tablero.</summary>
        public bool HighRisk { get; set; }
        /// <summary>sizing = floor(presupuesto / max_loss_por_contrato).</summary>
        public int Contracts { get; set; }

        /// <summary>Foto del estado que la emitió (TRIGGERED). No muta.</summary>
        public string State { get; set; } = "TRIGGERED";
        public DateTime CreatedAt { get; set; }
        /// <summary>Validez = 2× cadencia Tier B. Al vencer sin ack se descarta.</summary>
        public int TtlSeconds { get; set; }
    }
}
