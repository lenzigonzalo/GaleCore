namespace DataFeed.Application.App.Runtime.Contracts
{
    /// <summary>
    /// StrategySpec v1 — contrato inmutable que describe una estrategia (P0 §5.2).
    /// El JSON Schema canónico es la fuente de verdad; este record es el derivado .NET.
    /// content_hash lo calcula el validador, no lo provee el autor.
    /// </summary>
    public record StrategySpec
    {
        public string StrategySpecVersion { get; init; } = "1.0.0";
        /// <summary>SHA-256 canónico del JSON normalizado (RFC 8785 JCS). Lo calcula el sistema.</summary>
        public string? ContentHash { get; init; }
        public string CanonicalizationVersion { get; init; } = "jcs-1";

        public SpecIdentity Identity { get; init; } = new();
        public DeploymentConstraints DeploymentConstraints { get; init; } = new();
        public SpecUniverse Universe { get; init; } = new();
        public SpecStructure Structure { get; init; } = new();
        public EntryFilters EntryFilters { get; init; } = new();
        public CandidateConstruction CandidateConstruction { get; init; } = new();
        public SpecExits Exits { get; init; } = new();
        public SpecRiskLimits RiskLimits { get; init; } = new();
        /// <summary>Cómo se simula el fill y qué costos se descuentan (WS-0062). null = fill natural, sin costos declarados.</summary>
        public SpecExecution? Execution { get; init; }
        public SpecOperational Operational { get; init; } = new();
        public SpecDataQuality DataQuality { get; init; } = new();
        public Dictionary<string, AnalyticsRef> AnalyticsRefs { get; init; } = new();
        public SpecMetadata Metadata { get; init; } = new();
    }

    public record SpecIdentity
    {
        public string Id { get; init; } = "";
        public string Name { get; init; } = "";
        public string DisplayName { get; init; } = "";
        public string Version { get; init; } = "1.0.0";
        public SpecAuthor Author { get; init; } = new();
        public DateTime CreatedAt { get; init; }
        public string? ParentVersionHash { get; init; }
    }

    public record SpecAuthor
    {
        /// <summary>"HUMAN" | "AI" | "COLLABORATIVE"</summary>
        public string Type { get; init; } = "HUMAN";
        public string? AgentDefinitionVersion { get; init; }
    }

    public record DeploymentConstraints
    {
        public List<string> EligibleModes { get; init; } = new() { "SHADOW" };
        public List<string> RequiresHumanApprovalFor { get; init; } = new() { "LIVE" };
    }

    public record SpecUniverse
    {
        /// <summary>"WHITELIST" | "BLACKLIST" | "DYNAMIC"</summary>
        public string Mode { get; init; } = "WHITELIST";
        public List<string> Symbols { get; init; } = new();
        public Dictionary<string, object> Excluded { get; init; } = new();
        public List<string> InstrumentTypes { get; init; } = new() { "EQUITY_OPTION" };
    }

    public record SpecStructure
    {
        public List<string> AllowedStrategies { get; init; } = new();
        public List<string> ForbiddenStrategies { get; init; } = new();
        public string DefaultStructure { get; init; } = "";
        /// <summary>"FIXED" | "RULE_BASED" | "AI_RECOMMENDED"</summary>
        public string SelectionMethod { get; init; } = "FIXED";
    }

    public record EntryFilters
    {
        public GateLayer GateLayer { get; init; } = new();
        public SignalLayer SignalLayer { get; init; } = new();
    }

    public record GateLayer
    {
        /// <summary>"ALL" — todos deben pasar.</summary>
        public string PassRule { get; init; } = "ALL";
        /// <summary>"NO_TRADE" — si falla, no se opera.</summary>
        public string OnFail { get; init; } = "NO_TRADE";
        public List<GateDefinition> Gates { get; init; } = new();
    }

    public record SignalLayer
    {
        public string PassRule { get; init; } = "ALL";
        public List<GateDefinition> Gates { get; init; } = new();
    }

    public record GateDefinition
    {
        public string Id { get; init; } = "";
        public string Label { get; init; } = "";
        /// <summary>Referencia a capability: "capability:market_data.quote.VIX.price"</summary>
        public string MetricRef { get; init; } = "";
        /// <summary>"LT" | "LTE" | "GT" | "GTE" | "EQ" | "NEQ" | "BETWEEN"</summary>
        public string Operator { get; init; } = "";
        public GateThreshold Threshold { get; init; } = new();
        /// <summary>"NO_TRADE" | "INFORM_ONLY"</summary>
        public string OnFail { get; init; } = "NO_TRADE";
        /// <summary>"BLOCK" | "PASS" | "INFORM_ONLY"</summary>
        public string OnNoData { get; init; } = "BLOCK";
    }

    public record GateThreshold
    {
        public double? Value { get; init; }
        public double? Min { get; init; }
        public double? Max { get; init; }
    }

    public record CandidateConstruction
    {
        public List<LegTemplate> Legs { get; init; } = new();
        public SizingConfig Sizing { get; init; } = new();
        public ConstructionConstraints Constraints { get; init; } = new();
    }

    public record LegTemplate
    {
        /// <summary>"SELL" | "BUY"</summary>
        public string Side { get; init; } = "";
        /// <summary>"PUT" | "CALL"</summary>
        public string Type { get; init; } = "";
        public LegStrikeSelection StrikeSelection { get; init; } = new();
    }

    public record LegStrikeSelection
    {
        /// <summary>"DELTA" | "FIXED_WIDTH" | "PERCENTAGE_OTM"</summary>
        public string Method { get; init; } = "";
        public double? TargetDelta { get; init; }
        public double? DeltaTolerance { get; init; }
        public double? Width { get; init; }
    }

    public record SizingConfig
    {
        /// <summary>"FIXED" | "RISK_BASED" | "KELLY"</summary>
        public string Method { get; init; } = "RISK_BASED";
        /// <summary>
        /// Contratos fijos. En long_equity son ACCIONES (método FIXED): cantidad fija de acciones por entrada.
        /// </summary>
        public int? FixedContracts { get; init; }
        public double? RiskPerTradePct { get; init; }
    }

    public record ConstructionConstraints
    {
        public int? MinDte { get; init; }
        public int? MaxDte { get; init; }
        public double? MinCredit { get; init; }
        public double? MaxBidAskSpreadPct { get; init; }
    }

    public record SpecExits
    {
        public DeterministicExits Deterministic { get; init; } = new();
    }

    public record DeterministicExits
    {
        public TakeProfitExit? TakeProfit { get; init; }
        public StopLossExit? StopLoss { get; init; }
        public TimeExit? TimeExit { get; init; }
        public DefensiveRollExit? DefensiveRoll { get; init; }
        /// <summary>Cierra cuando una métrica cumple la condición (WS-0061). Se evalúa en el monitor de posiciones.</summary>
        public MetricExit? MetricExit { get; init; }
    }

    /// <summary>
    /// Salida por condición de métrica: cierra la posición cuando <c>metric_ref operator threshold</c> se cumple
    /// (mismo operador y umbral que un gate). Si falta el dato no cierra y lo deja anotado en la posición.
    /// </summary>
    public record MetricExit
    {
        public string MetricRef { get; init; } = "";
        /// <summary>"LT" | "LTE" | "GT" | "GTE" | "EQ" | "NEQ" | "BETWEEN"</summary>
        public string Operator { get; init; } = "";
        public GateThreshold Threshold { get; init; } = new();
    }

    public record TakeProfitExit
    {
        /// <summary>Porcentaje del crédito. Ej: 50 = cerrar cuando el spread vale 50% del crédito recibido.</summary>
        public double PctOfCredit { get; init; }
    }

    public record StopLossExit
    {
        /// <summary>Porcentaje del crédito. Ej: 200 = cerrar cuando la pérdida alcanza 200% del crédito.</summary>
        public double PctOfCredit { get; init; }
    }

    public record TimeExit
    {
        /// <summary>Cerrar cuando DTE <= este valor.</summary>
        public int MaxDte { get; init; }
    }

    public record DefensiveRollExit
    {
        public bool Enabled { get; init; }
    }

    /// <summary>
    /// Modelo de ejecución del simulador SHADOW. fill: "natural" (default; se compra al ask y se vende al bid),
    /// "mid" o "mid_slippage" (desde el medio hacia el lado desfavorable: slippage_pct_of_spread = 0 es el medio,
    /// 100 es el bid/ask, o sea el natural).
    /// </summary>
    public record SpecExecution
    {
        public string Fill { get; init; } = "natural";
        /// <summary>0-100, sólo con fill mid_slippage: % del medio spread bid/ask que se cede en contra.</summary>
        public double? SlippagePctOfSpread { get; init; }
        public ExecutionCosts? Costs { get; init; }
    }

    /// <summary>Costos en USD, aplicados en la entrada y otra vez en la salida. Los que no se declaran son 0.</summary>
    public record ExecutionCosts
    {
        /// <summary>Por contrato de opción (cada pata × contratos).</summary>
        public double? PerContractUsd { get; init; }
        /// <summary>Por acción (long_equity).</summary>
        public double? PerShareUsd { get; init; }
        /// <summary>Por orden (una en la entrada, una en la salida).</summary>
        public double? PerOrderUsd { get; init; }
    }

    public record SpecRiskLimits
    {
        public int? MaxConcurrentPositions { get; init; }
        /// <summary>
        /// Minutos mínimos entre dos entradas de la misma instancia (GC-0005). Escalona las posiciones:
        /// 1440 = como mucho una por día. null = sin espaciado (comportamiento anterior).
        /// </summary>
        public int? MinMinutesBetweenEntries { get; init; }
        public double? MaxPortfolioHeatPct { get; init; }
        public double? MaxRiskPerTradePct { get; init; }
        public double? MaxLossPerTradeUsd { get; init; }
    }

    public record SpecOperational
    {
        public string Timezone { get; init; } = "America/New_York";
        public SessionHours SessionHours { get; init; } = new();
        public string Calendar { get; init; } = "NYSE";
        public int DecimalPrecision { get; init; } = 2;
        public string Currency { get; init; } = "USD";
        public string Rounding { get; init; } = "HALF_UP";
        public string Symbology { get; init; } = "OCC_21_CHAR";
    }

    public record SessionHours
    {
        public string Start { get; init; } = "09:30";
        public string End { get; init; } = "16:00";
    }

    public record SpecDataQuality
    {
        public int MaxQuoteAgeSeconds { get; init; } = 15;
        public bool BlockOnCrossedMarket { get; init; } = true;
        public bool BlockOnMissingCriticalData { get; init; } = true;
    }

    public record AnalyticsRef
    {
        public string CapabilityRef { get; init; } = "";
        public string Version { get; init; } = "1.0.0";
    }

    public record SpecMetadata
    {
        public string SchemaVersion { get; init; } = "1.0.0";
        public string MethodologyVersion { get; init; } = "1.0.0";
        public List<string> ReferenceDocs { get; init; } = new();
        public string Notes { get; init; } = "";
    }
}
