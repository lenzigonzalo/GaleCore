using MediatR;

namespace DataFeed.Application.App.IVRank
{
    public class IVRankRequest : IRequest<IVRankResponse>
    {
        /// <summary>
        /// Símbolo del subyacente (ej: AAPL, MSFT, SPY)
        /// </summary>
        public string Symbol { get; set; }
    }
}
