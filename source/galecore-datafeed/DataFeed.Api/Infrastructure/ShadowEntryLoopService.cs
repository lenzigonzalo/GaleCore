using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;
using MediatR;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Loop de entrada SHADOW. BackgroundService singleton.
    /// Cada tick: para cada símbolo de la spec activa, ShadowRuntimeEngine.EvaluateEntryAsync
    /// (gates con métricas reales → candidato real → riesgo duro → fill simulado al mid real).
    /// Cadencia: 60 segundos. Arranca inerte (switch OFF por defecto).
    ///
    /// GC-0002: datos reales o nada. No hay métricas ni candidatos de relleno: un dato que falta
    /// bloquea la entrada y queda registrado. Con el switch OFF el loop no evalúa ni abre nada, y
    /// NO borra el estado: las posiciones abiertas las sigue el monitor (decisión del owner, 24/09).
    /// </summary>
    public class ShadowEntryLoopService : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ShadowRuntimeStore _store;
        private readonly RuntimeStrategySwitch _switch;
        private readonly ILogger<ShadowEntryLoopService> _logger;

        private const int TickSeconds = 60;
        private const int InitialDelaySeconds = 45;
        private bool _inertLogged;

        public ShadowEntryLoopService(
            IServiceScopeFactory scopeFactory,
            ShadowRuntimeStore store,
            RuntimeStrategySwitch strategySwitch,
            ILogger<ShadowEntryLoopService> logger)
        {
            _scopeFactory = scopeFactory;
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
                            _logger.LogInformation(
                                "ShadowEntryLoop pausado (switch={Source}): sin entradas nuevas; el estado se conserva", source);
                            _inertLogged = true;
                        }
                    }
                    else
                    {
                        _inertLogged = false;
                        await TickAsync(stoppingToken);
                    }
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "ShadowEntryLoop error en tick");
                }

                try { await Task.Delay(TimeSpan.FromSeconds(TickSeconds), stoppingToken); }
                catch (OperationCanceledException) { break; }
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
                    using var scope = _scopeFactory.CreateScope();
                    var data = new MediatorRuntimeMarketData(
                        scope.ServiceProvider.GetRequiredService<IMediator>(), _logger);
                    var outcome = await ShadowRuntimeEngine.EvaluateEntryAsync(
                        _store, data, activeInstance, spec, symbol, DateTime.UtcNow, ct);
                    _logger.LogDebug("ShadowEntryLoop: {Symbol} → {Outcome}", symbol, outcome);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
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
    }
}
