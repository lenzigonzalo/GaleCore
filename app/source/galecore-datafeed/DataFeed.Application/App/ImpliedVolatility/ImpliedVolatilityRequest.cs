using MediatR;

namespace DataFeed.Application.App.ImpliedVolatility
{
    public class ImpliedVolatilityRequest : IRequest<ImpliedVolatilityResponse>
    {
        /// <summary>
        /// Símbolo del subyacente (ej: AAPL, MSFT, SPY)
        /// </summary>
        public string Symbol { get; set; }
    }
}
