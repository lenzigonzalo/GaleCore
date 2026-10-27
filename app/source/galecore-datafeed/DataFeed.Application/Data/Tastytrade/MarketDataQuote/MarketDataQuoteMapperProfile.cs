using AutoMapper;
using DataFeed.Application.Dtos;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using System.Globalization;

namespace DataFeed.Application.Data.Tastytrade.MarketDataTrade
{
    public class MarketDataQuoteMapperProfile : AutoMapper.Profile
    {
        public MarketDataQuoteMapperProfile()
        {
            CreateMap<DataFeed.Infrastructure.Providers.Tastytrade.Models.QuoteModel,
                      DataFeed.Application.Data.Tastytrade.MarketDataQuote.MarketDataQuoteResponse>();

            CreateMap<DataFeed.Infrastructure.Providers.Tastytrade.Models.QuoteEvent,
                      DataFeed.Application.Data.Tastytrade.MarketDataQuote.QuoteEvent>();
        }
    }
}
