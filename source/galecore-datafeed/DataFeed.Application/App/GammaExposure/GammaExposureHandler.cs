using DataFeed.Application.App.Shared;
using DataFeed.Application.Functions;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers.Tastytrade;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using MediatR;
using Microsoft.Extensions.Configuration;
using Newtonsoft.Json.Linq;
using System.Globalization;
using System.Net.Http;

namespace DataFeed.Application.App.GammaExposure
{
    public class GammaExposureHandler : IRequestHandler<GammaExposureRequest, GammaExposureResponse>
    {
        private readonly IConfiguration _config;
        private readonly ITastytradeOAuth _auth;
        private readonly IHttpClientFactory _client;
        private readonly IDxLinkStreamingService _streaming;

        // Tasa libre de riesgo por defecto (si FRED no disponible)
        private const double DEFAULT_RISK_FREE_RATE = 0.045;

        // Cache de la cadena de opciones por símbolo/día. La chain (expiraciones, strikes,
        // streamer symbols) es estática intradía → la primera llamada del día paga el REST
        // (~1.3s) y las siguientes la reutilizan. Estático porque el handler se instancia por request.
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (OptionChainsModel Chain, DateTime Day)> _chainCache = new();

        // Cache diario de OI/cierre anterior por símbolo streamer (el OI settled no cambia intradía).
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (long Oi, double? PrevClose, DateTime Day)> _oiCache = new();

        public GammaExposureHandler(IConfiguration config, ITastytradeOAuth auth, IHttpClientFactory client, IDxLinkStreamingService streaming)
        {
            _config = config;
            _auth = auth;
            _client = client;
            _streaming = streaming;
        }

        /// <summary>
        /// Días hacia atrás en los que se buscan candles diarios para leer el Open Interest.
        ///
        /// DXLink sólo publica el candle de un día si el contrato operó ese día, y el OI viene en el
        /// candle. Con la ventana anterior de 2 días, un strike que no operó en los últimos dos días
        /// quedaba sin OI y entraba al GEX como 0, aunque sus contratos siguieran abiertos (el OI no
        /// cambia si no hay operaciones). Verificado el 2026-09-24 contra IBKR en SPY 2026-11-20: el
        /// call 515 tenía OI 97 (último candle 10/09) y el call 550 OI 25 (último candle 18/09); los
        /// dos entraban al GEX con 0.
        /// </summary>
        public const int OiLookbackDays = 30;

        /// <summary>
        /// Días hacia atrás en los que un candle todavía sirve como cierre previo. Es la ventana de
        /// siempre: el cierre previo lo usa RPF y no debe pasar a ser un precio de hace semanas.
        /// </summary>
        public const int PrevCloseLookbackDays = 2;

        /// <summary>Inicio (ms UTC) de la ventana de candles para el OI.</summary>
        public static long OiCandlesFromTime(DateTime todayUtc) =>
            new DateTimeOffset(todayUtc.Date.AddDays(-OiLookbackDays), TimeSpan.Zero).ToUnixTimeMilliseconds();

        /// <summary>true si un candle es lo bastante reciente para tomar su close como cierre previo.</summary>
        public static bool IsRecentForPrevClose(long candleTimeMs, DateTime todayUtc) =>
            candleTimeMs >= new DateTimeOffset(todayUtc.Date.AddDays(-PrevCloseLookbackDays), TimeSpan.Zero).ToUnixTimeMilliseconds();

        /// <summary>
        /// Elige, entre los candles diarios de un símbolo, el OI y el cierre previo: el candle más
        /// reciente que trae OI; su OI sólo si es válido (ver TryParseValidOpenInterest); su close como
        /// cierre previo sólo si el candle es reciente (ver IsRecentForPrevClose). null = sin OI.
        /// </summary>
        public static (long Oi, double? PrevClose)? PickOpenInterest(
            IEnumerable<(long Time, string? OpenInterest, string? Close)> candles, DateTime todayUtc)
        {
            var withOi = candles.Where(c => !string.IsNullOrEmpty(c.OpenInterest)).ToList();
            if (withOi.Count == 0) return null;
            var newest = withOi.OrderByDescending(c => c.Time).First();
            if (!TryParseValidOpenInterest(newest.OpenInterest, out var oi)) return null;

            double? prevClose = null;
            if (IsRecentForPrevClose(newest.Time, todayUtc)
                && !string.IsNullOrEmpty(newest.Close)
                && double.TryParse(newest.Close, NumberStyles.Any, CultureInfo.InvariantCulture, out var pc) && pc > 0)
                prevClose = pc;
            return (oi, prevClose);
        }

        // Tope plausible de Open Interest por strike. El OI real no supera ~1e6; 1e9 deja 1000x
        // de holgura y queda muy por debajo de long.MaxValue (evita el overflow del cast).
        private const double MAX_PLAUSIBLE_OI = 1_000_000_000;

        /// <summary>
        /// Parsea el Open Interest de un candle y valida que sea un valor plausible para agregar al GEX.
        /// Rechaza no-parseables, &lt;= 0, NaN/Infinity e implausibles (&gt; 1e9). Sin esta guarda, un OI
        /// corrupto llega a <c>(long)poi</c> y, si el double excede long.MaxValue, desborda a
        /// <c>long.MinValue</c> (-9.2e18) — un sentinel que envenena el netGEX agregado.
        /// </summary>
        public static bool TryParseValidOpenInterest(string? raw, out long oi)
        {
            oi = 0;
            if (!double.TryParse(raw, NumberStyles.Any, CultureInfo.InvariantCulture, out var poi)
                || poi <= 0 || poi > MAX_PLAUSIBLE_OI || double.IsNaN(poi) || double.IsInfinity(poi))
                return false;
            oi = (long)poi;
            return true;
        }

