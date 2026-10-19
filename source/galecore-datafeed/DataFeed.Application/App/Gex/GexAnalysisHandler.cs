using MediatR;
using Microsoft.Extensions.DependencyInjection;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json.Nodes;
using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.ImpliedVolatility;
using DataFeed.Application.App.IVRank;
using DataFeed.Application.App.Shared.Dtos;
using DataFeed.Application.Data.Tastytrade.MarketDataCandle;
using DataFeed.Application.Data.Tastytrade.MarketDataTrade;
using VLH = DataFeed.Application.App.Shared.CascadeUtils;

namespace DataFeed.Application.App.Gex
{
    /// <summary>
    /// Handler de GET /App/Gex/Analysis — estrategia GEX (informativa).
    ///
    /// Barre TODA la cadena del símbolo (todos los vencimientos ≤ gex.max_dte, incluido 0DTE) y
    /// devuelve el GEX global agregado + el desglose por vencimiento, más el contexto de mercado
    /// (capa 1 + factores de diagnóstico) para que el operador lea el entorno.
    ///
    /// NO corre las capas 2-4, ni signal gates, ni sizing: esta estrategia no propone operaciones.
    /// </summary>
    public class GexAnalysisHandler : IRequestHandler<GexAnalysisRequest, GexAnalysisResponse>
    {
        private readonly IMediator _mediator;

        // Cache por símbolo: el barrido de la cadena completa es caro y el tablero refresca solo.
        // Estático porque el handler se instancia por request (mismo criterio que los caches de
        // cadena/OI de GammaExposureHandler).
        //
        // La entrada guarda el hash del JSON de reglas con el que se calculó. La respuesta incluye
        // el macroRegime YA EVALUADO (umbrales aplicados), así que sin esto editar un umbral no
        // cambiaba nada durante cache_seconds: el JSON se relee en cada request, pero el veredicto
        // viejo seguía saliendo del cache. Pasó de verdad al cambiar el umbral de SPY (2026-08-06).
        private static readonly ConcurrentDictionary<string, (GexAnalysisResponse Response, DateTime At, string RulesHash)> _cache = new();

        // Un barrido a la vez. Todos comparten la misma conexión DXLink, así que dos barridos
        // concurrentes se pisan y ninguno completa: medido 2026-08-05 con el mercado abierto, un
        // SPY y un QQQ solapados bajaron a 60.8% y 69.2% de cobertura, contra 100% cuando corrieron
        // de a uno. Serializar cuesta espera al segundo pedido, pero devuelve datos completos en vez
        // de dos respuestas incompletas.
        private static readonly SemaphoreSlim _scanGate = new(1, 1);

        // Símbolos con un recálculo en segundo plano en curso: un solo recálculo por símbolo.
        private static readonly ConcurrentDictionary<string, bool> _refreshing = new();

        private readonly IServiceScopeFactory? _scopes;

        public GexAnalysisHandler(IMediator mediator, IServiceScopeFactory? scopes = null)
        {
            _mediator = mediator;
            _scopes = scopes;
        }

        public async Task<GexAnalysisResponse> Handle(GexAnalysisRequest request, CancellationToken cancellationToken)
        {
            var rules = JsonNode.Parse(request.RulesJson!)!.AsObject();
            var symbol = request.Symbol.ToUpperInvariant();
            var scan = ReadScanConfig(rules);
            var rulesHash = HashRules(request.RulesJson);

            // Switch en OFF: kill switch del barrido. No se toca DXLink ni a pedido explícito; se
            // devuelve el último resultado que haya quedado en cache, marcado como congelado, y se
            // ignora el TTL a propósito (nadie lo va a refrescar, y tirarlo dejaría la pantalla
            // vacía sin ganar nada).
            if (!request.AllowScan)
                return FrozenOrEmpty(symbol, scan);

            if (!request.Refresh && TryGetFresh(symbol, scan.CacheSeconds, rulesHash, out var hit))
                return hit!;

            // Lo último calculado, aunque esté vencido (o sea de antes de reiniciar la API): sale al
            // instante con su propia hora y el barrido corre aparte. Un barrido en frío tarda
            // minutos (SPY ~106 s, QQQ ~128 s) y el gráfico quedaba vacío todo ese tiempo.
            if (!request.Refresh && _scopes != null && TryGetStored(symbol, out var stored))
            {
                StartBackgroundRefresh(request, symbol, rules, scan, rulesHash);
                return stored!;
            }

            await _scanGate.WaitAsync(cancellationToken);
            try
            {
                // Puede haber esperado minutos: si el barrido que estaba corriendo era de este mismo
                // símbolo, ya hay resultado fresco y no tiene sentido volver a barrer la cadena.
                if (!request.Refresh && TryGetFresh(symbol, scan.CacheSeconds, rulesHash, out hit))
                    return hit!;

                return await ScanAsync(request, symbol, rules, scan, rulesHash, cancellationToken);
            }
            finally
            {
                _scanGate.Release();
            }
        }

