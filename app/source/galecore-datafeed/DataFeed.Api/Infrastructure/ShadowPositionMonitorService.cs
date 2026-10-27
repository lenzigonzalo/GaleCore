using DataFeed.Application.App.Runtime;
using MediatR;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Monitor de posiciones SHADOW. BackgroundService singleton.
    /// Cada tick: valúa cada posición abierta con el mid real de sus patas y evalúa sus salidas
    /// determinísticas (ShadowRuntimeTick.RunMonitorTickAsync); fuera de sesión valúa pero no cierra.
    /// Cadencia: 30 segundos.
    ///
    /// GC-0002: sin precio real de todas las patas no se evalúan salidas (queda VALUATION_NO_DATA);
    /// nada de decaimientos inventados. Corre aunque el switch esté OFF: apagar pausa las entradas
    /// nuevas, no el seguimiento de lo que ya está abierto (decisión del owner, 24/09).
    /// </summary>
    public class ShadowPositionMonitorService : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ShadowRuntimeStore _store;
        private readonly ILogger<ShadowPositionMonitorService> _logger;

        private const int TickSeconds = 30;

        public ShadowPositionMonitorService(
            IServiceScopeFactory scopeFactory,
            ShadowRuntimeStore store,
            ILogger<ShadowPositionMonitorService> logger)
        {
            _scopeFactory = scopeFactory;
            _store = store;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("ShadowPositionMonitorService iniciado");
            try { await Task.Delay(TimeSpan.FromSeconds(50), stoppingToken); }
            catch (OperationCanceledException) { return; }

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await TickMonitorAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "ShadowPositionMonitor error en tick");
                }

                try { await Task.Delay(TimeSpan.FromSeconds(TickSeconds), stoppingToken); }
                catch (OperationCanceledException) { break; }
            }
        }

        private async Task TickMonitorAsync(CancellationToken ct)
        {
            if (_store.OpenPositions().Count == 0) return;

            using var scope = _scopeFactory.CreateScope();
            var data = new MediatorRuntimeMarketData(scope.ServiceProvider.GetRequiredService<IMediator>(), _logger);
            var outcomes = await ShadowRuntimeTick.RunMonitorTickAsync(_store, data, DateTime.UtcNow, ct);
            foreach (var (id, outcome) in outcomes)
                _logger.LogDebug("ShadowPositionMonitor: {Id} → {Outcome}", id, outcome);
        }
    }
}