        /// <summary>
        /// Clamp defensivo en el punto de uso: un OI corrupto/faltante (o cacheado antes de la
        /// validación) no debe contribuir al GEX. Nunca negativo.
        /// </summary>
        public static long SanitizeOpenInterest(long oi) => oi < 0 ? 0 : oi;

        /// <summary>
        /// Call Wall: el strike por encima del spot con mayor CallGEX, <b>entre los que además
        /// tienen gamma neto positivo</b>. Devuelve null si ninguno califica.
        /// </summary>
        /// <remarks>
        /// El ranking sigue siendo por lado y no por neto, por dos razones medidas en SPY el
        /// 2026-08-18 (cadena completa, 17 vencimientos, cobertura 100%):
        /// <list type="bullet">
        /// <item>Es lo que dibuja <c>GexBarsPanel</c>: barras por lado, no netas. Con el argmax del
        /// neto, la línea del muro dejaba de caer sobre el pico visible.</item>
        /// <item>Es más estable. El margen entre el #1 y el #2 del Call Wall global caía de 23.8% a
        /// 6.1% al rankear por neto — es una resta de dos números grandes y el ganador se da vuelta
        /// con mucho menos movimiento.</item>
        /// </list>
        /// La guarda de signo es lo que se agregó: sin ella, el Call Wall del 0DTE de ese día salía
        /// 770, un strike con OI de puts 6x el de calls y gamma neto −$30B. Un muro donde el dealer
        /// está net short gamma es lo contrario de lo que la palabra promete.
        /// La guarda también resuelve el vencimiento sin OI (ese día, 2026-09-01 con 30 strikes y OI
        /// 0): NetGEX 0 no es &gt; 0, así que devuelve null en vez de elegir un strike arbitrario
        /// entre puros ceros.
        /// </remarks>
        /// <summary>
        /// Elige la expiración del modo de un solo vencimiento.
        ///
        /// Sin <paramref name="targetDte"/> mantiene el comportamiento histórico —la de MAYOR DTE
        /// dentro del rango— porque es el que produjo todos los números que el operador viene
        /// mirando. Con un objetivo, la más cercana a ese DTE, y a igual distancia gana la más
        /// corta, para que la regla sea determinística y no dependa del orden de la cadena.
        /// El porqué del objetivo, en <see cref="GammaExposureRequest.TargetDte"/>.
        /// </summary>
        public static Expiration SelectSingleExpiration(List<Expiration> candidates, int targetDte) =>
            targetDte > 0
                ? candidates.OrderBy(e => Math.Abs(e.DaysToExpiration - targetDte))
                            .ThenBy(e => e.DaysToExpiration)
                            .First()
                : candidates.OrderByDescending(e => e.DaysToExpiration).First();

        /// <summary>
        /// Recalcula el DTE de cada expiración contra la fecha de hoy en ET y descarta las vencidas.
        ///
        /// El `days-to-expiration` que manda Tastytrade NO es confiable. El 2026-08-25 la cadena de
        /// SPY y la de TSLA traían `2026-08-24` —un weekly de lunes ya vencido— con DTE 0, y toda
        /// su serie corrida un día; la de QQQ, pedida en el mismo minuto, venía bien. O sea que el
        /// campo puede estar mal para un símbolo y bien para otro a la vez, y por eso no alcanza con
        /// confiar en que "se actualiza en algún momento del día".
        ///
        /// Lo que costaba tomarlo tal cual:
        /// * un contrato vencido entraba al barrido como si fuera el 0DTE, y su gamma muerta sumaba
        ///   al GEX del agregado — el 37% del neto de SPY ese día;
        /// * <see cref="CascadeUtils.YearsToExpiry"/> le daba tiempo real, porque para DTE 0 mide las
        ///   horas hasta las 16:00 ET de HOY: el expected move de esa serie salió 20.90 contra 0.94
        ///   del 0DTE verdadero, o sea una IV implícita de ~114%;
        /// * con todos los DTE corridos, el expected move de cada vencimiento se calculaba con un día
        ///   de más, y el corte de MaxDTE dejaba entrar un contrato a 61 días como si fuera de 60.
        ///
        /// El DTE es una cuenta de calendario contra la fecha del vencimiento: se hace acá una vez y
        /// todo lo de abajo queda consistente. La fecha viene como `yyyy-MM-dd`; una que no parsea se
        /// descarta, porque sin fecha no hay forma de saber si el contrato existe todavía.
        /// </summary>
        public static List<Expiration> NormalizeExpirations(
            IEnumerable<Expiration> expirations, DateTimeOffset? nowUtc = null)
        {
            var today = CascadeUtils.TodayEt(nowUtc);
            var vivas = new List<Expiration>();

            foreach (var e in expirations ?? Enumerable.Empty<Expiration>())
            {
                if (e == null) continue;
                if (!DateTime.TryParseExact(e.ExpirationDate, "yyyy-MM-dd",
                        CultureInfo.InvariantCulture, DateTimeStyles.None, out var fecha))
                    continue;

                int dte = (int)(fecha.Date - today).TotalDays;
                if (dte < 0) continue;

                e.DaysToExpiration = dte;
                vivas.Add(e);
            }

            return vivas;
        }

