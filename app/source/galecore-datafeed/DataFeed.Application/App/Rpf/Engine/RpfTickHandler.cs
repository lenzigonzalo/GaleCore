using MediatR;
using System.Text.Json.Nodes;
using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.ImpliedVolatility;
using DataFeed.Application.App.IVRank;
using DataFeed.Application.App.PutSkew;
using DataFeed.Application.App.Shared;
using DataFeed.Application.App.SignalGates;
using DataFeed.Application.App.Shared.Dtos;
using DataFeed.Application.Data.Tastytrade.AccountBalances;
using DataFeed.Application.Data.Tastytrade.AccountPositions;
using DataFeed.Application.Data.Tastytrade.MarketDataCandle;
using DataFeed.Application.Data.Tastytrade.MarketDataQuote;
using DataFeed.Application.Data.Tastytrade.MarketDataTrade;

namespace DataFeed.Application.App.Rpf.Engine
{
    /// <summary>
    /// Motor de decisión PROPIO de RPF (Nivel 1 — corte total). Reemplaza el par
    /// ValidationLayerRequest + PositionBuilderRequest que el loop compartía con Main. En un solo tick:
    ///   1) corre el pipeline del candidato SIEMPRE (estructura → strikes+legs → micro → sizing), así el
    ///      candidato PCS se muestra aun en DORMANT y — a diferencia del camino viejo — SIEMPRE con legs;
    ///   2) evalúa macro_regime (Layer 1) y los signal_gates con la misma lógica/cortocircuito de la
    ///      cascada, para que el estado que consume RpfStateMachine no cambie.
    ///
    /// Reusa los primitivos compartidos (CascadeUtils.*, SignalGatesEvaluator, PutSkewCalculator);
    /// Motor propio de RPF: no depende de ningún handler de otra estrategia.
    /// </summary>
    public class RpfTickHandler : IRequestHandler<RpfTickRequest, RpfTickResult>
    {
        private readonly IMediator _mediator;

        public RpfTickHandler(IMediator mediator) => _mediator = mediator;

        // ═══════════════════════════════════════════════════════════════════════════════════════
        // Tier A / Tier B — la cadencia de dos niveles que el JSON declara desde siempre
        // ═══════════════════════════════════════════════════════════════════════════════════════
        //
        // orchestration declara tier_a_refresh_seconds (300) y tier_b_tick_seconds (30), con
        // physical_timer: "un solo timer a la cadencia rapida; Tier A se recomputa cada N ticks".
        // Hasta 2026-08-10 NADIE leía tier_a_refresh_seconds — sólo un test — y cada tick corría la
        // cascada COMPLETA. Medido con mercado abierto: 17-32s por tick, dominado por el snapshot de
        // Greeks de ~640 símbolos de la cadena, cada 30s. Es decir: el loop corría casi sin pausa y
        // suscribía/desuscribía 640 símbolos por minuto contra el canal DXLink compartido.
        //
        // El corte sigue la semántica de la estrategia, no sólo el costo: el eje ARMA (macro, GEX,
        // muros, IV) es de escala horaria y va en Tier A; el eje DISPARA (crédito de las patas, edge,
        // cupo) necesita frescura y sigue corriendo cada tick. Subir tier_b_tick_seconds habría hecho
        // más lento justamente el eje que tiene que ser rápido.
        //
        // CONSECUENCIA DE TRADING, aceptada explícitamente por el operador el 2026-08-10: la
        // selección de strikes y el gate macro quedan hasta tier_a_refresh_seconds (5 min)
        // desactualizados. El crédito y el edge NO: se recalculan cada tick sobre quotes vivos de las
        // patas. El riesgo residual es que el short put se aleje del delta objetivo si el spot se
        // mueve fuerte dentro de la ventana; con 39 DTE y strikes de $1 es chico, pero es real.
        private sealed record TierASnapshot(
            GammaExposureResponse Gex,
            IVRankResponse Ivr,
            ImpliedVolatilityResponse Iv,
            List<CandleData> Candles,
            double? Vvix,
            double? Vix,
            double? Vix9d,
            DateTime FetchedAt);

        // Estático porque el handler se instancia por request (mismo criterio que los caches de
        // cadena/OI de GammaExposureHandler).
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, TierASnapshot> _tierACache = new();