        /// <summary>
        /// Respuesta con el switch en OFF: lo último que haya en cache, sin importar su antigüedad,
        /// marcado como congelado. Si nunca se barrió, devuelve el envoltorio vacío para que el
        /// tablero muestre "detenido" en vez de un error.
        /// </summary>
        private static GexAnalysisResponse FrozenOrEmpty(string symbol, ScanConfig scan)
        {
            if (_cache.TryGetValue(symbol, out var cached))
            {
                cached.Response.FromCache = true;
                cached.Response.SwitchEnabled = false;
                cached.Response.Frozen = true;
                return cached.Response;
            }

            return new GexAnalysisResponse
            {
                Symbol = symbol,
                Timestamp = DateTime.UtcNow,
                SwitchEnabled = false,
                Frozen = true,
                Gex = new GexPayload { Config = scan.ToDto() },
            };
        }

        /// <summary>
        /// Huella del JSON de reglas. Se compara por contenido y no por fecha del archivo: guardarlo
        /// sin cambios no tiene por qué tirar un barrido de varios minutos a la basura.
        /// </summary>
        private static string HashRules(string? rulesJson)
        {
            if (string.IsNullOrEmpty(rulesJson)) return string.Empty;
            var bytes = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(rulesJson));
            return Convert.ToHexString(bytes);
        }

        private static bool TryGetFresh(string symbol, int cacheSeconds, string rulesHash, out GexAnalysisResponse? hit)
        {
            hit = null;
            if (!_cache.TryGetValue(symbol, out var cached)) return false;
            if ((DateTime.UtcNow - cached.At).TotalSeconds >= cacheSeconds) return false;

            // Cambió el JSON de reglas: el veredicto cacheado se calculó con otros umbrales.
            if (!string.Equals(cached.RulesHash, rulesHash, StringComparison.Ordinal)) return false;

            // La entrada del cache es un objeto compartido y se muta al servirlo: si estuvo en OFF
            // quedó marcada como congelada, y al volver a ON hay que limpiar esos flags.
            cached.Response.SwitchEnabled = true;
            cached.Response.Frozen = false;

            cached.Response.FromCache = true;
            hit = cached.Response;
            return true;
        }

        private bool TryGetStored(string symbol, out GexAnalysisResponse? stored)
        {
            stored = null;
            if (_cache.TryGetValue(symbol, out var cached)) stored = cached.Response;
            else if ((stored = GexAnalysisDisk.Load(symbol)) != null) _cache[symbol] = (stored, stored.Timestamp, string.Empty);
            if (stored == null) return false;

            stored.SwitchEnabled = true;
            stored.Frozen = false;
            stored.FromCache = true;
            return true;
        }

        private void StartBackgroundRefresh(
            GexAnalysisRequest request, string symbol, JsonObject rules, ScanConfig scan, string rulesHash)
        {
            if (!_refreshing.TryAdd(symbol, true)) return;

            var scopes = _scopes!;
            _ = Task.Run(async () =>
            {
                try
                {
                    // El request ya terminó: el barrido necesita su propio scope.
                    using var scope = scopes.CreateScope();
                    var handler = new GexAnalysisHandler(scope.ServiceProvider.GetRequiredService<IMediator>(), scopes);
                    await _scanGate.WaitAsync();
                    try { await handler.ScanAsync(request, symbol, rules, scan, rulesHash, CancellationToken.None); }
                    finally { _scanGate.Release(); }
                }
                catch
                {
                    // Sin recálculo se sigue sirviendo lo guardado; el próximo pedido reintenta.
                }
                finally
                {
                    _refreshing.TryRemove(symbol, out _);
                }
            });
        }

