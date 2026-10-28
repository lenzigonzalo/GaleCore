using AutoMapper;
using DataFeed.Application.Dtos;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using System.Globalization;

namespace DataFeed.Application.Data.Tastytrade.MarketDataCandle
{
    public class MarketDataCandleMapperProfile : AutoMapper.Profile
    {
        public MarketDataCandleMapperProfile()
        {
            CreateMap<DataFeed.Infrastructure.Providers.Tastytrade.Models.CandleModel,
                      DataFeed.Application.Data.Tastytrade.MarketDataCandle.MarketDataCandleResponse>();

            CreateMap<DataFeed.Infrastructure.Providers.Tastytrade.Models.CandleData,
                      DataFeed.Application.Data.Tastytrade.MarketDataCandle.CandleData>()
                      .ForMember(dest => dest.Open, opt => opt.MapFrom(src => ParseValues.ParseDouble(src.Open)))
                      .ForMember(dest => dest.High, opt => opt.MapFrom(src => ParseValues.ParseDouble(src.High)))
                      .ForMember(dest => dest.Low, opt => opt.MapFrom(src => ParseValues.ParseDouble(src.Low)))
                      .ForMember(dest => dest.Close, opt => opt.MapFrom(src => ParseValues.ParseDouble(src.Close)))
                      .ForMember(dest => dest.Volume, opt => opt.MapFrom(src => ParseValues.ParseLong(src.Volume)))
                      .ForMember(dest => dest.Vwap, opt => opt.MapFrom(src => ParseValues.ParseDouble(src.Vwap)))
                      .ForMember(dest => dest.BidVolume, opt => opt.MapFrom(src => ParseValues.ParseLong(src.BidVolume)))
                      .ForMember(dest => dest.AskVolume, opt => opt.MapFrom(src => ParseValues.ParseLong(src.AskVolume)))
                      .ForMember(dest => dest.ImpVolatility, opt => opt.MapFrom(src => ParseValues.ParseDouble(src.ImpVolatility)))
                      .ForMember(dest => dest.OpenInterest, opt => opt.MapFrom(src => ParseValues.ParseLong(src.OpenInterest)));
        }
    }
}
