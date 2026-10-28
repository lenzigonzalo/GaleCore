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
        /// <summary>Condiciones de eventos (WS-0062 inc.5): evitar o exigir un evento (FOMC, balances, datos macro, lo que el calendario conozca). Se evalúan junto con los gates.</summary>
        public List<EventGate> EventGates { get; init; } = new();
    }

    /// <summary>
    /// «Existe / no existe un evento de este tipo y sujeto dentro de la ventana». El tipo es un texto del catálogo del calendario de eventos
    /// (no un enum del runtime). Sin dato (fuente ilegible, tipo sin fuente, o evento sólo con fecha en una ventana de minutos) es NO_DATA y
    /// aplica on_no_data (BLOCK por defecto).
    /// </summary>
    public record EventGate
    {
        public string Id { get; init; } = "";
        /// <summary>Tipo del catálogo: "FOMC", "EARNINGS", "CPI"...</summary>
        public string Type { get; init; } = "";
        /// <summary>Un símbolo ("AAPL"), "UNIVERSE" (cualquier símbolo del universo de la spec) o "ANY" / sin declarar (eventos que no son de un símbolo, o de cualquiera).</summary>
        public string? Subject { get; init; }
        public EventGateWindow Window { get; init; } = new();
        /// <summary>"exist" (hay que operar con el evento) | "not_exist" (evitarlo).</summary>
        public string Must { get; init; } = "";
        /// <summary>"NO_TRADE" | "INFORM_ONLY"</summary>
        public string OnFail { get; init; } = "NO_TRADE";
        /// <summary>"BLOCK" | "PASS" | "INFORM_ONLY"</summary>
        public string OnNoData { get; init; } = "BLOCK";
    }

    /// <summary>
    /// Ventana en operational.timezone. from: "day_start" (00:00 de hoy) | "now". to: "day_end" (00:00 de mañana) | "minutes_after_now" con <c>minutes</c>.
    /// Un evento sólo con fecha coincide sólo con una ventana de día completo (day_start → day_end).
    /// </summary>
    public record EventGateWindow
    {
        public string From { get; init; } = "";
        public string To { get; init; } = "";
        public int? Minutes { get; init; }
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
        /// <summary>
        /// Métrica contra métrica (WS-0062 inc.5): el umbral es el valor de OTRA métrica ("capability:compute.ema.SPY.20").
        /// Excluye a value/min/max y no se combina con BETWEEN. Si falta cualquiera de las dos, es NO_DATA.
        /// </summary>
        public string? MetricRef { get; init; }
    }

    public record CandidateConstruction
    {
        public List<LegTemplate> Legs { get; init; } = new();
        public SizingConfig Sizing { get; init; } = new();
        public ConstructionConstraints Constraints { get; init; } = new();
    }

    public record LegTemplate
    {
        /// <summary>Nombre de la pata para que otra la referencie con from_leg (custom_options). Sin nombre: leg1, leg2... por orden.</summary>
        public string? Id { get; init; }
        /// <summary>"SELL" | "BUY"</summary>
        public string Side { get; init; } = "";
        /// <summary>"PUT" | "CALL"</summary>
        public string Type { get; init; } = "";
        public LegStrikeSelection StrikeSelection { get; init; } = new();
    }

    public record LegStrikeSelection
    {
        /// <summary>
        /// "DELTA" | "FIXED_WIDTH" (familias con ancho) | "PERCENTAGE_OTM", y las de custom_options:
        /// "POINTS_FROM_SPOT" | "PCT_FROM_SPOT" | "POINTS_FROM_ATM" | "FIXED_STRIKE" | "OFFSET_FROM_LEG".
        /// </summary>
        public string Method { get; init; } = "";
        public double? TargetDelta { get; init; }
        public double? DeltaTolerance { get; init; }
        public double? Width { get; init; }
        /// <summary>POINTS_FROM_SPOT, con signo: -5 = el primer strike a 5 puntos o más DEBAJO del precio; +5 = ARRIBA.</summary>
        public double? PointsFromSpot { get; init; }
        /// <summary>PCT_FROM_SPOT, con signo y en %: -1 = el primer strike a 1 % o más debajo del precio.</summary>
        public double? PctFromSpot { get; init; }
        /// <summary>
        /// POINTS_FROM_ATM, con signo: ATM = el strike de la cadena (de ese vencimiento y tipo) más cercano al precio, con empate el más bajo;
        /// -5 = 5 puntos debajo del ATM, +5 = arriba, 0 = el ATM. El strike resultante tiene que existir exacto.
        /// </summary>
        public double? PointsFromAtm { get; init; }
        /// <summary>FIXED_STRIKE: ese strike exacto (tiene que existir en el vencimiento elegido).</summary>
        public double? Strike { get; init; }
        /// <summary>OFFSET_FROM_LEG: id de la pata de la que se mide.</summary>
        public string? FromLeg { get; init; }
        /// <summary>OFFSET_FROM_LEG, con signo: -5 = 5 puntos debajo del strike de from_leg.</summary>
        public double? OffsetPoints { get; init; }
        /// <summary>OFFSET_FROM_LEG: diferencia tolerada (en puntos) entre el strike pedido y el que existe. Sin declarar: 0, tiene que existir exacto.</summary>
        public double? TolerancePoints { get; init; }
    }

    public record SizingConfig
    {
        /// <summary>"FIXED" | "RISK_BASED" (contratos = tope por operación / pérdida máxima de uno, ShadowSizing) | "KELLY" (no se ejecuta con opciones)</summary>
        public string Method { get; init; } = "RISK_BASED";
        /// <summary>
        /// Contratos por posición con FIXED (la misma cantidad en todas las patas de opciones). En long_equity son ACCIONES: cantidad fija
        /// de acciones por entrada.
        /// </summary>
        public int? FixedContracts { get; init; }
        public double? RiskPerTradePct { get; init; }
    }

    public record ConstructionConstraints
    {
        public int? MinDte { get; init; }
        public int? MaxDte { get; init; }
        public double? MinCredit { get; init; }
        /// <summary>Débito neto máximo al precio de fill (custom_options de débito); excluye a min_credit.</summary>
        public double? MaxDebit { get; init; }
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
        /// <summary>Cierra cuando un evento existe / no existe en la ventana (WS-0062 inc.5).</summary>
        public List<EventExit> EventExits { get; init; } = new();
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
        /// <summary>Estructuras de débito (custom_options con max_debit, long_equity): % de lo que costó entrar. 50 = cerrar con una ganancia del 50% del costo. Excluye a pct_of_credit.</summary>
        public double? PctOfCost { get; init; }
    }

    public record StopLossExit
    {
        /// <summary>Porcentaje del crédito. Ej: 200 = cerrar cuando la pérdida alcanza 200% del crédito.</summary>
        public double PctOfCredit { get; init; }
        /// <summary>Estructuras de débito: % del costo de entrada. 50 = cerrar cuando la pérdida alcanza el 50% de lo que costó entrar. Excluye a pct_of_credit.</summary>
        public double? PctOfCost { get; init; }
    }

    public record TimeExit
    {
        /// <summary>Cerrar cuando DTE <= este valor.</summary>
        public int? MaxDte { get; init; }
        /// <summary>
        /// Hora del día "HH:mm" en operational.timezone (WS-0062 inc.5). Cierra al precio de fill con la hora declarada o pasada,
        /// SÓLO el día del vencimiento (DTE 0): es la salida de una 0DTE antes de la liquidación. Sin vencimiento no aplica.
        /// Puede declararse junto con max_dte (se cierra con la primera que se cumpla).
        /// </summary>
        public string? At { get; init; }
        /// <summary>
        /// Con <c>at</c>: cierra a esa hora el N-ésimo día de sesión (lunes a viernes, sin feriados) después del día de entrada; 0 = el mismo día
        /// (intradía). Sin declarar y con vencimiento, <c>at</c> vale el día del vencimiento; sin vencimiento (acciones) es obligatorio.
        /// </summary>
        public int? DaysAfterEntry { get; init; }
    }

    /// <summary>
    /// Cierra la posición (razón EVENT_EXIT) cuando la condición de evento se cumple: misma forma que un event_gate. Sin dato nunca se inventa un
    /// cierre: on_no_data HOLD (default: se mantiene y se anota) o CLOSE.
    /// </summary>
    public record EventExit
    {
        public string Id { get; init; } = "";
        public string Type { get; init; } = "";
        public string? Subject { get; init; }
        public EventGateWindow Window { get; init; } = new();
        /// <summary>"exist" | "not_exist": la posición se cierra cuando se cumple.</summary>
        public string Must { get; init; } = "";
        /// <summary>"HOLD" | "CLOSE"</summary>
        public string OnNoData { get; init; } = "HOLD";
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

        // ── Capital simulado y controles que el runtime hace cumplir (WS-0062 inc.6) ──
        // Cada estrategia SHADOW declara su propio monto. Sin simulated_capital_usd no hay capital contra el cual medir: no se
        // aplican ni el tope por apuesta, ni el presupuesto de riesgo, ni el margen intradiario, ni los frenos en % del capital.

        /// <summary>Monto simulado de la estrategia, en USD. Es el capital de CapitalLimits y el punto de partida del equity (capital + P&amp;L realizado neto).</summary>
        public double? SimulatedCapitalUsd { get; init; }
        /// <summary>% del capital que no se usa como riesgo ni como margen. null = 0.</summary>
        public double? ReservePct { get; init; }
        /// <summary>Riesgo abierto máximo, en % del capital (CapitalLimits.MaxOpenRiskPct). null = 100 (sólo manda la reserva).</summary>
        public double? MaxOpenRiskPct { get; init; }
        /// <summary>Tope por apuesta, en % del riesgo abierto máximo (CapitalLimits.MaxBetPct). null = 100.</summary>
        public double? MaxBetPct { get; init; }
        /// <summary>Frenos por pérdida: con la pérdida del período en el límite, no entran posiciones nuevas (nunca se cierran las abiertas).</summary>
        public List<SpecLossBrake>? LossBrakes { get; init; }
    }

    /// <summary>
    /// Freno por pérdida (risk_limits.loss_brakes). period: "day" | "week" (lunes a domingo) | "total" (desde que arrancó la instancia);
    /// exactamente uno entre max_loss_usd y max_loss_pct_of_capital; basis: "realized" (default) o "realized_plus_open".
    /// </summary>
    public record SpecLossBrake
    {
        public string Period { get; init; } = "";
        public double? MaxLossUsd { get; init; }
        public double? MaxLossPctOfCapital { get; init; }
        public string Basis { get; init; } = "realized";
    }

    public record SpecOperational
    {
        public string Timezone { get; init; } = "America/New_York";
        public SessionHours SessionHours { get; init; } = new();
        /// <summary>Ventana de entrada en operational.timezone (WS-0062 inc.5): sólo ahí se evalúan entradas. session_hours sigue gobernando el monitoreo. null = toda la sesión.</summary>
        public EntryWindow? EntryWindow { get; init; }
        /// <summary>
        /// Límites de frecuencia de operaciones (WS-0062 inc.5, requisito legal): se hacen cumplir, la entrada que los rompería se
        /// bloquea y queda el motivo. Sin declarar no hay límite (no hay un default).
        /// </summary>
        public SpecTradeLimits? TradeLimits { get; init; }
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

    /// <summary>"HH:mm" de inicio (inclusive) y fin (exclusivo), como session_hours. Fin posterior al inicio y dentro de session_hours.</summary>
    public record EntryWindow
    {
        public string Start { get; init; } = "";
        public string End { get; init; } = "";
    }

    /// <summary>
    /// Frecuencia de operaciones que la estrategia se impone a sí misma, contada por estrategia (sus instancias, como los otros límites). Todo
    /// opcional. No hay un límite por defecto ni un contador de day trades: FINRA eliminó la regla PDT y los 25.000 USD mínimos (en vigor
    /// desde el 04/06/2026) y la reemplazó por margen intradiario.
    /// </summary>
    public record SpecTradeLimits
    {
        /// <summary>Entradas por día calendario en operational.timezone. 1 = una sola por día.</summary>
        public int? MaxEntriesPerDay { get; init; }
        /// <summary>Entradas por semana calendario (lunes a domingo) en operational.timezone.</summary>
        public int? MaxEntriesPerWeek { get; init; }
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
