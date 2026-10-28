using System.Text.Json.Nodes;
using DataFeed.Application.App.Gex;
using DataFeed.Application.App.Shared;
using MediatR;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Mantiene tibio el barrido de GEX de cada ticker del universo: los recorre de a uno al arrancar
    /// y cada gex.cache_seconds. Así el primer pedido de cualquier ticker (y el cambio entre tickers)
    /// sale del último barrido guardado en vez de esperar ~2 minutos. Respeta el switch de GEX.
    /// </summary>
    public class GexWarmService : BackgroundService
    {
        private const string RulesFile = "Gex/galecore_rules_gex.json";

        private readonly IServiceScopeFactory _scopes;
        private readonly IWebHostEnvironment _env;
        private readonly GexStrategySwitch _switch;
        private readonly ILogger<GexWarmService> _logger;

        public GexWarmService(IServiceScopeFactory scopes, IWebHostEnvironment env,
            GexStrategySwitch @switch, ILogger<GexWarmService> logger)
        {
            _scopes = scopes;
            _env = env;
            _switch = @switch;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            // DXLink tiene que completar el handshake.
            try { await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken); } catch (OperationCanceledException) { return; }

            while (!stoppingToken.IsCancellationRequested)
            {
                var wait = TimeSpan.FromSeconds(600);
                try
                {
                    var path = Path.Combine(_env.ContentRootPath, "Files", RulesFile);
                    if (File.Exists(path))
                    {
                        var json = await File.ReadAllTextAsync(path, stoppingToken);
                        var root = JsonNode.Parse(json)!.AsObject();
                        wait = TimeSpan.FromSeconds(root["gex"]?["cache_seconds"]?.GetValue<int>() ?? 600);

                        var (enabled, _) = StrategyEnablement.Resolve(
                            root["gex"]?["enabled"]?.GetValue<bool>() ?? false, _switch.ReadOverride());
                        if (enabled)
                        {
                            var tickers = root["universe"]?["tickers"]?.AsArray()
                                .Select(t => t?.GetValue<string>()).Where(t => !string.IsNullOrWhiteSpace(t)).ToList()
                                ?? new List<string?>();
                            foreach (var symbol in tickers)
                            {
                                if (stoppingToken.IsCancellationRequested) break;
                                await WarmAsync(symbol!, json, stoppingToken);
                            }
                        }
                    }
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (Exception ex) { _logger.LogError(ex, "Error en GexWarmService"); }

                try { await Task.Delay(wait, stoppingToken); } catch (OperationCanceledException) { break; }
            }
        }

        private async Task WarmAsync(string symbol, string rulesJson, CancellationToken ct)
        {
            try
            {
                using var scope = _scopes.CreateScope();
                var mediator = scope.ServiceProvider.GetRequiredService<IMediator>();
                var r = await mediator.Send(new GexAnalysisRequest
                {
                    Symbol = symbol, RulesJson = rulesJson, AllowScan = true, Refresh = true,
                }, ct);
                _logger.LogInformation("GEX tibio: {Symbol} en {Ms} ms", symbol, r.ElapsedMs);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "GEX tibio: {Symbol} falló; se reintenta en la próxima ronda", symbol);
            }
        }
    }
}
