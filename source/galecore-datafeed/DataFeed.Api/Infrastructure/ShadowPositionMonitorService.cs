using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Monitor de posiciones SHADOW (Step F). BackgroundService singleton.
    /// Cada tick: evalúa exits determinísticos contra posiciones abiertas.
    /// Cadencia: 30 segundos. Corre solo cuando el switch está ON y hay una instancia activa.
    /// </summary>
    public class ShadowPositionMonitorService : BackgroundService
    {
        private readonly ShadowRuntimeStore _store;
        private readonly RuntimeStrategySwitch _switch;
        private readonly ILogger<ShadowPositionMonitorService> _logger;

        private const int TickSeconds = 30;

        public ShadowPositionMonitorService(
            ShadowRuntimeStore store,
            RuntimeStrategySwitch strategySwitch,
            ILogger<ShadowPositionMonitorService> logger)
        {
            _store = store;
            _switch = strategySwitch;
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
                    var (enabled, _) = _switch.Resolve();
                    if (enabled)
                        TickMonitor();
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "ShadowPositionMonitor error en tick");
                }

                await Task.Delay(TimeSpan.FromSeconds(TickSeconds), stoppingToken);
            }
        }

        private void TickMonitor()
        {
            var instance = _store.ActiveInstance();
            if (instance == null) return;

            var spec = _store.GetSpec(instance.SpecName);
            if (spec == null) return;

            var exits = spec.Exits.Deterministic;
            var openPositions = _store.OpenPositions(instance.InstanceId);

            foreach (var pos in openPositions)
            {
                try
                {
                    EvaluatePosition(pos, exits, instance);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "ShadowPositionMonitor: error evaluando posición {Id}", pos.PositionId);
                }
            }
        }

        private void EvaluatePosition(ShadowPosition pos, DeterministicExits exits, StrategyInstance instance)
        {
            // DTE actual (stub: calculado desde entry)
            int currentDte = Math.Max(0, pos.EntryDte - (int)(DateTime.UtcNow - pos.EntryAt).TotalDays);

            // Spread value actual (stub: simula decay lineal del spread)
            // En producción: se resolvería con mid-prices reales de las patas.
            double daysPassed = (DateTime.UtcNow - pos.EntryAt).TotalDays;
            double decayFactor = Math.Max(0, 1.0 - (daysPassed / pos.EntryDte) * 0.7);
            double currentSpreadValue = pos.EntryCredit * decayFactor;

            // Unrealized P&L
            double unrealizedPnl = Math.Round((pos.EntryCredit - currentSpreadValue) * 100, 2);
            _store.UpdatePosition(pos with { UnrealizedPnl = unrealizedPnl, UpdatedAt = DateTime.UtcNow });

            // Evaluar exits
            var exitReason = ShadowFillSimulator.EvaluateExits(pos, exits, currentSpreadValue, currentDte);

            if (exitReason != null)
            {
                var closed = ShadowFillSimulator.Close(pos, currentSpreadValue, exitReason, DateTime.UtcNow);
                _store.UpdatePosition(closed);

                _logger.LogInformation(
                    "ShadowPositionMonitor: CLOSE {Symbol} pos={Id} reason={Reason} pnl={Pnl}",
                    pos.Symbol, pos.PositionId, exitReason, closed.RealizedPnl);

                _store.AddEvent(new OperationalEvent
                {
                    EventId = Guid.NewGuid().ToString(),
                    InstanceId = instance.InstanceId,
                    EventType = "POSITION_CLOSED",
                    Symbol = pos.Symbol,
                    Payload = new Dictionary<string, object?>
                    {
                        ["position_id"] = pos.PositionId,
                        ["exit_reason"] = exitReason,
                        ["realized_pnl"] = closed.RealizedPnl,
                        ["exit_debit"] = closed.ExitDebit
                    },
                    Timestamp = DateTime.UtcNow
                });
            }
        }
    }
}
