using DataFeed.Application.App.Runtime;
using MediatR;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Loop de entrada SHADOW. BackgroundService singleton.
    /// Cada tick: ShadowRuntimeTick.RunEntryTickAsync (en sesión, para cada instancia RUNNING y cada símbolo de su spec:
    /// gates con métricas reales → candidato real → riesgo duro → fill simulado al mid real).
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

                    // Con el switch OFF el tick sólo deja la instancia en PAUSED; no toca lo registrado.
                    await TickAsync(stoppingToken);
                    if (!enabled && !_inertLogged)
                    {
                        _logger.LogInformation(
                            "ShadowEntryLoop pausado (switch={Source}): sin entradas nuevas; el estado se conserva", source);
                        _inertLogged = true;
                    }
                    else if (enabled)
                    {
                        _inertLogged = false;
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
            using var scope = _scopeFactory.CreateScope();
            var data = new MediatorRuntimeMarketData(scope.ServiceProvider.GetRequiredService<IMediator>(), _logger);
            var outcomes = await ShadowRuntimeTick.RunEntryTickAsync(
                _store, data, () => _switch.Resolve().Enabled, DateTime.UtcNow, ct);
            foreach (var (symbol, outcome) in outcomes)
                _logger.LogDebug("ShadowEntryLoop: {InstanceSymbol} → {Outcome}", symbol, outcome);
        }
    }
}
