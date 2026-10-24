using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Performance SHADOW (P1-03): por estrategia, por versión y por regla de salida, de la cartera contra
    /// el capital de referencia, y la revisión de cada operación cerrada contra lo que su regla planeaba.
    ///
    /// Describe lo que pasó, en USD por contrato. No dice si es edge ni si alcanza el objetivo: eso lo
    /// interpreta el consumidor con el perfil (criterio de edge, utilidad mínima). Lo que no existe es null.
    /// </summary>
    public record PerformanceReport
    {
        public DateTime AsOf { get; init; }
        public double? ReferenceCapital { get; init; }
        public PortfolioPerformance Portfolio { get; init; } = new();
        /// <summary>Desde cuándo se recortó (`from`): sólo los cierres desde esa fecha. null = todo.</summary>
        public DateTime? From { get; init; }
        /// <summary>Lo cerrado en la ventana (`from`), todas las estrategias pedidas. null sin `from`.</summary>
        public GroupPerformance? Window { get; init; }
        public List<GroupPerformance> Strategies { get; init; } = new();
        public List<GroupPerformance> Versions { get; init; } = new();
        /// <summary>Operaciones cerradas (desde `from` si se pidió), la más reciente primero.</summary>
        public List<TradeReview> Trades { get; init; } = new();
    }

    public record PortfolioPerformance
    {
        public int PositionsClosed { get; init; }
        public int PositionsOpen { get; init; }
        public double? RealizedPnl { get; init; }
        public double? UnrealizedPnl { get; init; }
        public double? WinRate { get; init; }
        public double? MaxDrawdown { get; init; }
        /// <summary>Riesgo máximo sumado de las abiertas (USD).</summary>
        public double OpenMaxRisk { get; init; }
        /// <summary>Abiertas sin valuación con precios reales: su P&L no está en UnrealizedPnl.</summary>
        public int OpenNotValued { get; init; }
        /// <summary>Primera entrada: desde cuándo se mide.</summary>
        public DateTime? Since { get; init; }
        public double? DaysElapsed { get; init; }
        /// <summary>Realizado / capital de referencia, en %. null sin capital o sin cerradas.</summary>
        public double? RealizedReturnPct { get; init; }
        /// <summary>Realizado + no realizado / capital, en %. null sin capital o sin nada valuado.</summary>
        public double? TotalReturnPct { get; init; }
        /// <summary>TotalReturnPct llevado a un año (simple: × 365 / días). Con pocos días es ruido.</summary>
        public double? AnnualizedReturnPct { get; init; }
    }

    public record GroupPerformance
    {
        public string SpecName { get; init; } = "";
        /// <summary>null en el agregado por estrategia (todas sus versiones).</summary>
        public string? SpecVersion { get; init; }
        public string? ContentHash { get; init; }
        public int PositionsClosed { get; init; }
        public int PositionsOpen { get; init; }
        public double? RealizedPnl { get; init; }
        public double? UnrealizedPnl { get; init; }
        public double? WinRate { get; init; }
        public double? AvgPnl { get; init; }
        public double? AvgPctOfMaxRisk { get; init; }
        public double? MaxDrawdown { get; init; }
        /// <summary>Atribución por la regla que cerró (TAKE_PROFIT, STOP_LOSS, TIME_EXIT, MANUAL, KILL_SWITCH).</summary>
        public List<RulePerformance> ByExitRule { get; init; } = new();
    }

    public record RulePerformance
    {
        public string Rule { get; init; } = "";
        public int Count { get; init; }
        public double RealizedPnl { get; init; }
        public double AvgPnl { get; init; }
        /// <summary>Promedio de (realizado − lo que la regla planeaba); null si la regla no tiene nivel planeado.</summary>
        public double? AvgGapToPlan { get; init; }
    }

    public record TradeReview
    {
        public string PositionId { get; init; } = "";
        public string SpecName { get; init; } = "";
        public string SpecVersion { get; init; } = "";
        public string Symbol { get; init; } = "";
        public string Structure { get; init; } = "";
        public string Legs { get; init; } = "";
        public DateTime EntryAt { get; init; }
        public DateTime? ExitAt { get; init; }
        public double? DaysHeld { get; init; }
        public int EntryDte { get; init; }
        public double EntryCredit { get; init; }
        public double? ExitDebit { get; init; }
        public double Width { get; init; }
        public double MaxRisk { get; init; }
        public string? ExitReason { get; init; }
        public double? RealizedPnl { get; init; }
        public double? PnlPctOfCredit { get; init; }
        public double? PnlPctOfMaxRisk { get; init; }
        /// <summary>Lo que la spec de esa versión planeaba al entrar (null si la spec no se pudo leer).</summary>
        public TradePlan? Plan { get; init; }
        /// <summary>Realizado − nivel planeado de la regla que actuó (TP o SL). null si no aplica.</summary>
        public double? GapToPlan { get; init; }
    }

    public record TradePlan
    {
        /// <summary>P&L si cierra en el take profit (USD por contrato).</summary>
        public double? TakeProfitPnl { get; init; }
        /// <summary>P&L si cierra en el stop loss (negativo).</summary>
        public double? StopLossPnl { get; init; }
        public int? TimeExitDte { get; init; }
    }

    public static class ShadowPerformance
    {
        /// <summary>Patas en texto: «SELL PUT 580 2026-11-20 / BUY PUT 575 2026-11-20».</summary>
        public static string LegsText(ShadowPosition p) =>
            string.Join(" / ", p.Legs.Select(l => $"{l.Side} {l.Type} {l.Strike:0.##} {l.Expiration}".Trim()));

        public static PerformanceReport Compute(IEnumerable<SpecVersionRecord> records,
            IReadOnlyDictionary<string, DeterministicExits> exitsByHash, double? referenceCapital, DateTime now,
            DateTime? from = null)
        {
            var list = records.ToList();
            var trades = new List<TradeReview>();
            var versions = new List<GroupPerformance>();
            foreach (var r in list)
            {
                exitsByHash.TryGetValue(r.ContentHash, out var exits);
                var reviews = r.Positions.Where(IsClosed).Select(p => Review(p, r, exits)).ToList();
                trades.AddRange(reviews);
                versions.Add(Group(r.SpecName, r.SpecVersion, r.ContentHash, r.Positions, reviews));
            }

            var strategies = list.GroupBy(r => r.SpecName).Select(g => Group(g.Key, null, null,
                g.SelectMany(r => r.Positions).ToList(),
                trades.Where(t => t.SpecName == g.Key).ToList())).ToList();

            var inWindow = from == null ? trades : trades.Where(t => t.ExitAt >= from).ToList();
            return new PerformanceReport
            {
                AsOf = now,
                ReferenceCapital = referenceCapital,
                From = from,
                Window = from == null ? null : Group("(ventana)", null, null, Array.Empty<ShadowPosition>(), inWindow),
                Portfolio = Portfolio(list.SelectMany(r => r.Positions).ToList(), referenceCapital, now),
                Strategies = strategies,
                Versions = versions,
                Trades = inWindow.OrderByDescending(t => t.ExitAt).ToList(),
            };
        }

        private static bool IsClosed(ShadowPosition p) => p.Status == "CLOSED" && p.RealizedPnl != null;

        public static TradePlan? Plan(ShadowPosition p, DeterministicExits? exits)
        {
            if (exits == null) return null;
            return new TradePlan
            {
                // TP: el spread vale (100 − pct)% del crédito → se gana pct% del crédito.
                TakeProfitPnl = exits.TakeProfit == null ? null : Math.Round(p.EntryCredit * exits.TakeProfit.PctOfCredit, 2),
                // SL: la pérdida llega a pct% del crédito (spread − crédito ≥ crédito × pct).
                StopLossPnl = exits.StopLoss == null ? null : -Math.Round(p.EntryCredit * exits.StopLoss.PctOfCredit, 2),
                TimeExitDte = exits.TimeExit?.MaxDte,
            };
        }

        private static TradeReview Review(ShadowPosition p, SpecVersionRecord r, DeterministicExits? exits)
        {
            var plan = Plan(p, exits);
            double? planned = p.ExitReason switch
            {
                "TAKE_PROFIT" => plan?.TakeProfitPnl,
                "STOP_LOSS" => plan?.StopLossPnl,
                _ => null,
            };
            return new TradeReview
            {
                PositionId = p.PositionId,
                SpecName = r.SpecName,
                SpecVersion = r.SpecVersion,
                Symbol = p.Symbol,
                Structure = p.Structure,
                Legs = LegsText(p),
                EntryAt = p.EntryAt,
                ExitAt = p.ExitAt,
                DaysHeld = p.ExitAt == null ? null : Math.Round((p.ExitAt.Value - p.EntryAt).TotalDays, 1),
                EntryDte = p.EntryDte,
                EntryCredit = p.EntryCredit,
                ExitDebit = p.ExitDebit,
                Width = p.Width,
                MaxRisk = p.MaxRisk,
                ExitReason = p.ExitReason,
                RealizedPnl = p.RealizedPnl,
                // Acciones en largo: no hay crédito; el % va sobre el costo (PnlPctOfMaxRisk).
                PnlPctOfCredit = p.Structure != RuntimeStructures.LongEquity && p.EntryCredit > 0 ? Math.Round(p.RealizedPnl!.Value / (p.EntryCredit * 100) * 100, 1) : null,
                PnlPctOfMaxRisk = p.MaxRisk > 0 ? Math.Round(p.RealizedPnl!.Value / p.MaxRisk * 100, 1) : null,
                Plan = plan,
                GapToPlan = planned == null ? null : Math.Round(p.RealizedPnl!.Value - planned.Value, 2),
            };
        }

        private static GroupPerformance Group(string name, string? version, string? hash,
            IReadOnlyCollection<ShadowPosition> positions, IReadOnlyCollection<TradeReview> closed)
        {
            var valued = positions.Where(p => p.Status == "OPEN" && p.UnrealizedPnl != null).ToList();
            var withRisk = closed.Where(t => t.PnlPctOfMaxRisk != null).ToList();
            return new GroupPerformance
            {
                SpecName = name,
                SpecVersion = version,
                ContentHash = hash,
                PositionsClosed = closed.Count,
                PositionsOpen = positions.Count(p => p.Status == "OPEN"),
                RealizedPnl = closed.Count == 0 ? null : Math.Round(closed.Sum(t => t.RealizedPnl!.Value), 2),
                UnrealizedPnl = valued.Count == 0 ? null : Math.Round(valued.Sum(p => p.UnrealizedPnl!.Value), 2),
                WinRate = closed.Count == 0 ? null : Math.Round((double)closed.Count(t => t.RealizedPnl > 0) / closed.Count, 4),
                AvgPnl = closed.Count == 0 ? null : Math.Round(closed.Average(t => t.RealizedPnl!.Value), 2),
                AvgPctOfMaxRisk = withRisk.Count == 0 ? null : Math.Round(withRisk.Average(t => t.PnlPctOfMaxRisk!.Value), 1),
                MaxDrawdown = closed.Count == 0 ? null : Drawdown(closed),
                ByExitRule = closed.GroupBy(t => t.ExitReason ?? "UNKNOWN").OrderBy(g => g.Key).Select(g =>
                {
                    var gaps = g.Where(t => t.GapToPlan != null).ToList();
                    return new RulePerformance
                    {
                        Rule = g.Key,
                        Count = g.Count(),
                        RealizedPnl = Math.Round(g.Sum(t => t.RealizedPnl!.Value), 2),
                        AvgPnl = Math.Round(g.Average(t => t.RealizedPnl!.Value), 2),
                        AvgGapToPlan = gaps.Count == 0 ? null : Math.Round(gaps.Average(t => t.GapToPlan!.Value), 2),
                    };
                }).ToList(),
            };
        }

        // Mismo criterio que ShadowMetrics: las salidas del mismo instante cuentan como un solo paso.
        private static double Drawdown(IEnumerable<TradeReview> closed) => ShadowMetrics.MaxDrawdown(
            closed.GroupBy(t => t.ExitAt).OrderBy(g => g.Key ?? DateTime.MaxValue).Select(g => g.Sum(t => t.RealizedPnl!.Value)));

        private static PortfolioPerformance Portfolio(List<ShadowPosition> all, double? capital, DateTime now)
        {
            var closed = all.Where(IsClosed).ToList();
            var open = all.Where(p => p.Status == "OPEN").ToList();
            var valued = open.Where(p => p.UnrealizedPnl != null).ToList();
            double? realized = closed.Count == 0 ? null : Math.Round(closed.Sum(p => p.RealizedPnl!.Value), 2);
            double? unrealized = valued.Count == 0 ? null : Math.Round(valued.Sum(p => p.UnrealizedPnl!.Value), 2);
            DateTime? since = all.Count == 0 ? null : all.Min(p => p.EntryAt);
            double? days = since == null ? null : Math.Round((now - since.Value).TotalDays, 1);
            bool hasCapital = capital is > 0;
            double? total = realized == null && unrealized == null ? null : (realized ?? 0) + (unrealized ?? 0);
            double? totalPct = hasCapital && total != null ? Math.Round(total.Value / capital!.Value * 100, 3) : null;
            return new PortfolioPerformance
            {
                PositionsClosed = closed.Count,
                PositionsOpen = open.Count,
                RealizedPnl = realized,
                UnrealizedPnl = unrealized,
                WinRate = closed.Count == 0 ? null : Math.Round((double)closed.Count(p => p.RealizedPnl > 0) / closed.Count, 4),
                MaxDrawdown = closed.Count == 0 ? null : ShadowMetrics.MaxDrawdown(closed.GroupBy(p => p.ExitAt)
                    .OrderBy(g => g.Key ?? DateTime.MaxValue).Select(g => g.Sum(p => p.RealizedPnl!.Value))),
                OpenMaxRisk = Math.Round(open.Sum(p => p.MaxRisk), 2),
                OpenNotValued = open.Count - valued.Count,
                Since = since,
                DaysElapsed = days,
                RealizedReturnPct = hasCapital && realized != null ? Math.Round(realized.Value / capital!.Value * 100, 3) : null,
                TotalReturnPct = totalPct,
                AnnualizedReturnPct = totalPct != null && days is > 0 ? Math.Round(totalPct.Value * 365 / days.Value, 2) : null,
            };
        }
    }
}