        /// <summary>
        /// Devuelve Tier A del cache si sigue fresco, o lo trae de los proveedores. Un doble fetch
        /// por carrera es inocuo (mismo dato, se pisa), así que no se serializa con lock: el costo de
        /// bloquear supera al de una request repetida que en la práctica no ocurre — el loop es
        /// secuencial por símbolo.
        /// </summary>
        private async Task<(TierASnapshot Snapshot, bool FromCache, int AgeSec)> GetTierAAsync(
            string symbol, int refreshSeconds, CancellationToken ct)
        {
            if (_tierACache.TryGetValue(symbol, out var cached))
            {
                int age = (int)(DateTime.UtcNow - cached.FetchedAt).TotalSeconds;
                if (age < refreshSeconds) return (cached, true, age);
            }

            var gexTask = _mediator.Send(new GammaExposureRequest { Symbol = symbol, MaxDTE = 60 }, ct);
            var ivrTask = _mediator.Send(new IVRankRequest { Symbol = symbol }, ct);
            var ivTask = _mediator.Send(new ImpliedVolatilityRequest { Symbol = symbol }, ct);
            var candleTask = _mediator.Send(new MarketDataCandleRequest
            {
                Symbol = symbol,
                Interval = "1d",
                FromTime = DateTime.UtcNow.AddDays(-120) // cubre EMA 50 + RV 30 + ret 5d
            }, ct);
            var vvixTask = _mediator.Send(new MarketDataTradeRequest { Symbol = "VVIX" }, ct);
            // VIX y VIX9D reales para macro_regime (vix_absolute y vix_term_structure). Los dos son
            // macro y de escala horaria, así que viven en Tier A junto al resto del eje ARMA.
            var vixTask = _mediator.Send(new MarketDataTradeRequest { Symbol = "VIX" }, ct);
            var vix9dTask = _mediator.Send(new MarketDataTradeRequest { Symbol = "VIX9D" }, ct);

            await Task.WhenAll(gexTask, ivrTask, ivTask, candleTask, vvixTask, vixTask, vix9dTask);

            var snapshot = new TierASnapshot(
                gexTask.Result,
                ivrTask.Result,
                ivTask.Result,
                candleTask.Result?.data?.Where(c => c.Close > 0).OrderBy(c => c.Time).ToList() ?? new List<CandleData>(),
                vvixTask.Result?.Data?.FirstOrDefault()?.Price,
                vixTask.Result?.Data?.FirstOrDefault()?.Price,
                vix9dTask.Result?.Data?.FirstOrDefault()?.Price,
                DateTime.UtcNow);

            _tierACache[symbol] = snapshot;
            return (snapshot, false, 0);
        }