        public static double? SelectCallWall(IEnumerable<GammaExposureStrike> strikes, double spot) =>
            strikes.Where(s => s.Strike > spot && s.CallGEX > 0 && s.NetGEX > 0)
                   .OrderByDescending(s => s.CallGEX)
                   .FirstOrDefault()?.Strike;

        /// <summary>
        /// Put Wall: el strike por debajo del spot con mayor |PutGEX|, entre los que además tienen
        /// gamma neto negativo. Espejo de <see cref="SelectCallWall"/> — mismas razones.
        /// </summary>
        public static double? SelectPutWall(IEnumerable<GammaExposureStrike> strikes, double spot) =>
            strikes.Where(s => s.Strike < spot && s.PutGEX < 0 && s.NetGEX < 0)
                   .OrderBy(s => s.PutGEX)
                   .FirstOrDefault()?.Strike;

        // Defaults de la banda, espejo de gex.wall_band en galecore_rules_gex.json.
        public const double WallBandWidthEm = 0.25;
        public const double WallBandMoneyZoneEm = 0.15;

        // Mínimo de strikes con GEX en el lado para que la ventana signifique algo. Con menos, la
        // "ventana más densa" y la mediana se calculan sobre un puñado de puntos y el cociente es ruido.
        private const int WallBandMinStrikes = 6;

        /// <summary>
        /// La banda de gamma de un lado: la ventana de ancho <c>widthEm × EM</c> que maximiza la suma
        /// de |GEX| de ese lado, entre los strikes que están FUERA de la zona del dinero.
        ///
        /// REEMPLAZA a <see cref="SelectCallWall"/> / <see cref="SelectPutWall"/> como objeto que se
        /// muestra en la pantalla de GEX — los dos siguen existiendo porque RPF los usa de gate y el
        /// Monitor los dibuja en su StrikeLadder; acá no se les toca la definición.
        ///
        /// El argmax es un mal objeto y está medido: nunca junta más del 19% del |GEX| de su lado, le
        /// gana al segundo candidato por tan poco como un 2%, y salta —el call wall de QQQ 18-Sep
        /// estuvo en 750 a las 10:12 ET y en 710 a las 11:00 ET del mismo día—. La banda sobre las
        /// mismas series se movió $1.3 en total contra $16.1. Ver research/got/, sección 61.4.
        ///
        /// La zona del dinero se excluye del POOL entero —no sólo de la comparación—: los strikes
        /// pegados al spot siempre concentran gamma, y con ellos adentro la ventana más densa puede
        /// SER la pila del dinero (QQQ 18-Sep: argmax 710 con el spot en 708.02).
        ///
        /// LO QUE LA BANDA NO DICE: que el precio frene ahí. Medido sobre 926 observaciones de
        /// SPY/QQQ/IWM 2013-2025, su borde se comporta como un strike cualquiera del mismo delta y el
        /// mismo lado. Es descripción del posicionamiento, no una zona de venta.
        ///
        /// Devuelve null cuando no hay EM (sin él no hay ancho) o cuando el lado no tiene suficientes
        /// strikes con GEX. Null es un resultado válido: significa "no hay banda acá".
        /// </summary>
        public static GammaBand? SelectWallBand(
            IEnumerable<GammaExposureStrike> strikes, double spot, double? expectedMove, bool isCall,
            double widthEm = WallBandWidthEm, double moneyZoneEm = WallBandMoneyZoneEm)
        {
            if (strikes == null || !(expectedMove > 0) || !(spot > 0)) return null;

            double em = expectedMove.Value;
            double width = widthEm * em;
            if (!(width > 0)) return null;

            // El pool: strikes del lado que corresponde, con GEX propio, fuera de la zona del dinero.
            var pool = strikes
                .Where(s => isCall ? s.Strike > spot : s.Strike < spot)
                .Select(s => (Strike: s.Strike, Mass: Math.Abs(isCall ? s.CallGEX : s.PutGEX)))
                .Where(x => x.Mass > 0 && Math.Abs(x.Strike - spot) >= moneyZoneEm * em)
                .OrderBy(x => x.Strike)
                .ToList();

            if (pool.Count < WallBandMinStrikes) return null;

            double total = pool.Sum(x => x.Mass);
            if (!(total > 0)) return null;

            // Todas las ventanas del lado: cada una arranca en un strike del pool y mide `width`.
            // Hacia AFUERA en el lado call (k0 → k0+w) y hacia adentro en el put (k0-w → k0), para
            // que el borde externo caiga siempre del lado lejano al spot.
            var ventanas = new List<(double Mass, double Lo, double Hi)>(pool.Count);
            foreach (var (k0, _) in pool)
            {
                double lo = isCall ? k0 : k0 - width;
                double hi = isCall ? k0 + width : k0;
                double masa = pool.Where(x => x.Strike >= lo - 1e-9 && x.Strike <= hi + 1e-9)
                                  .Sum(x => x.Mass);
                ventanas.Add((masa, lo, hi));
            }

            var mejor = ventanas.OrderByDescending(v => v.Mass).First();

            var masas = ventanas.Select(v => v.Mass).OrderBy(m => m).ToList();
            double mediana = masas.Count % 2 == 1
                ? masas[masas.Count / 2]
                : (masas[masas.Count / 2 - 1] + masas[masas.Count / 2]) / 2;

            return new GammaBand
            {
                Low = Math.Round(mejor.Lo, 2),
                High = Math.Round(mejor.Hi, 2),
                Edge = Math.Round(isCall ? mejor.Hi : mejor.Lo, 2),
                PctOfSide = Math.Round(mejor.Mass / total * 100, 1),
                XMed = mediana > 0 ? Math.Round(mejor.Mass / mediana, 2) : null,
                Width = Math.Round(width, 2),
            };
        }

