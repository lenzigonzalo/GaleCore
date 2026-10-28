using AutoMapper;
using DataFeed.Application.Dtos;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using System.Globalization;
using System.Security.AccessControl;

namespace DataFeed.Application.Data.Tastytrade.OptionChains
{
    public class OptionChainsMapperProfile : AutoMapper.Profile
    {
        public OptionChainsMapperProfile()
        {
            // Mapeo principal Item -> OptionChainsResponse
            CreateMap<Item, OptionChainsResponse>()
                .ForMember(dest => dest.Symbol, opt => opt.MapFrom(src => src.UnderlyingSymbol))
                .ForMember(dest => dest.expirations, opt => opt.MapFrom(src => src.expirations));

            // Mapeos explícitos para tipos anidados
            CreateMap<Infrastructure.Providers.Tastytrade.Models.Expiration, Expiration>()
                .ForMember(dest => dest.ExpirationType, opt => opt.MapFrom(src => src.ExpirationType))
                .ForMember(dest => dest.ExpirationDate, opt => opt.MapFrom(src => src.ExpirationDate))
                .ForMember(dest => dest.DaysToExpiration, opt => opt.MapFrom(src => src.DaysToExpiration))
                .ForMember(dest => dest.SettlementType, opt => opt.MapFrom(src => src.SettlementType))
                .ForMember(dest => dest.strikes, opt => opt.MapFrom(src => src.strikes));

            CreateMap<Infrastructure.Providers.Tastytrade.Models.Strike, Strike>()
                .ForMember(dest => dest.StrikePrice, opt => opt.MapFrom(src => src.StrikePrice))
                .ForMember(dest => dest.call, opt => opt.MapFrom(src => src.call))
                .ForMember(dest => dest.CallStreamerSymbol, opt => opt.MapFrom(src => src.CallStreamerSymbol))
                .ForMember(dest => dest.put, opt => opt.MapFrom(src => src.put))
                .ForMember(dest => dest.PutStreamerSymbol, opt => opt.MapFrom(src => src.PutStreamerSymbol));
        }
    }
}