        public async Task<RpfTickResult> Handle(RpfTickRequest request, CancellationToken ct)
        {
            var rules = JsonNode.Parse(request.RulesJson!)!.AsObject();
            var symbol = request.Symbol.ToUpperInvariant();

            // ── Tier A: insumos caros (cadena de ~640 símbolos + IV/IVR/candles/VIX/VVIX) ──
            // Se reusan del cache mientras no venza tier_a_refresh_seconds. Ver el bloque de arriba.
            int tierARefreshSec = (int?)rules["orchestration"]?["tier_a_refresh_seconds"] ?? 300;
            var (tierA, tierAFromCache, tierAAgeSec) = await GetTierAAsync(symbol, tierARefreshSec, ct);

            var gex = tierA.Gex;
            var ivr = tierA.Ivr;
            var iv = tierA.Iv;
            var candles = tierA.Candles;
            double? vvix = tierA.Vvix;
            double? vix = tierA.Vix;
            double? vix9d = tierA.Vix9d;

            // ── Pipeline del candidato (SIEMPRE, aun si macro falla) ──
            var strikeEngine = BuildStrikeEngine(rules, symbol, gex, iv, candles, out int spreadWidth);
            var microstructure = await BuildMicrostructure(rules, symbol, gex, strikeEngine, ct);

            // Regla 1/3 + priority score sobre el crédito snapshot (position_builder.ranking del JSON).
            double snapshotCredit = microstructure.CreditMinimum?.MidCredit ?? 0;
            if (spreadWidth > 0 && snapshotCredit > 0)
            {
                double creditRatio = snapshotCredit / spreadWidth;
                strikeEngine.CreditRatio = Math.Round(creditRatio * 100, 1);
                if (strikeEngine.Pop.HasValue)
                    strikeEngine.PriorityScore = Math.Round(strikeEngine.Pop.Value * 0.01 * 0.6 + creditRatio * 0.4, 4);
            }

            var riskAndSizing = await BuildSizing(rules, request.AccountNumber, spreadWidth, snapshotCredit, ct);

            // ── Macro (Layer 1) ──
            var macro = BuildMacro(rules, symbol, gex, ivr, iv, vix, vix9d);

            // ── Cascada de estado (mismo cortocircuito que la cascada de Main) ──
            var result = new RpfTickResult
            {
                Symbol = symbol,
                MacroRegime = macro,
                StrikeEngine = strikeEngine,
                Microstructure = microstructure,
                RiskAndSizing = riskAndSizing,
                TierAFromCache = tierAFromCache,
                TierAAgeSec = tierAAgeSec,
            };

            // ── Signal gates: se evalúan SIEMPRE, independientes del cupo. VRP+tail siempre tienen data
            // (IV/RV30/VVIX/skew); edge/crédito/muro degradan a no_data sin candidato (no bloquean). Esto
            // desacopla la seguridad del sizing → el veto de cola es autoridad global y WAITING_CAPACITY se
            // vuelve alcanzable. El sizing se sigue computando (cupo + números de la sugerencia) pero NO
            // condiciona la corrida de los gates.
            double currentSkew25 = PutSkewCalculator.Compute(gex).PutSkew25d ?? 0;
            double? skewRoc = !string.IsNullOrWhiteSpace(request.SkewHistoryJson) && currentSkew25 > 0
                // El DTE va como tercer argumento a propósito: la lectura viva se mide sobre la
                // cadena que RPF eligió y la historia sobre la que eligió SkewSnapshotService, que
                // no tienen por qué ser el mismo plazo. Sin pasarlo, el RoC comparaba dos skews de
                // vencimientos distintos sin que nada lo dijera.
                ? SkewHistory.Parse(request.SkewHistoryJson!).Roc5d(symbol, currentSkew25, gex.DTE)
                : null;
            result.SignalGates = EvaluateSignalGates(rules, symbol, iv, strikeEngine, microstructure, request.PopCalibrationJson, vvix, skewRoc);

            // Cortocircuito de la SEÑAL (macro→strike→micro→gates). El cupo es ortogonal: se comunica por
            // el estado (WaitingCapacity) y la fila Cupo del panel, no corta acá.
            var (overall, failedAtLayer) = RpfCascadeResolver.Resolve(
                macro.Signal, strikeEngine.Signal, microstructure.Signal, result.SignalGates.AllPass);
            result.OverallSignal = overall;
            result.FailedAtLayer = failedAtLayer;
            return result;
        }

