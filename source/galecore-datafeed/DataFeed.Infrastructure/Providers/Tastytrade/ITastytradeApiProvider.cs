using System.Collections.Generic;
using System.Threading.Tasks;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    public interface ITastytradeApiProvider
    {
        Task<ByTypeModel?> GetMarketDataByTypeAsync(string symbol, CancellationToken cancellationToken);

        Task<OptionChainsModel?> GetOptionChainsAsync(string symbol, CancellationToken cancellationToken);

        /// <summary>
        /// Busca instrumentos por símbolo o parte de él. Es metadato de mercado, no dato de cuenta:
        /// va con la credencial de sistema como el resto de los market data.
        /// </summary>
        Task<SymbolSearchModel?> GetSymbolSearchAsync(string query, CancellationToken cancellationToken);

        /// <param name="credential">null = credencial de sistema. Los datos de cuenta son por usuario.</param>
        Task<AccountBalancesModel?> GetAccountBalancesAsync(string accountNumber, CancellationToken cancellationToken, TastytradeCredential? credential = null);

        /// <param name="credential">null = credencial de sistema. Los datos de cuenta son por usuario.</param>
        Task<AccountPositionsModel?> GetAccountPositionsAsync(string accountNumber, CancellationToken cancellationToken, TastytradeCredential? credential = null);

        Task<MarketMetricsVolatilityModel?> GetMarketMetricsVolatilityAsync(string symbols, CancellationToken cancellationToken);
        Task<FuturesModel?> GetFuturesAsync(IEnumerable<string> productCodes, CancellationToken cancellationToken);
    }
}
