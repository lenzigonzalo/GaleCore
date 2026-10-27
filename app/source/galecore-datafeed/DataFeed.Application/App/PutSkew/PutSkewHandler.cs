using System.Threading;
using System.Threading.Tasks;
using MediatR;
using DataFeed.Application.App.GammaExposure;

namespace DataFeed.Application.App.PutSkew
{
    /// <summary>
    /// Endpoint standalone del skew 25Δ put. Reutiliza GammaExposure (Greeks + IV por strike vía DXLink)
    /// y delega el cálculo a PutSkewCalculator (compartido con ValidationLayer).
    /// </summary>
    public class PutSkewHandler : IRequestHandler<PutSkewRequest, PutSkewResponse>
    {
        private readonly IMediator _mediator;

        public PutSkewHandler(IMediator mediator)
        {
            _mediator = mediator;
        }

        public async Task<PutSkewResponse> Handle(PutSkewRequest request, CancellationToken cancellationToken)
        {
            var gex = await _mediator.Send(
                new GammaExposureRequest { Symbol = request.Symbol, MaxDTE = request.MaxDTE },
                cancellationToken);

            return PutSkewCalculator.Compute(gex, request.Delta);
        }
    }
}
