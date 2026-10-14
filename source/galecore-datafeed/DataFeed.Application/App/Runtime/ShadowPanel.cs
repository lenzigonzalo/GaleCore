using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Panel de rendimiento de una estrategia en SHADOW (WS-0033, P1-10): curva, riesgo, resultados por régimen,
    /// regla de salida y versión, comparación con referencias, hipótesis y calidad de ejecución.
    ///
    /// Reutiliza ShadowPerformance (operaciones revisadas, brecha contra el plan) y ShadowCapital (límites).
    /// Sólo SHADOW: lee posiciones SHADOW y nunca toca la cartera real. Función pura, sin I/O.
    /// Lo que no existe es null con su motivo (<see cref="Metric.Reason"/>); nunca un cero ni una estimación.
    /// </summary>
    public record Metric
    {
        public double? Value { get; init; }
        /// <summary>Por qué no hay valor (null si lo hay).</summary>
        public string? Reason { get; init; }

        public static Metric Of(double value, int digits = 2) => new() { Value = Math.Round(value, digits) };
        public static Metric None(string reason) => new() { Reason = reason };
    }

    public record PanelOptions
    {
        public DateTime? From { get; init; }
        public DateTime? To { get; init; }
        /// <summary>Versión de la spec (SpecVersion); null = todas.</summary>
        public string? Version { get; init; }
        public double? ReferenceCapital { get; init; }
        public double? CashRatePct { get; init; }
        public double? Bond10yPct { get; init; }
        public double? TargetAnnualPct { get; init; }
        /// <summary>Criterio de la hipótesis: operaciones cerradas y días de período que pide.</summary>
        public int? HypothesisMinTrades { get; init; }
        public int? HypothesisMinDays { get; init; }
        /// <summary>Con menos cerradas que esto Sharpe y Sortino no se informan.</summary>
        public int MinSampleForRatios { get; init; } = 30;
        public CapitalLimits? Limits { get; init; }
    }

    public record GroupStats
    {
        public string Key { get; init; } = "";
        public int Trades { get; init; }
        public double? WinRate { get; init; }
        public double? AvgPnl { get; init; }
        public double? RealizedPnl { get; init; }
        /// <summary>Sólo en reglas de salida: promedio de (realizado − lo que la regla planeaba).</summary>
        public double? AvgGapToPlan { get; init; }
    }

    public record CurvePoint
    {
        public DateTime At { get; init; }
        public double Pnl { get; init; }
        public double Cumulative { get; init; }
        /// <summary>Caída desde el máximo previo del acumulado (≥ 0).</summary>
        public double Drawdown { get; init; }
    }

    public record RegimeBlock
    {
        public List<GroupStats> ByVix { get; init; } = new();
        public List<GroupStats> ByIvRank { get; init; } = new();
        public List<GroupStats> ByGamma { get; init; } = new();
        /// <summary>Cerradas sin contexto de entrada (anteriores al registro): no se asignan a ningún régimen.</summary>
        public int TradesWithoutContext { get; init; }
        public string? Reason { get; init; }
        /// <summary>Cortes de los tramos, para que el consumidor los muestre tal cual.</summary>
        public string Edges { get; init; } = "VIX: <15, 15–20, 20–30, ≥30 · IV Rank: <30, 30–60, ≥60 · Gamma: signo del gate de GEX de la spec";
    }

    public record ReferenceBlock
    {
        public double? PeriodDays { get; init; }
        public Metric StrategyReturnPct { get; init; } = Metric.None("");
        public Metric CashReturnPct { get; init; } = Metric.None("");
        public Metric BondReturnPct { get; init; } = Metric.None("");
        public Metric TargetReturnPct { get; init; } = Metric.None("");
        public Metric ExcessVsCashPct { get; init; } = Metric.None("");
        public Metric ExcessVsBondPct { get; init; } = Metric.None("");
        public Metric ExcessVsTargetPct { get; init; } = Metric.None("");
    }

    public record HypothesisBlock
    {
        public int TradesClosed { get; init; }
        public int? TradesRequired { get; init; }
        public double? DaysElapsed { get; init; }
        public int? DaysRequired { get; init; }
        /// <summary>true/false sólo si el criterio llegó completo; null si falta (y por qué en Reason).</summary>
        public bool? SampleReached { get; init; }
        public string? Reason { get; init; }
    }

    public record ExecutionBlock
    {
        /// <summary>Cerradas con cotizaciones guardadas de entrada y de salida.</summary>
        public int TradesMeasured { get; init; }
        public int TradesWithoutQuotes { get; init; }
        /// <summary>Costo de entrar y salir cruzando el spread bid/ask en lugar del mid simulado (USD por contrato).</summary>
        public Metric AvgCrossingCost { get; init; } = Metric.None("");
        public Metric TotalCrossingCost { get; init; } = Metric.None("");
        /// <summary>Realizado de las medidas, restado ese costo.</summary>
        public Metric RealizedAfterCrossing { get; init; } = Metric.None("");
        public Metric WinRateAfterCrossing { get; init; } = Metric.None("");
        public Metric RealizedMeasured { get; init; } = Metric.None("");
        /// <summary>Qué no está incluido: comisiones y costos reales de la cuenta.</summary>
        public string NotIncluded { get; init; } = "comisiones y costos reales de la cuenta: SHADOW no los conoce";
    }

    /// <summary>Resultado realizado de un día de salida (fecha ET), para el calendario.</summary>
    public record DailyPnl
    {
        public string Date { get; init; } = "";
        public double Pnl { get; init; }
        public int Trades { get; init; }
    }

    /// <summary>Posición SHADOW abierta tal como está guardada (última valuación con precios reales).</summary>
    public record OpenPositionRow
    {
        public string PositionId { get; init; } = "";
        public string Version { get; init; } = "";
        public string Structure { get; init; } = "";
        public string Legs { get; init; } = "";
        public DateTime EntryAt { get; init; }
        public int EntryDte { get; init; }
        public int? CurrentDte { get; init; }
        public double EntryCredit { get; init; }
        public double? LastSpreadValue { get; init; }
        public double? UnrealizedPnl { get; init; }
        public double MaxRisk { get; init; }
        public DateTime? LastValuedAt { get; init; }
        public List<string>? ValuationProblems { get; init; }
    }

    /// <summary>Operación SHADOW cerrada del período, con su motivo de salida.</summary>
    public record ClosedTradeRow
    {
        public string PositionId { get; init; } = "";
        public string Version { get; init; } = "";
        public string Structure { get; init; } = "";
        public string Legs { get; init; } = "";
        public DateTime EntryAt { get; init; }
        public DateTime? ExitAt { get; init; }
        public double? DaysHeld { get; init; }
        public double EntryCredit { get; init; }
        public double? ExitDebit { get; init; }
        public string? ExitReason { get; init; }
        public double? RealizedPnl { get; init; }
    }

    public record PanelReport
    {
        public DateTime AsOf { get; init; }
        public string Mode { get; init; } = "SHADOW";
        public string Source { get; init; } = "posiciones SHADOW guardadas (shadow_positions); P&L en USD por contrato";
        public string Spec { get; init; } = "";
        public string? Version { get; init; }
        public DateTime? From { get; init; }
        public DateTime? To { get; init; }

        public int TradesClosed { get; init; }
        public int TradesOpen { get; init; }
        public DateTime? FirstExitAt { get; init; }
        public DateTime? LastExitAt { get; init; }
        public bool SmallSample { get; init; }
        public List<string> Notes { get; init; } = new();

        public List<CurvePoint> Curve { get; init; } = new();
        /// <summary>Realizado por día de salida en hora de Nueva York; sólo días con cierres.</summary>
        public List<DailyPnl> Daily { get; init; } = new();
        /// <summary>Abiertas de la spec (todas sus instancias; el período no las filtra, igual que TradesOpen).</summary>
        public List<OpenPositionRow> OpenPositions { get; init; } = new();
        /// <summary>Cerradas del período, la más reciente primero.</summary>
        public List<ClosedTradeRow> ClosedTrades { get; init; } = new();
        public Metric RealizedPnl { get; init; } = Metric.None("");
        public Metric UnrealizedPnl { get; init; } = Metric.None("");
        public Metric MaxDrawdown { get; init; } = Metric.None("");
        public Metric WinRate { get; init; } = Metric.None("");
        public Metric AvgWin { get; init; } = Metric.None("");
        public Metric AvgLoss { get; init; } = Metric.None("");
        public Metric ProfitFactor { get; init; } = Metric.None("");
        public Metric Expectancy { get; init; } = Metric.None("");
        /// <summary>Media / desvío del resultado por operación (en % del riesgo máximo); no anualizado.</summary>
        public Metric Sharpe { get; init; } = Metric.None("");
        /// <summary>Media / desvío de las pérdidas (objetivo 0) del resultado por operación; no anualizado.</summary>
        public Metric Sortino { get; init; } = Metric.None("");
        public Metric AvgDaysHeld { get; init; } = Metric.None("");
        public Metric WorstTrade { get; init; } = Metric.None("");
        public Metric LossStreak { get; init; } = Metric.None("");

        public double OpenMaxRisk { get; init; }
        public List<LimitCheck>? OpenRiskVsLimits { get; init; }
        public string? OpenRiskVsLimitsReason { get; init; }

        public RegimeBlock Regime { get; init; } = new();
        public List<GroupStats> ByExitRule { get; init; } = new();
        public List<GroupStats> ByVersion { get; init; } = new();
        public ReferenceBlock References { get; init; } = new();
        public HypothesisBlock Hypothesis { get; init; } = new();
        public ExecutionBlock Execution { get; init; } = new();
    }

    public static class ShadowPanel
    {
        public static PanelReport Compute(string spec, IEnumerable<SpecVersionRecord> records,
            IReadOnlyDictionary<string, DeterministicExits> exitsByHash, PanelOptions o, DateTime now)
        {
            var recs = records.Where(r => r.SpecName == spec && (o.Version == null || r.SpecVersion == o.Version)).ToList();
            var perf = ShadowPerformance.Compute(recs, exitsByHash, o.ReferenceCapital, now);
            var positions = recs.SelectMany(r => r.Positions).ToDictionary(p => p.PositionId);
            var trades = perf.Trades
                .Where(t => (o.From == null || t.ExitAt >= o.From) && (o.To == null || t.ExitAt <= o.To))
                .OrderBy(t => t.ExitAt).ToList();
            var openRows = recs.SelectMany(r => r.Positions.Where(p => p.Status == "OPEN").Select(p => (r.SpecVersion, p)))
                .OrderByDescending(x => x.p.EntryAt).ToList();
            var open = openRows.Select(x => x.p).ToList();
            var pnls = trades.Select(t => t.RealizedPnl!.Value).ToList();
            var notes = new List<string>();

            bool small = trades.Count < o.MinSampleForRatios;
            if (trades.Count == 0) notes.Add("Sin operaciones cerradas en el período: no hay métricas de resultado.");
            else if (small) notes.Add($"Muestra chica: {trades.Count} cerradas (mínimo {o.MinSampleForRatios} para Sharpe y Sortino); leer los promedios con cuidado.");

            var curve = Curve(trades);
            var wins = pnls.Where(p => p > 0).ToList();
            var losses = pnls.Where(p => p < 0).ToList();
            string NoClosed() => "sin operaciones cerradas";

            return new PanelReport
            {
                AsOf = now,
                Spec = spec,
                Version = o.Version,
                From = o.From,
                To = o.To,
                TradesClosed = trades.Count,
                TradesOpen = open.Count,
                FirstExitAt = trades.Count == 0 ? null : trades[0].ExitAt,
                LastExitAt = trades.Count == 0 ? null : trades[^1].ExitAt,
                SmallSample = small,
                Notes = notes,
                Curve = curve,
                Daily = Daily(trades),
                OpenPositions = openRows.Select(x => new OpenPositionRow
                {
                    PositionId = x.p.PositionId, Version = x.SpecVersion, Structure = x.p.Structure,
                    Legs = ShadowPerformance.LegsText(x.p), EntryAt = x.p.EntryAt, EntryDte = x.p.EntryDte,
                    CurrentDte = x.p.CurrentDte, EntryCredit = x.p.EntryCredit, LastSpreadValue = x.p.LastSpreadValue,
                    UnrealizedPnl = x.p.UnrealizedPnl, MaxRisk = x.p.MaxRisk, LastValuedAt = x.p.LastValuedAt,
                    ValuationProblems = x.p.ValuationProblems,
                }).ToList(),
                ClosedTrades = trades.AsEnumerable().Reverse().Select(t => new ClosedTradeRow
                {
                    PositionId = t.PositionId, Version = t.SpecVersion, Structure = t.Structure, Legs = t.Legs,
                    EntryAt = t.EntryAt, ExitAt = t.ExitAt, DaysHeld = t.DaysHeld, EntryCredit = t.EntryCredit,
                    ExitDebit = t.ExitDebit, ExitReason = t.ExitReason, RealizedPnl = t.RealizedPnl,
                }).ToList(),
                RealizedPnl = trades.Count == 0 ? Metric.None(NoClosed()) : Metric.Of(pnls.Sum()),
                UnrealizedPnl = Unrealized(open),
                MaxDrawdown = trades.Count == 0 ? Metric.None(NoClosed()) : Metric.Of(curve.Max(c => c.Drawdown)),
                WinRate = trades.Count == 0 ? Metric.None(NoClosed()) : Metric.Of((double)wins.Count / trades.Count, 4),
                AvgWin = wins.Count == 0 ? Metric.None(trades.Count == 0 ? NoClosed() : "sin operaciones ganadoras") : Metric.Of(wins.Average()),
                AvgLoss = losses.Count == 0 ? Metric.None(trades.Count == 0 ? NoClosed() : "sin operaciones perdedoras") : Metric.Of(losses.Average()),
                ProfitFactor = trades.Count == 0 ? Metric.None(NoClosed())
                    : losses.Count == 0 ? Metric.None("sin pérdidas: el factor de ganancia no está definido")
                    : Metric.Of(wins.Sum() / -losses.Sum()),
                Expectancy = trades.Count == 0 ? Metric.None(NoClosed()) : Metric.Of(pnls.Average()),
                Sharpe = Ratio(trades, small, o, downsideOnly: false),
                Sortino = Ratio(trades, small, o, downsideOnly: true),
                AvgDaysHeld = trades.Count == 0 ? Metric.None(NoClosed()) : DaysHeld(trades),
                WorstTrade = trades.Count == 0 ? Metric.None(NoClosed()) : Metric.Of(pnls.Min()),
                LossStreak = trades.Count == 0 ? Metric.None(NoClosed()) : Metric.Of(LongestLossStreak(pnls), 0),
                OpenMaxRisk = Math.Round(open.Sum(p => p.MaxRisk), 2),
                OpenRiskVsLimits = o.Limits == null || o.Limits.Problem() != null ? null
                    : ShadowCapital.Exposure(recs, o.Limits, now).Checks,
                OpenRiskVsLimitsReason = o.Limits == null ? "no se pasaron los límites del perfil (capital, reserva, riesgo por operación y abierto, apuesta)"
                    : o.Limits.Problem(),
                Regime = Regime(trades, positions),
                ByExitRule = trades.GroupBy(t => t.ExitReason ?? "UNKNOWN").OrderBy(g => g.Key)
                    .Select(g => Stats(g.Key, g.ToList(), gap: true)).ToList(),
                ByVersion = trades.GroupBy(t => t.SpecVersion).OrderBy(g => g.Key)
                    .Select(g => Stats(g.Key, g.ToList())).ToList(),
                References = References(trades, open, o, now),
                Hypothesis = Hypothesis(trades, recs, o, now),
                Execution = Execution(trades, positions),
            };
        }

        // Día de salida en hora de Nueva York: una salida 21:30 ET es de ese día aunque en UTC ya sea el siguiente.
        private static List<DailyPnl> Daily(List<TradeReview> trades)
        {
            ShadowSession.TryZone("America/New_York", out var et);
            return trades.Where(t => t.ExitAt != null)
                .GroupBy(t => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(t.ExitAt!.Value, DateTimeKind.Utc), et).Date)
                .OrderBy(g => g.Key)
                .Select(g => new DailyPnl
                {
                    Date = g.Key.ToString("yyyy-MM-dd"), Pnl = Math.Round(g.Sum(t => t.RealizedPnl!.Value), 2), Trades = g.Count(),
                }).ToList();
        }

        private static Metric DaysHeld(List<TradeReview> trades)
        {
            var days = trades.Where(t => t.DaysHeld != null).Select(t => t.DaysHeld!.Value).ToList();
            return days.Count == 0 ? Metric.None("sin fecha de salida en las cerradas") : Metric.Of(days.Average(), 1);
        }

        private static Metric Unrealized(List<ShadowPosition> open)
        {
            if (open.Count == 0) return Metric.None("sin posiciones abiertas");
            var valued = open.Where(p => p.UnrealizedPnl != null).ToList();
            if (valued.Count == 0) return Metric.None("las abiertas no tienen una valuación con precios reales todavía");
            return Metric.Of(valued.Sum(p => p.UnrealizedPnl!.Value));
        }

        // Las salidas del mismo instante son un solo paso (igual criterio que ShadowMetrics.MaxDrawdown).
        private static List<CurvePoint> Curve(List<TradeReview> trades)
        {
            double cum = 0, peak = 0;
            var points = new List<CurvePoint>();
            foreach (var g in trades.GroupBy(t => t.ExitAt).OrderBy(g => g.Key ?? DateTime.MaxValue))
            {
                var pnl = g.Sum(t => t.RealizedPnl!.Value);
                cum += pnl;
                peak = Math.Max(peak, cum);
                points.Add(new CurvePoint
                {
                    At = g.Key ?? default, Pnl = Math.Round(pnl, 2),
                    Cumulative = Math.Round(cum, 2), Drawdown = Math.Round(peak - cum, 2),
                });
            }
            return points;
        }

        private static Metric Ratio(List<TradeReview> trades, bool small, PanelOptions o, bool downsideOnly)
        {
            if (trades.Count == 0) return Metric.None("sin operaciones cerradas");
            if (small) return Metric.None($"muestra chica: {trades.Count} cerradas, hacen falta {o.MinSampleForRatios}");
            var returns = trades.Where(t => t.PnlPctOfMaxRisk != null).Select(t => t.PnlPctOfMaxRisk!.Value).ToList();
            if (returns.Count < o.MinSampleForRatios) return Metric.None("faltan operaciones con riesgo máximo conocido");
            double mean = returns.Average();
            double dev = downsideOnly
                ? Math.Sqrt(returns.Average(r => Math.Min(r, 0) * Math.Min(r, 0)))
                : Math.Sqrt(returns.Sum(r => (r - mean) * (r - mean)) / (returns.Count - 1));
            return dev == 0 ? Metric.None(downsideOnly ? "sin pérdidas: el desvío a la baja es 0" : "desvío 0: todas las operaciones dieron igual")
                : Metric.Of(mean / dev);
        }

        private static int LongestLossStreak(List<double> pnlsInOrder)
        {
            int best = 0, run = 0;
            foreach (var p in pnlsInOrder)
            {
                run = p < 0 ? run + 1 : 0;
                best = Math.Max(best, run);
            }
            return best;
        }

        private static GroupStats Stats(string key, List<TradeReview> g, bool gap = false)
        {
            var gaps = g.Where(t => t.GapToPlan != null).ToList();
            return new GroupStats
            {
                Key = key,
                Trades = g.Count,
                WinRate = g.Count == 0 ? null : Math.Round((double)g.Count(t => t.RealizedPnl > 0) / g.Count, 4),
                AvgPnl = g.Count == 0 ? null : Math.Round(g.Average(t => t.RealizedPnl!.Value), 2),
                RealizedPnl = g.Count == 0 ? null : Math.Round(g.Sum(t => t.RealizedPnl!.Value), 2),
                AvgGapToPlan = gap && gaps.Count > 0 ? Math.Round(gaps.Average(t => t.GapToPlan!.Value), 2) : null,
            };
        }

        private static RegimeBlock Regime(List<TradeReview> trades, Dictionary<string, ShadowPosition> positions)
        {
            var withCtx = trades.Select(t => (T: t, C: positions.GetValueOrDefault(t.PositionId)?.EntryContext))
                .ToList();
            int without = withCtx.Count(x => x.C == null);
            var known = withCtx.Where(x => x.C != null).Select(x => (x.T, C: x.C!)).ToList();
            if (known.Count == 0)
                return new RegimeBlock
                {
                    TradesWithoutContext = without,
                    Reason = trades.Count == 0 ? "sin operaciones cerradas"
                        : "ninguna cerrada tiene el contexto de entrada guardado (se acumula desde WS-0033)",
                };

            List<GroupStats> Bucket(Func<EntryContext, string?> bucket) => known
                .Select(x => (Key: bucket(x.C), x.T)).Where(x => x.Key != null)
                .GroupBy(x => x.Key!).OrderBy(g => g.Key, StringComparer.Ordinal)
                .Select(g => Stats(g.Key, g.Select(x => x.T).ToList())).ToList();

            return new RegimeBlock
            {
                TradesWithoutContext = without,
                ByVix = Bucket(c => c.Vix switch { null => null, < 15 => "1 · VIX < 15", < 20 => "2 · VIX 15–20", < 30 => "3 · VIX 20–30", _ => "4 · VIX ≥ 30" }),
                ByIvRank = Bucket(c => c.IvRank switch { null => null, < 30 => "1 · IV Rank < 30", < 60 => "2 · IV Rank 30–60", _ => "3 · IV Rank ≥ 60" }),
                ByGamma = Bucket(c =>
                {
                    var gex = c.Gates.FirstOrDefault(g => g.GateId.Contains("gex", StringComparison.OrdinalIgnoreCase) && g.Value != null);
                    return gex == null ? null : gex.Value >= 0 ? "GEX ≥ 0" : "GEX < 0";
                }),
            };
        }

        private static ReferenceBlock References(List<TradeReview> trades, List<ShadowPosition> open, PanelOptions o, DateTime now)
        {
            if (trades.Count == 0 && open.Count == 0) return new ReferenceBlock { StrategyReturnPct = Metric.None("sin operaciones") };
            var start = trades.Select(t => t.EntryAt).Concat(open.Select(p => p.EntryAt)).DefaultIfEmpty(now).Min();
            var from = o.From != null && o.From > start ? o.From.Value : start;
            var end = o.To ?? now;
            double days = Math.Max(Math.Round((end - from).TotalDays, 1), 0);
            double? capital = o.ReferenceCapital is > 0 ? o.ReferenceCapital : null;
            var strategy = capital == null || trades.Count == 0
                ? Metric.None(capital == null ? "falta el capital de referencia" : "sin operaciones cerradas")
                : Metric.Of(trades.Sum(t => t.RealizedPnl!.Value) / capital.Value * 100, 3);

            Metric Ref(double? annualPct, string missing) => annualPct == null ? Metric.None(missing)
                : days <= 0 ? Metric.None("período de 0 días") : Metric.Of(annualPct.Value * days / 365, 3);
            var cash = Ref(o.CashRatePct, "falta la tasa de efectivo (cashRatePct)");
            var bond = Ref(o.Bond10yPct, "falta el rendimiento del bono a 10 años (bond10yPct)");
            var target = Ref(o.TargetAnnualPct, "falta el objetivo anual del perfil (targetAnnualPct)");

            Metric Excess(Metric reference) => strategy.Value == null ? Metric.None(strategy.Reason!)
                : reference.Value == null ? Metric.None(reference.Reason!)
                : Metric.Of(strategy.Value.Value - reference.Value.Value, 3);

            return new ReferenceBlock
            {
                PeriodDays = days,
                StrategyReturnPct = strategy, CashReturnPct = cash, BondReturnPct = bond, TargetReturnPct = target,
                ExcessVsCashPct = Excess(cash), ExcessVsBondPct = Excess(bond), ExcessVsTargetPct = Excess(target),
            };
        }

        private static HypothesisBlock Hypothesis(List<TradeReview> trades, List<SpecVersionRecord> recs, PanelOptions o, DateTime now)
        {
            var since = recs.SelectMany(r => r.Positions).Select(p => (DateTime?)p.EntryAt).DefaultIfEmpty(null).Min();
            double? days = since == null ? null : Math.Round((now - since.Value).TotalDays, 1);
            bool? reached = o.HypothesisMinTrades == null || o.HypothesisMinDays == null || days == null ? null
                : trades.Count >= o.HypothesisMinTrades && days >= o.HypothesisMinDays;
            return new HypothesisBlock
            {
                TradesClosed = trades.Count,
                TradesRequired = o.HypothesisMinTrades,
                DaysElapsed = days,
                DaysRequired = o.HypothesisMinDays,
                SampleReached = reached,
                Reason = o.HypothesisMinTrades == null || o.HypothesisMinDays == null
                    ? "falta el criterio de la hipótesis (hypothesisMinTrades, hypothesisMinDays)"
                    : days == null ? "sin operaciones" : null,
            };
        }

        /// <summary>
        /// Entrada cruzando el spread: se vende al bid y se compra al ask; salida al revés. El costo es la
        /// diferencia contra el mid simulado, en USD por contrato (×100).
        /// </summary>
        private static ExecutionBlock Execution(List<TradeReview> trades, Dictionary<string, ShadowPosition> positions)
        {
            var costs = new List<(double Cost, double Pnl)>();
            foreach (var t in trades)
            {
                var p = positions.GetValueOrDefault(t.PositionId);
                var entry = p?.EntryContext?.Legs;
                var exit = p?.ExitContext?.Legs;
                if (entry == null || exit == null || !Usable(entry) || !Usable(exit)) continue;
                // Cruzar el spread cuesta medio spread bid/ask por pata, al entrar y al salir.
                costs.Add((Math.Round((HalfSpreads(entry) + HalfSpreads(exit)) * 100, 2), t.RealizedPnl!.Value));
            }
            int missing = trades.Count - costs.Count;
            if (costs.Count == 0)
                return new ExecutionBlock
                {
                    TradesMeasured = 0, TradesWithoutQuotes = missing,
                    AvgCrossingCost = Metric.None(trades.Count == 0 ? "sin operaciones cerradas"
                        : "ninguna cerrada tiene las cotizaciones de entrada y salida guardadas (se acumulan desde WS-0033)"),
                };
            return new ExecutionBlock
            {
                TradesMeasured = costs.Count,
                TradesWithoutQuotes = missing,
                AvgCrossingCost = Metric.Of(costs.Average(c => c.Cost)),
                TotalCrossingCost = Metric.Of(costs.Sum(c => c.Cost)),
                RealizedMeasured = Metric.Of(costs.Sum(c => c.Pnl)),
                RealizedAfterCrossing = Metric.Of(costs.Sum(c => c.Pnl - c.Cost)),
                WinRateAfterCrossing = Metric.Of((double)costs.Count(c => c.Pnl - c.Cost > 0) / costs.Count, 4),
            };
        }

        private static bool Usable(List<LegQuoteSnapshot> legs) =>
            legs.Count > 0 && legs.All(l => l.Bid != null && l.Ask != null && l.Ask >= l.Bid);

        private static double HalfSpreads(List<LegQuoteSnapshot> legs) => legs.Sum(l => l.Ask!.Value - l.Bid!.Value) / 2;
    }
}
