using AutoMapper;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;

namespace DataFeed.Application.Data.Tastytrade.AccountPositions
{
    public class AccountPositionsMapperProfile : AutoMapper.Profile
    {
        public AccountPositionsMapperProfile()
        {
            CreateMap<AccountPositionItem, AccountPositionDto>();

            CreateMap<AccountPositionsData, AccountPositionsResponse>()
                .ForMember(dest => dest.Positions, opt => opt.MapFrom(src => src.Items));
        }
    }
}