        private async Task<GexAnalysisResponse> ScanAsync(
            GexAnalysisRequest request, string symbol, JsonObject rules, ScanConfig scan,
            string rulesHash, CancellationToken cancellationToken)
        {
            var sw = Stopwatch.StartNew();

            // GEX global (toda la cadena) + los mismos insumos de contexto que usa PositionBuilder.
            var gexTask = _mediator.Send(new GammaExposureRequest
            {
                Symbol = symbol,
                MaxDTE = scan.MaxDte,
                AllExpirations = true,
                IncludeByExpiry = true,
                IncludeZeroDte = scan.IncludeZeroDte,
                ExpirationTypes = scan.ExpirationTypes,
                GreeksBatchSize = scan.GreeksBatchSize,
                GreeksRetries = scan.GreeksRetries,
                OiDeltaMin = scan.OiDeltaMin,
                OiDeltaMax = scan.OiDeltaMax,
                WallBandWidthEm = scan.WallBandWidthEm,
                WallBandMoneyZoneEm = scan.WallBandMoneyZoneEm,
            }, cancellationToken);
            var ivrTask = _mediator.Send(new IVRankRequest { Symbol = symbol }, cancellationToken);
            var ivTask = _mediator.Send(new ImpliedVolatilityRequest { Symbol = symbol }, cancellationToken);
            var candleTask = _mediator.Send(new MarketDataCandleRequest
            {
                Symbol = symbol,
                Interval = "1d",
                FromTime = DateTime.UtcNow.AddDays(-120) // cubre EMA 50 + RV 30 + ret 5d
            }, cancellationToken);
            // VIX y VIX9D reales para macro_regime (vix_absolute y vix_term_structure). Son macro: no
            // dependen del símbolo barrido, dan lo mismo para los cuatro del universo.
            var vixTask = _mediator.Send(new MarketDataTradeRequest { Symbol = "VIX" }, cancellationToken);
            var vix9dTask = _mediator.Send(new MarketDataTradeRequest { Symbol = "VIX9D" }, cancellationToken);

            await Task.WhenAll(gexTask, ivrTask, ivTask, candleTask, vixTask, vix9dTask);

            var gex = gexTask.Result;
            var ivr = ivrTask.Result;
            var iv = ivTask.Result;
            double? vix = vixTask.Result?.Data?.FirstOrDefault()?.Price;
            double? vix9d = vix9dTask.Result?.Data?.FirstOrDefault()?.Price;
            var candles = candleTask.Result?.data?
                .Where(c => c.Close > 0)
                .OrderBy(c => c.Time)
                .ToList() ?? new List<CandleData>();

            var response = new GexAnalysisResponse
            {
                Symbol = symbol,
                Timestamp = DateTime.UtcNow,
                SpotPrice = gex.Spot,
                // Capa 1 evaluada con el GEX GLOBAL: gexTotal y spotVsZgl miran toda la cadena.
                MacroRegime = VLH.EvaluateLayer1(rules, symbol, gex, ivr, iv, vix, vix9d),
                StructureInputs = BuildStructureInputs(rules, symbol, gex, iv, candles),
                Gex = new GexPayload
                {
                    Config = scan.ToDto(),
                    Global = new GexScope
                    {
                        Spot = gex.Spot,
                        CallGex = gex.CallGEX,
                        PutGex = gex.PutGEX,
                        NetGex = gex.NetGEX,
                        GammaZeroLevel = gex.GammaZeroLevel,
                        CallWall = gex.CallWall,
                        PutWall = gex.PutWall,
                        ExpirationsIncluded = gex.ByExpiry.Count,
                        ExpirationsRequested = gex.ExpirationsRequested,
                        CoveragePct = gex.SymbolsRequested > 0
                            ? Math.Round(100.0 * gex.SymbolsWithGreeks / gex.SymbolsRequested, 1)
                            : 0,
                        Strikes = gex.Strikes.Select(MapStrike).ToList(),
                    },
                    ByExpiry = gex.ByExpiry
                        .OrderBy(e => e.DTE)
                        .Select(e => new GexExpiryScope
                        {
                            Expiration = e.Expiration,
                            Dte = e.DTE,
                            ExpirationType = e.ExpirationType,
                            CallGex = e.CallGEX,
                            PutGex = e.PutGEX,
                            NetGex = e.NetGEX,
                            GammaZeroLevel = e.GammaZeroLevel,
                            CallWall = e.CallWall,
                            PutWall = e.PutWall,
                            CallBand = e.CallBand,
                            PutBand = e.PutBand,
                            AtmIv = e.AtmIv,
                            ExpectedMove = e.ExpectedMove,
                            Strikes = e.Strikes.Select(MapStrike).ToList(),
                        })
                        .ToList(),
                },
            };

            sw.Stop();
            response.ElapsedMs = sw.ElapsedMilliseconds;

            // Un barrido incompleto NO se cachea. Si se guardara, el tablero mostraría durante
            // cache_seconds un GEX al que le faltan vencimientos enteros — y un GEX más chico se
            // lee como una caída del gamma, no como un dato faltante. Sin cachearlo, el próximo
            // pedido vuelve a intentar. Tampoco se cachea si el cliente abortó: ahí el barrido se
            // corta a mitad de camino y el resultado parcial no representa nada.
            var g = response.Gex.Global;
            bool complete = g.ExpirationsIncluded >= g.ExpirationsRequested
                            && g.CoveragePct >= scan.CacheMinCoveragePct;

            if (complete && !cancellationToken.IsCancellationRequested)
            {
                _cache[symbol] = (response, DateTime.UtcNow, rulesHash);
                GexAnalysisDisk.Save(symbol, response);
            }

            return response;
        }

