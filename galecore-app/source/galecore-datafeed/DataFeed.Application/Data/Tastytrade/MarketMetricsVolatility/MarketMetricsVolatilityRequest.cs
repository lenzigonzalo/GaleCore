using MediatR;

namespace DataFeed.Application.Data.Tastytrade.MarketMetricsVolatility
{
    public class MarketMetricsVolatilityRequest : IRequest<MarketMetricsVolatilityResponse>
    {
        // Uno o más símbolos separados por coma, ej: "AAPL,SPY,QQQ"
        public string Symbols { get; set; }
    }
}
