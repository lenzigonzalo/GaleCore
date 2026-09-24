using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;
using MediatR;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Loop de entrada SHADOW. BackgroundService singleton.
    /// Cada tick: evaluate gates → build candidate → hard risk → shadow fill.
    /// Cadencia: 60 segundos. Arranca inerte (switch OFF por defecto).
    ///
    /// Patrón: mismo que RpfLoopService — scope factory, timeout, switch check, error handling.
    /// MetricResolver resuelve gates vía MediatR; PcsCandidateBuilder construye candidatos reales.
    /// Fallback a stubs si MediatR falla (SHADOW: no bloquea el flujo por un error de datos).
    /// </summary>
    public class ShadowEntryLoopService : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly IWebHostEnvironment _env;
        private readonly ShadowRuntimeStore _store;
        private readonly RuntimeStrategySwitch _switch;
        private readonly ILogger<ShadowEntryLoopService> _logger;

        private const int TickSeconds = 60;
        private const int InitialDelaySeconds = 45;
        private bool _inertLogged;

        public ShadowEntryLoopService(
            IServiceScopeFactory scopeFactory,
            IWebHostEnvironment env,
            ShadowRuntimeStore store,
            RuntimeStrategySwitch strategySwitch,
            ILogger<ShadowEntryLoopService> logger)
        {
            _scopeFactory = scopeFactory;
            _env = env;
            _store = store;
            _switch = strategySwitch;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("ShadowEntryLoopService iniciado (arranca inerte, switch OFF)");
            try { await Task.Delay(TimeSpan.FromSeconds(InitialDelaySeconds), stoppingToken); }
            catch (OperationCanceledException) { return; }

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    var (enabled, source) = _switch.Resolve();

                    if (!enabled)
                    {
                        if (!_inertLogged)
                        {
                            _store.Clear();
                            _logger.LogInformation("ShadowEntryLoop inerte (switch={Source})", source);
                            _inertLogged = true;
                        }
                        await Task.Delay(TimeSpan.FromSeconds(TickSeconds), stoppingToken);
                        continue;
                    }

                    _inertLogged = false;

                    // ── Tick ──
                    await TickAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "ShadowEntryLoop error en tick");
                }

                await Task.Delay(TimeSpan.FromSeconds(TickSeconds), stoppingToken);
            }
        }

        private async Task TickAsync(CancellationToken ct)
        {
            var activeInstance = _store.ActiveInstance();
            if (activeInstance == null)
            {
                _logger.LogDebug("ShadowEntryLoop: sin instancia activa");
                return;
            }

            // Buscar el spec de la instancia activa
            var spec = _store.GetSpec(activeInstance.SpecName);
            if (spec == null)
            {
                _logger.LogWarning("ShadowEntryLoop: spec '{Name}' no encontrado para instancia {Id}",
                    activeInstance.SpecName, activeInstance.InstanceId);
                return;
            }

            _store.UpdateInstanceState(activeInstance.InstanceId, "RUNNING", "EVALUATING");

            foreach (var symbol in spec.Universe.Symbols)
            {
                try
                {
                    await EvaluateSymbolAsync(activeInstance, spec, symbol, ct);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "ShadowEntryLoop: error evaluando {Symbol}", symbol);
                    _store.AddEvent(new OperationalEvent
                    {
                        EventId = Guid.NewGuid().ToString(),
                        InstanceId = activeInstance.InstanceId,
                        EventType = "ERROR",
                        Symbol = symbol,
                        Payload = new Dictionary<string, object?> { ["error"] = ex.Message },
                        Timestamp = DateTime.UtcNow
                    });
                }
            }

            _store.UpdateInstanceState(activeInstance.InstanceId, "RUNNING", "IDLE");
        }

        private async Task EvaluateSymbolAsync(StrategyInstance instance, StrategySpec spec, string symbol, CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var mediator = scope.ServiceProvider.GetRequiredService<IMediator>();

            // ── 1. Evaluar gates con métricas reales ──
            Dictionary<string, double?> metrics;
            bool usingRealMetrics = false;
            try
            {
                var resolver = new MetricResolver(mediator, _logger);
                var metricRefs = spec.EntryFilters.GateLayer.Gates.Select(g => g.MetricRef);
                metrics = await resolver.ResolveAsync(metricRefs, ct);
                usingRealMetrics = true;
                _logger.LogDebug("ShadowEntryLoop: métricas reales para {Symbol}: {Metrics}",
                    symbol, string.Join(", ", metrics.Select(kv => $"{kv.Key}={kv.Value}")));
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "ShadowEntryLoop: MetricResolver falló, usando stubs para {Symbol}", symbol);
                metrics = BuildStubMetrics(spec);
            }

            var evalResult = GenericGateEvaluator.Evaluate(
                spec.EntryFilters.GateLayer.Gates,
                spec.EntryFilters.GateLayer.PassRule,
                spec.EntryFilters.GateLayer.OnFail,
                metrics,
                instance.InstanceId,
                symbol);

            _store.SetLastEvaluation($"{instance.InstanceId}:{symbol}", evalResult);

            _store.AddEvent(new OperationalEvent
            {
                EventId = Guid.NewGuid().ToString(),
                InstanceId = instance.InstanceId,
                EventType = "EVALUATION_COMPLETED",
                Symbol = symbol,
                Payload = new Dictionary<string, object?>
                {
                    ["overall_pass"] = evalResult.OverallPass,
                    ["gate_count"] = evalResult.GateResults.Count,
                    ["real_metrics"] = usingRealMetrics
                },
                Timestamp = DateTime.UtcNow
            });

            if (!evalResult.OverallPass)
            {
                _logger.LogDebug("ShadowEntryLoop: gates no pasan para {Symbol}", symbol);
                return;
            }

            // ── 2. Verificar si ya hay posición abierta ──
            int openCount = _store.OpenPositionCount(instance.InstanceId);
            if (spec.RiskLimits.MaxConcurrentPositions.HasValue
                && openCount >= spec.RiskLimits.MaxConcurrentPositions.Value)
            {
                _logger.LogDebug("ShadowEntryLoop: max posiciones alcanzado ({Count})", openCount);
                return;
            }

            // ── 3. Construir candidato real ──
            TradeCandidate? candidate = null;
            bool usingRealCandidate = false;
            try
            {
                var builder = new PcsCandidateBuilder(mediator, _logger);
                double? vixPrice = metrics.GetValueOrDefault("capability:market_data.quote.VIX.price");
                candidate = await builder.BuildAsync(instance, spec, symbol, vixPrice, ct);
                if (candidate != null) usingRealCandidate = true;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "ShadowEntryLoop: PcsCandidateBuilder falló para {Symbol}", symbol);
            }

            // Fallback a stub si el builder real no pudo construir candidato
            if (candidate == null)
            {
                _logger.LogDebug("ShadowEntryLoop: usando candidato stub para {Symbol}", symbol);
                candidate = BuildStubCandidate(instance, spec, symbol);
            }

            _store.AddEvent(new OperationalEvent
            {
                EventId = Guid.NewGuid().ToString(),
                InstanceId = instance.InstanceId,
                EventType = "CANDIDATE_CREATED",
                Symbol = symbol,
                Payload = new Dictionary<string, object?>
                {
                    ["candidate_id"] = candidate.CandidateId,
                    ["credit"] = candidate.Credit,
                    ["max_risk"] = candidate.MaxRisk,
                    ["real_candidate"] = usingRealCandidate,
                    ["delta_short"] = candidate.DeltaShort,
                    ["dte"] = candidate.Dte
                },
                Timestamp = DateTime.UtcNow
            });

            // ── 4. Hard risk ──
            var riskResult = ShadowRiskValidator.Validate(candidate, spec, openCount, null);
            if (!riskResult.IsValid)
            {
                _logger.LogWarning("ShadowEntryLoop: risk check failed for {Symbol}: {Errors}",
                    symbol, string.Join("; ", riskResult.Errors));

                _store.AddEvent(new OperationalEvent
                {
                    EventId = Guid.NewGuid().ToString(),
                    InstanceId = instance.InstanceId,
                    EventType = "RISK_CHECK_FAILED",
                    Symbol = symbol,
                    Payload = new Dictionary<string, object?> { ["errors"] = string.Join("; ", riskResult.Errors) },
                    Timestamp = DateTime.UtcNow
                });
                return;
            }

            // ── 5. Shadow fill ──
            var position = ShadowFillSimulator.Fill(candidate, DateTime.UtcNow);
            _store.AddPosition(position);

            _logger.LogInformation(
                "ShadowEntryLoop: FILL {Symbol} pos={PositionId} credit={Credit} real={Real}",
                symbol, position.PositionId, position.EntryCredit, usingRealCandidate);

            _store.AddEvent(new OperationalEvent
            {
                EventId = Guid.NewGuid().ToString(),
                InstanceId = instance.InstanceId,
                EventType = "POSITION_OPENED",
                Symbol = symbol,
                Payload = new Dictionary<string, object?>
                {
                    ["position_id"] = position.PositionId,
                    ["credit"] = position.EntryCredit,
                    ["max_risk"] = position.MaxRisk,
                    ["dte"] = position.EntryDte,
                    ["real_candidate"] = usingRealCandidate
                },
                Timestamp = DateTime.UtcNow
            });
        }

        /// <summary>
        /// Métricas stub: fallback cuando MetricResolver falla (sin conexión, API caída, etc.).
        /// Los gates siempre pasan con estos valores.
        /// </summary>
        private static Dictionary<string, double?> BuildStubMetrics(StrategySpec spec)
        {
            var metrics = new Dictionary<string, double?>();
            foreach (var gate in spec.EntryFilters.GateLayer.Gates)
            {
                metrics[gate.MetricRef] = gate.Operator switch
                {
                    "LT" => gate.Threshold.Value.HasValue ? gate.Threshold.Value.Value - 1 : 0,
                    "LTE" => gate.Threshold.Value ?? 0,
                    "GT" => gate.Threshold.Value.HasValue ? gate.Threshold.Value.Value + 1 : 1,
                    "GTE" => gate.Threshold.Value ?? 0,
                    _ => 0
                };
            }
            return metrics;
        }

        /// <summary>
        /// Candidato stub: fallback cuando PcsCandidateBuilder falla o no encuentra candidato viable.
        /// </summary>
        private static TradeCandidate BuildStubCandidate(StrategyInstance instance, StrategySpec spec, string symbol)
        {
            var cc = spec.CandidateConstruction;
            double width = cc.Legs.LastOrDefault()?.StrikeSelection.Width ?? 5.0;
            double credit = cc.Constraints.MinCredit ?? 0.85;
            int dte = cc.Constraints.MinDte ?? 35;

            return new TradeCandidate
            {
                CandidateId = Guid.NewGuid().ToString(),
                InstanceId = instance.InstanceId,
                Symbol = symbol,
                Structure = spec.Structure.DefaultStructure,
                Credit = credit,
                MaxRisk = (width - credit) * 100,
                Width = width,
                Dte = dte,
                DeltaShort = cc.Legs.FirstOrDefault()?.StrikeSelection.TargetDelta ?? -0.16,
                Legs = new List<CandidateLeg>
                {
                    new() { Side = "SELL", Type = "PUT", Strike = 520, Bid = credit + 0.05, Ask = credit + 0.15,
                            Delta = cc.Legs.FirstOrDefault()?.StrikeSelection.TargetDelta ?? -0.16,
                            Expiration = DateTime.UtcNow.AddDays(dte).ToString("yyyy-MM-dd") },
                    new() { Side = "BUY", Type = "PUT", Strike = 520 - width, Bid = 0.05, Ask = 0.15,
                            Expiration = DateTime.UtcNow.AddDays(dte).ToString("yyyy-MM-dd") }
                },
                Snapshot = new MarketSnapshot
                {
                    UnderlyingPrice = 545,
                    Vix = 18,
                    AsOf = DateTime.UtcNow
                },
                CreatedAt = DateTime.UtcNow
            };
        }
    }
}
