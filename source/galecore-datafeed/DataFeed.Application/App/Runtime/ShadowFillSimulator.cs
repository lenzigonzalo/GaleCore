using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Fill simulado al mid-price, determinístico (P0 §8.6).
    /// No hay llamada al broker. EXECUTION_UNKNOWN no es posible.
    /// El fill es inmediato y siempre resuelve.
    /// </summary>
    public static class ShadowFillSimulator
    {
        /// <summary>
        /// Crea una ShadowPosition a partir de un TradeCandidate validado.
        /// Entry price de cada leg = mid-price real (bid+ask)/2. Si una pata no tiene una cotización
        /// utilizable, no hay fill: lanza InvalidOperationException (datos reales o nada, GC-0002).
        /// </summary>
        public static ShadowPosition Fill(TradeCandidate candidate, DateTime now)
        {
            var legs = candidate.Legs.Select(leg => new ShadowLeg
            {
                Side = leg.Side,
                Type = leg.Type,
                Strike = leg.Strike,
                Expiration = leg.Expiration,
                OccSymbol = leg.OccSymbol,
                StreamerSymbol = leg.StreamerSymbol,
                Quantity = leg.Quantity,
                EntryPrice = ComputeMidPrice(leg)
                    ?? throw new InvalidOperationException(
                        $"Sin cotización utilizable para la pata {leg.Side} {leg.Type} {leg.Strike}: no hay fill"),
                Delta = leg.Delta
            }).ToList();

            return new ShadowPosition
            {
                PositionId = Guid.NewGuid().ToString(),
                InstanceId = candidate.InstanceId,
                CandidateId = candidate.CandidateId,
                Symbol = candidate.Symbol,
                Structure = candidate.Structure,
                Legs = legs,
                Status = "OPEN",
                EntryCredit = candidate.Credit,
                MaxRisk = candidate.MaxRisk,
                Width = candidate.Width,
                EntryDte = candidate.Dte,
                EntryAt = now,
                CreatedAt = now,
                UpdatedAt = now
            };
        }

        /// <summary>
        /// Multiplicador del P&L por unidad de precio: 100 por contrato de opciones; en long_equity, las acciones.
        /// </summary>
        public static double Multiplier(ShadowPosition position) =>
            position.Structure == RuntimeStructures.LongEquity ? position.Legs.FirstOrDefault()?.Quantity ?? 1 : 100;

        /// <summary>P&L no realizado / realizado: (entrada − valor de cierre) × multiplicador, en USD.</summary>
        public static double Pnl(ShadowPosition position, double closeValue) =>
            Math.Round((position.EntryCredit - closeValue) * Multiplier(position), 2);

        /// <summary>Mid-price real del leg, o null si no tiene una cotización utilizable.</summary>
        public static double? ComputeMidPrice(CandidateLeg leg)
        {
            if (leg.Bid.HasValue && leg.Ask.HasValue && QuoteRules.IsUsable(leg.Bid.Value, leg.Ask.Value))
                return Math.Round((leg.Bid.Value + leg.Ask.Value) / 2.0, 2);
            return null;
        }

        /// <summary>
        /// Evalúa exits determinísticos contra una posición abierta.
        /// Devuelve la razón de exit si alguno se dispara, null si no.
        /// Precedencia: STOP_LOSS > METRIC_EXIT > TAKE_PROFIT > TIME_EXIT.
        /// <paramref name="metricExitMet"/>: la condición de exits.MetricExit se cumple ahora (la evalúa el motor con el dato real).
        /// </summary>
        public static string? EvaluateExits(
            ShadowPosition position,
            DeterministicExits exits,
            double currentSpreadValue,
            int currentDte,
            bool metricExitMet = false)
        {
            if (position.Status != "OPEN") return null;

            // Stop loss: pérdida >= pct del crédito
            if (exits.StopLoss != null)
            {
                double stopThreshold = position.EntryCredit * (exits.StopLoss.PctOfCredit / 100.0);
                double currentLoss = currentSpreadValue - position.EntryCredit;
                if (currentLoss >= stopThreshold)
                    return "STOP_LOSS";
            }

            // Salida por métrica (WS-0061)
            if (exits.MetricExit != null && metricExitMet)
                return "METRIC_EXIT";

            // Take profit: spread vale <= (100 - pct)% del crédito
            if (exits.TakeProfit != null)
            {
                double profitTarget = position.EntryCredit * (1.0 - exits.TakeProfit.PctOfCredit / 100.0);
                if (currentSpreadValue <= profitTarget)
                    return "TAKE_PROFIT";
            }

            // Time exit: DTE <= max_dte
            if (exits.TimeExit != null && currentDte <= exits.TimeExit.MaxDte)
                return "TIME_EXIT";

            return null;
        }

        /// <summary>Cierra una posición SHADOW con razón y debit.</summary>
        public static ShadowPosition Close(ShadowPosition position, double exitDebit, string reason, DateTime now)
        {
            double realizedPnl = Pnl(position, exitDebit); // x100 por contrato en opciones; x acciones en long_equity

            return position with
            {
                Status = "CLOSED",
                ExitDebit = exitDebit,
                ExitAt = now,
                ExitReason = reason,
                RealizedPnl = realizedPnl,
                UnrealizedPnl = null,
                UpdatedAt = now
            };
        }
    }
}
