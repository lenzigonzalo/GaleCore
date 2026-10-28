using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using MediatR;

namespace DataFeed.Application.Data.Tastytrade.MarketDataGreeks
{
    public class MarketDataGreeksRequest : IRequest<MarketDataGreeksResponse>
    {
        public string Symbol { get; set; }
    }
}