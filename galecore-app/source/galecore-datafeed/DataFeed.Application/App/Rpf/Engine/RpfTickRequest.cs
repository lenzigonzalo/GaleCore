using MediatR;
using System.Text.Json.Serialization;

namespace DataFeed.Application.App.Rpf.Engine
{
    /// <summary>
    /// Tick del motor RPF — motor de decisión PROPIO de RPF (Nivel 1, corte total). Reemplaza a la
    /// dupla ValidationLayerRequest + PositionBuilderRequest que RPF usaba (compartida con Main).
    /// Corre macro + candidato (siempre, con legs) + signal_gates sobre galecore_rules_rpf.json en un
    /// solo paso. Reusa los primitivos ya compartidos (VLH.* estáticos, SignalGatesEvaluator) sin tocar
    /// los handlers de Main. Handler: <see cref="RpfTickHandler"/>.
    /// </summary>
    public class RpfTickRequest : IRequest<RpfTickResult>
    {
        public string Symbol { get; set; } = "";

        /// <summary>Contenido de Files/galecore_rules_rpf.json — fuente de verdad de RPF.</summary>
        [JsonIgnore]
        public string? RulesJson { get; set; }

        /// <summary>Files/pop_calibration.json (tabla POP empírica del gate edge).</summary>
        [JsonIgnore]
        public string? PopCalibrationJson { get; set; }

        /// <summary>Files/skew25_history.json (serie diaria para el RoC 5d de tail_score).</summary>
        [JsonIgnore]
        public string? SkewHistoryJson { get; set; }

        /// <summary>Cuenta para balances/posiciones en el sizing (Layer 4).</summary>
        public string? AccountNumber { get; set; }
    }
}
