using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    public interface ITastytradeSocketProvider
    {
        Task<CandleModel> GetCandleAsync(string symbol, string interval, DateTime fromTime, DateTime? toTime, CancellationToken cancellationToken);

        Task<TradeModel> GetTradeAsync(string symbol, CancellationToken cancellationToken);

        Task<TradeQuoteGreeksModel> GetTradeQuoteGreeksAsync(string symbol, bool includeGreeks, CancellationToken cancellationToken);
    }
}
