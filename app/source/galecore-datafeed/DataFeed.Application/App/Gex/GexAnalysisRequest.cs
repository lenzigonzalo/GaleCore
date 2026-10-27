using MediatR;
using System.Text.Json.Serialization;

namespace DataFeed.Application.App.Gex
{
    /// <summary>
    /// Request de GET /App/Gex/Analysis — estrategia GEX (informativa).
    /// </summary>
    public class GexAnalysisRequest : IRequest<GexAnalysisResponse>
    {
        /// <summary>Símbolo del subyacente (debe estar en universe.tickers del JSON de GEX).</summary>
        public string Symbol { get; set; } = "";

        /// <summary>true = ignora el cache y vuelve a barrer la cadena.</summary>
        public bool Refresh { get; set; } = false;

        /// <summary>
        /// false = el switch de la estrategia está en OFF: no se barre la cadena ni se toca DXLink,
        /// se devuelve lo último que quedó en cache marcado como congelado. Lo inyecta el controller
        /// desde GexStrategySwitch; no es un parámetro de la query.
        /// </summary>
        [JsonIgnore]
        public bool AllowScan { get; set; } = true;

        /// <summary>
        /// Contenido de Files/Gex/galecore_rules_gex.json. Lo inyecta el controller — el handler
        /// no lee del disco (misma convención que ValidationLayerRequest.RulesJson).
        /// </summary>
        [JsonIgnore]
        public string? RulesJson { get; set; }
    }
}