        /// <summary>
        /// Obtiene Greeks (IV/delta/gamma) + OI por símbolo vía la conexión DXLink persistente,
        /// sin abrir una sesión nueva. Greeks pasa por reference-counting (no pisa al Monitor);
        /// Candle (OI) va en lotes con cache diario.
        /// </summary>
        private async Task<MultiGreeksModel> FetchGreeksAndOIAsync(
            string[] streamerSymbols, double candleDeltaMin, double candleDeltaMax, CancellationToken ct,
            int greeksBatchSize = 0, int greeksRetries = 0)
        {
            var result = new MultiGreeksModel();
            if (streamerSymbols == null || streamerSymbols.Length == 0) return result;

            // ── Fase 1: Greeks (ref-counted) ──
            // greeksBatchSize > 0 trocea el pedido: con la cadena completa (modo global) son miles de
            // símbolos y una sola suscripción gigante hace timeout antes de completar.
            //
            // RequestSnapshotAsync devuelve lo que alcanzó a juntar cuando vence el timeout, así que
            // un lote lento deja símbolos sin Greeks — y sin Greeks el strike se cae del GEX en
            // silencio. Con la cadena completa eso significa vencimientos enteros faltantes y un
            // netGEX que cambia entre corridas. Por eso se reintenta lo que faltó: cada vuelta pide
            // solo los que quedaron y el conjunto se achica rápido.
            var pending = streamerSymbols;

            for (int attempt = 0; attempt <= greeksRetries; attempt++)
            {
                if (ct.IsCancellationRequested || pending.Length == 0) break;

                var greeksBatches = greeksBatchSize > 0
                    ? pending.Chunk(greeksBatchSize).ToList()
                    : new List<string[]> { pending };

                foreach (var batch in greeksBatches)
                {
                    if (ct.IsCancellationRequested) break;

                    var greeksItems = await _streaming.RequestSnapshotAsync(
                        batch.Select(s => (s, "Greeks", (long?)null)).ToList(),
                        isSymbolComplete: it => { var v = (double?)it["volatility"]; return v.HasValue && v.Value > 0; },
                        timeout: TimeSpan.FromSeconds(15),
                        cancellationToken: ct);

                    foreach (var it in greeksItems)
                    {
                        var sym = it["eventSymbol"]?.ToString();
                        if (string.IsNullOrEmpty(sym)) continue;
                        var g = it.ToObject<GreeksEvent>();
                        if (g != null && g.Volatility > 0) result.Greeks[sym] = g;
                    }
                }

                pending = pending.Where(s => !result.Greeks.ContainsKey(s)).ToArray();
            }

            result.SymbolsRequested = streamerSymbols.Length;

            // Filtro por banda de |delta|: solo pedimos OI de strikes relevantes (deep OTM/ITM ≈ 0 gamma).
            var candleSymbols = streamerSymbols
                .Where(sym => result.Greeks.TryGetValue(sym, out var g)
                              && Math.Abs(g.Delta) >= candleDeltaMin && Math.Abs(g.Delta) <= candleDeltaMax)
                .ToArray();
            result.OiRequested = candleSymbols.ToHashSet();

            // Cache diario de OI: resolver hits sin pedir Candle; juntar los miss.
            var today = DateTime.UtcNow.Date;
            var toFetch = new List<string>();
            foreach (var sym in candleSymbols)
            {
                if (_oiCache.TryGetValue(sym, out var c) && c.Day == today)
                {
                    result.OpenInterest[sym] = c.Oi;
                    if (c.PrevClose.HasValue) result.PrevClose[sym] = c.PrevClose.Value;
                }
                else toFetch.Add(sym);
            }

            // ── Fase 2: Candle (OI) en lotes (DXLink limita las suscripciones Candle activas) ──
            // DXLink rechaza con BAD_ACTION ("Candle subscription too big") si el lote pasa su
            // cupo de suscripciones Candle activas, y como el canal 3 es compartido, ese rechazo
            // degrada Trade/Quote/Greeks también. Con el GEX global (cadena entera) los lotes
            // llegaban al tope de 80 y disparaban el error; se baja a 40 (el orden que ya andaba
            // antes del barrido global).
            const int CANDLE_BATCH_SIZE = 40;
            var fromTime = OiCandlesFromTime(today);

            for (int i = 0; i < toFetch.Count; i += CANDLE_BATCH_SIZE)
            {
                if (ct.IsCancellationRequested) break;
                var batch = toFetch.Skip(i).Take(CANDLE_BATCH_SIZE).ToList();

                var candleItems = await _streaming.RequestSnapshotAsync(
                    batch.Select(s => (s + "{=d}", "Candle", (long?)fromTime)).ToList(),
                    // Símbolo completo al primer Candle con OI, o al SNAPSHOT_END/SNIP si no trae OI.
                    isSymbolComplete: it =>
                    {
                        if (!string.IsNullOrEmpty(it["openInterest"]?.ToString())) return true;
                        var flags = (int?)it["eventFlags"] ?? 0;
                        return (flags & 0x08) != 0 || (flags & 0x10) != 0;
                    },
                    timeout: TimeSpan.FromSeconds(6),
                    cancellationToken: ct);

                // Por símbolo, tomar el candle más reciente con OI > 0.
                var byKey = candleItems
                    .Select(it => new
                    {
                        Key = (it["eventSymbol"]?.ToString() ?? "").Replace("{=d}", ""),
                        Time = (long?)it["time"] ?? 0,
                        Cd = it.ToObject<CandleData>()
                    })
                    .Where(x => !string.IsNullOrEmpty(x.Key) && x.Cd != null && !string.IsNullOrEmpty(x.Cd.OpenInterest))
                    .GroupBy(x => x.Key);

                foreach (var grp in byKey)
                {
                    // Candle más reciente con OI válido; cierre previo sólo si es reciente (ver PickOpenInterest).
                    var picked = PickOpenInterest(grp.Select(x => (x.Time, (string?)x.Cd!.OpenInterest, (string?)x.Cd.Close)), today);
                    if (picked is not var (oiParsed, pc))
                        continue;

                    result.OpenInterest[grp.Key] = oiParsed;
                    if (pc.HasValue) result.PrevClose[grp.Key] = pc.Value;
                    _oiCache[grp.Key] = (oiParsed, pc, today);
                }
            }

            return result;
        }

