using System.Collections.Concurrent;
using System.Net.WebSockets;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Websocket.Client;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    public class DxLinkStreamingService : IHostedService, IDxLinkStreamingService, IDisposable
    {
        private readonly ITastytradeOAuth _auth;
        private readonly IMarketDataBroadcaster _broadcaster;
        private readonly ILogger<DxLinkStreamingService> _logger;

        private WebsocketClient? _socket;
        private readonly SemaphoreSlim _connectionLock = new(1, 1);
        private bool _isConnected;
        private bool _handshakeComplete;
        private CancellationTokenSource? _cts;

        // Suscripciones del socket actual (se disponen antes de tear down para que el disconnect
        // que provocamos nosotros al reconectar no dispare otro ciclo de reconexión).
        private IDisposable? _msgSub;
        private IDisposable? _disconnectSub;

        // Handshake synchronization
        private TaskCompletionSource<bool>? _authTcs;
        private TaskCompletionSource<bool>? _channelTcs;

        // ── Keepalive periódico ────────────────────────────────────────────────────────────────
        // El SETUP declara keepaliveTimeout=60: eso es una PROMESA de hablarle al servidor al menos
        // cada 60s, no una preferencia. Hasta 2026-08-10 el único KEEPALIVE que se mandaba era
        // REACTIVO (responder cuando el server preguntaba), así que en silencio el server cerraba la
        // sesión y el socket entraba en ciclo: Lost → reconexión → handshake → Lost.
        // El daño no era solo perder el feed: ConnectAsync retiene _connectionLock durante todo el
        // teardown + OAuth + handshake, y quien esperara ese lock quedaba encolado detrás de
        // reconexiones que no paraban. Como ese WaitAsync no toma token, era una espera INCANCELABLE
        // — así se colgaba el tick de RpfLoopService, sin log y sin que ningún timeout lo rescatara.
        // Se manda a la mitad del timeout declarado: margen para no depender de la precisión del
        // timer ni de la latencia de red.
        private const int KEEPALIVE_INTERVAL_SECONDS = 30;
        private CancellationTokenSource? _keepaliveCts;

        // Reference counting: (symbol, eventType) -> cantidad de suscriptores
        private readonly ConcurrentDictionary<(string Symbol, string EventType), int> _subscriptions = new();
        private readonly object _subLock = new();

        // Pending subscriptions queued before handshake completes
        private readonly ConcurrentQueue<List<object>> _pendingSubscriptions = new();

        // Collectors activos para requests de snapshot (request/response sobre la conexión persistente)
        private readonly ConcurrentDictionary<Guid, SnapshotCollector> _collectors = new();

        // Último evento de cada (símbolo, tipo) suscripto. DXLink manda el evento inicial sólo al
        // suscribir: si el Monitor ya tenía la pata suscripta, un snapshot no recibía nada hasta el
        // próximo cambio, y los Greeks de una opción quieta no cambian en segundos — el pedido
        // agotaba su timeout sin griegas (WS-0036, /Account/Spreads). Se entrega este último valor
        // sólo si la suscripción ya estaba viva, y se borra cuando su ref-count llega a cero.
        private readonly ConcurrentDictionary<(string Symbol, string EventType), JObject> _lastEvents = new();

        // Reference-count de suscripciones Candle por símbolo (con la fromTime más vieja pedida).
        // Evita que un snapshot que termina desuscriba un Candle que otro request concurrente aún
        // necesita (ej. IVRank y MarketDataCandle pidiendo "SPY{=1d}" a la vez → el remove de uno
        // mataba el snapshot del otro → timeout de 30s).
        private readonly Dictionary<string, (int Count, long FromTime)> _candleSubs = new();
        private readonly object _candleLock = new();

        // Un snapshot de Candle a la vez por símbolo. Dos pedidos simultáneos del mismo símbolo compartían
        // la suscripción (el segundo no recibe un snapshot propio) y el colector, que filtra por símbolo sin
        // agregación: cada uno se quedaba con un pedazo del otro (WS-0047: 3 años de velas cortados al 27/05).
        private readonly ConcurrentDictionary<string, SemaphoreSlim> _candleSnapshotGates = new();

        // ── Throttle de FEED_SUBSCRIPTION (add) ────────────────────────────────────────────────
        // DXLink limita la CANTIDAD de items por suscripción y la VELOCIDAD a la que se mandan; al
        // pasarse responde BAD_ACTION ("subscription size too big" / "subscription rate is too
        // high") y, como el canal 3 es compartido por Trade/Quote/Greeks/Candle, ese rechazo degrada
        // el feed entero: dejan de llegar trades y el barrido de la cadena vuelve vacío.
        // Todos los `add` Y los `remove` pasan por SendSubscriptionChunkedAsync: se parten en chunks
        // y se espacian, serializados por el semáforo para que dos llamadores concurrentes no sumen
        // sus ráfagas. Los `remove` se throttlean también: el barrido de la cadena desuscribe tandas
        // enteras al terminar cada lote, y esas ráfagas cuentan para el mismo cupo (con los `remove`
        // sin throttle el BAD_ACTION seguía apareciendo justo después de cada desuscripción masiva).
        private const int SUB_CHUNK_SIZE = 50;
        private const int SUB_CHUNK_DELAY_MS = 500;
        private readonly SemaphoreSlim _subSendLock = new(1, 1);

        public DxLinkStreamingService(
            ITastytradeOAuth auth,
            IMarketDataBroadcaster broadcaster,
            ILogger<DxLinkStreamingService> logger)
        {
            _auth = auth;
            _broadcaster = broadcaster;
            _logger = logger;
        }

        public async Task StartAsync(CancellationToken cancellationToken)
        {
            _cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            _logger.LogInformation("DxLinkStreamingService iniciando...");
            await ConnectAsync();
        }

        public async Task StopAsync(CancellationToken cancellationToken)
        {
            _logger.LogInformation("DxLinkStreamingService deteniendo...");
            _cts?.Cancel();

            await TearDownSocketAsync();

            _isConnected = false;
            _handshakeComplete = false;
        }

        public void Dispose()
        {
            StopKeepaliveLoop();
            _socket?.Dispose();
            _connectionLock.Dispose();
            _cts?.Dispose();
        }

        #region Conexión y handshake

        private async Task ConnectAsync()
        {
            await _connectionLock.WaitAsync();
            try
            {
                if (_isConnected && _handshakeComplete) return;

                // Tear down limpio del socket anterior ANTES de crear uno nuevo. Esto cierra la sesión
                // server-side (evita acumular sesiones zombie que saturan el límite) y libera el canal 3,
                // evitando el BAD_ACTION "Channel with id 3 already exists" al reconectar.
                await TearDownSocketAsync();

                var authws = await _auth.GetWsOAuthApiAsync();
                var token = authws.Data.Token;
                var url = new Uri(authws.Data.DxlinkUrl);

                var socket = new WebsocketClient(url)
                {
                    // Reconexión controlada por nosotros (vía DisconnectionHappened). Desactivamos la
                    // reconexión automática del cliente para no tener DOS caminos compitiendo, que era
                    // la causa del reconnect spiral (re-handshake sobre un canal ya abierto).
                    IsReconnectionEnabled = false
                };

                _disconnectSub = socket.DisconnectionHappened.Subscribe(info =>
                {
                    // Se loguea TODO lo que trae DisconnectionInfo, no solo Type y CloseStatus.
                    //
                    // Hasta 2026-08-10 esta línea imprimía solo esos dos, y como los `Lost` vienen sin
                    // close frame el resultado era siempre "Lost - (null)". Durante toda una sesión de
                    // diagnóstico esos cortes se anotaron como "sin causa identificada" — pero la causa
                    // no faltaba, la estábamos descartando antes de mirarla: Exception y
                    // CloseStatusDescription ya venían en el evento y nadie los leía.
                    //
                    // Type=Lost + CloseStatus=null significa algo preciso: la conexión murió SIN
                    // handshake de cierre, o sea que se cayó el TCP en vez de que el server cerrara
                    // ordenadamente. Exception es la única pista de por qué.
                    _logger.LogWarning(info.Exception,
                        "DxLink desconectado: Type={Type} CloseStatus={CloseStatus} Desc={Desc} SubProtocol={SubProtocol}",
                        info.Type, info.CloseStatus, info.CloseStatusDescription, info.SubProtocol);
                    _isConnected = false;
                    _handshakeComplete = false;

                    if (_cts is { IsCancellationRequested: false })
                    {
                        _ = ReconnectWithDelayAsync();
                    }
                });

                _msgSub = socket.MessageReceived.Subscribe(OnMessageReceived);

                _socket = socket;
                await socket.Start();
                _isConnected = true;

                await DoHandshakeAsync(token);

                // Re-suscribir las suscripciones activas (tras cualquier reconexión).
                await ResubscribeActiveAsync();

                // Recién con el canal abierto: antes del handshake el Send sería un no-op.
                StartKeepaliveLoop();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error conectando a DxLink");
                _isConnected = false;
                _handshakeComplete = false;

                if (_cts is { IsCancellationRequested: false })
                {
                    _ = ReconnectWithDelayAsync();
                }
            }
            finally
            {
                _connectionLock.Release();
            }
        }

        /// <summary>
        /// Cierra y descarta el socket actual de forma limpia, desuscribiendo primero sus handlers
        /// para que el disconnect que provocamos no dispare otro ciclo de reconexión.
        /// </summary>
        private async Task TearDownSocketAsync()
        {
            // Antes que nada: cortar el keepalive del socket que se va. Si no, cada reconexión
            // dejaría un loop huérfano y se irían acumulando, latiendo todos sobre el socket nuevo.
            StopKeepaliveLoop();

            _msgSub?.Dispose(); _msgSub = null;
            _disconnectSub?.Dispose(); _disconnectSub = null;

            if (_socket != null)
            {
                try { await _socket.Stop(WebSocketCloseStatus.NormalClosure, "reconnect"); } catch { }
                _socket.Dispose();
                _socket = null;
            }
        }

        /// <summary>
        /// Late periódico mientras el socket viva, para cumplir el keepaliveTimeout declarado en el
        /// SETUP. Exactamente uno por socket: se arranca al completar el handshake y se corta en
        /// TearDownSocketAsync.
        /// </summary>
        private void StartKeepaliveLoop()
        {
            StopKeepaliveLoop();

            var cts = CancellationTokenSource.CreateLinkedTokenSource(_cts?.Token ?? CancellationToken.None);
            _keepaliveCts = cts;

            _ = Task.Run(async () =>
            {
                using var timer = new PeriodicTimer(TimeSpan.FromSeconds(KEEPALIVE_INTERVAL_SECONDS));
                try
                {
                    while (await timer.WaitForNextTickAsync(cts.Token))
                    {
                        if (!_isConnected || !_handshakeComplete) continue;

                        // El try va DENTRO del while: un fallo puntual de envío no puede dejar al
                        // socket sin latido para siempre — eso reabriría el mismo agujero.
                        try { Send(new { type = "KEEPALIVE", channel = 0 }); }
                        catch (Exception ex) { _logger.LogWarning(ex, "DxLink: fallo enviando KEEPALIVE"); }
                    }
                }
                catch (OperationCanceledException) { /* tear down normal */ }
            }, cts.Token);
        }

        private void StopKeepaliveLoop()
        {
            var cts = _keepaliveCts;
            _keepaliveCts = null;
            if (cts == null) return;

            try { cts.Cancel(); } catch { }
            cts.Dispose();
        }

        /// <summary>Re-envía las suscripciones activas (reference count &gt; 0) tras una reconexión.</summary>
        private async Task ResubscribeActiveAsync()
        {
            var activeSubs = _subscriptions
                .Where(kv => kv.Value > 0)
                .Select(kv => (object)new { type = kv.Key.EventType, symbol = kv.Key.Symbol })
                .ToList();

            if (activeSubs.Count > 0)
            {
                // Throttleado: reenviar toda la cadena de golpe era la ráfaga más grande de todas.
                await SendSubscriptionChunkedAsync(activeSubs);
                _logger.LogInformation("Re-suscripción de {Count} feeds tras reconexión", activeSubs.Count);
            }
        }

        private async Task DoHandshakeAsync(string token)
        {
            _handshakeComplete = false;
            _authTcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            _channelTcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

            // Step 1: SETUP
            Send(new { type = "SETUP", channel = 0, version = "0.1-DXF-JS/0.3.0", keepaliveTimeout = 60, acceptKeepaliveTimeout = 60 });

            // Step 2: AUTH — send and wait for AUTH_STATE: AUTHORIZED
            Send(new { type = "AUTH", channel = 0, token });
            _logger.LogInformation("DxLink: esperando AUTH_STATE AUTHORIZED...");

            if (await Task.WhenAny(_authTcs.Task, Task.Delay(10000)) != _authTcs.Task)
            {
                _logger.LogError("DxLink: timeout esperando AUTH — reintentando conexión");
                throw new TimeoutException("DxLink AUTH timeout");
            }
            _logger.LogInformation("DxLink: AUTH OK");

            // Step 3: CHANNEL_REQUEST — wait for CHANNEL_OPENED
            Send(new { type = "CHANNEL_REQUEST", channel = 3, service = "FEED", parameters = new { contract = "AUTO" } });
            _logger.LogInformation("DxLink: esperando CHANNEL_OPENED...");

            if (await Task.WhenAny(_channelTcs.Task, Task.Delay(10000)) != _channelTcs.Task)
            {
                _logger.LogError("DxLink: timeout esperando CHANNEL_OPENED — reintentando conexión");
                throw new TimeoutException("DxLink CHANNEL_OPENED timeout");
            }
            _logger.LogInformation("DxLink: CHANNEL OK");

            // Step 4: FEED_SETUP
            Send(DxLinkHandshake.FeedSetup);

            _handshakeComplete = true;
            _logger.LogInformation("DxLink handshake completo — listo para suscripciones");

            // Flush any subscriptions queued during handshake
            await FlushPendingSubscriptionsAsync();
        }

        private async Task ReconnectWithDelayAsync()
        {
            _logger.LogInformation("Reintentando conexión DxLink en 5 segundos...");
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(5), _cts!.Token);
                await ConnectAsync();
            }
            catch (OperationCanceledException)
            {
                // Servicio detenido, no reintentar
            }
        }


        private async Task FlushPendingSubscriptionsAsync()
        {
            while (_pendingSubscriptions.TryDequeue(out var toAdd))
            {
                await SendSubscriptionChunkedAsync(toAdd);
                _logger.LogInformation("FEED_SUBSCRIPTION pendiente enviado ({Count} items)", toAdd.Count);
            }
        }

        #endregion

        #region Suscripciones con reference counting

        public async Task SubscribeAsync(string symbol, string[] eventTypes)
        {
            await EnsureConnectedAsync();

            var toAdd = new List<object>();

            lock (_subLock)
            {
                foreach (var eventType in eventTypes)
                {
                    var key = (symbol, eventType);
                    var currentCount = _subscriptions.GetOrAdd(key, 0);
                    _subscriptions[key] = currentCount + 1;

                    if (currentCount == 0)
                    {
                        toAdd.Add(new { type = eventType, symbol });
                    }
                }
            }

            if (toAdd.Count > 0)
            {
                if (_handshakeComplete)
                {
                    await SendSubscriptionChunkedAsync(toAdd);
                    _logger.LogInformation("FEED_SUBSCRIPTION enviado: {Symbol} -> [{EventTypes}]",
                        symbol, string.Join(", ", eventTypes));
                }
                else
                {
                    _pendingSubscriptions.Enqueue(toAdd);
                    _logger.LogInformation("FEED_SUBSCRIPTION encolado (handshake pendiente): {Symbol}", symbol);
                }
            }
        }

        public async Task UnsubscribeAsync(string symbol, string[] eventTypes)
        {
            var toRemove = new List<object>();

            lock (_subLock)
            {
                foreach (var eventType in eventTypes)
                {
                    var key = (symbol, eventType);
                    if (!_subscriptions.TryGetValue(key, out var currentCount) || currentCount <= 0)
                        continue;

                    var newCount = currentCount - 1;
                    _subscriptions[key] = newCount;

                    if (newCount == 0)
                    {
                        toRemove.Add(new { type = eventType, symbol });
                        _subscriptions.TryRemove(key, out _);
                    }
                }
            }

            if (toRemove.Count > 0 && _handshakeComplete)
            {
                await SendSubscriptionChunkedAsync(toRemove, remove: true);

                _logger.LogInformation("Desuscripción DxLink: {Symbol} -> [{EventTypes}]",
                    symbol, string.Join(", ", eventTypes));
            }
        }

        public async Task SubscribeBatchAsync(IEnumerable<string> symbols, string[] eventTypes)
        {
            await EnsureConnectedAsync();

            var toAdd = new List<object>();

            lock (_subLock)
            {
                foreach (var symbol in symbols)
                {
                    foreach (var eventType in eventTypes)
                    {
                        var key = (symbol, eventType);
                        var currentCount = _subscriptions.GetOrAdd(key, 0);
                        _subscriptions[key] = currentCount + 1;

                        if (currentCount == 0)
                        {
                            toAdd.Add(new { type = eventType, symbol });
                        }
                    }
                }
            }

            if (toAdd.Count > 0)
            {
                if (_handshakeComplete)
                {
                    await SendSubscriptionChunkedAsync(toAdd);
                    _logger.LogInformation("FEED_SUBSCRIPTION batch enviado: {Count} items", toAdd.Count);
                }
                else
                {
                    _pendingSubscriptions.Enqueue(toAdd);
                    _logger.LogInformation("FEED_SUBSCRIPTION batch encolado (handshake pendiente): {Count} items", toAdd.Count);
                }
            }
        }

        public async Task UnsubscribeBatchAsync(IEnumerable<string> symbols, string[] eventTypes)
        {
            var toRemove = new List<object>();

            lock (_subLock)
            {
                foreach (var symbol in symbols)
                {
                    foreach (var eventType in eventTypes)
                    {
                        var key = (symbol, eventType);
                        if (!_subscriptions.TryGetValue(key, out var currentCount) || currentCount <= 0)
                            continue;

                        var newCount = currentCount - 1;
                        _subscriptions[key] = newCount;

                        if (newCount == 0)
                        {
                            toRemove.Add(new { type = eventType, symbol });
                            _subscriptions.TryRemove(key, out _);
                            _lastEvents.TryRemove(key, out _);
                        }
                    }
                }
            }

            if (toRemove.Count > 0 && _handshakeComplete)
            {
                await SendSubscriptionChunkedAsync(toRemove, remove: true);
                _logger.LogInformation("Desuscripción batch DxLink: {Count} items", toRemove.Count);
            }
        }

        private async Task EnsureConnectedAsync()
        {
            if (!_isConnected || !_handshakeComplete)
            {
                await ConnectAsync();
            }
        }

        #endregion

        #region Procesamiento de mensajes

        private void OnMessageReceived(ResponseMessage message)
        {
            try
            {
                if (string.IsNullOrEmpty(message.Text)) return;

                var json = JObject.Parse(message.Text);
                var type = json["type"]?.ToString();

                switch (type)
                {
                    case "KEEPALIVE":
                        Send(new { type = "KEEPALIVE", channel = 0 });
                        return;

                    case "FEED_DATA":
                        _ = ProcessFeedDataAsync(json);
                        return;

                    case "AUTH_STATE":
                        var state = json["state"]?.ToString();
                        _logger.LogInformation("DxLink AUTH_STATE: {State}", state);
                        if (state == "AUTHORIZED")
                            _authTcs?.TrySetResult(true);
                        return;

                    case "CHANNEL_OPENED":
                        var ch = json["channel"]?.Value<int>() ?? 0;
                        _logger.LogInformation("DxLink CHANNEL_OPENED: channel={Channel}", ch);
                        if (ch == 3)
                            _channelTcs?.TrySetResult(true);
                        return;

                    case "ERROR":
                        _logger.LogError("DxLink ERROR: {Message}", message.Text);
                        return;

                    case "FEED_CONFIG":
                        // Qué campos aceptó DXLink de verdad para el Quote (BL-013): si no lista
                        // bidTime/askTime, el feed no los da y no hay hora que mapear.
                        _logger.LogInformation("DxLink FEED_CONFIG Quote: {Fields}",
                            json["eventFields"]?["Quote"]?.ToString(Newtonsoft.Json.Formatting.None) ?? "(sin eventFields)");
                        return;

                    default:
                        _logger.LogInformation("DxLink msg: {Type}", type);
                        return;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error procesando mensaje DxLink");
            }
        }

        private async Task ProcessFeedDataAsync(JObject json)
        {
            try
            {
                var dataArray = json["data"] as JArray;
                if (dataArray == null) return;

                foreach (var item in dataArray)
                {
                    var eventType = item["eventType"]?.ToString();
                    var eventSymbol = item["eventSymbol"]?.ToString();

                    if (string.IsNullOrEmpty(eventType) || string.IsNullOrEmpty(eventSymbol))
                        continue;

                    if (eventType != "Candle" && item is JObject last)
                        _lastEvents[(eventSymbol, eventType)] = last;

                    // Fan-out a collectors de snapshot (request/response). Incluye Candle, que no se broadcastea.
                    if (!_collectors.IsEmpty && item is JObject jitem)
                    {
                        foreach (var collector in _collectors.Values)
                            collector.Offer(eventType, eventSymbol, jitem);
                    }

                    switch (eventType)
                    {
                        case "Trade":
                            var trade = item.ToObject<TradeEvent>();
                            if (trade != null)
                                await _broadcaster.BroadcastTradeAsync(eventSymbol, trade);
                            break;

                        case "Quote":
                            var quote = item.ToObject<QuoteEvent>();
                            if (quote != null)
                                await _broadcaster.BroadcastQuoteAsync(eventSymbol, quote);
                            break;

                        case "Greeks":
                            var greeks = item.ToObject<GreeksEvent>();
                            if (greeks != null)
                                await _broadcaster.BroadcastGreeksAsync(eventSymbol, greeks);
                            break;
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error procesando FEED_DATA");
            }
        }

        #endregion

        #region Snapshot (request/response sobre la conexión persistente)

        public async Task<IReadOnlyList<JObject>> RequestSnapshotAsync(
            IReadOnlyList<(string Symbol, string EventType, long? FromTime)> subs,
            Func<JObject, bool> isSymbolComplete,
            TimeSpan timeout,
            CancellationToken cancellationToken)
        {
            if (subs == null || subs.Count == 0)
                return Array.Empty<JObject>();

            await EnsureConnectedAsync();

            var gates = subs.Where(s => s.EventType == "Candle")
                            .Select(s => SnapshotCollector.Normalize(s.Symbol))
                            .Distinct().OrderBy(s => s, StringComparer.Ordinal)
                            .Select(s => _candleSnapshotGates.GetOrAdd(s, _ => new SemaphoreSlim(1, 1)))
                            .ToList();
            var held = new List<SemaphoreSlim>();
            try
            {
                foreach (var g in gates) { await g.WaitAsync(cancellationToken); held.Add(g); }
                return await RequestSnapshotCoreAsync(subs, isSymbolComplete, timeout, cancellationToken);
            }
            finally
            {
                foreach (var g in held) g.Release();
            }
        }

        private async Task<IReadOnlyList<JObject>> RequestSnapshotCoreAsync(
            IReadOnlyList<(string Symbol, string EventType, long? FromTime)> subs,
            Func<JObject, bool> isSymbolComplete,
            TimeSpan timeout,
            CancellationToken cancellationToken)
        {
            var interest = subs.Select(s => (s.Symbol, s.EventType));
            var collector = new SnapshotCollector(interest, isSymbolComplete);
            var id = Guid.NewGuid();
            _collectors[id] = collector;

            // Candle: suscripción directa (con fromTime). El Monitor no usa Candle, así que no colisiona.
            // Otros event types (Greeks/Quote/Trade): por el reference-counting, para NO pisar las
            // suscripciones persistentes del Monitor al desuscribir al terminar el snapshot.
            var candleSubs = subs.Where(s => s.EventType == "Candle").ToList();
            var refCountGroups = subs.Where(s => s.EventType != "Candle")
                                     .GroupBy(s => s.EventType)
                                     .ToList();
            // Suscripciones que ya estaban vivas antes de este pedido: no van a mandar evento inicial.
            var alreadyLive = subs.Where(s => s.EventType != "Candle"
                                              && _subscriptions.TryGetValue((s.Symbol, s.EventType), out var c) && c > 0)
                                  .ToList();
            try
            {
                foreach (var grp in refCountGroups)
                    await SubscribeBatchAsync(grp.Select(s => s.Symbol), new[] { grp.Key });

                foreach (var s in alreadyLive)
                    if (_lastEvents.TryGetValue((s.Symbol, s.EventType), out var cached))
                        collector.Offer(s.EventType, s.Symbol, cached);

                foreach (var s in candleSubs)
                    await CandleSubscribeAsync(s.Symbol, s.FromTime ?? 0);

                await Task.WhenAny(collector.Done.Task, Task.Delay(timeout, cancellationToken));
                return collector.Items;
            }
            finally
            {
                foreach (var grp in refCountGroups)
                    await UnsubscribeBatchAsync(grp.Select(s => s.Symbol), new[] { grp.Key });

                foreach (var s in candleSubs)
                    await CandleUnsubscribeAsync(s.Symbol);

                _collectors.TryRemove(id, out _);
            }
        }

        /// <summary>
        /// Acumula eventos de un request de snapshot. Acepta items cuyo (eventSymbol, eventType) está
        /// en su set de interés y marca un símbolo como completo cuando <c>isSymbolComplete</c> da true.
        /// </summary>
        private sealed class SnapshotCollector
        {
            private readonly HashSet<(string, string)> _interest;
            private readonly HashSet<(string, string)> _pending;
            private readonly Func<JObject, bool> _isSymbolComplete;
            private readonly List<JObject> _items = new();
            private readonly object _lock = new();

            public TaskCompletionSource<bool> Done { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

            public SnapshotCollector(IEnumerable<(string Symbol, string EventType)> interest, Func<JObject, bool> isSymbolComplete)
            {
                // Normalizar el símbolo (quitar sufijo de agregación {=...}): dxFeed devuelve los
                // Candle con el sufijo normalizado (ej. se pide "SPY{=1d}" pero llega "SPY{=d}").
                _interest = new HashSet<(string, string)>(interest.Select(i => (Normalize(i.Symbol), i.EventType)));
                _pending = new HashSet<(string, string)>(_interest);
                _isSymbolComplete = isSymbolComplete;
            }

            public static string Normalize(string symbol)
            {
                var idx = symbol.IndexOf("{=", StringComparison.Ordinal);
                return idx >= 0 ? symbol.Substring(0, idx) : symbol;
            }

            public void Offer(string eventType, string eventSymbol, JObject item)
            {
                var key = (Normalize(eventSymbol), eventType);
                if (!_interest.Contains(key)) return;

                lock (_lock)
                {
                    _items.Add(item);
                    if (_pending.Contains(key) && _isSymbolComplete(item))
                    {
                        _pending.Remove(key);
                        if (_pending.Count == 0)
                            Done.TrySetResult(true);
                    }
                }
            }

            public IReadOnlyList<JObject> Items
            {
                get { lock (_lock) return _items.ToList(); }
            }
        }

        #endregion

        #region Candle ref-counting

        /// <summary>
        /// Suscribe Candle con reference-count por símbolo. Solo envía add cuando es el primer
        /// suscriptor, o cuando un suscriptor nuevo necesita una fromTime más vieja (re-snapshot).
        /// </summary>
        private async Task CandleSubscribeAsync(string symbol, long fromTime)
        {
            bool sendAdd; long effectiveFrom;
            lock (_candleLock)
            {
                if (_candleSubs.TryGetValue(symbol, out var e))
                {
                    var olderFrom = Math.Min(e.FromTime, fromTime); // unix ms: más viejo = menor
                    sendAdd = olderFrom < e.FromTime;               // ampliar la ventana si hace falta
                    _candleSubs[symbol] = (e.Count + 1, olderFrom);
                    effectiveFrom = olderFrom;
                }
                else
                {
                    _candleSubs[symbol] = (1, fromTime);
                    sendAdd = true;
                    effectiveFrom = fromTime;
                }
            }

            if (sendAdd)
                await SendSubscriptionChunkedAsync(
                    new List<object> { new { type = "Candle", symbol, fromTime = effectiveFrom } });
        }

        /// <summary>Desuscribe Candle; solo envía remove cuando el ref-count llega a 0.</summary>
        private async Task CandleUnsubscribeAsync(string symbol)
        {
            bool sendRemove = false;
            lock (_candleLock)
            {
                if (_candleSubs.TryGetValue(symbol, out var e))
                {
                    if (e.Count <= 1) { _candleSubs.Remove(symbol); sendRemove = true; }
                    else _candleSubs[symbol] = (e.Count - 1, e.FromTime);
                }
            }

            if (sendRemove)
                await SendSubscriptionChunkedAsync(
                    new List<object> { new { type = "Candle", symbol } }, remove: true);
        }

        #endregion

        #region Helpers

        private void Send(object msg)
        {
            if (_socket is { IsRunning: true })
            {
                var json = JsonConvert.SerializeObject(msg);
                _socket.Send(json);
            }
        }

        /// <summary>
        /// Envía un FEED_SUBSCRIPTION respetando los límites de DXLink: parte la lista en chunks de
        /// <see cref="SUB_CHUNK_SIZE"/> y espera <see cref="SUB_CHUNK_DELAY_MS"/> entre envíos. El
        /// semáforo serializa a los llamadores concurrentes (barrido de la cadena, legs del Monitor,
        /// replay de reconexión), que es lo que hacía picos de rate al sumarse.
        /// </summary>
        /// <param name="items">Símbolos a suscribir o desuscribir.</param>
        /// <param name="remove">false → va como `add`; true → como `remove`.</param>
        private async Task SendSubscriptionChunkedAsync(List<object> items, bool remove = false)
        {
            if (items == null || items.Count == 0) return;

            await _subSendLock.WaitAsync();
            try
            {
                for (int i = 0; i < items.Count; i += SUB_CHUNK_SIZE)
                {
                    if (_cts is { IsCancellationRequested: true }) return;

                    var chunk = items.GetRange(i, Math.Min(SUB_CHUNK_SIZE, items.Count - i));
                    Send(remove
                        ? new { type = "FEED_SUBSCRIPTION", channel = 3, remove = chunk }
                        : (object)new { type = "FEED_SUBSCRIPTION", channel = 3, add = chunk });

                    // Espaciar solo ENTRE chunks: el último no necesita cola de espera.
                    if (i + SUB_CHUNK_SIZE < items.Count)
                        await Task.Delay(SUB_CHUNK_DELAY_MS);
                }
            }
            finally
            {
                _subSendLock.Release();
            }
        }

        #endregion
    }
}
