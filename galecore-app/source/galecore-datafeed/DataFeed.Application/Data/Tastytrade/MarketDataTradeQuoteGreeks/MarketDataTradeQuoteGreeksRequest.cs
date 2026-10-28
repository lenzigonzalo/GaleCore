using MediatR;

namespace DataFeed.Application.Data.Tastytrade.MarketDataTradeQuoteGreeks
{
    public class MarketDataTradeQuoteGreeksRequest : IRequest<MarketDataTradeQuoteGreeksResponse>
    {
        public string Symbol { get; set; }
    }
}
