namespace DataFeed.Application.App.Shared.Dtos
{
    // ═══════════════════════════════════════════════════════════════════════
    // Contratos de cascada compartidos entre estrategias.
    //
    // Son los DTOs que producen los primitivos de CascadeUtils y que consumen los motores de
    // decisión (hoy RPF y GEX). Viven acá y no en el Dtos/ de la raíz porque esa carpeta es de la
    // capa Data/ (BaseResponse, PriceQuoteDTO — los usan los handlers de Data/Tastytrade/*), y en
    // App/ cada contrato vive con su dominio.
    //
    // Origen: hasta 2026-08-06 estaban en App/ValidationLayer/ValidationLayerResponse.cs y
    // App/PositionBuilder/PositionBuilderResponse.cs, los response DTOs de la estrategia core.
    // Al eliminarse esa estrategia se movieron acá los tipos que RPF y GEX sí usan; el resto
    // (ValidationLayerResponse, PositionBuilderResponse/Result, StrikeEngineCandidate,
    // SelectedStructureResult, ValidationGexData) se borró con ella.
    // ═══════════════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════════════
    // Macro Regime (Layer 1) — lo produce CascadeUtils.EvaluateLayer1
    // ═══════════════════════════════════════════════════════════════════════

    public class MacroRegimeResult
    {
        public string Signal { get; set; }
        public int PassedCount { get; set; }
        public int TotalChecks { get; set; }
        public MacroRegimeChecks Checks { get; set; }
    }

    public class MacroRegimeChecks
    {
        public VixAbsoluteCheck VixAbsolute { get; set; }
        public VixTermStructureCheck VixTermStructure { get; set; }
        public IVRankCheck IVRank { get; set; }
        public IVMomentumCheck IVMomentum { get; set; }
        public GexTotalCheck GexTotal { get; set; }
        public SpotVsZglCheck SpotVsZgl { get; set; }
    }

    public class VixAbsoluteCheck
    {
        public bool Passed { get; set; }
        public double? Value { get; set; }
        public double Threshold { get; set; }
    }

    public class VixTermStructureCheck
    {
        /// <summary>Con NoData true viene en true: sin dato el check no bloquea (on_no_data: pass).</summary>
        public bool Passed { get; set; }

        /// <summary>Faltó VIX9D o VIX. El tablero lo pinta distinto de un pass real — un ✓ verde por
        /// falta de datos escondería que la guarda dejó de estar.</summary>
        public bool NoData { get; set; }

        /// <summary>VIX9D (índice CBOE de 9 días), NO la IV del símbolo. Se llamaban Iv9d/Iv30d hasta
        /// 2026-08-10, y ese nombre es parte de por qué la confusión sobrevivió tanto.</summary>
        public double? Vix9d { get; set; }
        public double? Vix30d { get; set; }
    }

    public class IVRankCheck
    {
        public bool Passed { get; set; }
        public double Value { get; set; }
        public double Min { get; set; }
        public double Max { get; set; }
    }

    public class IVMomentumCheck
    {
        public bool Passed { get; set; }
        public double? Value { get; set; }
        public double Threshold { get; set; }
    }

    public class GexTotalCheck
    {
        public bool Passed { get; set; }
        public double Value { get; set; }
        public string Metric { get; set; }

        /// <summary>Umbral del símbolo. null = no está declarado en el JSON (no se evalúa).</summary>
        public double? Threshold { get; set; }

        /// <summary>
        /// false = el símbolo no tiene umbral en definitions.gex_threshold_by_symbol, así que no se
        /// evaluó nada. Sin esto, un símbolo sin configurar sería indistinguible de uno reprobado y
        /// el tablero lo pintaría en rojo cuando en realidad nadie definió contra qué compararlo.
        /// </summary>
        public bool ThresholdDeclared { get; set; }
    }

    public class SpotVsZglCheck
    {
        public bool Passed { get; set; }
        public double Spot { get; set; }
        public double? ZGL { get; set; }
        public double BufferPct { get; set; }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Strike Engine (Layer 2)
    // ═══════════════════════════════════════════════════════════════════════

    public class StrikeEngineResult
    {
        public string Signal { get; set; }
        public double ExpectedMove { get; set; }
        public int DTE { get; set; }
        public string Expiration { get; set; }
        public double? CallWall { get; set; }
        public double? PutWall { get; set; }
        public double ZScore { get; set; }
        public string SelectedStructure { get; set; }
        public double? ShortPutStrike { get; set; }
        public double? ShortCallStrike { get; set; }
        public double? ShortPutDelta { get; set; }
        public double? ShortCallDelta { get; set; }
        public double? LongPutStrike { get; set; }
        public double? LongCallStrike { get; set; }
        public bool StrikesInsideWalls { get; set; }

        // Multi-factor structure selection
        public int? StructureRuleId { get; set; }
        public string? StructureRuleName { get; set; }
        public string? StructureRuleLabel { get; set; }
        public string? GexSign { get; set; }
        public string? TrendSignal { get; set; }
        public double? Ema20 { get; set; }
        public double? Ema50 { get; set; }
        public string? RealizedVolSignal { get; set; }
        public double? Rv10d { get; set; }
        public double? Rv30d { get; set; }