        public async Task<GammaExposureResponse> Handle(GammaExposureRequest request, CancellationToken cancellationToken)
        {
            try
            {
                var response = new GammaExposureResponse
                {
                    Symbol = request.Symbol
                };

                // ═══════════════════════════════════════════════════════════
                // PASO 1: Obtener spot price y cadena de opciones (REST)
                // El spot se obtiene por REST para no competir con la conexión
                // persistente de DxLinkStreamingService al usar el WebSocket.
                // ═══════════════════════════════════════════════════════════
                var apiProvider = new TastytradeApiProvider(_config, _auth, _client);

                // El spot siempre se pide en vivo. La option chain se cachea por día:
                // si hay hit solo se pide el spot; si no, spot + chain en paralelo.
                var today = DateTime.UtcNow.Date;
                ByTypeModel? marketData;
                OptionChainsModel? optionChains;

                if (_chainCache.TryGetValue(request.Symbol, out var cachedChain) && cachedChain.Day == today)
                {
                    optionChains = cachedChain.Chain;
                    marketData = await apiProvider.GetMarketDataByTypeAsync(request.Symbol, cancellationToken);
                }
                else
                {
                    var spotTask = apiProvider.GetMarketDataByTypeAsync(request.Symbol, cancellationToken);
                    var chainTask = apiProvider.GetOptionChainsAsync(request.Symbol, cancellationToken);
                    await Task.WhenAll(spotTask, chainTask);
                    marketData = spotTask.Result;
                    optionChains = chainTask.Result;
                    if (optionChains?.data?.items != null)
                        _chainCache[request.Symbol] = (optionChains, today);
                }

                double spot = marketData?.Data?.Items?.FirstOrDefault()?.Mark ?? 0;
                if (spot <= 0)
                    spot = marketData?.Data?.Items?.FirstOrDefault()?.Last ?? 0;
                if (spot <= 0)
                    throw new Exception($"No se pudo obtener el precio spot de {request.Symbol}");

                var rawExpirations = optionChains?.data?.items?.SelectMany(i => i.expirations).ToList();
                if (rawExpirations == null || !rawExpirations.Any())
                    throw new OptionChainNotFoundException(request.Symbol,
                        $"{request.Symbol} no lista opciones.");

                // El DTE se recalcula acá y NO se toma del proveedor. Ver NormalizeExpirations.
                var allExpirations = NormalizeExpirations(rawExpirations);
                if (!allExpirations.Any())
                    throw new OptionChainNotFoundException(request.Symbol,
                        $"Todas las expiraciones de {request.Symbol} vencieron o traen fecha ilegible.");

                // Filtrar expiraciones. Por defecto (modo histórico): solo "Regular", DTE > 0.
                // La estrategia GEX pasa ExpirationTypes = [Regular, Weekly] e IncludeZeroDte = true.
                var allowedTypes = request.ExpirationTypes is { Length: > 0 }
                    ? request.ExpirationTypes
                    : new[] { "Regular" };
                int minDte = request.IncludeZeroDte ? 0 : 1;

                var candidateExpirations = allExpirations
                    .Where(e => allowedTypes.Contains(e.ExpirationType)
                             && e.DaysToExpiration >= minDte
                             && e.DaysToExpiration <= request.MaxDTE)
                    .ToList();

                if (!candidateExpirations.Any())
                    throw new OptionChainNotFoundException(request.Symbol,
                        $"{request.Symbol} no tiene vencimientos {string.Join("/", allowedTypes)} dentro de {request.MaxDTE} DTE.");

                // Modo histórico: la más cercana (el OrderByDescending + First original devolvía la de
                // MAYOR DTE dentro del rango; se conserva ese orden para no cambiar el comportamiento).
                // Modo global: todas, ordenadas por DTE ascendente.
                var expirations = request.AllExpirations
                    ? candidateExpirations.OrderBy(e => e.DaysToExpiration).ToList()
                    : new List<Expiration> { SelectSingleExpiration(candidateExpirations, request.TargetDte) };

                // La raíz de la respuesta describe la expiración de referencia: la única en modo
                // histórico, la más cercana en modo global (el agregado abarca todas las de ByExpiry).
                var headExpiration = expirations.First();
                response.Expiration = headExpiration.ExpirationDate;
                response.DTE = headExpiration.DaysToExpiration;
                response.ExpirationType = headExpiration.ExpirationType;

                // ═══════════════════════════════════════════════════════════
                // PASO 2: Armar lista de símbolos streamer para la suscripción
                // ═══════════════════════════════════════════════════════════
                var streamerSymbols = new List<string>();
                // streamerSym → (strike, C/P, expiración a la que pertenece)
                var strikeMap = new Dictionary<string, (double Strike, string Type, Expiration Exp)>();

                foreach (var expiration in expirations)
                {
                    foreach (var strike in expiration.strikes)
                    {
                        var strikePrice = double.Parse(strike.StrikePrice, CultureInfo.InvariantCulture);

                        // Call
                        if (!string.IsNullOrEmpty(strike.CallStreamerSymbol))
                        {
                            streamerSymbols.Add(strike.CallStreamerSymbol);
                            strikeMap[strike.CallStreamerSymbol] = (strikePrice, "C", expiration);
                        }

                        // Put
                        if (!string.IsNullOrEmpty(strike.PutStreamerSymbol))
                        {
                            streamerSymbols.Add(strike.PutStreamerSymbol);
                            strikeMap[strike.PutStreamerSymbol] = (strikePrice, "P", expiration);
                        }
                    }
                }

                // ═══════════════════════════════════════════════════════════
                // PASO 3: Greeks + OI vía la conexión DXLink persistente (sin sesión nueva).
                // Banda de |delta| 0.02–0.98 para pedir OI solo de strikes relevantes (gamma ≈ 0 afuera).
                // ═══════════════════════════════════════════════════════════
                var multiGreeks = await FetchGreeksAndOIAsync(
                    streamerSymbols.ToArray(),
                    candleDeltaMin: request.OiDeltaMin,
                    candleDeltaMax: request.OiDeltaMax,
                    cancellationToken,
                    greeksBatchSize: request.GreeksBatchSize,
                    greeksRetries: request.GreeksRetries
                );

                // Cobertura del snapshot: cuántos de los símbolos pedidos volvieron con Greeks.
                // Si no es total, el GEX está incompleto y hay que poder verlo.
                response.SymbolsRequested = multiGreeks.SymbolsRequested;
                response.SymbolsWithGreeks = multiGreeks.Greeks.Count;
                response.ExpirationsRequested = expirations.Count;

                // Cobertura del OI por lado: pedidos (en la banda de delta) contra recibidos.
                foreach (var sym in multiGreeks.OiRequested)
                {
                    if (!strikeMap.TryGetValue(sym, out var info)) continue;
                    bool received = multiGreeks.OpenInterest.ContainsKey(sym);
                    if (info.Item2 == "C") { response.CallOiRequested++; if (received) response.CallOiReceived++; }
                    else { response.PutOiRequested++; if (received) response.PutOiReceived++; }
                }

                response.Spot = spot;

                // Tasa libre de riesgo (default, podría mejorarse con FRED)
                double r = DEFAULT_RISK_FREE_RATE;
                response.RiskFreeRate = r;

                // ═══════════════════════════════════════════════════════════
                // PASO 4: GEX por strike usando Greeks de DXLink
                // Se acumula por (expiración → strike). En modo de una sola expiración hay un solo
                // grupo y el agregado final es idéntico al de siempre.
                // ═══════════════════════════════════════════════════════════
                var byExpiry = new Dictionary<string, Dictionary<double, GammaExposureStrike>>();

                foreach (var kvp in multiGreeks.Greeks)
                {
                    var streamerSym = kvp.Key;
                    var greeksData = kvp.Value;

                    if (!strikeMap.TryGetValue(streamerSym, out var info))
                        continue;

                    double strikePrice = info.Strike;
                    string optType = info.Type;
                    string expKey = info.Exp.ExpirationDate;

                    // IV y Greeks directamente de DXLink (tiempo real)
                    double iv = greeksData.Volatility;
                    if (iv <= 0 || double.IsNaN(iv)) continue;

                    double delta = greeksData.Delta;
                    double gamma = greeksData.Gamma;

                    // OI del candle diario más reciente con OI (hasta OiLookbackDays atrás). Clamp defensivo (ver SanitizeOpenInterest):
                    // un OI corrupto/cacheado no debe contribuir al GEX.
                    multiGreeks.OpenInterest.TryGetValue(streamerSym, out long oiRaw);
                    long oi = SanitizeOpenInterest(oiRaw);

                    // Cierre del período anterior (close del mismo candle diario)
                    double? prevClose = multiGreeks.PrevClose.TryGetValue(streamerSym, out double pc) ? pc : (double?)null;

                    // Inicializar expiración/strike si no existen
                    if (!byExpiry.TryGetValue(expKey, out var expStrikes))
                        byExpiry[expKey] = expStrikes = new Dictionary<double, GammaExposureStrike>();

                    if (!expStrikes.ContainsKey(strikePrice))
                        expStrikes[strikePrice] = new GammaExposureStrike { Strike = strikePrice };

                    var strikeResult = expStrikes[strikePrice];

                    // GEX = Gamma × OI × 100 (contratos) × Spot²
                    // Calls: dealer long gamma (positivo)
                    // Puts: dealer short gamma (negativo)
                    double gex = gamma * oi * 100 * spot * spot;

                    if (optType == "C")
                    {
                        strikeResult.CallStreamerSymbol = streamerSym;
                        strikeResult.CallDelta = Math.Round(delta, 5);
                        strikeResult.CallGamma = Math.Round(gamma, 7);
                        strikeResult.CallIV = Math.Round(iv, 4);
                        strikeResult.CallOI = oi;
                        strikeResult.CallGEX = Math.Round(gex / 1_000_000, 4);
                        strikeResult.CallPrevClose = prevClose.HasValue ? Math.Round(prevClose.Value, 2) : null;
                    }
                    else
                    {
                        strikeResult.PutStreamerSymbol = streamerSym;
                        strikeResult.PutDelta = Math.Round(delta, 5);
                        strikeResult.PutGamma = Math.Round(gamma, 7);
                        strikeResult.PutIV = Math.Round(iv, 4);
                        strikeResult.PutOI = oi;
                        strikeResult.PutGEX = Math.Round(-gex / 1_000_000, 4);
                        strikeResult.PutPrevClose = prevClose.HasValue ? Math.Round(prevClose.Value, 2) : null;
                    }
                }

                // ═══════════════════════════════════════════════════════════
                // PASO 5: Desglose por vencimiento + agregado global
                // ═══════════════════════════════════════════════════════════
                if (request.IncludeByExpiry)
                {
                    foreach (var exp in expirations)
                    {
                        if (!byExpiry.TryGetValue(exp.ExpirationDate, out var expStrikes) || expStrikes.Count == 0)
                            continue;

                        var strikes = expStrikes.Values.OrderBy(s => s.Strike).ToList();

                        // IV ATM del vencimiento: el strike más cercano al spot que tenga IV.
                        var atm = strikes
                            .Where(s => s.CallIV > 0 || s.PutIV > 0)
                            .OrderBy(s => Math.Abs(s.Strike - spot))
                            .FirstOrDefault();
                        double? atmIv = atm == null ? null
                            : (atm.CallIV > 0 && atm.PutIV > 0) ? (atm.CallIV + atm.PutIV) / 2
                            : (atm.CallIV > 0 ? atm.CallIV : atm.PutIV);

                        // El tiempo a vencimiento sale de CascadeUtils.YearsToExpiry, que para 0DTE usa
                        // el resto real de la rueda hasta el cierre ET en vez del entero de días — con
                        // el entero, sqrt(0) colapsaba el producto y el panel mostraba "±0.0 pts" justo
                        // en el vencimiento que la estrategia pone primero. Devuelve null si ya venció.
                        // MISMA FÓRMULA DUPLICADA en RpfTickHandler.BuildStrikeEngine — si esto cambia,
                        // cambia allá.
                        double? tYears = CascadeUtils.YearsToExpiry(exp.DaysToExpiration);
                        double? expectedMove = atmIv.HasValue && atmIv.Value > 0 && tYears.HasValue
                            ? Math.Round(spot * atmIv.Value * Math.Sqrt(tYears.Value), 2)
                            : null;

                        response.ByExpiry.Add(new GammaExposureExpiry
                        {
                            Expiration = exp.ExpirationDate,
                            DTE = exp.DaysToExpiration,
                            ExpirationType = exp.ExpirationType,
                            GammaZeroLevel = CalculateGammaZero(strikes, spot),
                            CallWall = SelectCallWall(strikes, spot),
                            PutWall = SelectPutWall(strikes, spot),
                            // La banda necesita el EM, así que va DESPUÉS de calcularlo. Es la única
                            // de estas métricas que depende de otra: por eso el argmax se podía
                            // calcular sobre el agregado y la banda no (61.1).
                            CallBand = SelectWallBand(strikes, spot, expectedMove, isCall: true,
                                                      request.WallBandWidthEm, request.WallBandMoneyZoneEm),
                            PutBand = SelectWallBand(strikes, spot, expectedMove, isCall: false,
                                                     request.WallBandWidthEm, request.WallBandMoneyZoneEm),
                            AtmIv = atmIv.HasValue ? Math.Round(atmIv.Value, 4) : null,
                            ExpectedMove = expectedMove,
                            Strikes = strikes,
                        });
                    }
                }

                // Agregado: un strike puede repetirse en varias expiraciones. GEX y OI se suman —
                // es la definición de GEX global. Delta/gamma/IV NO se suman (no tendría sentido):
                // se toman de la expiración más cercana que tenga ese strike, como referencia.
                response.Strikes = AggregateStrikes(expirations, byExpiry);

                // ═══════════════════════════════════════════════════════════
                // PASO 6: Calcular Gamma Zero, Call Wall y Put Wall
                // ═══════════════════════════════════════════════════════════
                response.GammaZeroLevel = CalculateGammaZero(response.Strikes, spot);

                // Muros del agregado. Misma definición que la de cada vencimiento — ver SelectCallWall.
                response.CallWall = SelectCallWall(response.Strikes, spot);
                response.PutWall = SelectPutWall(response.Strikes, spot);

                return response;
            }
            catch (OptionChainNotFoundException)
            {
                // Pasa derecho: envuelta en un Exception genérico pierde su tipo y vuelve a ser el
                // 500 que se quería evitar. El controller la mapea a 409 con su code.
                throw;
            }
            catch (Exception ex)
            {
                throw new Exception($"GammaExposureHandler Error: {ex.Message}");
            }
        }