        private static GexStrike MapStrike(GammaExposureStrike s) => new()
        {
            Strike = s.Strike,
            CallGEX = s.CallGEX,
            PutGEX = s.PutGEX,
            NetGEX = s.NetGEX,
            CallOI = s.CallOI,
            PutOI = s.PutOI,
            CallDelta = s.CallDelta,
            PutDelta = s.PutDelta,
            CallIV = s.CallIV,
            PutIV = s.PutIV,
        };

        // ═══════════════════════════════════════════════════════════════════════
        // Contexto de mercado — los mismos primitivos compartidos que usa RPF (App/Shared/CascadeUtils),
        // sin la parte de selección de estructura (esta estrategia no elige nada).
        // ═══════════════════════════════════════════════════════════════════════

        private StructureInputs BuildStructureInputs(
            JsonObject rules, string symbol, GammaExposureResponse gex,
            ImpliedVolatilityResponse iv, List<CandleData> candles)
        {
            var structureConfig = VLH.GetPositionBuilderLayer(rules, 2)?["config"]?["structure_selection"];
            double neutralZ = structureConfig?["thresholds"]?["neutral_z"]?.GetValue<double>() ?? 1.0;
            double extremeZ = structureConfig?["thresholds"]?["extreme_z"]?.GetValue<double>() ?? 1.5;

            double ivAtm = (iv.IV30_30d ?? 0) / 100.0;

            double priceZScore = VLH.ComputePriceZScore(candles, ivAtm);
            string gexSkew = VLH.ComputeGexSkew(gex.CallGEX, gex.PutGEX);
            var (ema20, ema50, trendSignal) = VLH.ComputeTrend(candles);
            var (rv10d, rv30d, realizedVolSignal) = VLH.ComputeRealizedVol(candles);

            double ret5d = 0;
            if (candles.Count >= 6 && candles[^6].Close > 0)
                ret5d = Math.Log(candles[^1].Close / candles[^6].Close);

            double gexSkewRaw = (gex.CallGEX + Math.Abs(gex.PutGEX)) > 0
                ? gex.CallGEX / (gex.CallGEX + Math.Abs(gex.PutGEX)) : 0.5;

            return new StructureInputs
            {
                PriceZScore = new PriceZScoreInput
                {
                    Value = Math.Round(priceZScore, 4),
                    Ret5d = Math.Round(ret5d, 6),
                    IvAtm = Math.Round(ivAtm * 100, 2),
                    Interpretation = InterpretZScore(priceZScore, neutralZ, extremeZ)
                },
                GexSign = new GexSignInput
                {
                    Value = gexSkew,
                    SkewRatio = Math.Round(gexSkewRaw, 3),
                    Interpretation = gexSkew == "call_dominant"
                        ? "call wall domina — soporte estructural arriba"
                        : gexSkew == "put_dominant"
                            ? "put wall domina — soporte estructural abajo"
                            : "GEX simétrico — ancla equilibrada"
                },
                Trend = new TrendInput
                {
                    Ema20 = ema20.HasValue ? Math.Round(ema20.Value, 2) : null,
                    Ema50 = ema50.HasValue ? Math.Round(ema50.Value, 2) : null,
                    Signal = trendSignal,
                    Interpretation = trendSignal switch
                    {
                        "up" => "ema_20 > ema_50",
                        "down" => "ema_20 < ema_50",
                        "neutral" => "ema_20 ≈ ema_50 (diff < 0.2%)",
                        _ => "datos insuficientes"
                    }
                },
                RealizedVolRegime = new RealizedVolInput
                {
                    Rv10d = rv10d.HasValue ? Math.Round(rv10d.Value, 2) : null,
                    Rv30d = rv30d.HasValue ? Math.Round(rv30d.Value, 2) : null,
                    Signal = realizedVolSignal,
                    Interpretation = realizedVolSignal switch
                    {
                        "high" => "rv_short > rv_long — vol en expansión",
                        "low" => "rv_short ≤ rv_long — vol en contracción",
                        _ => "datos insuficientes"
                    }
                },
            };
        }

