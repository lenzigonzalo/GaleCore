using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    public record StrategyCardWindow(string Start, string End, string Timezone);

    public record StrategyCardLimits(double? Capital, double? PerTrade, double? OpenRisk, double? PerBet);

    public record StrategyCardDto(
        string SpecName, string? Version, string? ContentHash, StrategyCardWindow? Window, int? MaxEntriesPerDay, StrategyCardLimits LimitsUsd);

    /// <summary>
    /// Ficha de una estrategia (WS-0098 inc.3): ventana de entrada, entradas por día y límites en USD, derivados de la spec.
    /// Función pura; un dato faltante da null (nunca se adivina) y los valores no se redondean.
    /// </summary>
    public static class StrategyCard
    {
        public static StrategyCardDto Build(StrategySpec spec)
        {
            var op = spec.Operational;
            var window = op.EntryWindow is EntryWindow w ? new StrategyCardWindow(w.Start, w.End, op.Timezone) : null;

            var r = spec.RiskLimits;
            double? capital = r.SimulatedCapitalUsd;
            double? perTrade = r.MaxLossPerTradeUsd
                ?? (capital != null && r.MaxRiskPerTradePct != null ? capital * r.MaxRiskPerTradePct / 100 : null);
            double? openRisk = capital != null && r.MaxOpenRiskPct != null ? capital * r.MaxOpenRiskPct / 100 : null;
            double? perBet = openRisk != null && r.MaxBetPct != null ? openRisk * r.MaxBetPct / 100 : null;

            return new StrategyCardDto(
                spec.Identity.Name, spec.Identity.Version, spec.ContentHash, window,
                op.TradeLimits?.MaxEntriesPerDay, new StrategyCardLimits(capital, perTrade, openRisk, perBet));
        }
    }
}
