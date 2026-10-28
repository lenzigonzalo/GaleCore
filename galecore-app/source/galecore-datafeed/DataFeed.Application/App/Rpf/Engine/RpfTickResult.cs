using DataFeed.Application.App.SignalGates;
using DataFeed.Application.App.Shared.Dtos;

namespace DataFeed.Application.App.Rpf.Engine
{
    /// <summary>
    /// Salida de un tick del motor RPF. Compone los DTOs de resultado ya existentes (namespace
    /// ValidationLayer) para NO cambiar el contrato hacia el loop / frontend: RpfLoopService la mapea a
    /// RpfStateUpdate/TradeSuggestion igual que antes leía de ValidationLayerResponse + PositionBuilderResponse.
    ///
    /// A diferencia del camino viejo (candidato de PB SIN legs cuando la cascada de Main producía el
    /// strikeEngine), acá el <see cref="StrikeEngine"/> SIEMPRE trae legs (LegSymbols/LegMeta) y creditRatio,
    /// tanto en DORMANT como en ARMED/TRIGGERED — el candidato es uno solo, coherente para estado y display.
    /// </summary>
    public class RpfTickResult
    {
        public string Symbol { get; set; } = "";

        /// <summary>Layer 1 — macro_regime (6 checks, misma lógica que la cascada para preservar el gate de estado).</summary>
        public MacroRegimeResult? MacroRegime { get; set; }

        /// <summary>Candidato PCS con strikes, delta, walls, POP, legs (DXLink) y creditRatio. Siempre poblado si hay strikes.</summary>
        public StrikeEngineResult? StrikeEngine { get; set; }

        /// <summary>Layer 3 — microestructura (OI/spread/crédito). El MidCredit alimenta creditRatio y el gate edge.</summary>
        public MicrostructureResult? Microstructure { get; set; }

        /// <summary>Layer 4 — sizing (contracts/maxLoss/heat/posiciones).</summary>
        public RiskAndSizingResult? RiskAndSizing { get; set; }

        /// <summary>Signal gates (VRP, tail, edge, credit, wall). Null si la cascada cortó antes (no evaluados).</summary>
        public SignalGatesResult? SignalGates { get; set; }

        /// <summary>OPERAR / ESPERAR / NO_OPERAR — veredicto de la cascada (espejo del de la cascada de Main).</summary>
        public string OverallSignal { get; set; } = "NO_OPERAR";

        /// <summary>Capa donde cortó (1=macro, 2=strike/gates, 3=micro, 4=sizing), o null si llegó al final.</summary>
        public int? FailedAtLayer { get; set; }

        /// <summary>
        /// true = este tick reusó los insumos de Tier A del cache (no barrió la cadena).
        /// Va al log del loop: sin esto, un cache que deja de refrescarse es invisible — se vería
        /// como ticks rápidos y sanos mientras el macro se congela. Mismo criterio que la traza de
        /// tres puntos: lo que no se puede observar, no se puede diagnosticar.
        /// </summary>
        public bool TierAFromCache { get; set; }

        /// <summary>Antigüedad de los insumos de Tier A al momento del tick, en segundos.</summary>
        public int TierAAgeSec { get; set; }
    }
}
