using System.Text.Json.Nodes;
using DataFeed.Application.App.Rpf;
using DataFeed.Infrastructure.Providers.Tastytrade;
using Microsoft.AspNetCore.SignalR;

namespace DataFeed.Api.Hubs
{
    /// <summary>
    /// Hub SignalR para streaming de datos de mercado en tiempo real.
    /// Los clientes se suscriben a simbolos y reciben Trade, Quote, Greeks y Flow en tiempo real.
    /// </summary>
    [Microsoft.AspNetCore.Authorization.Authorize(Policy = "HubAccess")]
    public class MarketDataHub : Hub
    {
        private readonly IDxLinkStreamingService _streaming;
        private readonly RpfStateStore _rpfStore;
        private readonly IWebHostEnvironment _env;
        private readonly ILogger<MarketDataHub> _logger;

        // Tipos de evento soportados para streaming
        private static readonly string[] DefaultEventTypes = ["Trade", "Quote"];
        private static readonly string[] OptionEventTypes = ["Trade", "Quote", "Greeks"];

        private readonly IConfiguration _config;

        public MarketDataHub(
            IDxLinkStreamingService streaming,
            RpfStateStore rpfStore,
            IWebHostEnvironment env,
            IConfiguration config,
            ILogger<MarketDataHub> logger)
        {
            _streaming = streaming;
            _rpfStore = rpfStore;
            _env = env;
            _config = config;
            _logger = logger;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Autenticación
        // ═══════════════════════════════════════════════════════════════════════

        /// <summary>
        /// Estado de la autenticación del hub, en una sola línea por conexión.
        ///
        /// CONTEXTO (2026-08-11): hasta hoy el hub NO tenía autenticación de ningún tipo — está
        /// exento de ApiKeyMiddleware junto con /swagger y /mcp. Cualquiera que alcance la API puede
        /// conectarse y recibir precios, el estado de RPF y sus sugerencias de trade. NO viajan
        /// datos de cuenta por acá (balances y posiciones van por REST), así que el alcance del
        /// agujero es el feed y la estrategia, no la plata. En local es inocuo; contra Azure no.
        ///
        /// El servidor ya sabe validar el JWT que venga por ?access_token (ver OnMessageReceived en
        /// Program.cs). Lo que falta para poder EXIGIRLO es del lado del tablero: todavía entra con
        /// una Access Key y no tiene login de Supabase, así que no tiene ningún token que mandar.
        /// Exigirlo hoy dejaría el tablero sin datos en vivo.
        ///
        /// Por eso el interruptor: `Supabase:RequireAuthOnHub` arranca en false y se prende el día
        /// que el front tenga login. Mientras tanto cada conexión anónima queda registrada, para que
        /// el agujero sea visible en el log y no una nota en un documento.
        /// </summary>
        public override async Task OnConnectedAsync()
        {
            var user = Context.User;
            var authenticated = user?.Identity?.IsAuthenticated == true;

            // Acá NO se rechaza nada: de eso se encarga la política "HubAccess", que corta en el
            // negotiate antes de que la conexión exista. Esto solo deja registro de quién entró.
            if (authenticated)
            {
                var sub = user!.FindFirst("sub")?.Value
                       ?? user.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
                _logger.LogInformation("Hub: conexión autenticada, usuario {UserId} ({ConnectionId})",
                    sub, Context.ConnectionId);
            }
            else
            {
                _logger.LogInformation(
                    "Hub: conexión ANÓNIMA ({ConnectionId}). El hub no exige autenticación todavía " +
                    "(Supabase:RequireAuthOnHub=false) porque el tablero aún no tiene login de Supabase.",
                    Context.ConnectionId);
            }

            await base.OnConnectedAsync();
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Suscripciones de precio (existentes)
        // ═══════════════════════════════════════════════════════════════════════

        /// <summary>
        /// Cliente se suscribe a un simbolo. Si includeGreeks=true, tambien recibe Greeks (para opciones).
        /// </summary>
        public async Task Subscribe(string symbol, bool includeGreeks = false)
        {
            var eventTypes = includeGreeks ? OptionEventTypes : DefaultEventTypes;

            // Agregar al grupo del simbolo para recibir broadcasts
            await Groups.AddToGroupAsync(Context.ConnectionId, symbol);

            // Registrar suscripcion en DxLink
            await _streaming.SubscribeAsync(symbol, eventTypes);

            _logger.LogInformation("Cliente {ConnectionId} suscripto a {Symbol} (Greeks: {IncludeGreeks})",
                Context.ConnectionId, symbol, includeGreeks);
        }

        /// <summary>
        /// Cliente se desuscribe de un simbolo.
        /// </summary>
        public async Task Unsubscribe(string symbol, bool includeGreeks = false)
        {
            var eventTypes = includeGreeks ? OptionEventTypes : DefaultEventTypes;

            await Groups.RemoveFromGroupAsync(Context.ConnectionId, symbol);
            await _streaming.UnsubscribeAsync(symbol, eventTypes);

            _logger.LogInformation("Cliente {ConnectionId} desuscripto de {Symbol}",
                Context.ConnectionId, symbol);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Orquestación RPF (Fase 6a) — tablero + ack del operador
        // ═══════════════════════════════════════════════════════════════════════

        /// <summary>
        /// Cliente (tablero) se suscribe al estado del loop RPF. Al unirse recibe un snapshot del
        /// estado actual de cada símbolo trackeado (ReceiveRpfState) para pintar el cockpit sin esperar
        /// el próximo tick.
        /// </summary>
        public async Task SubscribeRpf()
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, "rpf");

            var now = DateTime.UtcNow;
            foreach (var s in _rpfStore.All())
            {
                await Clients.Caller.SendAsync("ReceiveRpfState", s.Symbol, new RpfStateUpdate
                {
                    Symbol = s.Symbol,
                    State = s.State.ToWire(),
                    CooldownRemainingSec = _rpfStore.CooldownRemainingSec(s.Symbol, now),
                    SuggestionId = s.Suggestion?.Id,
                    Timestamp = s.UpdatedAt,
                });
            }

            _logger.LogInformation("SubscribeRpf: {ConnectionId} unido al grupo rpf", Context.ConnectionId);
        }

        public Task UnsubscribeRpf()
            => Groups.RemoveFromGroupAsync(Context.ConnectionId, "rpf");

        /// <summary>
        /// El operador aprueba la sugerencia vigente. NO ejecuta la orden — confirma la intención y
        /// arranca el cooldown anti-doble-emisión. IN_POSITION lo confirma la cuenta, no este ack.
        /// Idempotente por id: un ack sobre una sugerencia vencida/reemplazada se ignora.
        /// </summary>
        public Task AcceptSuggestion(string suggestionId) => AckAsync(suggestionId, accepted: true);

        /// <summary>El operador descarta la sugerencia vigente; arranca el cooldown.</summary>
        public Task DismissSuggestion(string suggestionId) => AckAsync(suggestionId, accepted: false);

        private async Task AckAsync(string suggestionId, bool accepted)
        {
            int cooldownSeconds = ReadCooldownSeconds();
            var symbol = _rpfStore.Ack(suggestionId, accepted, cooldownSeconds, DateTime.UtcNow);

            if (symbol == null)
            {
                _logger.LogInformation("Ack ignorado (sugerencia {Id} vencida o reemplazada) accepted={Accepted}", suggestionId, accepted);
                return;
            }

            // Feedback inmediato: el símbolo entra en COOLDOWN. El loop lo refina en el próximo tick.
            _rpfStore.SetState(symbol, RpfState.Cooldown);
            var now = DateTime.UtcNow;
            await Clients.Group("rpf").SendAsync("ReceiveRpfState", symbol, new RpfStateUpdate
            {
                Symbol = symbol,
                State = RpfState.Cooldown.ToWire(),
                CooldownRemainingSec = _rpfStore.CooldownRemainingSec(symbol, now),
                Timestamp = now,
            });

            _logger.LogInformation("Ack {Verb}: sugerencia {Id} ({Symbol}) → COOLDOWN {Sec}s",
                accepted ? "ACCEPT" : "DISMISS", suggestionId, symbol, cooldownSeconds);
        }

        private int ReadCooldownSeconds()
        {
            try
            {
                var path = Path.Combine(_env.ContentRootPath, "Files", "Rpf", "galecore_rules_rpf.json");
                var root = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
                return (int?)root["orchestration"]?["cooldown_seconds"] ?? 120;
            }
            catch { return 120; }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Lifecycle
        // ═══════════════════════════════════════════════════════════════════════

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            // No hay nada que limpiar por conexión: los grupos los maneja SignalR, y las
            // suscripciones a DXLink llevan refcount adentro de DxLinkStreamingService.
            _logger.LogInformation("Cliente {ConnectionId} desconectado", Context.ConnectionId);
            await base.OnDisconnectedAsync(exception);
        }
    }
}
