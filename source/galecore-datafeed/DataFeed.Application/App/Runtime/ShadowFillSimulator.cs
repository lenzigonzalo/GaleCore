using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Fill simulado, determinístico (P0 §8.6): natural por defecto (se compra al ask y se vende al bid), o al mid /
    /// mid con deslizamiento según spec.execution (WS-0062), más costos declarados en el P&L.
    /// No hay llamada al broker. EXECUTION_UNKNOWN no es posible.
    /// El fill es inmediato y siempre resuelve.
    /// </summary>
    public static class ShadowFillSimulator
    {
        /// <summary>Razón de cierre de una posición liquidada al vencimiento (WS-0062 inc.3).</summary>
        public const string ExpirationReason = "EXPIRATION";

        /// <summary>
        /// Crea una ShadowPosition a partir de un TradeCandidate validado.
        /// Entry price de cada leg según el modelo (abrir: vendidas al bid, compradas al ask en natural). Si una pata no
        /// tiene una cotización utilizable, no hay fill: lanza InvalidOperationException (datos reales o nada, GC-0002).
        /// </summary>
        public static ShadowPosition Fill(TradeCandidate candidate, DateTime now, ExecutionTerms? terms = null)
        {
            terms ??= new ExecutionTerms();
            var legs = candidate.Legs.Select(leg => new ShadowLeg
            {
                Side = leg.Side,
                Type = leg.Type,
                Strike = leg.Strike,
                Expiration = leg.Expiration,
                OccSymbol = leg.OccSymbol,
                StreamerSymbol = leg.StreamerSymbol,
                Quantity = leg.Quantity,
                EntryPrice = EntryPrice(leg, terms)
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
                EntryContext = new EntryContext { Execution = terms },
                CreatedAt = now,
                UpdatedAt = now
            };
        }

        /// <summary>
        /// Multiplicador del P&L por unidad de precio: 100 por contrato de opciones; en long_equity, las acciones.
        /// </summary>
        public static double Multiplier(ShadowPosition position) =>
            position.Structure == RuntimeStructures.LongEquity
                ? position.Legs.FirstOrDefault()?.Quantity
                    ?? throw new InvalidOperationException(
                        $"La posición de acciones {position.PositionId} no tiene cantidad en su pata: no se puede calcular el P&L ni el costo.")
                : 100;

        /// <summary>Las condiciones con que se abrió la posición; las anteriores a WS-0062 entraron al mid y sin costos.</summary>
        public static ExecutionTerms TermsOf(ShadowPosition position) => position.EntryContext?.Execution ?? ExecutionTerms.Legacy;

        /// <summary>
        /// Precio de una pata según el modelo: desde el medio, hacia el lado desfavorable (compra más caro, venta más barato)
        /// la fracción que marca el modelo del medio spread. Con fill mid es el medio.
        /// </summary>
        public static double LegPrice(double bid, double ask, bool buying, ExecutionTerms terms, int decimals) =>
            Math.Round((bid + ask) / 2.0 + (buying ? 1 : -1) * terms.AdverseFraction * (ask - bid) / 2.0, decimals);

        /// <summary>Precio de entrada de una pata (abrir: BUY paga, SELL cobra); null sin cotización utilizable.</summary>
        public static double? EntryPrice(CandidateLeg leg, ExecutionTerms terms)
        {
            if (!(leg.Bid.HasValue && leg.Ask.HasValue && QuoteRules.IsUsable(leg.Bid.Value, leg.Ask.Value))) return null;
            // Al mid se conserva el redondeo a centavos de siempre.
            return LegPrice(leg.Bid.Value, leg.Ask.Value, leg.Side == "BUY", terms, terms.AdverseFraction == 0 ? 2 : 4);
        }

        /// <summary>Costo declarado de UNA orden (la de entrada o la de salida), en USD.</summary>
        public static double OrderCost(ShadowPosition position, ExecutionTerms terms)
        {
            double units = position.Legs.Sum(l => l.Quantity ?? 1);   // contratos (1 por pata) o acciones
            double perUnit = position.Structure == RuntimeStructures.LongEquity ? terms.PerShareUsd : terms.PerContractUsd;
            return Math.Round(perUnit * units + terms.PerOrderUsd, 2);
        }

        /// <summary>P&L bruto, sin costos: (entrada − valor de cierre) × multiplicador, en USD.</summary>
        public static double GrossPnl(ShadowPosition position, double closeValue) =>
            Math.Round((position.EntryCredit - closeValue) * Multiplier(position), 2);

        /// <summary>
        /// P&L NETO (el que se guarda y se mide): bruto menos la orden de entrada y la de salida. Una abierta descuenta
        /// también la salida: es lo que daría cerrarla ahora.
        /// </summary>
        public static double Pnl(ShadowPosition position, double closeValue, bool atExpiration = false)
        {
            var terms = TermsOf(position);
            return Math.Round(GrossPnl(position, closeValue) - OrdersCharged(position, atExpiration) * OrderCost(position, terms), 2);
        }

        /// <summary>
        /// Órdenes con costo: entrada + salida. Una posición liquidada al vencimiento no tiene orden de salida: sólo paga la de entrada.
        /// </summary>
        private static int OrdersCharged(ShadowPosition position, bool atExpiration) =>
            atExpiration || position.ExitReason == ExpirationReason ? 1 : 2;

        /// <summary>Costos declarados de la posición (entrada + salida si la hubo), en USD.</summary>
        public static double Costs(ShadowPosition position) =>
            Math.Round(OrdersCharged(position, false) * OrderCost(position, TermsOf(position)), 2);

        /// <summary>P&L bruto de una posición ya valuada o cerrada (neto + costos); null si no tiene P&L.</summary>
        public static double? GrossOf(ShadowPosition position)
        {
            var net = position.Status == "CLOSED" ? position.RealizedPnl : position.UnrealizedPnl;
            return net == null ? null : Math.Round(net.Value + Costs(position), 2);
        }

        /// <summary>Mid-price real del leg (no el precio de fill), o null si no tiene una cotización utilizable.</summary>
        public static double? ComputeMidPrice(CandidateLeg leg)
        {
            if (leg.Bid.HasValue && leg.Ask.HasValue && QuoteRules.IsUsable(leg.Bid.Value, leg.Ask.Value))
                return Math.Round((leg.Bid.Value + leg.Ask.Value) / 2.0, 2);
            return null;
        }

        /// <summary>
        /// Evalúa exits determinísticos contra una posición abierta.
        /// Devuelve la razón de exit si alguno se dispara, null si no.
        /// Precedencia: STOP_LOSS > METRIC_EXIT > TAKE_PROFIT > TIME_EXIT. El vencimiento (EXPIRATION) manda sobre todas
        /// y no pasa por acá: lo liquida el motor antes de valuar con cotizaciones.
        /// <paramref name="metricExitMet"/>: la condición de exits.MetricExit se cumple ahora (la evalúa el motor con el dato real).
        /// </summary>
        public static string? EvaluateExits(
            ShadowPosition position,
            DeterministicExits exits,
            double currentSpreadValue,
            int currentDte,
            bool metricExitMet = false,
            bool timeOfDayReached = false,
            bool eventExitMet = false)
        {
            if (position.Status != "OPEN") return null;

            // Estructuras de débito (EntryCredit < 0, p. ej. acciones o custom_options con max_debit): take profit y stop loss son % del
            // COSTO de entrada, sobre el P&L por unidad (entrada − valor de cierre, ya con el modelo de fill del valor de cierre).
            // Las de crédito no cambian: siguen siendo % del crédito.
            double pnlPerUnit = position.EntryCredit - currentSpreadValue;
            double cost = -position.EntryCredit;

            // Stop loss: pérdida >= pct del crédito (o del costo)
            if (exits.StopLoss != null)
            {
                if (exits.StopLoss.PctOfCost is double slCost)
                {
                    if (position.EntryCredit < 0 && pnlPerUnit <= -cost * (slCost / 100.0))
                        return "STOP_LOSS";
                }
                else
                {
                    double stopThreshold = position.EntryCredit * (exits.StopLoss.PctOfCredit / 100.0);
                    double currentLoss = currentSpreadValue - position.EntryCredit;
                    if (currentLoss >= stopThreshold)
                        return "STOP_LOSS";
                }
            }

            // Salida por métrica (WS-0061)
            if (exits.MetricExit != null && metricExitMet)
                return "METRIC_EXIT";
            if (eventExitMet)
                return "EVENT_EXIT";

            // Take profit: spread vale <= (100 - pct)% del crédito; en débito, ganancia >= pct% del costo
            if (exits.TakeProfit != null)
            {
                if (exits.TakeProfit.PctOfCost is double tpCost)
                {
                    if (position.EntryCredit < 0 && pnlPerUnit >= cost * (tpCost / 100.0))
                        return "TAKE_PROFIT";
                }
                else
                {
                    double profitTarget = position.EntryCredit * (1.0 - exits.TakeProfit.PctOfCredit / 100.0);
                    if (currentSpreadValue <= profitTarget)
                        return "TAKE_PROFIT";
                }
            }

            // Time exit: DTE <= max_dte, o la hora del día de vencimiento (at, ya evaluada por el motor)
            if (exits.TimeExit != null
                && ((exits.TimeExit.MaxDte is int maxDte && currentDte <= maxDte) || (exits.TimeExit.At != null && timeOfDayReached)))
                return "TIME_EXIT";

            return null;
        }

        /// <summary>Cierra una posición SHADOW con razón y debit.</summary>
        public static ShadowPosition Close(ShadowPosition position, double exitDebit, string reason, DateTime now)
        {
            double realizedPnl = Pnl(position, exitDebit, reason == ExpirationReason); // x100 por contrato en opciones; x acciones en long_equity

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
