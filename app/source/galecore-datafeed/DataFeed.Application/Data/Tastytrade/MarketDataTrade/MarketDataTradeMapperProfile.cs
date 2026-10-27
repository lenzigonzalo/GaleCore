using AutoMapper;
using DataFeed.Application.Dtos;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using System.Globalization;

namespace DataFeed.Application.Data.Tastytrade.MarketDataTrade
{
    public class MarketDataTradeMapperProfile : AutoMapper.Profile
    {
        public MarketDataTradeMapperProfile()
        {
            CreateMap<DataFeed.Infrastructure.Providers.Tastytrade.Models.TradeModel,
                      DataFeed.Application.Data.Tastytrade.MarketDataTrade.MarketDataTradeResponse>();

            CreateMap<DataFeed.Infrastructure.Providers.Tastytrade.Models.TradeEvent,
                      DataFeed.Application.Data.Tastytrade.MarketDataTrade.TradeEvent>();
        }
    }
}