        /// <summary>
        /// Colapsa los strikes de todas las expiraciones en una sola curva por strike (GEX global).
        /// GEX y OI se suman; delta, gamma, IV, streamer symbol y cierre previo se toman de la
        /// expiración más cercana que tenga ese strike — sumarlos no tendría significado.
        /// Con una sola expiración devuelve exactamente sus strikes.
        /// </summary>
        private static List<GammaExposureStrike> AggregateStrikes(
            List<Expiration> expirations,
            Dictionary<string, Dictionary<double, GammaExposureStrike>> byExpiry)
        {
            var aggregated = new Dictionary<double, GammaExposureStrike>();

            // De más cercana a más lejana: la primera que toca un strike fija sus greeks de referencia.
            foreach (var exp in expirations.OrderBy(e => e.DaysToExpiration))
            {
                if (!byExpiry.TryGetValue(exp.ExpirationDate, out var expStrikes)) continue;

                foreach (var src in expStrikes.Values)
                {
                    if (!aggregated.TryGetValue(src.Strike, out var acc))
                    {
                        // Copia: el objeto de la expiración se sigue publicando en ByExpiry y no debe mutarse.
                        aggregated[src.Strike] = new GammaExposureStrike
                        {
                            Strike = src.Strike,
                            CallStreamerSymbol = src.CallStreamerSymbol,
                            CallDelta = src.CallDelta,
                            CallGamma = src.CallGamma,
                            CallIV = src.CallIV,
                            CallOI = src.CallOI,
                            CallGEX = src.CallGEX,
                            CallPrevClose = src.CallPrevClose,
                            PutStreamerSymbol = src.PutStreamerSymbol,
                            PutDelta = src.PutDelta,
                            PutGamma = src.PutGamma,
                            PutIV = src.PutIV,
                            PutOI = src.PutOI,
                            PutGEX = src.PutGEX,
                            PutPrevClose = src.PutPrevClose,
                        };
                        continue;
                    }

                    acc.CallOI += src.CallOI;
                    acc.PutOI += src.PutOI;
                    acc.CallGEX = Math.Round(acc.CallGEX + src.CallGEX, 4);
                    acc.PutGEX = Math.Round(acc.PutGEX + src.PutGEX, 4);

                    // Greeks de referencia: si la expiración más cercana no tenía ese lado, se completa.
                    if (acc.CallDelta == 0 && src.CallDelta != 0)
                    {
                        acc.CallStreamerSymbol = src.CallStreamerSymbol;
                        acc.CallDelta = src.CallDelta;
                        acc.CallGamma = src.CallGamma;
                        acc.CallIV = src.CallIV;
                        acc.CallPrevClose = src.CallPrevClose;
                    }
                    if (acc.PutDelta == 0 && src.PutDelta != 0)
                    {
                        acc.PutStreamerSymbol = src.PutStreamerSymbol;
                        acc.PutDelta = src.PutDelta;
                        acc.PutGamma = src.PutGamma;
                        acc.PutIV = src.PutIV;
                        acc.PutPrevClose = src.PutPrevClose;
                    }
                }
            }

            return aggregated.Values.OrderBy(s => s.Strike).ToList();
        }

