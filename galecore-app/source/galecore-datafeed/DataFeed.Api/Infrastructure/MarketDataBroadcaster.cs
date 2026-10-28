using DataFeed.Api.Hubs;
using DataFeed.Infrastructure.Providers.Tastytrade;
using Microsoft.AspNetCore.SignalR;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Implementación de IMarketDataBroadcaster que usa SignalR IHubContext
    /// para enviar datos a los clientes suscriptos por grupo (símbolo).
    /// </summary>
    public class MarketDataBroadcaster : IMarketDataBroadcaster
    {
        private readonly IHubContext<MarketDataHub> _hubContext;

        public MarketDataBroadcaster(IHubContext<MarketDataHub> hubContext)
        {
            _hubContext = hubContext;
        }

        public async Task BroadcastTradeAsync(string symbol, object tradeData)
        {
            await _hubContext.Clients.Group(symbol).SendAsync("ReceiveTrade", symbol, tradeData);
        }

        public async Task BroadcastQuoteAsync(string symbol, object quoteData)
        {
            await _hubContext.Clients.Group(symbol).SendAsync("ReceiveQuote", symbol, quoteData);
        }

        public async Task BroadcastGreeksAsync(string symbol, object greeksData)
        {
            await _hubContext.Clients.Group(symbol).SendAsync("ReceiveGreeks", symbol, greeksData);
        }

        public async Task BroadcastRpfStateAsync(string symbol, object stateUpdate, CancellationToken ct)
        {
            await _hubContext.Clients.Group("rpf").SendAsync("ReceiveRpfState", symbol, stateUpdate, ct);
        }

        public async Task BroadcastTradeSuggestionAsync(string symbol, object suggestion)
        {
            await _hubContext.Clients.Group("rpf").SendAsync("ReceiveTradeSuggestion", symbol, suggestion);
        }

        public async Task BroadcastRpfSwitchAsync(bool enabled)
        {
            // Al grupo entero: el switch es global. Un tablero que no esté conectado simplemente no
            // recibe nada, que es lo correcto — lo va a ver en su próximo GET.
            await _hubContext.Clients.Group("rpf").SendAsync("ReceiveRpfSwitch", enabled);
        }
    }
}