        // ── Layer 1: macro_regime (6 checks — misma lógica que la cascada para preservar el gate de estado) ──
        // OJO: copia casi verbatim de CascadeUtils.EvaluateLayer1. Todo cambio de semántica va en LOS DOS
        // lados o vuelven a divergir — que es exactamente cómo el proxy de VIX sobrevivió sin que se notara.
        private static MacroRegimeResult BuildMacro(
            JsonObject rules, string symbol, GammaExposureResponse gex, IVRankResponse ivr,
            ImpliedVolatilityResponse iv, double? vix, double? vix9d)
        {
            var macroChecks = rules["macro_regime"]?["checks"]?.AsArray();
            var definitions = rules["definitions"];

            // VIX real (índice CBOE), no la IV del símbolo. Sin dato NO pasa: fail-closed, porque acá
            // el on_fail declarado es no_trade — quedarse sin el índice tiene que bloquear, no habilitar.
            double maxVix = CascadeUtils.FindCheck(macroChecks, "vix_absolute")?["threshold"]?["value"]?.GetValue<double>() ?? 30.0;
            bool vixAbsPassed = vix.HasValue && vix.Value < maxVix;

            // Compartido con CascadeUtils.EvaluateLayer1 en vez de reimplementado: esta misma lógica
            // duplicada es como el proxy de VIX sobrevivió años sin que se notara.
            var vixTSCheck = CascadeUtils.EvaluateVixTermStructure(vix9d, vix);
            bool vixTSPassed = vixTSCheck.Passed;

            var ivRankDef = CascadeUtils.FindCheck(macroChecks, "iv_rank");
            double ivMin = ivRankDef?["threshold"]?["min"]?.GetValue<double>() ?? 25;
            double ivMax = ivRankDef?["threshold"]?["max"]?.GetValue<double>() ?? 65;
            bool ivRankPassed = ivr.IVRank >= ivMin && ivr.IVRank <= ivMax;

            double ivMomThreshold = CascadeUtils.FindCheck(macroChecks, "iv_momentum")?["threshold"]?["value"]?.GetValue<double>() ?? 12.0;
            bool ivMomentumPassed = iv.IV30RocPct.HasValue && Math.Abs(iv.IV30RocPct.Value) <= ivMomThreshold;

            double gexThreshold = definitions?["gex_threshold_by_symbol"]?["values"]?[symbol]?.GetValue<double>() ?? 50;
            double gexValue = gex.NetGEX;
            bool gexPassed = gexValue >= gexThreshold;

            double bufferPct = definitions?["zgl_with_buffer"]?["buffer_pct"]?.GetValue<double>() ?? 0.005;
            bool spotPassed = gex.GammaZeroLevel.HasValue && gex.Spot >= gex.GammaZeroLevel.Value * (1 + bufferPct);

            var checks = new[] { vixAbsPassed, vixTSPassed, ivRankPassed, ivMomentumPassed, gexPassed, spotPassed };
            int passed = checks.Count(c => c);
            int total = checks.Length;
            string signal = passed == total ? "OPERAR" : passed >= total - 1 ? "ESPERAR" : "NO_OPERAR";

            return new MacroRegimeResult
            {
                Signal = signal,
                PassedCount = passed,
                TotalChecks = total,
                Checks = new MacroRegimeChecks
                {
                    VixAbsolute = new VixAbsoluteCheck { Passed = vixAbsPassed, Value = vix, Threshold = maxVix },
                    VixTermStructure = vixTSCheck,
                    IVRank = new IVRankCheck { Passed = ivRankPassed, Value = ivr.IVRank, Min = ivMin, Max = ivMax },
                    IVMomentum = new IVMomentumCheck { Passed = ivMomentumPassed, Value = iv.IV30RocPct, Threshold = ivMomThreshold },
                    GexTotal = new GexTotalCheck { Passed = gexPassed, Value = gexValue, Metric = "billions_usd", Threshold = gexThreshold },
                    SpotVsZgl = new SpotVsZglCheck { Passed = spotPassed, Spot = gex.Spot, ZGL = gex.GammaZeroLevel, BufferPct = bufferPct },
                }
            };
        }

