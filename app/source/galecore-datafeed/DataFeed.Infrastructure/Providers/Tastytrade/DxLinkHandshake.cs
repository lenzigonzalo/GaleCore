using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Websocket.Client;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    /// <summary>
    /// DxLink handshake helper — ensures sequential SETUP → AUTH → CHANNEL_REQUEST → FEED_SETUP.
    /// DxLink requires each step to be acknowledged before the next can be sent.
    /// </summary>
    public static class DxLinkHandshake
    {
        private const int TimeoutMs = 10_000;

        /// <summary>
        /// Campos del Quote que se piden. Con el set por defecto DXLink mandaba el Quote sin hora
        /// (eventTime 0, verificado el 24/09 y el 06/10). Se listan los que ya se usaban más las dos
        /// horas (BL-013). El resto de los eventos queda con su set por defecto.
        /// </summary>
        public static readonly string[] QuoteFields =
        {
            "eventType", "eventSymbol", "eventTime", "sequence",
            "bidTime", "bidExchangeCode", "bidPrice", "bidSize",
            "askTime", "askExchangeCode", "askPrice", "askSize",
        };

        /// <summary>FEED_SETUP único para las dos conexiones (la persistente y la de snapshot).</summary>
        public static object FeedSetup => new
        {
            type = "FEED_SETUP",
            channel = 3,
            acceptDataFormat = "FULL",
            acceptEventFields = new Dictionary<string, string[]> { ["Quote"] = QuoteFields },
            parameters = new { },
        };

        /// <summary>
        /// Performs the DxLink handshake on an already-started WebsocketClient.
        /// Subscribes to MessageReceived internally; caller should subscribe AFTER this returns.
        /// Returns an IDisposable that unsubscribes the handshake handler.
        /// </summary>
        public static async Task PerformAsync(WebsocketClient socket, string token)
        {
            var authTcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var channelTcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

            // Temporary subscription to track handshake responses
            using var sub = socket.MessageReceived.Subscribe(msg =>
            {
                if (string.IsNullOrEmpty(msg.Text)) return;
                try
                {
                    var json = JObject.Parse(msg.Text);
                    var type = json["type"]?.ToString();

                    if (type == "AUTH_STATE" && json["state"]?.ToString() == "AUTHORIZED")
                        authTcs.TrySetResult(true);

                    if (type == "CHANNEL_OPENED" && json["channel"]?.Value<int>() == 3)
                        channelTcs.TrySetResult(true);
                }
                catch { }
            });

            void Send(object msg) => socket.Send(JsonConvert.SerializeObject(msg));

            // Asegurar que la conexión esté realmente establecida antes del handshake.
            // socket.Start() puede retornar con IsRunning=false bajo churn de conexiones
            // (la conexión inicial falla y el auto-reconnect tarda ~60s), lo que dejaba
            // SETUP/AUTH enviados al vacío → AUTH timeout. Reintentamos Start() hasta conectar.
            await EnsureConnectedAsync(socket);

            // Step 1+2: SETUP + AUTH (can be sent together, server processes in order)
            Send(new { type = "SETUP", channel = 0, version = "0.1-DXF-JS/0.3.0", keepaliveTimeout = 60, acceptKeepaliveTimeout = 60 });
            Send(new { type = "AUTH", channel = 0, token });

            // Wait for AUTH_STATE: AUTHORIZED
            if (await Task.WhenAny(authTcs.Task, Task.Delay(TimeoutMs)) != authTcs.Task)
                throw new TimeoutException("DxLink handshake: AUTH timeout");

            // Step 3: CHANNEL_REQUEST — requires AUTH to be complete
            Send(new { type = "CHANNEL_REQUEST", channel = 3, service = "FEED", parameters = new { contract = "AUTO" } });

            // Wait for CHANNEL_OPENED
            if (await Task.WhenAny(channelTcs.Task, Task.Delay(TimeoutMs)) != channelTcs.Task)
                throw new TimeoutException("DxLink handshake: CHANNEL_OPENED timeout");

            // Step 4: FEED_SETUP
            Send(FeedSetup);
        }

        /// <summary>
        /// Espera a que el WebSocket esté efectivamente conectado (IsRunning=true).
        /// Si no lo está, reintenta Start() hasta 3 veces (la conexión inicial puede
        /// fallar silenciosamente bajo churn). Lanza si no logra conectar.
        /// </summary>
        private static async Task EnsureConnectedAsync(WebsocketClient socket)
        {
            const int maxAttempts = 3;
            const int waitPerAttemptMs = 3_000;

            for (int attempt = 0; attempt < maxAttempts; attempt++)
            {
                if (socket.IsRunning) return;

                try { await socket.Start(); } catch { }

                var deadline = DateTime.UtcNow.AddMilliseconds(waitPerAttemptMs);
                while (!socket.IsRunning && DateTime.UtcNow < deadline)
                    await Task.Delay(100);

                if (socket.IsRunning) return;
            }

            throw new TimeoutException("DxLink handshake: WebSocket no conectó (IsRunning=false tras reintentos)");
        }
    }
}
