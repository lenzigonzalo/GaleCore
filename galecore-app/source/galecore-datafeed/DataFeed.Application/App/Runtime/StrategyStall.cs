using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>Por qué no entra una estrategia: días hábiles seguidos frenados por la misma causa.</summary>
    public record StrategyStallDto(int Days, string Since, string Until, string Cause, string CauseLabel, string Reason, string Text);

    /// <summary>
    /// «Por qué no opera» (WS-0098): el único lugar donde se calcula. La ficha lo muestra tal cual y el supervisor avisa
    /// leyéndolo. Cuenta sólo lo que frena una entrada ya armada: un límite (ENTRY_SKIPPED), un candidato inviable
    /// (CANDIDATE_NOT_VIABLE) o un chequeo de riesgo (RISK_CHECK_FAILED). Los gates no cuentan (GATES_NOT_PASSED es el filtro
    /// de mercado haciendo su trabajo): un día frenado sólo por un gate ni confirma ni corta la racha. Una posición abierta
    /// la corta. Los días son los evaluados (hábiles), en hora de Nueva York.
    /// </summary>
    public static class StrategyStall
    {
        private static readonly string[] Blocking = { "ENTRY_SKIPPED", "CANDIDATE_NOT_VIABLE", "RISK_CHECK_FAILED" };

        private static readonly Dictionary<string, string> Labels = new()
        {
            ["ENTRY_SKIPPED:max_bet"] = "tope por apuesta",
            ["ENTRY_SKIPPED:max_positions"] = "máximo de posiciones",
            ["ENTRY_SKIPPED:trade_limits"] = "límite de operaciones",
            ["ENTRY_SKIPPED:loss_brake"] = "freno por pérdida",
            ["ENTRY_SKIPPED:risk_budget"] = "presupuesto de riesgo",
            ["CANDIDATE_NOT_VIABLE"] = "candidato inviable",
            ["RISK_CHECK_FAILED"] = "riesgo rechazado",
        };

        private sealed class Day
        {
            public bool Opened;
            public bool Evaluated;
            public bool GateFailed;
            public Dictionary<string, OperationalEvent> Causes = new();
        }

        public static string CauseOf(OperationalEvent e)
        {
            if (e.EventType == "ENTRY_SKIPPED")
                return "ENTRY_SKIPPED:" + (e.Payload.TryGetValue("limit", out var l) && l != null ? l.ToString() : "other");
            return e.EventType;
        }

        public static StrategyStallDto? Compute(IEnumerable<OperationalEvent> events)
        {
            if (!ShadowSession.TryZone("America/New_York", out var et)) return null;
            var days = new SortedDictionary<DateOnly, Day>();
            foreach (var e in events.OrderBy(x => x.Timestamp))
            {
                bool counts = e.EventType == "EVALUATION_COMPLETED" || e.EventType == "POSITION_OPENED" || Blocking.Contains(e.EventType)
                    || e.EventType == "GATES_NOT_PASSED";
                if (!counts) continue;
                var utc = DateTime.SpecifyKind(e.Timestamp, DateTimeKind.Utc);
                var key = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(utc, et));
                if (!days.TryGetValue(key, out var d)) days[key] = d = new Day();
                d.Evaluated = true;
                if (e.EventType == "POSITION_OPENED") d.Opened = true;
                else if (e.EventType == "GATES_NOT_PASSED") d.GateFailed = true;
                else if (Blocking.Contains(e.EventType)) d.Causes[CauseOf(e)] = e;   // el último del día queda
            }
            var ordered = days.Where(kv => kv.Value.Evaluated).ToList();
            if (ordered.Count == 0 || ordered[^1].Value.Opened) return null;

            StrategyStallDto? best = null;
            foreach (var cause in ordered[^1].Value.Causes.Keys)
            {
                var run = new List<DateOnly>();
                for (int i = ordered.Count - 1; i >= 0; i--)
                {
                    var d = ordered[i].Value;
                    if (d.Opened) break;
                    if (!d.Causes.ContainsKey(cause))
                    {
                        if (d.Causes.Count == 0 && d.GateFailed) continue;   // sólo un gate: no confirma ni corta
                        break;
                    }
                    run.Add(ordered[i].Key);
                }
                if (run.Count == 0 || (best != null && run.Count <= best.Days)) continue;
                var latest = ordered[^1].Value.Causes[cause];
                var label = Labels.TryGetValue(cause, out var l) ? l : cause.Split(':').Last();
                var reason = latest.Payload.TryGetValue("reason", out var r) && r != null ? r.ToString()! : label;
                best = new StrategyStallDto(run.Count, run[^1].ToString("yyyy-MM-dd"), run[0].ToString("yyyy-MM-dd"), cause, label, reason,
                    $"{run.Count} {(run.Count == 1 ? "día hábil" : "días hábiles")} {(run.Count == 1 ? "sin entrar" : "seguidos sin entrar")} por {label}");
            }
            return best;
        }
    }
}