        // ── Layer 2: strike engine (estilo PositionBuilder — filtrado por muro + legs DXLink) ──
        private static StrikeEngineResult BuildStrikeEngine(
            JsonObject rules, string symbol, GammaExposureResponse gex, ImpliedVolatilityResponse iv,
            List<CandleData> candles, out int spreadWidth)
        {
            var layer2Node = CascadeUtils.GetPositionBuilderLayer(rules, 2);
            var config = layer2Node?["config"];
            var structureConfig = config?["structure_selection"];
            var spreadConfig = config?["spread_width"];

            double spot = gex.Spot;
            double ivAtm = (iv.IV30_30d ?? 0) / 100.0;
            // Copia de la fórmula de GammaExposureHandler, con el MISMO defecto latente: con DTE 0 el
            // sqrt colapsa el producto y el expected move da 0. Acá NO se manifiesta porque RPF pide la
            // cadena con IncludeZeroDte en false (el filtro exige DTE > 0), así que gex.DTE nunca es 0;
            // y su DTE objetivo son ~39 días. Se deja el 0 en vez de null porque StrikeEngineResult.
            // ExpectedMove no es nullable y volverlo nullable arrastra el contrato hasta el front por un
            // caso que hoy no puede ocurrir.
            // Si algún día RPF opera 0DTE, ESTO HAY QUE ARREGLARLO ANTES — ver el comentario largo en
            // GammaExposureHandler, que explica por qué el problema no es la raíz sino el DTE entero.
            double expectedMove = ivAtm > 0 ? spot * ivAtm * Math.Sqrt(gex.DTE / 365.0) : 0;

            double neutralZ = structureConfig?["thresholds"]?["neutral_z"]?.GetValue<double>() ?? 1.0;
            double extremeZ = structureConfig?["thresholds"]?["extreme_z"]?.GetValue<double>() ?? 1.5;

            double priceZScore = CascadeUtils.ComputePriceZScore(candles, ivAtm);
            string gexSkew = CascadeUtils.ComputeGexSkew(gex.CallGEX, gex.PutGEX);
            var (ema20, ema50, trendSignal) = CascadeUtils.ComputeTrend(candles);
            var (rv10d, rv30d, realizedVolSignal) = CascadeUtils.ComputeRealizedVol(candles);

            var (selectedStructure, ruleId, ruleName, ruleLabel) = CascadeUtils.ResolveStructure(
                structureConfig, priceZScore, gexSkew, trendSignal, neutralZ, extremeZ);

            var deltaTarget = config?["delta_target"];
            double putDeltaMin = deltaTarget?["put_short_min"]?.GetValue<double>() ?? 0.25;
            double putDeltaMax = deltaTarget?["put_short_max"]?.GetValue<double>() ?? 0.30;
            double maxCallDelta = CascadeUtils.GetCheckThresholdValue(layer2Node?["checks"]?.AsArray(), "call_strike_delta") ?? 0.25;

            spreadWidth = 10;
            var symbolOverride = spreadConfig?["symbol_overrides"]?[symbol];
            if (symbolOverride != null)
                spreadWidth = symbolOverride["default"]?.GetValue<int>() ?? 10;

            double? shortPutStrike = null, shortCallStrike = null;
            double? shortPutDelta = null, shortCallDelta = null;
            double? longPutStrike = null, longCallStrike = null;
            bool strikesInsideWalls = false;
            GammaExposureStrike? putCandidate = null, callCandidate = null;

            if (selectedStructure != "no_trade" && gex.Strikes.Count > 0)
            {
                if (selectedStructure is "iron_condor" or "put_credit_spread")
                {
                    putCandidate = gex.Strikes
                        .Where(s => Math.Abs(s.PutDelta) >= putDeltaMin && Math.Abs(s.PutDelta) <= putDeltaMax
                                 && (!gex.PutWall.HasValue || s.Strike < gex.PutWall.Value))
                        .OrderBy(s => Math.Abs(Math.Abs(s.PutDelta) - putDeltaMin))
                        .FirstOrDefault();

                    if (putCandidate != null)
                    {
                        shortPutStrike = putCandidate.Strike;
                        shortPutDelta = putCandidate.PutDelta;
                        longPutStrike = CascadeUtils.SnapToNearestStrike(gex.Strikes, putCandidate.Strike - spreadWidth);
                    }
                }

                if (selectedStructure is "iron_condor" or "call_credit_spread")
                {
                    double targetCall = spot + expectedMove; // rama dormida (CCS REPROBADO); compat.
                    callCandidate = gex.Strikes
                        .Where(s => s.Strike >= targetCall && Math.Abs(s.CallDelta) <= maxCallDelta && Math.Abs(s.CallDelta) > 0
                                 && (!gex.CallWall.HasValue || s.Strike > gex.CallWall.Value))
                        .OrderBy(s => s.Strike)
                        .FirstOrDefault();

                    if (callCandidate != null)
                    {
                        shortCallStrike = callCandidate.Strike;
                        shortCallDelta = callCandidate.CallDelta;
                        longCallStrike = CascadeUtils.SnapToNearestStrike(gex.Strikes, callCandidate.Strike + spreadWidth);
                    }
                }

                bool putOutsideWall = !shortPutStrike.HasValue || !gex.PutWall.HasValue || shortPutStrike.Value < gex.PutWall.Value;
                bool callOutsideWall = !shortCallStrike.HasValue || !gex.CallWall.HasValue || shortCallStrike.Value > gex.CallWall.Value;
                strikesInsideWalls = putOutsideWall && callOutsideWall;
            }

            bool hasValidStrikes = selectedStructure switch
            {
                "iron_condor" => shortPutStrike.HasValue && shortCallStrike.HasValue,
                "put_credit_spread" => shortPutStrike.HasValue,
                "call_credit_spread" => shortCallStrike.HasValue,
                _ => false
            };

            double? pop = null;
            if (selectedStructure == "iron_condor" && shortPutDelta.HasValue && shortCallDelta.HasValue)
                pop = Math.Round(Math.Min((1 - Math.Abs(shortPutDelta.Value)) * 100, (1 - Math.Abs(shortCallDelta.Value)) * 100), 1);
            else if (selectedStructure == "put_credit_spread" && shortPutDelta.HasValue)
                pop = Math.Round((1 - Math.Abs(shortPutDelta.Value)) * 100, 1);
            else if (selectedStructure == "call_credit_spread" && shortCallDelta.HasValue)
                pop = Math.Round((1 - Math.Abs(shortCallDelta.Value)) * 100, 1);

            GammaExposureStrike? longPutObj = longPutStrike.HasValue
                ? gex.Strikes.OrderBy(s => Math.Abs(s.Strike - longPutStrike.Value)).FirstOrDefault() : null;
            GammaExposureStrike? longCallObj = longCallStrike.HasValue
                ? gex.Strikes.OrderBy(s => Math.Abs(s.Strike - longCallStrike.Value)).FirstOrDefault() : null;

            return new StrikeEngineResult
            {
                Signal = hasValidStrikes && strikesInsideWalls ? "OPERAR" : "NO_OPERAR",
                ExpectedMove = Math.Round(expectedMove, 2),
                DTE = gex.DTE,
                Expiration = gex.Expiration,
                CallWall = gex.CallWall,
                PutWall = gex.PutWall,
                ZScore = Math.Round(priceZScore, 4),
                SelectedStructure = selectedStructure,
                ShortPutStrike = shortPutStrike,
                ShortCallStrike = shortCallStrike,
                ShortPutDelta = shortPutDelta,
                ShortCallDelta = shortCallDelta,
                LongPutStrike = longPutStrike,
                LongCallStrike = longCallStrike,
                StrikesInsideWalls = strikesInsideWalls,
                StructureRuleId = ruleId,
                StructureRuleName = ruleName,
                StructureRuleLabel = ruleLabel,
                GexSign = gexSkew,
                TrendSignal = trendSignal,
                Ema20 = ema20.HasValue ? Math.Round(ema20.Value, 2) : null,
                Ema50 = ema50.HasValue ? Math.Round(ema50.Value, 2) : null,
                RealizedVolSignal = realizedVolSignal,
                Rv10d = rv10d.HasValue ? Math.Round(rv10d.Value, 2) : null,
                Rv30d = rv30d.HasValue ? Math.Round(rv30d.Value, 2) : null,
                Pop = pop,
                LegSymbols = new LegSymbols
                {
                    ShortPut = putCandidate?.PutStreamerSymbol,
                    LongPut = longPutObj?.PutStreamerSymbol,
                    ShortCall = callCandidate?.CallStreamerSymbol,
                    LongCall = longCallObj?.CallStreamerSymbol,
                },
                LegMeta = new LegMetaSet
                {
                    ShortPut = BuildLegMeta(putCandidate, false),
                    LongPut = BuildLegMeta(longPutObj, false),
                    ShortCall = BuildLegMeta(callCandidate, true),
                    LongCall = BuildLegMeta(longCallObj, true),
                }
            };
        }

