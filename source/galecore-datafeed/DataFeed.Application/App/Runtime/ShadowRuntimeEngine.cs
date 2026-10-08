using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Application.App.Shared;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Las dos decisiones del runtime SHADOW, separadas de los loops para poder probarlas:
    /// entrar o no en un símbolo, y valuar (y eventualmente cerrar) una posición abierta.
    ///
    /// Datos reales o nada (GC-0002, W-1): una métrica sin dato es NO_DATA y el gate aplica su
    /// on_no_data; sin candidato real no hay posición; sin precio real de todas las patas no se
    /// evalúan salidas. Cada paso deja un evento que explica qué pasó y por qué. SHADOW simula la
    /// orden, nunca el dato.
    /// </summary>
    public static class ShadowRuntimeEngine
    {
        public const string VixMetricRef = "capability:market_data.trade.VIX.price";

        public static class Outcomes
        {
            public const string GatesNotPassed = "GATES_NOT_PASSED";
            public const string MaxPositions = "MAX_POSITIONS";
            public const string TooSoon = "TOO_SOON";
            public const string NoCandidate = "NO_CANDIDATE";
            public const string RiskRejected = "RISK_REJECTED";
            public const string Opened = "OPENED";
            public const string NoData = "NO_DATA";
            public const string Valued = "VALUED";
            public const string Closed = "CLOSED";
            public const string Paused = "PAUSED";
        }

        // ── Entrada ──────────────────────────────────────────────────

        /// <param name="canOpen">
        /// Se consulta al registrar la posición, bajo el mismo lock que el cambio del switch
        /// (ShadowRuntimeStore.TryAddPosition): si el switch se apagó mientras se pedían datos, no se
        /// abre (Codex C1/C2). null = siempre se puede.
        /// </param>
        public static async Task<string> EvaluateEntryAsync(
            ShadowRuntimeStore store, IRuntimeMarketData data, StrategyInstance instance, StrategySpec spec,
            string symbol, DateTime nowUtc, CancellationToken ct, Func<bool>? canOpen = null)
        {
            var gates = spec.EntryFilters.GateLayer.Gates;
            var metricRefs = gates.Select(g => g.MetricRef).Distinct().ToList();

            // 1. Métricas reales; si el resolver entero falla, todas quedan sin dato (nunca inventadas).
            Dictionary<string, double?> metrics;
            try
            {
                metrics = await data.ResolveMetricsAsync(metricRefs, nowUtc, DataFreshness.MaxAge(spec), ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                metrics = metricRefs.ToDictionary(r => r, _ => (double?)null);
                AddEvent(store, instance, "METRICS_UNAVAILABLE", symbol, nowUtc,
                    ("error", ex.Message), ("metric_refs", metricRefs));
            }
            var missing = metricRefs.Where(r => !metrics.TryGetValue(r, out var v) || v == null).ToList();
            if (missing.Count > 0)
                AddEvent(store, instance, "METRICS_NO_DATA", symbol, nowUtc, ("metric_refs", missing));

            // 2. Gates.
            var eval = GenericGateEvaluator.Evaluate(
                gates, spec.EntryFilters.GateLayer.PassRule, spec.EntryFilters.GateLayer.OnFail,
                metrics, instance.InstanceId, symbol, nowUtc);
            store.AddEvaluation(eval);
            var gateSummary = eval.GateResults.Select(g => new Dictionary<string, object?>
            {
                ["gate_id"] = g.GateId, ["status"] = g.Status, ["value"] = g.Value,
                ["operator"] = g.Operator, ["threshold"] = g.Threshold,
            }).ToList();
            AddEvent(store, instance, "EVALUATION_COMPLETED", symbol, nowUtc,
                ("evaluation_id", eval.EvaluationId), ("overall_pass", eval.OverallPass), ("gates", gateSummary));

            if (!eval.OverallPass)
            {
                AddEvent(store, instance, "GATES_NOT_PASSED", symbol, nowUtc,
                    ("evaluation_id", eval.EvaluationId),
                    ("gates", gateSummary.Where(g => (string?)g["status"] != "PASS").ToList()));
                return Outcomes.GatesNotPassed;
            }

            // 3. Límite de posiciones.
            int openCount = store.OpenPositionCount(instance.InstanceId);
            if (spec.RiskLimits.MaxConcurrentPositions is int max && openCount >= max)
            {
                AddEvent(store, instance, "ENTRY_SKIPPED", symbol, nowUtc,
                    ("reason", $"máximo de posiciones abiertas alcanzado ({openCount}/{max})"));
                return Outcomes.MaxPositions;
            }

            // 3b. Espaciado entre entradas (GC-0005): cuenta la última entrada de la instancia, abierta o
            // cerrada, así un cierre rápido no habilita otra entrada el mismo día. Igual que el máximo de
            // posiciones, se chequea fuera del lock de TryAddPosition: vale porque ShadowEntryLoopService es el
            // único que abre posiciones y evalúa un tick por vez, con las instancias en serie (P1-07). Un segundo
            // camino de entrada tendría que repetir estos dos chequeos bajo ese lock.
            if (spec.RiskLimits.MinMinutesBetweenEntries is int minMinutes
                && store.LastEntryAt(instance.InstanceId) is DateTime lastEntry
                && nowUtc - lastEntry < TimeSpan.FromMinutes(minMinutes))
            {
                var next = lastEntry.AddMinutes(minMinutes);
                AddEvent(store, instance, "ENTRY_SKIPPED", symbol, nowUtc,
                    ("reason", $"espaciado entre entradas: la última fue hace {(int)(nowUtc - lastEntry).TotalMinutes} min (mínimo {minMinutes})"),
                    ("last_entry_at", lastEntry.ToString("o")), ("next_entry_allowed_at", next.ToString("o")));
                return Outcomes.TooSoon;
            }

            // 4. Candidato real, o la razón por la que no hay.
            CandidateBuildResult built;
            try
            {
                built = await data.BuildCandidateAsync(
                    instance, spec, symbol, metrics.GetValueOrDefault(VixMetricRef), nowUtc, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                built = CandidateBuildResult.Rejected($"error construyendo el candidato: {ex.Message}");
            }
            if (built.Candidate is not TradeCandidate candidate)
            {
                AddEvent(store, instance, "CANDIDATE_NOT_VIABLE", symbol, nowUtc,
                    ("reason", built.RejectReason ?? "sin razón informada"));
                return Outcomes.NoCandidate;
            }
            AddEvent(store, instance, "CANDIDATE_CREATED", symbol, nowUtc,
                ("candidate_id", candidate.CandidateId), ("credit", candidate.Credit), ("max_risk", candidate.MaxRisk),
                ("delta_short", candidate.DeltaShort), ("dte", candidate.Dte),
                ("quotes_as_of", candidate.Snapshot.OldestQuoteAt?.ToString("o") ?? "desconocida (el proveedor no informa la hora)"),
                ("quotes_without_time", candidate.Snapshot.QuotesWithoutTime),
                ("legs", candidate.Legs.Select(l => $"{l.Side} {l.Type} {l.Strike} {l.Expiration} bid={l.Bid} ask={l.Ask}").ToList()));

            // 5. Riesgo duro.
            var risk = ShadowRiskValidator.Validate(candidate, spec, openCount, null, nowUtc);
            if (!risk.IsValid)
            {
                AddEvent(store, instance, "RISK_CHECK_FAILED", symbol, nowUtc, ("errors", risk.Errors));
                return Outcomes.RiskRejected;
            }

            // 6. Fill simulado al mid real.
            ShadowPosition position;
            try
            {
                position = ShadowFillSimulator.Fill(candidate, nowUtc);
            }
            catch (InvalidOperationException ex)
            {
                AddEvent(store, instance, "CANDIDATE_NOT_VIABLE", symbol, nowUtc, ("reason", ex.Message));
                return Outcomes.NoCandidate;
            }
            var opened = NewEvent(instance.InstanceId, "POSITION_OPENED", symbol, nowUtc,
                ("position_id", position.PositionId), ("credit", position.EntryCredit),
                ("max_risk", position.MaxRisk), ("dte", position.EntryDte));
            if (!store.TryAddPosition(position, canOpen ?? (() => true), opened))
            {
                AddEvent(store, instance, "ENTRY_ABORTED", symbol, nowUtc,
                    ("reason", "el switch se apagó o la instancia se paró mientras se evaluaba la entrada"), ("candidate_id", candidate.CandidateId));
                return Outcomes.Paused;
            }
            return Outcomes.Opened;
        }

        // ── Valuación y salidas ─────────────────────────────────────

        /// <summary>
        /// Valúa una posición abierta con el mid real de cada pata y evalúa sus salidas. Si falta el
        /// precio de alguna pata (o su vencimiento), no evalúa salidas y registra NO_DATA; el evento
        /// se registra cuando el problema aparece o cambia, no en cada tick.
        /// Con <paramref name="evaluateExits"/> en false (fuera de sesión) valúa pero no cierra:
        /// no se simula un cierre con precios de un mercado cerrado (R1-M1).
        /// </summary>
        public static async Task<string> ValuePositionAsync(
            ShadowRuntimeStore store, IRuntimeMarketData data, ShadowPosition pos, DeterministicExits exits,
            DateTime nowUtc, CancellationToken ct, bool evaluateExits = true, TimeSpan? maxQuoteAge = null)
        {
            var problems = new List<string>();
            double spreadValue = 0;
            foreach (var leg in pos.Legs)
            {
                if (string.IsNullOrEmpty(leg.StreamerSymbol))
                {
                    problems.Add($"{leg.Side} {leg.Type} {leg.Strike}: sin símbolo de streamer");
                    continue;
                }
                LegQuote? quote;
                try { quote = await data.GetQuoteAsync(leg.StreamerSymbol, ct); }
                catch (Exception ex) when (ex is not OperationCanceledException) { quote = null; problems.Add($"{leg.StreamerSymbol}: {ex.Message}"); continue; }
                if (quote == null)
                {
                    problems.Add($"{leg.StreamerSymbol}: sin cotización utilizable");
                    continue;
                }
                // Una cotización vieja no puede disparar un take profit ni un stop (Codex C1).
                var stale = DataFreshness.Problem(quote.AsOf, nowUtc, maxQuoteAge);
                if (stale != null)
                {
                    problems.Add($"{leg.StreamerSymbol}: {stale}");
                    continue;
                }
                // Débito para cerrar: recomprar lo vendido (+mid) y vender lo comprado (−mid).
                if (leg.Side == "SELL") spreadValue += quote.Mid;
                else if (leg.Side == "BUY") spreadValue -= quote.Mid;
                else problems.Add($"{leg.StreamerSymbol}: lado de pata desconocido '{leg.Side}'");
            }

            int? dte = CurrentDte(pos, nowUtc);
            if (dte == null) problems.Add("sin fecha de vencimiento en las patas");
            if (problems.Count == 0 && !double.IsFinite(spreadValue)) problems.Add($"valor del spread no finito ({spreadValue})");

            if (problems.Count > 0)
            {
                RecordValuationProblems(store, pos, problems, nowUtc);
                return Outcomes.NoData;
            }

            spreadValue = Math.Round(spreadValue, 4);
            var valued = pos with
            {
                LastSpreadValue = spreadValue,
                CurrentDte = dte,
                LastValuedAt = nowUtc,
                UnrealizedPnl = Math.Round((pos.EntryCredit - spreadValue) * 100, 2),
                ValuationProblems = null,
                UpdatedAt = nowUtc,
            };
            store.UpdatePosition(valued);
            if (!evaluateExits) return Outcomes.Valued;

            var reason = ShadowFillSimulator.EvaluateExits(valued, exits, spreadValue, dte!.Value);
            if (reason == null) return Outcomes.Valued;

            var closed = ShadowFillSimulator.Close(valued, spreadValue, reason, nowUtc);
            // El cierre y su evento se guardan juntos (GC-0004).
            store.UpdatePosition(closed, NewEvent(pos.InstanceId, "POSITION_CLOSED", pos.Symbol, nowUtc,
                ("position_id", pos.PositionId), ("exit_reason", reason),
                ("realized_pnl", closed.RealizedPnl), ("exit_debit", closed.ExitDebit), ("dte", dte)));
            return Outcomes.Closed;
        }

        /// <summary>
        /// Deja en la posición por qué no se pudo valuar, y un evento VALUATION_NO_DATA sólo si el
        /// problema es nuevo o cambió. El monitor corre cada 30 s: sin esto, una noche sin
        /// cotizaciones llenaría el registro de eventos con el mismo aviso.
        /// </summary>
        public static void RecordValuationProblems(
            ShadowRuntimeStore store, ShadowPosition pos, List<string> problems, DateTime nowUtc)
        {
            bool changed = pos.ValuationProblems == null || !pos.ValuationProblems.SequenceEqual(problems);
            store.UpdatePosition(pos with { ValuationProblems = problems, UpdatedAt = nowUtc });
            if (!changed) return;
            store.AddEvent(new OperationalEvent
            {
                EventId = Guid.NewGuid().ToString(), InstanceId = pos.InstanceId, EventType = "VALUATION_NO_DATA",
                Symbol = pos.Symbol, Timestamp = nowUtc,
                Payload = new Dictionary<string, object?> { ["position_id"] = pos.PositionId, ["problems"] = problems },
            });
        }

        /// <summary>Días hasta el vencimiento de la posición, contados en la fecha del mercado (ET).</summary>
        public static int? CurrentDte(ShadowPosition pos, DateTime nowUtc)
        {
            var exp = pos.Legs.Select(l => l.Expiration).FirstOrDefault(e => !string.IsNullOrEmpty(e));
            if (exp == null || !DateTime.TryParse(exp, System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None, out var expDate))
                return null;
            var today = CascadeUtils.TodayEt(new DateTimeOffset(DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc)));
            return Math.Max(0, (expDate.Date - today).Days);
        }

        private static void AddEvent(ShadowRuntimeStore store, StrategyInstance instance, string type, string symbol,
            DateTime nowUtc, params (string Key, object? Value)[] payload)
            => store.AddEvent(NewEvent(instance.InstanceId, type, symbol, nowUtc, payload));

        private static OperationalEvent NewEvent(string instanceId, string type, string? symbol,
            DateTime nowUtc, params (string Key, object? Value)[] payload) => new()
        {
            EventId = Guid.NewGuid().ToString(),
            InstanceId = instanceId,
            EventType = type,
            Symbol = symbol,
            Payload = payload.ToDictionary(p => p.Key, p => p.Value),
            Timestamp = nowUtc,
        };
    }
}
