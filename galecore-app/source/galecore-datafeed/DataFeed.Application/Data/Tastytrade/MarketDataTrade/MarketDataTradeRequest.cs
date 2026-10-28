using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using MediatR;

namespace DataFeed.Application.Data.Tastytrade.MarketDataTrade
{
    public class MarketDataTradeRequest : IRequest<MarketDataTradeResponse>
    {
        public string Symbol { get; set; }
    }
}