        // ── Layer 3: microestructura (OI/spread/crédito) ──
        private async Task<MicrostructureResult> BuildMicrostructure(
            JsonObject rules, string symbol, GammaExposureResponse gex, StrikeEngineResult se, CancellationToken ct)
        {
            var layer3Checks = CascadeUtils.GetPositionBuilderLayer(rules, 3)?["checks"]?.AsArray();
            long shortLegMinOI = (long)(CascadeUtils.GetCheckThresholdValue(layer3Checks, "oi_short_leg") ?? 2000);
            long longLegMinOI = (long)(CascadeUtils.GetCheckThresholdValue(layer3Checks, "oi_long_leg") ?? 2000);
            double maxBidAskPct = CascadeUtils.GetCheckThresholdValue(layer3Checks, "bid_ask_spread") ?? 0.05;
            double minCredit = CascadeUtils.GetCheckThresholdValue(layer3Checks, "credit_minimum") ?? 0.30;

            var atm = gex.Strikes.OrderBy(s => Math.Abs(s.Strike - gex.Spot)).FirstOrDefault();

            var shortCallOI = GetOICheck(gex, se.ShortCallStrike, true, shortLegMinOI);
            var shortPutOI = GetOICheck(gex, se.ShortPutStrike, false, shortLegMinOI);
            var longCallOI = GetOICheck(gex, se.LongCallStrike, true, longLegMinOI);
            var longPutOI = GetOICheck(gex, se.LongPutStrike, false, longLegMinOI);
            bool allOIPassed = shortCallOI.Passed && shortPutOI.Passed && longCallOI.Passed && longPutOI.Passed;

            var legQuotes = await FetchLegQuotes(symbol, se, ct);
            var bidAskChecks = CascadeUtils.BuildBidAskChecks(legQuotes, se, maxBidAskPct);
            bool allBidAskPassed = (bidAskChecks.ShortPut?.Passed ?? true) && (bidAskChecks.ShortCall?.Passed ?? true)
                && (bidAskChecks.LongPut?.Passed ?? true) && (bidAskChecks.LongCall?.Passed ?? true);
            var creditCheck = CascadeUtils.BuildCreditCheck(legQuotes, se, minCredit);

            bool allPassed = allOIPassed && allBidAskPassed && creditCheck.Passed;

            return new MicrostructureResult
            {
                Signal = allPassed ? "OPERAR" : "NO_OPERAR",
                ATMStrike = atm?.Strike ?? gex.Spot,
                OIChecks = new OIChecks
                {
                    ShortPut = se.ShortPutStrike.HasValue ? shortPutOI : null,
                    ShortCall = se.ShortCallStrike.HasValue ? shortCallOI : null,
                    LongPut = se.LongPutStrike.HasValue ? longPutOI : null,
                    LongCall = se.LongCallStrike.HasValue ? longCallOI : null
                },
                ATMCallDelta = atm?.CallDelta,
                ATMPutDelta = atm?.PutDelta,
                BidAskChecks = bidAskChecks,
                CreditMinimum = creditCheck
            };
        }

