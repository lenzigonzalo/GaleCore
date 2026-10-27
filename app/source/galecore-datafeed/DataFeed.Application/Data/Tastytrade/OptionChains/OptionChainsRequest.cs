using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using MediatR;

namespace DataFeed.Application.Data.Tastytrade.OptionChains
{
    public class OptionChainsRequest : IRequest<OptionChainsResponse>
    {
        public string Symbol { get; set; }
    }
}