        private static string InterpretZScore(double z, double neutralZ, double extremeZ)
        {
            double absZ = Math.Abs(z);
            if (absZ < neutralZ) return "neutral";
            string direction = z > 0 ? "bullish" : "bearish";
            return absZ >= extremeZ ? $"{direction}_extreme" : $"{direction}_moderate";
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Config del barrido — nodo `gex` del JSON. Los defaults valen solo si el nodo falta.
        // ═══════════════════════════════════════════════════════════════════════

        private sealed record ScanConfig(
            int MaxDte, bool IncludeZeroDte, string[] ExpirationTypes,
            int GreeksBatchSize, int GreeksRetries, int CacheSeconds, double CacheMinCoveragePct,
            double OiDeltaMin, double OiDeltaMax,
            double WallBandWidthEm, double WallBandMoneyZoneEm)
        {
            public GexScanConfig ToDto() => new()
            {
                MaxDte = MaxDte,
                IncludeZeroDte = IncludeZeroDte,
                ExpirationTypes = ExpirationTypes,
                GreeksBatchSize = GreeksBatchSize,
                GreeksRetries = GreeksRetries,
                CacheSeconds = CacheSeconds,
                CacheMinCoveragePct = CacheMinCoveragePct,
            };
        }

        private static ScanConfig ReadScanConfig(JsonObject rules)
        {
            var node = rules["gex"];

            var types = node?["expiration_types"]?.AsArray()
                ?.Select(t => t?.GetValue<string>())
                .Where(t => !string.IsNullOrWhiteSpace(t))
                .Select(t => t!)
                .ToArray();

            var band = node?["oi_delta_band"]?.AsArray();
            var wb = node?["wall_band"];

            return new ScanConfig(
                MaxDte: node?["max_dte"]?.GetValue<int>() ?? 60,
                IncludeZeroDte: node?["include_zero_dte"]?.GetValue<bool>() ?? true,
                ExpirationTypes: types is { Length: > 0 } ? types : new[] { "Regular", "Weekly" },
                GreeksBatchSize: node?["greeks_batch_size"]?.GetValue<int>() ?? 1000,
                GreeksRetries: node?["greeks_retries"]?.GetValue<int>() ?? 2,
                CacheSeconds: node?["cache_seconds"]?.GetValue<int>() ?? 600,
                CacheMinCoveragePct: node?["cache_min_coverage_pct"]?.GetValue<double>() ?? 99,
                OiDeltaMin: band?.Count > 0 ? band[0]!.GetValue<double>() : 0.02,
                OiDeltaMax: band?.Count > 1 ? band[1]!.GetValue<double>() : 0.98,
                WallBandWidthEm: wb?["width_em"]?.GetValue<double>()
                    ?? GammaExposureHandler.WallBandWidthEm,
                WallBandMoneyZoneEm: wb?["money_zone_em"]?.GetValue<double>()
                    ?? GammaExposureHandler.WallBandMoneyZoneEm);
        }
    }
}
