using AutoMapper;
using DataFeed.Application.Dtos;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using System.Globalization;
using DataFeed.Application.Shared;

namespace DataFeed.Application.Data.Tastytrade.MarketDataByType
{
    public class MarketDataByTypeMapperProfile : AutoMapper.Profile
    {
        public MarketDataByTypeMapperProfile()
        {
            //CreateMap<ByTypeModel, MarketDataByTypeResponse>();
            //CreateMap<DataFeed.Application.Data.Tastytrade.MarketDataByType.QuoteData, DataFeed.Application.Data.Tastytrade.MarketDataByType.QuoteData>();

            //CreateMap<PriceLastItem, PriceLastResponse>()
            //    .ForMember(dest => dest.Symbol, opt => opt.MapFrom(src => src.Symbol))
            //    //.ForMember(dest => dest.InstrumentType, opt => opt.MapFrom(src => src.InstrumentType))
            //    .ForMember(dest => dest.Time, opt => opt.MapFrom(src => ParseValues.ParseDateTime(src.UpdatedAt)))
            //    //.ForMember(dest => dest.Bid, opt => opt.MapFrom(src => ParseValues.ParseDecimal(src.Bid)))
            //    //.ForMember(dest => dest.Ask, opt => opt.MapFrom(src => ParseValues.ParseDecimal(src.Ask)))
            //    //.ForMember(dest => dest.Last, opt => opt.MapFrom(src => ParseValues.ParseDecimal(src.Last)))
            //    //.ForMember(dest => dest.Open, opt => opt.MapFrom(src => ParseValues.ParseDecimal(src.Open)))
            //    //.ForMember(dest => dest.Close, opt => opt.MapFrom(src => ParseValues.ParseDecimal(src.Close)))
            //    //.ForMember(dest => dest.PrevClose, opt => opt.MapFrom(src => ParseValues.ParseDecimal(src.PrevClose)))
            //    //.ForMember(dest => dest.Delta, opt => opt.MapFrom(src => ParseValues.ParseDouble(src.Delta)))
            //    //.ForMember(dest => dest.Gamma, opt => opt.MapFrom(src => ParseValues.ParseDouble(src.Gamma)))
            //    //.ForMember(dest => dest.Theta, opt => opt.MapFrom(src => ParseValues.ParseDouble(src.Theta)))
            //    //.ForMember(dest => dest.Volatility, opt => opt.MapFrom(src => ParseValues.ParseDouble(src.Volatility)))
            //    //.ForMember(dest => dest.Volume, opt => opt.MapFrom(src => ParseValues.ParseLong(src.Volume)))
            //    //.ForMember(dest => dest.OpenInterest, opt => opt.MapFrom(src => ParseValues.ParseLong(src.OpenInterest.ToString())))
            //    ;

            CreateMap<DataFeed.Infrastructure.Providers.Tastytrade.Models.ByTypeModel,
                      DataFeed.Application.Data.Tastytrade.MarketDataByType.MarketDataByTypeResponse>();

            CreateMap<DataFeed.Infrastructure.Providers.Tastytrade.Models.QuoteData,
                      DataFeed.Application.Data.Tastytrade.MarketDataByType.QuoteData>();

            CreateMap<DataFeed.Infrastructure.Providers.Tastytrade.Models.QuoteItem,
                      DataFeed.Application.Data.Tastytrade.MarketDataByType.QuoteItem>();
        }
    }
}
