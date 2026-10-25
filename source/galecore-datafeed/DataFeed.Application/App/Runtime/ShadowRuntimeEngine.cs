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
            public const string TradeLimit = "TRADE_LIMIT";
            public const string LossBrake = "LOSS_BRAKE";
            public const string RiskLimit = "RISK_LIMIT";
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
            // Los umbrales que son otra métrica (metric_ref contra metric_ref) se resuelven junto con las demás.
            var metricRefs = gates.Select(g => g.MetricRef)
                .Concat(gates.Where(g => g.Threshold.MetricRef != null).Select(g => g.Threshold.MetricRef!))
                .Distinct().ToList();

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
            // Condiciones de eventos (WS-0062 inc.5): FOMC, balances, datos macro... según lo que el calendario conozca.
            eval = await EventGates.ApplyAsync(eval, spec.EntryFilters.GateLayer.EventGates, data.Events, spec.Operational,
                spec.Universe.Symbols, nowUtc, ct);
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

            // 3. Límite de posiciones: cuentan también las que dejaron abiertas las instancias paradas de la
            // misma estrategia (WS-0024, ver ShadowRuntimeStore.LimitScope).
            var limitScope = store.LimitScope(instance);
            int openCount = store.OpenPositionCount(limitScope);
            if (spec.RiskLimits.MaxConcurrentPositions is int max && openCount >= max)
            {
                AddEvent(store, instance, "ENTRY_SKIPPED", symbol, nowUtc,
                    ("reason", $"máximo de posiciones abiertas alcanzado ({openCount}/{max})"));
                return Outcomes.MaxPositions;
            }

            // 3b. Espaciado entre entradas (GC-0005): cuenta la última entrada del mismo alcance, abierta o
            // cerrada, así un cierre rápido no habilita otra entrada el mismo día. Igual que el máximo de
            // posiciones, se chequea fuera del lock de TryAddPosition: vale porque ShadowEntryLoopService es el
            // único que abre posiciones y evalúa un tick por vez, con las instancias en serie (P1-07). Un segundo
            // camino de entrada tendría que repetir estos dos chequeos bajo ese lock.
            if (spec.RiskLimits.MinMinutesBetweenEntries is int minMinutes
                && store.LastEntryAt(limitScope) is DateTime lastEntry
                && nowUtc - lastEntry < TimeSpan.FromMinutes(minMinutes))
            {
                var next = lastEntry.AddMinutes(minMinutes);
                AddEvent(store, instance, "ENTRY_SKIPPED", symbol, nowUtc,
                    ("reason", $"espaciado entre entradas: la última fue hace {(int)(nowUtc - lastEntry).TotalMinutes} min (mínimo {minMinutes})"),
                    ("last_entry_at", lastEntry.ToString("o")), ("next_entry_allowed_at", next.ToString("o")));
                return Outcomes.TooSoon;
            }

            // 3c. Límites de frecuencia de operaciones (WS-0062 inc.5, requisito legal): bloquean la entrada y dejan el motivo.
            // Mismo criterio que 3b: se chequean fuera del lock, el loop de entrada es único y serial.
            var limitReason = TradeLimits.BlockReason(
                spec, store.AllPositions().Where(p => limitScope.Contains(p.InstanceId)).ToList(), nowUtc);
            if (limitReason != null)
            {
                AddEvent(store, instance, "ENTRY_SKIPPED", symbol, nowUtc, ("reason", limitReason), ("limit", "trade_limits"));
                return Outcomes.TradeLimit;
            }

            // 3d. Freno por pérdida (WS-0062 inc.6): no depende del candidato, así que se chequea antes de pedir cotizaciones. Nunca cierra
            // nada abierto. El total mira sólo esta instancia: redesplegar la estrategia lo levanta; day y week se levantan al cambiar el período.
            var scopePositions = store.AllPositions().Where(p => limitScope.Contains(p.InstanceId)).ToList();
            var brake = ShadowRiskControls.LossBrake(spec, scopePositions, scopePositions.Where(p => p.InstanceId == instance.InstanceId).ToList(), nowUtc);
            if (brake != null)
            {
                AddEvent(store, instance, "ENTRY_SKIPPED", symbol, nowUtc, ("reason", brake.Reason), ("limit", brake.Limit));
                return Outcomes.LossBrake;
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
            // Con capital simulado declarado, el % máximo de riesgo por operación se mide contra el equity (capital + P&L realizado).
            var risk = ShadowRiskValidator.Validate(candidate, spec, openCount, ShadowRiskControls.Equity(spec, scopePositions), nowUtc);
            if (!risk.IsValid)
            {
                AddEvent(store, instance, "RISK_CHECK_FAILED", symbol, nowUtc, ("errors", risk.Errors));
                return Outcomes.RiskRejected;
            }

            // 5b. Tope por apuesta, presupuesto de riesgo y margen intradiario (WS-0062 inc.6): dependen del candidato.
            var block = ShadowRiskControls.CandidateBlock(spec, candidate, scopePositions);
            if (block != null)
            {
                AddEvent(store, instance, "ENTRY_SKIPPED", symbol, nowUtc,
                    ("reason", block.Reason), ("limit", block.Limit), ("candidate_id", candidate.CandidateId), ("max_risk", candidate.MaxRisk));
                return Outcomes.RiskLimit;
            }

            // 6. Fill simulado con las condiciones de la spec (natural por defecto).
            ShadowPosition position;
            try
            {
                var terms = ExecutionTerms.From(spec);
                position = ShadowFillSimulator.Fill(candidate, nowUtc, terms) with { EntryContext = BuildEntryContext(eval, candidate, terms) };
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

        /// <summary>Lo que la spec evaluó y las cotizaciones de las patas al armar el candidato (WS-0033).</summary>
        private static EntryContext BuildEntryContext(EvaluationResult eval, TradeCandidate candidate, ExecutionTerms terms) => new()
        {
            EvaluationId = eval.EvaluationId,
            Gates = eval.GateResults,
            Vix = candidate.Snapshot.Vix,
            IvRank = candidate.Snapshot.IvRank,
            UnderlyingPrice = candidate.Snapshot.UnderlyingPrice,
            SnapshotAt = candidate.Snapshot.AsOf,
            Execution = terms,
            Legs = candidate.Legs.Select(l => new LegQuoteSnapshot
            {
                Side = l.Side, Type = l.Type, Strike = l.Strike, Bid = l.Bid, Ask = l.Ask,
            }).ToList(),
        };

        // ── Valuación y salidas ─────────────────────────────────────

        /// <summary>Tolerancia (USD) del rango [0, ancho] del débito: los mids redondeados pueden pasarse unos centavos.</summary>
        private const double ValueTolerance = 0.05;

        /// <summary>
        /// Valúa una posición abierta con el mid real de cada pata y evalúa sus salidas. Si falta el
        /// precio de alguna pata (o su vencimiento), no evalúa salidas y registra NO_DATA; el evento
        /// se registra cuando el problema aparece o cambia, no en cada tick.
        /// Con <paramref name="evaluateExits"/> en false (fuera de sesión) valúa pero no cierra:
        /// no se simula un cierre con precios de un mercado cerrado (R1-M1).
        /// </summary>
        public static async Task<string> ValuePositionAsync(
            ShadowRuntimeStore store, IRuntimeMarketData data, ShadowPosition pos, DeterministicExits exits,
            DateTime nowUtc, CancellationToken ct, bool evaluateExits = true, TimeSpan? maxQuoteAge = null,
            SpecOperational? operational = null)
        {
            // Vencida y pasada la hora de liquidación: se liquida (o queda pendiente) sin mirar cotizaciones de opciones.
            if (Expiry.SettlementDue(pos, nowUtc) is DateTime expiredOn)
                return await SettleExpiredAsync(store, data, pos, expiredOn, nowUtc, ct);

            var problems = new List<string>();
            var legQuotes = new List<LegQuoteSnapshot>();
            var terms = ShadowFillSimulator.TermsOf(pos);
            double spreadValue = 0;
            double midValue = 0;   // el mismo débito al medio: valida las cotizaciones sin depender del modelo de fill
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
                legQuotes.Add(new LegQuoteSnapshot
                {
                    Side = leg.Side, Type = leg.Type, Strike = leg.Strike, Bid = quote.Bid, Ask = quote.Ask,
                });
                // Débito para cerrar: recomprar lo vendido (+precio; natural: al ask) y vender lo comprado (−precio; al bid).
                if (leg.Side == "SELL")
                {
                    spreadValue += ShadowFillSimulator.LegPrice(quote.Bid, quote.Ask, buying: true, terms, 4);
                    midValue += quote.Mid;
                }
                else if (leg.Side == "BUY")
                {
                    spreadValue -= ShadowFillSimulator.LegPrice(quote.Bid, quote.Ask, buying: false, terms, 4);
                    midValue -= quote.Mid;
                }
                else problems.Add($"{leg.StreamerSymbol}: lado de pata desconocido '{leg.Side}'");
            }

            bool equity = pos.Structure == RuntimeStructures.LongEquity;
            int? dte = equity ? null : CurrentDte(pos, nowUtc);   // las acciones no vencen
            if (dte == null && !equity) problems.Add("sin fecha de vencimiento en las patas");
            if (problems.Count == 0 && !double.IsFinite(spreadValue)) problems.Add($"valor del spread no finito ({spreadValue})");
            // El débito de un spread de crédito de riesgo definido está en [0, ancho]. Fuera de eso alguna pata
            // trae una cotización sin sentido (p. ej. bid 0 / ask 20 en la apertura): no se valúa ni se cierra con ese precio.
            // En custom_options el rango sale del payoff de las patas (un débito puede valer menos que 0); en las familias, [0, ancho].
            var (lowest, highest) = pos.Structure == RuntimeStructures.CustomOptions
                ? OptionPayoff.DebitRange(pos.Legs.Select(l => (l.Side, l.Type, l.Strike)).ToList())
                : (0.0, pos.Width);
            if (problems.Count == 0 && (pos.Width > 0 || pos.Structure == RuntimeStructures.CustomOptions)
                && (midValue < lowest - ValueTolerance || midValue > highest + ValueTolerance))
                problems.Add($"valor del spread {midValue:0.00} fuera de [{lowest:0.##}, {highest:0.##}]: cotización inválida en alguna pata");

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
                UnrealizedPnl = ShadowFillSimulator.Pnl(pos, spreadValue),
                ValuationProblems = null,
                UpdatedAt = nowUtc,
            };

            // Salidas por métrica (WS-0061) y por evento (WS-0062 inc.5): sólo con sesión abierta. Sin dato no se cierra (salvo un
            // event_exit con on_no_data CLOSE) y queda anotado en la posición, con el nombre de lo que falta.
            bool metricMet = false, eventMet = false;
            var exitProblems = new List<string>();
            if (evaluateExits && exits.MetricExit is MetricExit metricExit)
            {
                var resolved = new Dictionary<string, double?>();
                string? metricProblem = null;
                var refs = metricExit.Threshold.MetricRef == null
                    ? new[] { metricExit.MetricRef } : new[] { metricExit.MetricRef, metricExit.Threshold.MetricRef };
                try { resolved = await data.ResolveMetricsAsync(refs, nowUtc, maxQuoteAge, ct); }
                catch (Exception ex) when (ex is not OperationCanceledException) { metricProblem = ex.Message; }
                var metricValue = resolved.GetValueOrDefault(metricExit.MetricRef);
                var threshold = GenericGateEvaluator.ResolveThreshold(metricExit.Threshold, resolved);
                if (metricValue is double mv && threshold != null) metricMet = GenericGateEvaluator.EvaluateOperator(metricExit.Operator, mv, threshold);
                else
                {
                    var missing = refs.Where(r => resolved.GetValueOrDefault(r) == null).Distinct();
                    exitProblems.Add($"salida por condición sin dato: {string.Join(", ", missing)}" + (metricProblem == null ? "" : $" ({metricProblem})"));
                }
            }
            if (evaluateExits)
                foreach (var ev in exits.EventExits)
                {
                    var gate = new EventGate { Id = ev.Id, Type = ev.Type, Subject = ev.Subject, Window = ev.Window, Must = ev.Must };
                    var r = await EventGates.EvaluateAsync(gate, data.Events, operational ?? new SpecOperational(), new[] { pos.Symbol }, nowUtc, ct);
                    if (r.Status == "PASS") eventMet = true;
                    else if (r.Status == "NO_DATA")
                    {
                        if (ev.OnNoData == "CLOSE") eventMet = true;
                        else exitProblems.Add($"salida por evento sin dato: {r.Label}");
                    }
                }
            // Salida por hora (WS-0062 inc.5): con days_after_entry, a esa hora del N-ésimo día de sesión tras la entrada (0 = el mismo día);
            // sin él, el día del vencimiento (DTE 0). Los feriados de NYSE no cuentan como día de sesión; en un cierre temprano la salida
            // se dispara 5 minutos antes del cierre. Si el calendario no cubre la fecha, no se inventa un día: queda anotado.
            bool timeOfDayReached = false;
            var op = operational ?? new SpecOperational();
            if (evaluateExits && exits.TimeExit?.At is string at && ShadowSession.TryTime(at, out var atTime)
                && ShadowSession.LocalTime(op, nowUtc) is DateTime localNow)
            {
                if (exits.TimeExit.DaysAfterEntry is int n && ShadowSession.LocalTime(op, pos.EntryAt) is DateTime entryLocal)
                {
                    if (AddSessionDays(entryLocal.Date, n) is DateTime target)
                    {
                        var effectiveAt = ShadowSession.EffectiveExitTime(op, target, atTime);
                        timeOfDayReached = localNow.Date > target || (localNow.Date == target && localNow.TimeOfDay >= effectiveAt);
                    }
                    else exitProblems.Add("salida por hora sin dato: el calendario de NYSE no cubre el día de sesión de la salida");
                }
                else if (exits.TimeExit.DaysAfterEntry == null && dte == 0)
                    timeOfDayReached = localNow.TimeOfDay >= ShadowSession.EffectiveExitTime(op, localNow.Date, atTime);
            }
            if (exitProblems.Count > 0)
            {
                valued = valued with { ValuationProblems = exitProblems };
                if (pos.ValuationProblems == null || !pos.ValuationProblems.SequenceEqual(exitProblems))
                    store.AddEvent(NewEvent(pos.InstanceId, "VALUATION_NO_DATA", pos.Symbol, nowUtc,
                        ("position_id", pos.PositionId), ("problems", exitProblems)));
            }
            store.UpdatePosition(valued);
            if (!evaluateExits) return Outcomes.Valued;

            var reason = ShadowFillSimulator.EvaluateExits(valued, exits, spreadValue, dte ?? int.MaxValue, metricMet, timeOfDayReached, eventMet);
            if (reason == null) return Outcomes.Valued;

            var closed = ShadowFillSimulator.Close(valued, spreadValue, reason, nowUtc) with
            {
                ExitContext = new ExitContext { CapturedAt = nowUtc, Dte = dte, Legs = legQuotes },
            };
            // El cierre y su evento se guardan juntos (GC-0004).
            store.UpdatePosition(closed, NewEvent(pos.InstanceId, "POSITION_CLOSED", pos.Symbol, nowUtc,
                ("position_id", pos.PositionId), ("exit_reason", reason),
                ("realized_pnl", closed.RealizedPnl), ("exit_debit", closed.ExitDebit), ("dte", dte)));
            return Outcomes.Closed;
        }

        /// <summary>
        /// Liquidación al vencimiento. Valor = intrínseco de cada pata con el cierre oficial del subyacente de ese día; el
        /// cierre se pide como vela diaria de esa fecha. Sin ese precio la posición sigue OPEN, «pendiente de liquidar»,
        /// sin P&amp;L ni otras salidas. Las de liquidación AM (SPX mensual) no se pueden liquidar con el cierre: quedan pendientes.
        /// Simplificación declarada: una opción sobre acciones/ETF se liquida por su valor intrínseco (como si se ejerciera
        /// y se vendiera/recomprara al cierre); no se crea posición en acciones.
        /// </summary>
        private static async Task<string> SettleExpiredAsync(
            ShadowRuntimeStore store, IRuntimeMarketData data, ShadowPosition pos, DateTime expiredOn,
            DateTime nowUtc, CancellationToken ct)
        {
            var date = expiredOn.ToString("yyyy-MM-dd");
            if (Expiry.IsAmSettled(pos))
            {
                RecordValuationProblems(store, pos, new List<string>
                {
                    $"{Expiry.PendingText}: vencimiento {date} de liquidación AM; se liquida con la apertura y no hay ese precio",
                }, nowUtc);
                return Outcomes.NoData;
            }
            double? close = null;
            string? error = null;
            try { close = await data.GetOfficialCloseAsync(pos.Symbol, expiredOn, ct); }
            catch (Exception ex) when (ex is not OperationCanceledException) { error = ex.Message; }
            if (close is not double underlying || !double.IsFinite(underlying) || underlying <= 0)
            {
                RecordValuationProblems(store, pos, new List<string>
                {
                    $"{Expiry.PendingText}: sin cierre oficial de {pos.Symbol} del {date}" + (error == null ? "" : $" ({error})"),
                }, nowUtc);
                return Outcomes.NoData;
            }

            double debit = Math.Round(pos.Legs.Sum(l =>
                (l.Side == "SELL" ? 1 : -1) * Expiry.Intrinsic(l, underlying)), 4);
            var closed = ShadowFillSimulator.Close(
                pos with { LastSpreadValue = debit, CurrentDte = 0, LastValuedAt = nowUtc, ValuationProblems = null },
                debit, ShadowFillSimulator.ExpirationReason, nowUtc) with
            {
                ExitContext = new ExitContext { CapturedAt = nowUtc, Dte = 0, Legs = new List<LegQuoteSnapshot>() },
            };
            store.UpdatePosition(closed, NewEvent(pos.InstanceId, "POSITION_CLOSED", pos.Symbol, nowUtc,
                ("position_id", pos.PositionId), ("exit_reason", ShadowFillSimulator.ExpirationReason),
                ("realized_pnl", closed.RealizedPnl), ("exit_debit", closed.ExitDebit), ("dte", 0),
                ("underlying_close", underlying), ("expiration", date)));
            return Outcomes.Closed;
        }

        /// <summary>
        /// Deja en la posición por qué no se pudo valuar, y un evento VALUATION_NO_DATA sólo si el
        /// problema es nuevo o cambió. El monitor corre cada 30 s: sin esto, una noche sin
        /// cotizaciones llenaría el registro de eventos con el mismo aviso. Sin valuación vigente no queda el P&amp;L ni el valor
        /// de la valuación anterior: nadie suma un número viejo (métricas, rendimiento, capital, freno por pérdida).
        /// </summary>
        public static void RecordValuationProblems(
            ShadowRuntimeStore store, ShadowPosition pos, List<string> problems, DateTime nowUtc)
        {
            bool changed = pos.ValuationProblems == null || !pos.ValuationProblems.SequenceEqual(problems);
            store.UpdatePosition(pos with { ValuationProblems = problems, UnrealizedPnl = null, LastSpreadValue = null, UpdatedAt = nowUtc });
            if (!changed) return;
            store.AddEvent(new OperationalEvent
            {
                EventId = Guid.NewGuid().ToString(), InstanceId = pos.InstanceId, EventType = "VALUATION_NO_DATA",
                Symbol = pos.Symbol, Timestamp = nowUtc,
                Payload = new Dictionary<string, object?> { ["position_id"] = pos.PositionId, ["problems"] = problems },
            });
        }

        /// <summary>
        /// El día de sesión N después de <paramref name="date"/>: lunes a viernes sin los feriados de NYSE (los cierres tempranos cuentan).
        /// Null si algún día a contar cae en un año que el calendario no cubre: no se sabe, no se inventa.
        /// </summary>
        public static DateTime? AddSessionDays(DateTime date, int n)
        {
            var d = date;
            for (int i = 0; i < n; i++)
            {
                do
                {
                    d = d.AddDays(1);
                    while (d.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday) d = d.AddDays(1);
                    var kind = NyseCalendar.Kind(DateOnly.FromDateTime(d));
                    if (kind == NyseDay.Unknown) return null;
                    if (kind != NyseDay.Closed) break;
                } while (true);
            }
            return d;
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

namespace DataFeed.Application.App.Runtime
{
    /// <summary>Vencimiento y liquidación de las patas de una posición (WS-0062 inc.3).</summary>
    public static class Expiry
    {
        public const string PendingText = "pendiente de liquidar";

        /// <summary>Raíces de índice con liquidación AM (SPX mensual, NDX, RUT, VIX); SPXW, NDXP, RUTW... liquidan PM.</summary>
        private static readonly HashSet<string> AmRoots = new(StringComparer.OrdinalIgnoreCase) { "SPX", "NDX", "RUT", "VIX" };

        /// <summary>Liquidación AM, derivada de la raíz del símbolo OCC (la cadena trae settlement-type pero la posición no lo guarda).</summary>
        public static bool IsAmSettled(ShadowPosition pos)
        {
            return IsAmRoot(pos.Legs.Select(l => l.OccSymbol).FirstOrDefault(o => !string.IsNullOrWhiteSpace(o)));
        }

        /// <summary>Liquidación AM según la raíz de un símbolo OCC (null = se asume PM).</summary>
        public static bool IsAmRoot(string? occ)
        {
            if (string.IsNullOrWhiteSpace(occ)) return false;
            var root = new string(occ.Trim().TakeWhile(char.IsLetter).ToArray());
            return AmRoots.Contains(root);
        }

        /// <summary>
        /// Hora (ET) desde la que se liquida: 16:15, no 16:00. A las 16:00 la vela diaria puede estar parcial y su cierre
        /// todavía no ser el definitivo; el cuarto de hora de margen evita liquidar con un precio provisorio.
        /// </summary>
        public static readonly TimeSpan SettlementTimeEt = new(16, 15, 0);

        /// <summary>
        /// La fecha de vencimiento si la posición de opciones ya pasó su hora de liquidación (<see cref="SettlementTimeEt"/> de ese día), o null.
        /// Las acciones (long_equity) no vencen.
        /// </summary>
        public static DateTime? SettlementDue(ShadowPosition pos, DateTime nowUtc)
        {
            if (pos.Structure == RuntimeStructures.LongEquity) return null;
            var exp = pos.Legs.Select(l => l.Expiration).FirstOrDefault(e => !string.IsNullOrEmpty(e));
            if (exp == null || !DateTime.TryParse(exp, System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None, out var expDate)) return null;
            if (!ShadowSession.TryZone("America/New_York", out var et)) return null;   // sin zona no se sabe si ya pasó la hora: no se liquida
            var nowEt = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc), et);
            return nowEt >= expDate.Date + SettlementTimeEt ? expDate.Date : null;
        }

        /// <summary>Valor intrínseco de una pata con el subyacente a <paramref name="underlying"/>.</summary>
        public static double Intrinsic(ShadowLeg leg, double underlying) =>
            string.Equals(leg.Type, "CALL", StringComparison.OrdinalIgnoreCase)
                ? Math.Max(underlying - leg.Strike, 0)
                : Math.Max(leg.Strike - underlying, 0);
    }
}