        /// <summary>
        /// Interpola el nivel donde Net GEX cruza de negativo a positivo.
        /// Si hay múltiples cruces, retorna el más cercano al spot (gamma flip relevante).
        /// </summary>
        private double? CalculateGammaZero(List<GammaExposureStrike> strikes, double spot)
        {
            if (strikes == null || strikes.Count < 2) return null;

            var crossings = new List<double>();

            for (int i = 0; i < strikes.Count - 1; i++)
            {
                var current = strikes[i];
                var next = strikes[i + 1];

                if (current.NetGEX < 0 && next.NetGEX >= 0)
                {
                    double range = next.NetGEX - current.NetGEX;
                    if (Math.Abs(range) < 0.0001) continue;

                    double ratio = -current.NetGEX / range;
                    double crossing = current.Strike + ratio * (next.Strike - current.Strike);
                    crossings.Add(Math.Round(crossing, 2));
                }
            }

            if (!crossings.Any()) return null;

            // El gamma flip relevante es el cruce más cercano al spot actual
            return crossings.OrderBy(c => Math.Abs(c - spot)).First();
        }

        //private static double ParseDoubleOrZero(string value)
        //{
        //    if (string.IsNullOrWhiteSpace(value) || value.Trim() == "NaN")
        //        return 0;
        //    return double.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out double result) ? result : 0;
        //}

        //private static long ParseLongOrZero(string value)
        //{
        //    if (string.IsNullOrWhiteSpace(value) || value.Trim() == "NaN")
        //        return 0;
        //    // OI puede venir como decimal (ej: "200.0")
        //    if (double.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out double dResult))
        //        return (long)dResult;
        //    return 0;
        //}
    }
}
