using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using MediatR;

namespace DataFeed.Application.Data.Tastytrade.MarketDataQuote
{
    public class MarketDataQuoteRequest : IRequest<MarketDataQuoteResponse>
    {
        public string Symbol { get; set; }
    }
}