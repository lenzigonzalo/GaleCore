using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Cuántos contratos abre una posición de opciones (WS-0062 inc.10), según candidate_construction.sizing de la spec. Todas las patas
    /// llevan la misma cantidad N (sin ratios) y N queda en Quantity de cada una; el candidato que construye el constructor es de UN
    /// contrato y acá se escala: la pérdida máxima (MaxRisk) pasa a ser la de N contratos, y el tope por apuesta, el presupuesto de riesgo,
    /// el margen intradiario y los frenos miden esa pérdida. Crédito, ancho y precios siguen siendo por unidad (un contrato).
    ///
    /// FIXED: N = fixed_contracts. RISK_BASED: N = floor(tope por operación / pérdida máxima de un contrato), con el tope que el runtime
    /// ya usa (el menor de max_risk_per_trade_pct × equity y max_loss_per_trade_usd; <see cref="ShadowCapital.PerTradeCapUsd"/>, la misma
    /// fórmula del reparto de capital). Sin tope calculable o con N &lt; 1 no entra, con el motivo: nunca se inventa N. long_equity no pasa
    /// por acá (su cantidad ya son las acciones de fixed_contracts). Función pura.
    /// </summary>
    public static class ShadowSizing
    {
        public const string Fixed = "FIXED";
        public const string RiskBased = "RISK_BASED";

        /// <param name="equity">Capital simulado + P&amp;L realizado (<see cref="ShadowRiskControls.Equity"/>); null sin capital declarado.</param>
        /// <returns>El candidato de N contratos, o null y el motivo por el que no entra.</returns>
        public static (TradeCandidate? Candidate, string? Reason) Apply(StrategySpec spec, TradeCandidate candidate, double? equity)
        {
            if (candidate.Structure == RuntimeStructures.LongEquity) return (candidate, null);
            var sizing = spec.CandidateConstruction.Sizing;
            int n;
            switch (sizing.Method)
            {
                case Fixed:
                    if (sizing.FixedContracts is not > 0)
                        return (null, "sizing FIXED sin fixed_contracts > 0: no se sabe cuántos contratos abrir");
                    n = sizing.FixedContracts.Value;
                    break;
                case RiskBased:
                {
                    var r = spec.RiskLimits;
                    double? pctCap = r.MaxRiskPerTradePct is double pct && equity is double e && e > 0 ? e * pct / 100 : null;
                    if (ShadowCapital.PerTradeCapUsd(pctCap, r.MaxLossPerTradeUsd) is not double cap)
                        return (null, "sizing RISK_BASED sin tope por operación calculable: la spec necesita max_loss_per_trade_usd, "
                                      + "o max_risk_per_trade_pct con capital simulado");
                    if (!(candidate.MaxRisk > 0))
                        return (null, $"pérdida máxima de un contrato no positiva ({candidate.MaxRisk}): no se puede dimensionar");
                    n = ShadowCapital.ContractsWithin(cap, candidate.MaxRisk);
                    if (n < 1)
                        return (null, $"ni un contrato entra: pérdida máxima de {candidate.MaxRisk:0.00} USD por contrato, tope por operación de {cap:0.00} USD");
                    break;
                }
                default:
                    return (null, $"sizing.method '{sizing.Method}' no se ejecuta con opciones (FIXED o RISK_BASED)");
            }
            return (candidate with
            {
                MaxRisk = Math.Round(candidate.MaxRisk * n, 2),
                Legs = candidate.Legs.Select(l => l with { Quantity = n }).ToList(),
            }, null);
        }
    }
}
