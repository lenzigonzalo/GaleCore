using Newtonsoft.Json.Linq;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    /// <summary>
    /// Servicio de streaming persistente DXLink con multiplexing de suscripciones.
    /// Mantiene una sola conexión WebSocket y administra suscripciones por reference counting.
    /// </summary>
    public interface IDxLinkStreamingService
    {
        /// <summary>
        /// Pide un snapshot puntual (request/response) sobre la conexión persistente: suscribe los
        /// (símbolo, eventType) indicados, acumula los eventos que llegan y devuelve cuando cada símbolo
        /// "completa" (según <paramref name="isSymbolComplete"/>) o se agota el timeout; luego desuscribe.
        /// Evita abrir una sesión DXLink nueva por request (que choca con el límite de sesiones).
        /// </summary>
        /// <param name="subs">Suscripciones a pedir. FromTime solo aplica a Candle (snapshot histórico).</param>
        /// <param name="isSymbolComplete">Dado un evento, indica si ese símbolo ya está completo.</param>
        Task<IReadOnlyList<JObject>> RequestSnapshotAsync(
            IReadOnlyList<(string Symbol, string EventType, long? FromTime)> subs,
            Func<JObject, bool> isSymbolComplete,
            TimeSpan timeout,
            CancellationToken cancellationToken);
        /// <summary>
        /// Agrega suscripciones para un símbolo. Si es la primera vez, envía FEED_SUBSCRIPTION add.
        /// </summary>
        Task SubscribeAsync(string symbol, string[] eventTypes);

        /// <summary>
        /// Remueve suscripciones para un símbolo. Si el ref count llega a 0, envía FEED_SUBSCRIPTION remove.
        /// </summary>
        Task UnsubscribeAsync(string symbol, string[] eventTypes);

        /// <summary>
        /// Batch subscribe: suscribe multiples simbolos en un solo FEED_SUBSCRIPTION.
        /// Mas eficiente que llamar SubscribeAsync en loop (ej: option chain completa).
        /// </summary>
        Task SubscribeBatchAsync(IEnumerable<string> symbols, string[] eventTypes);

        /// <summary>
        /// Batch unsubscribe: desuscribe multiples simbolos en un solo FEED_SUBSCRIPTION remove.
        /// </summary>
        Task UnsubscribeBatchAsync(IEnumerable<string> symbols, string[] eventTypes);
    }
}