        /// <summary>Proxy POP: (1 - |short_delta|) * 100. IC = min de ambos lados.</summary>
        public double? Pop { get; set; }
        /// <summary>
        /// Regla 1/3 Tastytrade: net_credit_snapshot / spread_width * 100.
        /// Target ≥ 33.3%. Indica la calidad del spread: cobrar al menos 1/3 del ancho implica riesgo 2:1 y strikes ~16-20 delta.
        /// Fuente: definitions.credit_ratio del JSON de la estrategia.
        /// </summary>
        public double? CreditRatio { get; set; }
        /// <summary>
        /// Score compuesto de prioridad: (pop/100)*0.6 + (credit/width)*0.4.
        /// Fuente: position_builder.ranking del JSON de la estrategia. Mayor score = operar primero.
        /// </summary>
        public double? PriorityScore { get; set; }
        /// <summary>Símbolos DXLink streamer de cada leg — el frontend suscribe al socket para quotes live.</summary>
        public LegSymbols? LegSymbols { get; set; }
        /// <summary>OI + cierre anterior por leg. Fuente: definitions.leg_open_interest / leg_prev_close.</summary>
        public LegMetaSet? LegMeta { get; set; }
    }

    public class LegSymbols
    {
        public string? ShortPut { get; set; }
        public string? LongPut { get; set; }
        public string? ShortCall { get; set; }
        public string? LongCall { get; set; }
    }

    /// <summary>Datos estáticos por leg (cierre anterior): OI y precio de cierre del candle diario previo.</summary>
    public class LegMeta
    {
        /// <summary>Open Interest del leg al cierre de la sesión anterior. Fuente: definitions.leg_open_interest.</summary>
        public long? OpenInterest { get; set; }
        /// <summary>Precio de cierre del leg en el período (candle) anterior. Fuente: definitions.leg_prev_close.</summary>
        public double? PrevClose { get; set; }
    }

    /// <summary>OI + cierre anterior por cada leg de la estructura.</summary>
    public class LegMetaSet
    {
        public LegMeta? ShortPut { get; set; }
        public LegMeta? LongPut { get; set; }
        public LegMeta? ShortCall { get; set; }
        public LegMeta? LongCall { get; set; }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Microstructure (Layer 3)
    // ═══════════════════════════════════════════════════════════════════════

    public class MicrostructureResult
    {
        public string Signal { get; set; }
        public double ATMStrike { get; set; }
        public OIChecks OIChecks { get; set; }
        public double? ATMCallDelta { get; set; }
        public double? ATMPutDelta { get; set; }
        public BidAskChecks? BidAskChecks { get; set; }
        public CreditMinimumCheck? CreditMinimum { get; set; }
    }

    public class OIChecks
    {
        public OICheck? ShortPut { get; set; }
        public OICheck? ShortCall { get; set; }
        public OICheck? LongPut { get; set; }
        public OICheck? LongCall { get; set; }
    }

    public class OICheck
    {
        public bool Passed { get; set; }
        public long Value { get; set; }
        public long MinRequired { get; set; }
    }

    public class BidAskLegCheck
    {
        public bool Passed { get; set; }
        public double? SpreadPct { get; set; }
        public double MaxAllowed { get; set; }
    }

    public class BidAskChecks
    {
        public BidAskLegCheck? ShortPut { get; set; }
        public BidAskLegCheck? ShortCall { get; set; }
        public BidAskLegCheck? LongPut { get; set; }
        public BidAskLegCheck? LongCall { get; set; }
    }

    public class CreditMinimumCheck
    {
        public bool Passed { get; set; }
        public double MidCredit { get; set; }
        public double MinRequired { get; set; }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Risk & Sizing (Layer 4)
    // ═══════════════════════════════════════════════════════════════════════

    public class RiskAndSizingResult
    {
        public string Signal { get; set; }
        public decimal NetLiq { get; set; }
        public decimal RiskPerTrade { get; set; }
        public decimal MaxRiskAmount { get; set; }
        public int OpenPositions { get; set; }
        public int MaxPositions { get; set; }
        public bool PositionsAvailable { get; set; }
        public double CurrentHeatPct { get; set; }
        public double MaxHeatPct { get; set; }
        public bool HeatOk { get; set; }

        public int Contracts { get; set; }
        public decimal MaxProfit { get; set; }
        public decimal MaxLoss { get; set; }
        public decimal BuyingPowerReq { get; set; }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Structure Inputs — factores multi-factor detallados (contexto de mercado).
    // Macro-independientes: se computan aunque la cascada corte en macro.
    // ═══════════════════════════════════════════════════════════════════════

    public class StructureInputs
    {
        public PriceZScoreInput PriceZScore { get; set; }
        public GexSignInput GexSign { get; set; }
        public TrendInput Trend { get; set; }
        public RealizedVolInput RealizedVolRegime { get; set; }
    }

    public class PriceZScoreInput
    {
        public double Value { get; set; }
        public string Formula { get; set; } = "ret_5d / (iv_atm / sqrt(252))";
        public double Ret5d { get; set; }
        public double IvAtm { get; set; }
        public string Interpretation { get; set; }
    }

    public class GexSignInput
    {
        public string Value { get; set; }
        /// <summary>Ratio callGEX / (callGEX + |putGEX|) en rango [0, 1]. Ver definitions.gex_skew.</summary>
        public double SkewRatio { get; set; }
        public string Interpretation { get; set; }
    }

    public class TrendInput
    {
        public double? Ema20 { get; set; }
        public double? Ema50 { get; set; }
        public string Signal { get; set; }
        public string Interpretation { get; set; }
    }

    public class RealizedVolInput
    {
        public double? Rv10d { get; set; }
        public double? Rv30d { get; set; }
        public string Signal { get; set; }
        public string Interpretation { get; set; }
    }
}
