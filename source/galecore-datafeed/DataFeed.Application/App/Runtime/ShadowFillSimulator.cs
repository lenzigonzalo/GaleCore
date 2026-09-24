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
        /// Entry price de cada leg = mid-price (bid+ask)/2. Si bid/ask no están disponibles,
        /// se usa el crédito total del candidato repartido proporcionalmente.
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
                EntryPrice = ComputeMidPrice(leg),
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

        /// <summary>Mid-price del leg. Si no hay bid/ask, devuelve 0 (el crédito viene del candidato).</summary>
        public static double ComputeMidPrice(CandidateLeg leg)
        {
            if (leg.Bid.HasValue && leg.Ask.HasValue)
                return Math.Round((leg.Bid.Value + leg.Ask.Value) / 2.0, 2);
            return 0;
        }

        /// <summary>
        /// Evalúa exits determinísticos contra una posición abierta.
        /// Devuelve la razón de exit si alguno se dispara, null si no.
        /// Precedencia: STOP_LOSS > TAKE_PROFIT > TIME_EXIT.
        /// </summary>
        public static string? EvaluateExits(
            ShadowPosition position,
            DeterministicExits exits,
            double currentSpreadValue,
            int currentDte)
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
            double realizedPnl = Math.Round((position.EntryCredit - exitDebit) * 100, 2); // per contract, x100 for options

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
