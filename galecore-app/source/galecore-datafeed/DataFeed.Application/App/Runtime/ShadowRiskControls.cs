using DataFeed.Application.App.Runtime.Contracts;
using System.Globalization;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>Un control de riesgo que bloquea una entrada: el nombre del límite y el motivo, para el evento ENTRY_SKIPPED.</summary>
    public record RiskBlock(string Limit, string Reason);

    /// <summary>
    /// Controles de riesgo que el runtime hace cumplir (WS-0062 inc.6): freno por pérdida, tope por apuesta, presupuesto de riesgo y margen
    /// intradiario. Funciones puras que reciben las posiciones de la estrategia y la hora. Sin capital simulado declarado
    /// (risk_limits.simulated_capital_usd) no hay contra qué medir: sólo valen los frenos en USD. Nunca cierran posiciones abiertas:
    /// sólo bloquean entradas nuevas.
    /// </summary>
    public static class ShadowRiskControls
    {
        public const string BasisRealized = "realized";
        public const string BasisRealizedPlusOpen = "realized_plus_open";
        public static readonly string[] Periods = { "day", "week", "total" };

        /// <summary>
        /// Mínimo de equity de una cuenta de margen (FINRA 4210, en vigor desde el 04/06/2026, reemplazó la regla PDT y sus 25.000 USD). Una
        /// estructura con una pata corta de opción necesita cuenta de margen.
        /// </summary>
        public const double MarginAccountMinimumUsd = 2000;

        public static class Limits
        {
            public const string LossBrake = "loss_brake";
            public const string MaxBet = "max_bet";
            public const string RiskBudget = "risk_budget";
            public const string MarginAccountMinimum = "margin_account_minimum";
            public const string IntradayMargin = "intraday_margin";
        }

        /// <summary>Los límites de capital de la spec (los mismos de ShadowCapital), o null si no declara capital simulado.</summary>
        public static CapitalLimits? CapitalOf(SpecRiskLimits r) => r.SimulatedCapitalUsd is double capital
            ? new CapitalLimits
            {
                Capital = capital,
                ReservePct = r.ReservePct ?? 0,
                MaxRiskPerTradePct = r.MaxRiskPerTradePct ?? 100,
                MaxOpenRiskPct = r.MaxOpenRiskPct ?? 100,
                MaxBetPct = r.MaxBetPct ?? 100,
            }
            : null;

        /// <summary>Equity de la estrategia: capital simulado + P&amp;L realizado neto de las posiciones cerradas. null sin capital declarado.</summary>
        public static double? Equity(StrategySpec spec, IEnumerable<ShadowPosition> positions) =>
            spec.RiskLimits.SimulatedCapitalUsd is double capital
                ? capital + positions.Where(p => p.Status == "CLOSED" && p.RealizedPnl != null).Sum(p => p.RealizedPnl!.Value)
                : null;

        // ── Freno por pérdida (no depende del candidato: se chequea antes de armarlo) ──

        /// <summary>
        /// El primer freno por pérdida vencido, o null. <paramref name="scope"/>: posiciones de la estrategia (también lo que dejaron las
        /// instancias paradas), para day y week. <paramref name="thisInstance"/>: sólo la instancia actual, para "total": redesplegar la
        /// estrategia (instancia nueva) lo levanta; day y week se levantan solos al cambiar el período.
        /// </summary>
        public static RiskBlock? LossBrake(StrategySpec spec, IReadOnlyCollection<ShadowPosition> scope,
            IReadOnlyCollection<ShadowPosition> thisInstance, DateTime nowUtc)
        {
            if (spec.RiskLimits.LossBrakes is not { Count: > 0 } brakes) return null;
            if (ShadowSession.LocalTime(spec.Operational, nowUtc) is not DateTime now)
                return new RiskBlock(Limits.LossBrake, $"zona horaria ilegible ({spec.Operational.Timezone}): no se puede medir la pérdida del período");
            var monday = now.Date.AddDays(-(((int)now.DayOfWeek + 6) % 7));

            foreach (var b in brakes)
            {
                double? limit = b.MaxLossUsd
                    ?? (b.MaxLossPctOfCapital is double pct && spec.RiskLimits.SimulatedCapitalUsd is double cap ? cap * pct / 100 : null);
                if (limit == null) continue;   // el validador lo rechaza; sin límite medible no se inventa uno
                var positions = b.Period == "total" ? thisInstance : scope;
                bool InPeriod(ShadowPosition p)
                {
                    if (b.Period == "total") return true;
                    if (ShadowSession.LocalTime(spec.Operational, p.ExitAt!.Value)?.Date is not DateTime d) return false;
                    return b.Period == "day" ? d == now.Date : d >= monday && d < monday.AddDays(7);
                }

                double pnl = positions.Where(p => p.Status == "CLOSED" && p.RealizedPnl != null && p.ExitAt != null && InPeriod(p))
                    .Sum(p => p.RealizedPnl!.Value);
                if (b.Basis == BasisRealizedPlusOpen)
                {
                    var open = positions.Where(p => p.Status == "OPEN").ToList();
                    // Una abierta sin valuación vigente no se puede medir: NO_DATA, y se bloquea (conservador).
                    int unvalued = open.Count(p => p.UnrealizedPnl == null || p.ValuationProblems is { Count: > 0 });
                    if (unvalued > 0)
                        return new RiskBlock(Limits.LossBrake,
                            $"NO_DATA: freno por pérdida ({b.Period}, realizada + abiertas) sin valuación de {unvalued} posición(es) abierta(s)");
                    pnl += open.Sum(p => p.UnrealizedPnl!.Value);
                }
                double loss = -pnl;
                if (loss >= limit.Value - 1e-9)
                    return new RiskBlock(Limits.LossBrake,
                        $"freno por pérdida ({b.Period}): pérdida de {Usd(loss)} USD ≥ límite de {Usd(limit.Value)} USD "
                        + $"({(b.Basis == BasisRealizedPlusOpen ? "realizada + abiertas" : "realizada")})"
                        + (b.Period == "total" ? "; sigue hasta redesplegar la estrategia" : "; se levanta al cambiar el período"));
            }
            return null;
        }

        // ── Controles que dependen del candidato ──

        /// <summary>
        /// Tope por apuesta, presupuesto de riesgo y margen intradiario para <paramref name="candidate"/>, en ese orden; null si entra.
        /// <paramref name="scope"/> son las posiciones de la estrategia (abiertas y cerradas). Sin capital simulado declarado no bloquea.
        /// </summary>
        public static RiskBlock? CandidateBlock(StrategySpec spec, TradeCandidate candidate, IReadOnlyCollection<ShadowPosition> scope)
        {
            if (CapitalOf(spec.RiskLimits) is not CapitalLimits limits) return null;
            var open = scope.Where(p => p.Status == "OPEN").ToList();
            double openRisk = open.Sum(p => p.MaxRisk);

            // Apuesta = subyacente + dirección + semana ISO de vencimiento, como ShadowCapital.Exposure.
            var week = ShadowCapital.ExpiryWeek(candidate.Legs
                .Select(l => DateTime.TryParse(l.Expiration, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : (DateTime?)null)
                .Where(d => d != null).Min()) ?? "?";
            var direction = ShadowCapital.Direction(candidate.Structure);
            double betRisk = open.Where(p => p.Symbol == candidate.Symbol && ShadowCapital.Direction(p.Structure) == direction
                    && (ShadowCapital.ExpiryWeek(ShadowCapital.Expiration(p)) ?? "?") == week).Sum(p => p.MaxRisk);
            if (betRisk + candidate.MaxRisk > limits.MaxBetUsd + 1e-9)
                return new RiskBlock(Limits.MaxBet,
                    $"tope por apuesta ({candidate.Symbol} {direction} {week}): abierto {Usd(betRisk)} + nueva {Usd(candidate.MaxRisk)} USD supera el tope de {Usd(limits.MaxBetUsd)} USD");

            if (openRisk + candidate.MaxRisk > limits.RiskBudgetUsd + 1e-9)
                return new RiskBlock(Limits.RiskBudget,
                    $"presupuesto de riesgo: abierto {Usd(openRisk)} + nueva {Usd(candidate.MaxRisk)} USD supera {Usd(limits.RiskBudgetUsd)} USD");

            // Margen intradiario (reemplaza a PDT). equity = capital simulado + P&L realizado neto. Requisito de cada posición = su MaxRisk:
            // riesgo definido en opciones, costo entero en acciones y opciones largas. Conservador: sin el 50 % de Reg T para acciones.
            double equity = Equity(spec, scope)!.Value;
            bool needsMarginAccount = candidate.Legs.Any(l => l.Side == "SELL" && l.Type != LongEquityCandidateBuilder.LegType);
            if (needsMarginAccount && equity < MarginAccountMinimumUsd)
                return new RiskBlock(Limits.MarginAccountMinimum,
                    $"mínimo de {Usd(MarginAccountMinimumUsd)} USD de cuenta de margen: la estructura tiene una pata corta y el equity es {Usd(equity)} USD");
            if (openRisk + candidate.MaxRisk > equity - limits.ReserveUsd + 1e-9)
                return new RiskBlock(Limits.IntradayMargin,
                    $"margen intradiario: requisito abierto {Usd(openRisk)} + nuevo {Usd(candidate.MaxRisk)} USD supera el equity {Usd(equity)} menos la reserva {Usd(limits.ReserveUsd)} USD");
            return null;
        }

        private static string Usd(double v) => v.ToString("0.00", CultureInfo.InvariantCulture);
    }
}
