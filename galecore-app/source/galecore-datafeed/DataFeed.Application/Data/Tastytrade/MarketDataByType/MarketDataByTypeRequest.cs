using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using MediatR;

namespace DataFeed.Application.Data.Tastytrade.MarketDataByType
{
    public class MarketDataByTypeRequest : IRequest<MarketDataByTypeResponse>
    {
        public string Symbol { get; set; }
    }
}