using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Métricas SHADOW de una versión de spec (GC-0004, AC-05). Describen lo que pasó; no dicen si la
    /// spec gana plata (eso requiere muestra, y es I4 en adelante).
    ///
    /// Lo que no existe es null, no cero: sin operaciones cerradas no hay P&L realizado, ni tasa de
    /// acierto, ni drawdown. Cero sería afirmar que se operó y se salió hecho.
    /// </summary>
    public record SpecVersionMetrics
    {
        public string ContentHash { get; init; } = "";
        public string SpecName { get; init; } = "";
        public string SpecVersion { get; init; } = "";
        public int Instances { get; init; }

        public int Evaluations { get; init; }
        public int EvaluationsPassed { get; init; }
        public DateTime? FirstEvaluationAt { get; init; }
        public DateTime? LastEvaluationAt { get; init; }

        /// <summary>Descartes por motivo (tipo de evento), sólo los que ocurrieron.</summary>
        public Dictionary<string, int> Discards { get; init; } = new();
        public int DiscardsTotal { get; init; }
        /// <summary>Evaluaciones en las que faltó al menos una métrica (METRICS_NO_DATA).</summary>
        public int NoDataBlocks { get; init; }

        public int PositionsOpened { get; init; }
        public int PositionsOpen { get; init; }
        public int PositionsClosed { get; init; }
        /// <summary>Posiciones abiertas sin una valuación con precios reales todavía.</summary>
        public int OpenPositionsNotValued { get; init; }

        /// <summary>Suma del P&L realizado NETO de costos declarados (USD por contrato). null sin operaciones cerradas.</summary>
        public double? RealizedPnl { get; init; }
        /// <summary>Suma del P&L no realizado NETO de las abiertas valuadas. null si no hay ninguna valuada.</summary>
        public double? UnrealizedPnl { get; init; }
        /// <summary>El realizado sin costos (WS-0062). null sin operaciones cerradas.</summary>
        public double? RealizedGrossPnl { get; init; }
        /// <summary>Costos declarados descontados en las cerradas (entrada + salida). null sin cerradas.</summary>
        public double? RealizedCosts { get; init; }
        /// <summary>false = ninguna posición tiene costos declarados: neto y bruto coinciden porque no se descontó nada.</summary>
        public bool CostsDeclared { get; init; }
        /// <summary>Cerradas con P&L &gt; 0 sobre cerradas. null sin operaciones cerradas.</summary>
        public double? WinRate { get; init; }
        /// <summary>Mayor caída desde un máximo del P&L realizado acumulado (≥ 0). null sin cerradas.</summary>
        public double? MaxDrawdown { get; init; }

        /// <summary>true si esta versión todavía no abrió ninguna operación.</summary>
        public bool NoTrades => PositionsOpened == 0;
    }

    public static class ShadowMetrics
    {
        /// <summary>Los motivos por los que una evaluación no terminó en una posición.</summary>
        public static readonly IReadOnlyList<string> DiscardEventTypes = new[]
        {
            "GATES_NOT_PASSED", "ENTRY_SKIPPED", "CANDIDATE_NOT_VIABLE", "RISK_CHECK_FAILED", "ENTRY_ABORTED",
        };

        public static SpecVersionMetrics Compute(SpecVersionRecord r)
        {
            var closed = r.Positions.Where(p => p.Status == "CLOSED" && p.RealizedPnl != null).ToList();
            var open = r.Positions.Where(p => p.Status == "OPEN").ToList();
            var valued = open.Where(p => p.UnrealizedPnl != null).ToList();
            var discards = DiscardEventTypes
                .Where(t => r.EventCounts.GetValueOrDefault(t) > 0)
                .ToDictionary(t => t, t => r.EventCounts[t]);

            return new SpecVersionMetrics
            {
                ContentHash = r.ContentHash,
                SpecName = r.SpecName,
                SpecVersion = r.SpecVersion,
                Instances = r.Instances,
                Evaluations = r.Evaluations,
                EvaluationsPassed = r.EvaluationsPassed,
                FirstEvaluationAt = r.FirstEvaluationAt,
                LastEvaluationAt = r.LastEvaluationAt,
                Discards = discards,
                DiscardsTotal = discards.Values.Sum(),
                NoDataBlocks = r.EventCounts.GetValueOrDefault("METRICS_NO_DATA"),
                PositionsOpened = r.Positions.Count,
                PositionsOpen = open.Count,
                PositionsClosed = r.Positions.Count(p => p.Status == "CLOSED"),
                OpenPositionsNotValued = open.Count - valued.Count,
                RealizedPnl = closed.Count == 0 ? null : Math.Round(closed.Sum(p => p.RealizedPnl!.Value), 2),
                UnrealizedPnl = valued.Count == 0 ? null : Math.Round(valued.Sum(p => p.UnrealizedPnl!.Value), 2),
                RealizedGrossPnl = closed.Count == 0 ? null : Math.Round(closed.Sum(p => ShadowFillSimulator.GrossOf(p)!.Value), 2),
                RealizedCosts = closed.Count == 0 ? null : Math.Round(closed.Sum(ShadowFillSimulator.Costs), 2),
                CostsDeclared = r.Positions.Any(p => ShadowFillSimulator.TermsOf(p).CostsDeclared),
                WinRate = closed.Count == 0 ? null : Math.Round((double)closed.Count(p => p.RealizedPnl > 0) / closed.Count, 4),
                // Las salidas del mismo instante (un mismo tick del monitor) cuentan como un solo paso:
                // así el drawdown no depende del orden en que la base devuelva las filas.
                MaxDrawdown = closed.Count == 0 ? null : MaxDrawdown(closed.GroupBy(p => p.ExitAt)
                    .OrderBy(g => g.Key ?? DateTime.MaxValue).Select(g => g.Sum(p => p.RealizedPnl!.Value))),
            };
        }

        /// <summary>Mayor caída del acumulado desde su máximo previo; el acumulado arranca en 0.</summary>
        public static double MaxDrawdown(IEnumerable<double> pnlsInOrder)
        {
            double cumulative = 0, peak = 0, maxDd = 0;
            foreach (var pnl in pnlsInOrder)
            {
                cumulative += pnl;
                peak = Math.Max(peak, cumulative);
                maxDd = Math.Max(maxDd, peak - cumulative);
            }
            return Math.Round(maxDd, 2);
        }
    }
}
