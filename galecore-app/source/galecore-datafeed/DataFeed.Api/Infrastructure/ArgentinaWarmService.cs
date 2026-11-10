using DataFeed.Application.App.Macro;
using MediatR;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Precalienta el tablero Argentina (WS-0095) al arrancar la API: el primer pedido del front sale del último tablero armado
    /// en vez de esperar todas las fuentes en frío. Después el propio handler refresca en segundo plano.
    /// </summary>
    public class ArgentinaWarmService : BackgroundService
    {
        private readonly IServiceScopeFactory _scopes;
        private readonly ILogger<ArgentinaWarmService> _logger;

        public ArgentinaWarmService(IServiceScopeFactory scopes, ILogger<ArgentinaWarmService> logger)
        {
            _scopes = scopes;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            try { await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken); } catch (OperationCanceledException) { return; }
            try
            {
                using var scope = _scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<IMediator>().Send(new MacroArgentinaRequest(), stoppingToken);
            }
            catch (OperationCanceledException) { }
            catch (Exception ex) { _logger.LogWarning(ex, "No se pudo precalentar el tablero Argentina"); }
        }
    }
}
