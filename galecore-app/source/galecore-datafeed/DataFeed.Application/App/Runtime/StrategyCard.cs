using DataFeed.Application.App.Runtime.Contracts;
using System.Collections.Generic;

namespace DataFeed.Application.App.Runtime
{
    public record StrategyCardWindow(string Start, string End, string Timezone);

    public record StrategyCardLimits(double? Capital, double? PerTrade, double? OpenRisk, double? PerBet);

    public record StrategyCardDto(
        string SpecName, string? Version, string? ContentHash, StrategyCardWindow? Window, int? MaxEntriesPerDay, StrategyCardLimits LimitsUsd,
        StrategyStallDto? Stall = null);

    /// <summary>
    /// Ficha de una estrategia (WS-0098 inc.3): ventana de entrada, entradas por día y límites en USD, derivados de la spec.
    /// Función pura; un dato faltante da null (nunca se adivina) y los valores no se redondean.
    /// </summary>
    public static class StrategyCard
    {
        public static StrategyCardDto Build(StrategySpec spec, IEnumerable<OperationalEvent>? events = null)
        {
            var op = spec.Operational;
            var window = op.EntryWindow is EntryWindow w ? new StrategyCardWindow(w.Start, w.End, op.Timezone) : null;

            // Los mismos límites y defaults que aplica el motor (ShadowRiskControls.CapitalOf: lo no declarado es 100 %):
            // sin capital simulado no hay límites en USD. Mostrar otra cosa que lo que el motor ejecuta sería mentir.
            var r = spec.RiskLimits;
            var limits = ShadowRiskControls.CapitalOf(r);
            var usd = limits == null ? new StrategyCardLimits(null, null, null, null)
                : new StrategyCardLimits(limits.Capital, ShadowCapital.PerTradeCapUsd(limits.MaxRiskPerTradeUsd, r.MaxLossPerTradeUsd),
                    limits.MaxOpenRiskUsd, limits.MaxBetUsd);

            return new StrategyCardDto(
                spec.Identity.Name, spec.Identity.Version, spec.ContentHash, window,
                op.TradeLimits?.MaxEntriesPerDay, usd, events == null ? null : StrategyStall.Compute(events));
        }
    }
}