        // ── Layer 4: risk & sizing (contracts/maxLoss/heat) ──
        private async Task<RiskAndSizingResult> BuildSizing(
            JsonObject rules, string? accountNumber, int spreadWidth, double snapshotCredit, CancellationToken ct)
        {
            var config = CascadeUtils.GetPositionBuilderLayer(rules, 4)?["config"];
            double riskPct = config?["risk_per_trade_pct"]?.GetValue<double>() ?? 0.015;
            int maxPositions = config?["max_positions"]?.GetValue<int>() ?? 3;
            double heatMaxPct = config?["max_heat_pct_net_liq"]?.GetValue<double>() ?? 0.045;

            var balancesTask = _mediator.Send(new AccountBalancesRequest { AccountNumber = accountNumber }, ct);
            var positionsTask = _mediator.Send(new AccountPositionsRequest { AccountNumber = accountNumber }, ct);
            await Task.WhenAll(balancesTask, positionsTask);

            decimal netLiq = balancesTask.Result.NetLiquidatingValue;
            decimal riskPerTrade = netLiq * (decimal)riskPct;
            decimal maxRiskAmount = Math.Min(netLiq * 0.02m, 10000m);

            int openPositions = positionsTask.Result.Positions?
                .Where(p => p.InstrumentType == "Equity Option")
                .Select(p => p.UnderlyingSymbol)
                .Distinct()
                .Count() ?? 0;

            bool positionsAvailable = openPositions < maxPositions;
            double currentHeatPct = netLiq > 0 ? (double)((openPositions * riskPerTrade) / netLiq) : 0;
            bool heatOk = currentHeatPct <= heatMaxPct;

            decimal maxRiskPerContract = snapshotCredit > 0
                ? (decimal)((spreadWidth - snapshotCredit) * 100)
                : (decimal)(spreadWidth * 100);
            int contracts = maxRiskPerContract > 0 ? Math.Max(1, (int)Math.Floor(riskPerTrade / maxRiskPerContract)) : 1;

            return new RiskAndSizingResult
            {
                Signal = positionsAvailable && heatOk ? "OPERAR" : "NO_OPERAR",
                NetLiq = netLiq,
                RiskPerTrade = riskPerTrade,
                MaxRiskAmount = maxRiskAmount,
                OpenPositions = openPositions,
                MaxPositions = maxPositions,
                PositionsAvailable = positionsAvailable,
                CurrentHeatPct = Math.Round(currentHeatPct * 100, 2),
                MaxHeatPct = heatMaxPct * 100,
                HeatOk = heatOk,
                Contracts = contracts,
                MaxProfit = Math.Round((decimal)(snapshotCredit * 100) * contracts, 2),
                MaxLoss = Math.Round(maxRiskPerContract * contracts, 2),
                BuyingPowerReq = Math.Round(maxRiskPerContract, 2)
            };
        }

