using DataFeed.Application.App.Shared.Dtos;

namespace DataFeed.Application.App.Rpf
{
    /// <summary>Un check con etiqueta legible + valor/umbral, para pintar una fila del tablero.</summary>
    public class RpfCheck
    {
        public string Id { get; set; } = "";
        public string Label { get; set; } = "";
        /// <summary>pass | fail | skipped | no_data | pending (no evaluado: la cascada cortó antes).</summary>
        public string Status { get; set; } = "pending";
        public double? Value { get; set; }
        public double? Threshold { get; set; }
        public string? Detail { get; set; }
    }

    /// <summary>La posición PCS candidata que el motor arma (se muestra siempre, aun DORMANT).</summary>
    public class RpfCandidate
    {
        public double? ShortPutStrike { get; set; }
        public double? LongPutStrike { get; set; }
        public double? ShortPutDelta { get; set; }
        public int Dte { get; set; }
        public string? Expiration { get; set; }
        public double? Credit { get; set; }
        public double? Width { get; set; }
        public double? CreditRatio { get; set; }   // fracción del ancho (0.21 = 21%)
        public double? Pop { get; set; }
        public double? PutWall { get; set; }
        public double? Edge { get; set; }
        public double? Bar { get; set; }
        /// <summary>true si viene de la cascada (macro pasó); false si del motor macro-independiente.</summary>
        public bool FromCascade { get; set; }
        /// <summary>Símbolos DXLink streamer de cada leg — el tablero RPF los suscribe al socket para primas en vivo.</summary>
        public LegSymbols? LegSymbols { get; set; }
        /// <summary>OI + cierre anterior por leg — sublínea de cada strike en el candidato.</summary>
        public LegMetaSet? LegMeta { get; set; }
    }

    /// <summary>
    /// Snapshot del estado del loop por símbolo (diseño Fase 5 §5.4, enriquecido). Se emite al grupo
    /// SignalR "rpf" (evento ReceiveRpfState) en cada tick (heartbeat). Lleva el detalle que el loop ya
    /// computa — los gates de "arma" (macro + señal) con valor/umbral y el candidato de "dispara" — para
    /// que el tablero represente la lógica de la estrategia, no solo el estado resultante.
    /// </summary>
    public class RpfStateUpdate
    {
        public string Symbol { get; set; } = "";
        /// <summary>Estado canónico (IN_POSITION/VETOED/DORMANT/ARMED/WAITING_CAPACITY/COOLDOWN/TRIGGERED).</summary>
        public string State { get; set; } = "";

        public double? Edge { get; set; }
        public double? Bar { get; set; }
        public string? Regime { get; set; }
        public bool CapacityAvailable { get; set; }
        public int OpenPositions { get; set; }
        public int MaxPositions { get; set; }
        public double? HeatPct { get; set; }

        /// <summary>Segundos restantes de cooldown (null si no está en cooldown).</summary>
        public int? CooldownRemainingSec { get; set; }
        /// <summary>Id de la sugerencia vigente si el estado es TRIGGERED (para atar el ack).</summary>
        public string? SuggestionId { get; set; }

        // ── Eje ARMA (entorno): macro_regime + gates de señal (VRP, cola) ──
        public int MacroPassed { get; set; }
        public int MacroTotal { get; set; }
        /// <summary>Checks de macro_regime (VIX, estructura, momentum, GEX) con valor/umbral.</summary>
        public List<RpfCheck> MacroChecks { get; set; } = new();
        /// <summary>Gates de señal (VRP, tail, edge, credit, put_wall). Vacío si la cascada cortó en macro.</summary>
        public List<RpfCheck> Gates { get; set; } = new();

        // ── Eje DISPARA (spread) ──
        /// <summary>Posición PCS candidata; null si el motor no pudo armarla.</summary>
        public RpfCandidate? Candidate { get; set; }

        /// <summary>false si la cascada tiró excepción en este tick (el tablero lo marca).</summary>
        public bool CascadeOk { get; set; } = true;
        /// <summary>Capa donde cortó la cascada (1..4), o null si llegó al final.</summary>
        public int? DiedAtLayer { get; set; }

        public DateTime Timestamp { get; set; }
    }
}
