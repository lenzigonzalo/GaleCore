using System.Diagnostics;
using System.Text.Json.Nodes;
using DataFeed.Application.App.Rpf;
using DataFeed.Application.App.Rpf.Engine;
using DataFeed.Application.App.SignalGates;
using DataFeed.Application.App.Shared.Dtos;
using DataFeed.Infrastructure.Providers.Tastytrade;
using MediatR;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Loop de orquestación RPF (diseño Fase 5 §3). BackgroundService singleton, molde de
    /// SkewSnapshotService. SPY-only. En cada tick corre la cascada existente
    /// (ValidationLayerRequest sobre galecore_rules_rpf.json) y mapea su salida a la máquina de estados
    /// (RpfStateMachine, función pura); emite RpfStateUpdate al cambiar de estado y TradeSuggestion al
    /// entrar en TRIGGERED. El sistema SUGIERE, nunca ejecuta.
    ///
    /// ARRANCA INERTE: mientras state_machine.enabled != true en el JSON, el loop no corre la cascada
    /// ni emite nada — solo late. Se activa recién tras revisión + validación en paper (Decisión de
    /// arranque, 2026-07-29). NO está registrado para emitir hasta ese flip.
    ///
    /// Nota 6a: corre la cascada COMPLETA por tick (el cache de Tier A del diseño §3.1 es una
    /// optimización de latencia que se afina en activación; con el loop inerte no hay costo).
    /// </summary>
    public class RpfLoopService : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly IWebHostEnvironment _env;
        private readonly IMarketDataBroadcaster _broadcaster;
        private readonly RpfStateStore _store;
        private readonly RpfStrategySwitch _strategySwitch;
        private readonly ILogger<RpfLoopService> _logger;

        // Archivos propios de RPF bajo Files/Rpf/ (regla "archivos por estrategia" de CLAUDE.md).
        private const string RulesFile = "Rpf/galecore_rules_rpf.json";

        private bool _inertLogged;

        public RpfLoopService(
            IServiceScopeFactory scopeFactory,
            IWebHostEnvironment env,
            IMarketDataBroadcaster broadcaster,
            RpfStateStore store,
            RpfStrategySwitch strategySwitch,
            ILogger<RpfLoopService> logger)
        {
            _scopeFactory = scopeFactory;
            _env = env;
            _broadcaster = broadcaster;
            _store = store;
            _strategySwitch = strategySwitch;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("RpfLoopService iniciado (arranca inerte hasta state_machine.enabled=true)");
            // Delay inicial para que DXLink complete el handshake, como los demás hosted services.
            try { await Task.Delay(TimeSpan.FromSeconds(45), stoppingToken); } catch (OperationCanceledException) { return; }

            while (!stoppingToken.IsCancellationRequested)
            {
                int tickBSeconds = 30;
                try
                {
                    var cfg = LoadConfig();
                    tickBSeconds = cfg.TickBSeconds;

                    // El switch es GLOBAL y se resuelve sin salir del disco (archivo de estado +
                    // JSON de reglas): el loop no consulta la base. Hasta el 2026-08-12 preguntaba
                    // además "¿le sirve a alguien?" contra `user_strategies` en cada tick — ese
                    // nivel se eliminó con la tabla, y con él un round-trip por tick y su rama
                    // permisiva ante fallas. Ver StrategyEnablement.
                    if (!cfg.Enabled)
                    {
                        if (!_inertLogged)
                        {
                            // Al entrar en inerte se descarta el estado en memoria: con el loop parado
                            // nadie lo actualiza. Cubre también el apagado por fuera del switch (edición
                            // directa del archivo de estado o del JSON de reglas).
                            _store.Clear();
                            _logger.LogInformation(
                                "RpfLoopService INERTE: switch en OFF — no se corre la cascada ni se emite.");
                            _inertLogged = true;
                        }
                    }
                    else
                    {
                        _inertLogged = false;
                        await TickAsync(cfg, stoppingToken);
                    }
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (Exception ex) { _logger.LogError(ex, "Error en RpfLoopService tick"); }

                try { await Task.Delay(TimeSpan.FromSeconds(tickBSeconds), stoppingToken); } catch (OperationCanceledException) { break; }
            }
            _logger.LogInformation("RpfLoopService detenido");
        }

        // ── Config ──

        private record LoopConfig(bool Enabled, int TickBSeconds, int CooldownSeconds, int TickTimeoutSeconds, int EmitTimeoutSeconds, List<string> Tickers, string RulesJson, string? PopJson, string? SkewJson);

        private LoopConfig LoadConfig()
        {
            var filesDir = Path.Combine(_env.ContentRootPath, "Files");
            var rulesJson = File.ReadAllText(Path.Combine(filesDir, RulesFile));
            var root = JsonNode.Parse(rulesJson)!.AsObject();

            // El switch manual del operador (Files/Rpf/rpf_workers_state.json) pisa lo que declara el
            // JSON de reglas. Si nunca se tocó, manda state_machine.enabled. Se relee en cada tick, así
            // que apagar desde el front corta el loop dentro de un tick, sin reiniciar la API.
            bool enabled = _strategySwitch.ReadOverride() ?? (bool?)root["state_machine"]?["enabled"] ?? false;
            var orch = root["orchestration"]?.AsObject();
            int tickB = (int?)orch?["tier_b_tick_seconds"] ?? 30;
            int cooldown = (int?)orch?["cooldown_seconds"] ?? 120;
            int tickTimeout = (int?)orch?["tick_timeout_seconds"] ?? 90;
            int emitTimeout = (int?)orch?["emit_timeout_seconds"] ?? 10;

            var tickers = root["universe"]?["tickers"]?.AsArray()
                .Select(x => (string?)x).Where(s => !string.IsNullOrEmpty(s)).Select(s => s!).ToList()
                ?? new List<string> { "SPY" };

            // Quedan en la raíz de Files/, no en Files/Rpf/: hoy los lee solo RPF, pero quien
            // ESCRIBE skew25_history.json es SkewSnapshotService, que no es de ninguna estrategia.
            string? pop = ReadOrNull(Path.Combine(filesDir, "pop_calibration.json"));
            string? skew = ReadOrNull(Path.Combine(filesDir, "skew25_history.json"));

            return new LoopConfig(enabled, tickB, cooldown, tickTimeout, emitTimeout, tickers, rulesJson, pop, skew);
        }

        private static string? ReadOrNull(string path) => File.Exists(path) ? File.ReadAllText(path) : null;

        // ── Tick ──

        private async Task TickAsync(LoopConfig cfg, CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var mediator = scope.ServiceProvider.GetRequiredService<IMediator>();

            foreach (var symbol in cfg.Tickers)
            {
                var now = DateTime.UtcNow;

                // Corte duro por tick. Sin esto, un mediator.Send que se cuelga (canal DXLink saturado,
                // snapshot que nunca completa) wedgea el loop PARA SIEMPRE: no se llega nunca al Delay
                // del final, no hay log y no hay heartbeat, así que el tablero se queda mostrando datos
                // viejos que parecen vigentes. Con el corte el tick muere, cae en el catch de abajo y
                // emite estado de error — el cuelgue silencioso pasa a ser un fallo visible y recuperable.
                // NO arregla la causa raíz; evita que se coma el loop.
                using var tickCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                tickCts.CancelAfter(TimeSpan.FromSeconds(cfg.TickTimeoutSeconds));

                // Corte propio del BROADCAST, separado del tick. Se crea acá (no dentro del try) para
                // que el filtro del catch lo pueda consultar, pero el reloj recién arranca justo antes
                // de emitir: con CancelAfter acá vencería durante la cascada, que tarda ~30s.
                using var emitCts = CancellationTokenSource.CreateLinkedTokenSource(ct);

                // Traza de diagnóstico en TRES puntos: inicio, cascada resuelta y estado emitido.
                // Hasta 2026-08-10 un tick exitoso no logueaba NADA, así que el silencio del log era
                // ambiguo — no se podía distinguir "el loop no corre" de "corre pero el mensaje no
                // llega". Los tres puntos separan justamente eso: si aparece "inicio" y no "cascada",
                // se colgó el motor; si aparece "cascada" y no "emitido", se colgó el broadcast.
                var sw = Stopwatch.StartNew();
                _logger.LogInformation("RpfLoop: tick {Symbol} inicio", symbol);

                try
                {
                    // Motor de decisión PROPIO de RPF (corte total): un solo tick corre macro + candidato
                    // (siempre, con legs) + signal_gates sobre rpf.json. Ya no comparte VL/PB con Main.
                    var tick = await mediator.Send(new RpfTickRequest
                    {
                        Symbol = symbol,
                        RulesJson = cfg.RulesJson,
                        PopCalibrationJson = cfg.PopJson,
                        SkewHistoryJson = cfg.SkewJson,
                    }, tickCts.Token);

                    long cascadeMs = sw.ElapsedMilliseconds;

                    bool inCooldown = _store.InCooldown(symbol, now);
                    var inputs = BuildInputs(tick, inCooldown);
                    var state = RpfStateMachine.Evaluate(inputs);

                    _logger.LogInformation("RpfLoop: tick {Symbol} cascada OK en {Ms}ms → {State} (macro {Passed}/{Total}, tierA {TierA})",
                        symbol, cascadeMs, state.ToWire(),
                        tick.MacroRegime?.PassedCount ?? 0, tick.MacroRegime?.TotalChecks ?? 0,
                        // Un tick de Tier B se reconoce por el "cache Ns"; uno que barrió la cadena dice
                        // "fresco". Si dejan de aparecer los "fresco", el macro se congeló en silencio.
                        tick.TierAFromCache ? $"cache {tick.TierAAgeSec}s" : "fresco");

                    HandleSuggestion(symbol, state, tick, cfg, now);
                    _store.SetState(symbol, state);

                    // Heartbeat: se emite cada tick (no solo en cambio) para que el tablero sepa que
                    // el loop vive. Sin esto, un estado DORMANT que coincide con el default del store
                    // nunca se emitiría y el front quedaría en "loop offline" con el loop corriendo.
                    var update = BuildStateUpdate(symbol, state, tick, inputs, now);

                    // El timestamp que viaja al tablero es el del EMIT, no el del inicio del tick.
                    // Medido el 2026-08-10: el tick tarda 17-30s, así que con el timestamp de inicio
                    // el mensaje llegaba al front ya envejecido por esa cantidad, y el cálculo de
                    // frescura declaraba el loop caído estando perfectamente sano.
                    // `now` se mantiene para cooldown y sugerencias: esas SÍ se razonan desde el
                    // arranque del tick (es el instante en que se leyó el mercado).
                    update.Timestamp = DateTime.UtcNow;

                    emitCts.CancelAfter(TimeSpan.FromSeconds(cfg.EmitTimeoutSeconds));
                    await _broadcaster.BroadcastRpfStateAsync(symbol, update, emitCts.Token);

                    _logger.LogInformation("RpfLoop: tick {Symbol} emitido (total {Ms}ms)", symbol, sw.ElapsedMilliseconds);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
                catch (OperationCanceledException) when (emitCts.IsCancellationRequested)
                {
                    // El broadcast se colgó: hay un cliente tapado en el grupo rpf. NO se intenta emitir
                    // estado de error — iría al MISMO grupo y volvería a colgarse, que es precisamente
                    // cómo un cliente zombi se comía el loop. Se descarta esta emisión y se sigue: el
                    // próximo tick manda el estado completo igual, así que no se pierde información.
                    _logger.LogWarning("RpfLoop: el broadcast de {Symbol} superó {Timeout}s (cliente tapado en el grupo rpf); se descarta esta emisión y el loop sigue",
                        symbol, cfg.EmitTimeoutSeconds);
                }
                catch (OperationCanceledException) when (tickCts.IsCancellationRequested)
                {
                    // Se agotó el timeout del tick, no un fallo de datos. Se distingue en el log porque
                    // el síntoma es opuesto: acá NO hubo excepción del proveedor, hubo silencio.
                    _logger.LogError("RpfLoop: el tick de {Symbol} superó {Timeout}s y se cortó; emito estado de error", symbol, cfg.TickTimeoutSeconds);
                    await EmitErrorStateAsync(symbol, now, cfg.EmitTimeoutSeconds, ct);
                }
                catch (Exception ex)
                {
                    // La cascada falló (ej. sin datos de mercado, o la integración cascada-sobre-RPF-JSON).
                    // Se emite igual un estado para que el tablero muestre LOOP ONLINE y el símbolo en
                    // DORMANT con nota de error, en vez de un silencio indistinguible de "loop apagado".
                    _logger.LogError(ex, "RpfLoop: fallo evaluando {Symbol}; emito estado de error", symbol);
                    await EmitErrorStateAsync(symbol, now, cfg.EmitTimeoutSeconds, ct);
                }
            }
        }

        /// <summary>
        /// Estado de error para el tablero: DORMANT con CascadeOk=false. Lo comparten el corte por
        /// timeout y el fallo de la cascada — en los dos casos lo que importa es que el front vea
        /// LOOP ONLINE con nota de error, y no un silencio indistinguible de "loop apagado".
        /// Se emite con el token del loop, nunca con el del tick: el del tick ya está cancelado.
        /// </summary>
        private async Task EmitErrorStateAsync(string symbol, DateTime now, int emitTimeoutSeconds, CancellationToken ct)
        {
            _store.SetState(symbol, RpfState.Dormant);

            // El aviso de fallo también va con corte: si el grupo está tapado, este emit se colgaría
            // igual que el normal y el loop moriría justo en el camino que existe para no morir.
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(emitTimeoutSeconds));

            try
            {
                await _broadcaster.BroadcastRpfStateAsync(symbol, new RpfStateUpdate
                {
                    Symbol = symbol,
                    State = RpfState.Dormant.ToWire(),
                    CascadeOk = false,
                    CapacityAvailable = false,
                    CooldownRemainingSec = _store.CooldownRemainingSec(symbol, now),
                    // Igual que en el camino OK: el timestamp es el del emit. Acá importa todavía más,
                    // porque un tick que murió por timeout arrastraría 90s de desfasaje.
                    Timestamp = DateTime.UtcNow,
                }, cts.Token);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                _logger.LogWarning("RpfLoop: tampoco se pudo emitir el estado de error de {Symbol} (grupo rpf tapado)", symbol);
            }
        }

        /// <summary>
        /// Mapea la respuesta de la cascada a los inputs de la máquina de estados.
        /// Short-circuit: si el macro corta, PositionBuilder viene null → tail/edge no corrieron
        /// (TailScoreAvailable=false) y Tier A no pasa → DORMANT honesto (nunca VETOED sin dato).
        /// </summary>
        private static RpfStateInputs BuildInputs(RpfTickResult tick, bool inCooldown)
        {
            var gates = tick.SignalGates;
            var tail = gates?.Gates.FirstOrDefault(g => g.Id == "tail_score");
            var edge = gates?.Gates.FirstOrDefault(g => g.Id == "edge");
            var sizing = tick.RiskAndSizing;

            bool macroPass = tick.MacroRegime?.Signal is "OPERAR" or "PASS"
                             || (tick.MacroRegime is { } m && m.PassedCount == m.TotalChecks && m.TotalChecks > 0);
            bool vrpTailPass = gates != null && gates.AllPass ||
                               (gates != null && gates.FailedGate is not ("volatility_risk_premium" or "tail_score"));

            // Los gates ahora corren SIEMPRE (desacoplados del cupo). TierA exige, además del entorno,
            // que exista un candidato válido — antes era implícito porque los gates solo corrían con
            // candidato; sin este conjunto, macro+VRP+tail bastarían para un ARMED espurio sin spread.
            bool candidateValid = tick.StrikeEngine?.Signal == "OPERAR" && tick.Microstructure?.Signal == "OPERAR";
            bool tierAPass = macroPass && candidateValid && gates != null
                             && gates.FailedGate is not ("volatility_risk_premium" or "tail_score");

            bool tailAvailable = tail is { Status: not "skipped" and not "no_data" };
            int tailScore = (int)Math.Round(tail?.Value ?? 0);

            bool edgePass = edge is { Enabled: true, Status: "pass" };

            bool capacity = sizing is { PositionsAvailable: true, HeatOk: true };
            bool hasOpen = sizing is { OpenPositions: > 0 };

            return new RpfStateInputs
            {
                TailScore = tailScore,
                TailScoreAvailable = tailAvailable,
                TierAPass = tierAPass,
                EdgePass = edgePass,
                CapacityAvailable = capacity,
                HasOpenPosition = hasOpen,
                InCooldown = inCooldown,
            };
        }

        private void HandleSuggestion(string symbol, RpfState state, RpfTickResult tick, LoopConfig cfg, DateTime now)
        {
            if (state == RpfState.Triggered)
            {
                var current = _store.CurrentSuggestion(symbol);
                if (current != null && !_store.SuggestionExpired(symbol, now))
                {
                    // Refresca la vigente (mismo id) con números actuales — evita spam (§5.3).
                    var refreshed = BuildSuggestion(symbol, tick, cfg, current.Id, current.CreatedAt);
                    _store.SetSuggestion(symbol, refreshed);
                    _ = _broadcaster.BroadcastTradeSuggestionAsync(symbol, refreshed);
                }
                else
                {
                    var fresh = BuildSuggestion(symbol, tick, cfg, Guid.NewGuid().ToString(), now);
                    _store.SetSuggestion(symbol, fresh);
                    _ = _broadcaster.BroadcastTradeSuggestionAsync(symbol, fresh);
                }
            }
            else
            {
                // Dejó de disparar: si había una sugerencia vigente y venció el TTL, se descarta.
                if (_store.CurrentSuggestion(symbol) != null && _store.SuggestionExpired(symbol, now))
                    _store.ClearSuggestion(symbol, "expired");
            }
        }

        // ── Builders del contrato (payload se finaliza en activación; acá se pueblan los campos disponibles) ──

        private static TradeSuggestion BuildSuggestion(string symbol, RpfTickResult tick, LoopConfig cfg, string id, DateTime createdAt)
        {
            var se = tick.StrikeEngine;
            var edge = tick.SignalGates?.Gates.FirstOrDefault(g => g.Id == "edge");
            var sizing = tick.RiskAndSizing;
            var credit = tick.Microstructure?.CreditMinimum?.MidCredit ?? 0;
            double width = se is { ShortPutStrike: { } sp, LongPutStrike: { } lp } ? Math.Abs(sp - lp) : 5;

            double riskPct = sizing != null && sizing.NetLiq > 0 ? (double)(sizing.MaxLoss / sizing.NetLiq) : 0;

            var legs = new List<TradeSuggestionLeg>();
            if (se?.ShortPutStrike is { } shortStrike)
                legs.Add(new TradeSuggestionLeg { Action = "sell", Strike = shortStrike, Delta = se.ShortPutDelta, StreamerSymbol = se.LegSymbols?.ShortPut });
            if (se?.LongPutStrike is { } longStrike)
                legs.Add(new TradeSuggestionLeg { Action = "buy", Strike = longStrike, StreamerSymbol = se.LegSymbols?.LongPut });

            return new TradeSuggestion
            {
                Id = id,
                Symbol = symbol,
                Structure = "put_credit_spread",
                Legs = legs,
                Credit = credit,
                Width = width,
                CreditRatio = se?.CreditRatio.HasValue == true ? se.CreditRatio / 100.0 : null,
                EdgeEmp = edge?.Value,
                Bar = edge?.Threshold,
                Regime = tick.SignalGates?.Regime ?? "normal",
                DeltaShort = Math.Abs(se?.ShortPutDelta ?? 0),
                Dte = se?.DTE ?? 0,
                RiskPerTradePct = riskPct,
                HighRisk = riskPct > 0.05,
                Contracts = sizing?.Contracts ?? 0,
                State = "TRIGGERED",
                CreatedAt = createdAt,
                TtlSeconds = cfg.TickBSeconds * 2,
            };
        }

        private RpfStateUpdate BuildStateUpdate(string symbol, RpfState state, RpfTickResult tick, RpfStateInputs inp, DateTime now)
        {
            var edge = tick.SignalGates?.Gates.FirstOrDefault(g => g.Id == "edge");
            var sizing = tick.RiskAndSizing;

            return new RpfStateUpdate
            {
                Symbol = symbol,
                State = state.ToWire(),
                Edge = edge?.Value,
                Bar = edge?.Threshold,
                // Régimen que eligió la barra del edge. Solo presente si el macro pasó (los signal
                // gates corrieron); si la cascada cortó en macro, viene null y el tablero cae a la
                // etiqueta genérica — coherente con el eje DISPARA atenuado en ese caso.
                Regime = tick.SignalGates?.Regime,
                CapacityAvailable = inp.CapacityAvailable,
                OpenPositions = sizing?.OpenPositions ?? 0,
                MaxPositions = sizing?.MaxPositions ?? 0,
                HeatPct = sizing != null ? sizing.CurrentHeatPct : null,
                CooldownRemainingSec = _store.CooldownRemainingSec(symbol, now),
                SuggestionId = state == RpfState.Triggered ? _store.CurrentSuggestion(symbol)?.Id : null,

                MacroPassed = tick.MacroRegime?.PassedCount ?? 0,
                MacroTotal = tick.MacroRegime?.TotalChecks ?? 0,
                MacroChecks = MapMacroChecks(tick.MacroRegime),
                Gates = MapGates(tick.SignalGates),
                Candidate = BuildCandidate(tick, edge),

                CascadeOk = true,
                DiedAtLayer = tick.FailedAtLayer,
                Timestamp = now,
            };
        }

        // Eje ARMA — macro_regime. Los 4 checks de RPF (sin iv_rank/spot_vs_zgl) con etiqueta legible.
        // Se computan dentro de Layer 1 aun si el macro falla, así que la fila muestra el valor igual.
        private static List<RpfCheck> MapMacroChecks(MacroRegimeResult? macro)
        {
            var list = new List<RpfCheck>();
            if (macro?.Checks is not { } c) return list;

            // noData tiene precedencia sobre passed: el check no bloquea (viene passed=true) pero el
            // tablero lo pinta amarillo en vez de verde. Un ✓ por falta de datos escondería que la
            // guarda dejó de estar — el mismo tipo de mentira que el "±0.0" del expected move.
            void Add(string id, string label, bool? passed, double? value, double? threshold, string? detail = null, bool noData = false)
            {
                if (passed == null) return; // check no presente en el JSON de RPF
                string status = noData ? "no_data" : passed.Value ? "pass" : "fail";
                list.Add(new RpfCheck { Id = id, Label = label, Status = status, Value = value, Threshold = threshold, Detail = detail });
            }

            Add("vix_absolute", "VIX bajo control", c.VixAbsolute?.Passed, c.VixAbsolute?.Value, c.VixAbsolute?.Threshold);
            Add("vix_term_structure", "Estructura VIX en calma", c.VixTermStructure?.Passed, c.VixTermStructure?.Vix9d, c.VixTermStructure?.Vix30d,
                c.VixTermStructure is { NoData: false } ts ? $"VIX9D {ts.Vix9d:0.00} vs VIX {ts.Vix30d:0.00}" : "sin dato de VIX9D/VIX — el check no bloquea",
                c.VixTermStructure?.NoData ?? false);
            Add("iv_momentum", "Momentum de vol frenado", c.IVMomentum?.Passed, c.IVMomentum?.Value, c.IVMomentum?.Threshold);
            Add("gex_total", "Dealers amortiguan (GEX≥0)", c.GexTotal?.Passed, c.GexTotal?.Value, c.GexTotal?.Threshold);
            return list;
        }

        // Eje ARMA — gates de señal (VRP, cola) + eje DISPARA (edge, crédito, muro). Solo corren si el
        // macro pasó (cascada cortocircuitante); si no, la lista viene vacía → el tablero los marca "no evaluado".
        private static List<RpfCheck> MapGates(SignalGatesResult? gates)
        {
            var list = new List<RpfCheck>();
            if (gates == null) return list;
            foreach (var g in gates.Gates)
            {
                if (!g.Enabled) continue;
                list.Add(new RpfCheck { Id = g.Id, Label = g.Label, Status = g.Status, Value = g.Value, Threshold = g.Threshold, Detail = g.Detail });
            }
            return list;
        }

        // Eje DISPARA — el PCS candidato. El motor RPF produce UN solo strikeEngine (con legs), poblado
        // siempre (aun DORMANT) — decisión candidato-siempre, ahora coherente para estado y display.
        private static RpfCandidate? BuildCandidate(RpfTickResult tick, GateResult? edge)
        {
            var se = tick.StrikeEngine;
            if (se?.ShortPutStrike is not { } shortStrike) return null;

            double? credit = tick.Microstructure?.CreditMinimum?.MidCredit;
            double? width = se.LongPutStrike is { } lp ? Math.Abs(shortStrike - lp) : 5;

            return new RpfCandidate
            {
                ShortPutStrike = shortStrike,
                LongPutStrike = se.LongPutStrike,
                ShortPutDelta = se.ShortPutDelta,
                Dte = se.DTE,
                Expiration = se.Expiration,
                Credit = credit,
                Width = width,
                CreditRatio = se.CreditRatio.HasValue ? se.CreditRatio / 100.0 : null,
                Pop = se.Pop,
                PutWall = se.PutWall,
                Edge = edge?.Value,
                Bar = edge?.Threshold,
                FromCascade = tick.FailedAtLayer != 1, // macro no cortó → candidato validado por el entorno
                // Legs DXLink + OI/cierre previo del mismo motor que armó los strikes: el tablero
                // suscribe estas patas para primas en vivo del candidato REAL de RPF (no del PositionBuilder).
                LegSymbols = se.LegSymbols,
                LegMeta = se.LegMeta,
            };
        }
    }
}