        // ── Signal gates (wrapper — reusa SignalGatesEvaluator sin cambios) ──
        private static SignalGatesResult EvaluateSignalGates(
            JsonObject rules, string symbol, ImpliedVolatilityResponse iv,
            StrikeEngineResult se, MicrostructureResult micro, string? popJson, double? vvix, double? skew25Roc)
        {
            var pop = string.IsNullOrWhiteSpace(popJson) ? null : PopCalibrationTable.Parse(popJson!);
            double? width = se.ShortPutStrike.HasValue && se.LongPutStrike.HasValue
                ? Math.Abs(se.ShortPutStrike.Value - se.LongPutStrike.Value) : null;

            var inputs = new SignalGatesInputs
            {
                Symbol = symbol,
                AtmIv30 = iv.IV30_30d,
                RealizedVol30 = se.Rv30d,
                Vvix = vvix,
                Skew25Roc5d = skew25Roc,
                ShortPutStrike = se.ShortPutStrike,
                PutWall = se.PutWall,
                Credit = micro.CreditMinimum?.MidCredit,
                SpreadWidth = width ?? 0,
                ShortPutDeltaAbs = se.ShortPutDelta.HasValue ? Math.Abs(se.ShortPutDelta.Value) : null,
                Regime = CascadeUtils.ClassifyRegime(rules["definitions"]?["regime_classification"], iv.IV30_30d),
            };

            return SignalGatesEvaluator.Evaluate(rules["signal_gates"], inputs, pop);
        }

        // ── Helpers propios (equivalentes a los private de VL/PB) ──
        private async Task<Dictionary<string, QuoteEvent?>> FetchLegQuotes(
            string symbol, StrikeEngineResult se, CancellationToken ct)
        {
            var tasks = new Dictionary<string, Task<MarketDataQuoteResponse>>();

            if (se.ShortPutStrike.HasValue)
                tasks["shortPut"] = _mediator.Send(new MarketDataQuoteRequest
                { Symbol = CascadeUtils.BuildOccSymbol(symbol, se.Expiration, se.ShortPutStrike.Value, 'P') }, ct);
            if (se.LongPutStrike.HasValue)
                tasks["longPut"] = _mediator.Send(new MarketDataQuoteRequest
                { Symbol = CascadeUtils.BuildOccSymbol(symbol, se.Expiration, se.LongPutStrike.Value, 'P') }, ct);
            if (se.ShortCallStrike.HasValue)
                tasks["shortCall"] = _mediator.Send(new MarketDataQuoteRequest
                { Symbol = CascadeUtils.BuildOccSymbol(symbol, se.Expiration, se.ShortCallStrike.Value, 'C') }, ct);
            if (se.LongCallStrike.HasValue)
                tasks["longCall"] = _mediator.Send(new MarketDataQuoteRequest
                { Symbol = CascadeUtils.BuildOccSymbol(symbol, se.Expiration, se.LongCallStrike.Value, 'C') }, ct);

            await Task.WhenAll(tasks.Values);

            var quotes = new Dictionary<string, QuoteEvent?>();
            foreach (var kvp in tasks)
                quotes[kvp.Key] = kvp.Value.Result?.Data?.FirstOrDefault();
            return quotes;
        }

        private static OICheck GetOICheck(GammaExposureResponse gex, double? strike, bool isCall, long minRequired)
        {
            if (!strike.HasValue)
                return new OICheck { Passed = true, Value = 0, MinRequired = minRequired };

            var strikeData = gex.Strikes.OrderBy(s => Math.Abs(s.Strike - strike.Value)).FirstOrDefault();
            long oi = strikeData != null ? (isCall ? strikeData.CallOI : strikeData.PutOI) : 0;
            return new OICheck { Passed = oi >= minRequired, Value = oi, MinRequired = minRequired };
        }

        private static LegMeta? BuildLegMeta(GammaExposureStrike? strike, bool isCall)
        {
            if (strike == null) return null;
            return new LegMeta
            {
                OpenInterest = isCall ? strike.CallOI : strike.PutOI,
                PrevClose = isCall ? strike.CallPrevClose : strike.PutPrevClose
            };
        }
    }
}
