using AutoMapper;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;

namespace DataFeed.Application.Data.Tastytrade.AccountBalances
{
    public class AccountBalancesMapperProfile : AutoMapper.Profile
    {
        public AccountBalancesMapperProfile()
        {
            CreateMap<AccountBalancesData, AccountBalancesResponse>();
        }
    }
}
