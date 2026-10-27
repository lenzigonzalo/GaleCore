using AutoMapper;
using DataFeed.Application.Dtos;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using System.Globalization;

namespace DataFeed.Application.Data.Tastytrade.MarketDataGreeks
{
    public class MarketDataGreeksMapperProfile : AutoMapper.Profile
    {
        public MarketDataGreeksMapperProfile()
        {
            CreateMap<DataFeed.Infrastructure.Providers.Tastytrade.Models.GreeksModel,
                      DataFeed.Application.Data.Tastytrade.MarketDataGreeks.MarketDataGreeksResponse>();

            CreateMap<DataFeed.Infrastructure.Providers.Tastytrade.Models.GreeksEvent,
                      DataFeed.Application.Data.Tastytrade.MarketDataGreeks.GreeksEvent>();
        }
    }
}
