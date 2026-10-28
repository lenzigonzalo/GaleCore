using AutoMapper;
using DataFeed.Infrastructure.Providers.Tastytrade;
using MediatR;
using Microsoft.Extensions.Configuration;

namespace DataFeed.Application.Data.Tastytrade.MarketMetricsVolatility
{
    public class MarketMetricsVolatilityHandler : IRequestHandler<MarketMetricsVolatilityRequest, MarketMetricsVolatilityResponse>
    {
        private readonly IConfiguration _config;
        private readonly IMapper _mapper;
        private readonly ITastytradeOAuth _auth;
        private readonly IHttpClientFactory _client;

        public MarketMetricsVolatilityHandler(IConfiguration config, IMapper mapper, ITastytradeOAuth auth, IHttpClientFactory client)
        {
            _config = config;
            _mapper = mapper;
            _auth = auth;
            _client = client;
        }

        public async Task<MarketMetricsVolatilityResponse> Handle(MarketMetricsVolatilityRequest request, CancellationToken cancellationToken)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(request.Symbols))
                    throw new Exception("Se requiere al menos un símbolo.");

                var provider = new TastytradeApiProvider(_config, _auth, _client);
                var metrics = await provider.GetMarketMetricsVolatilityAsync(request.Symbols, cancellationToken);

                if (metrics?.Data?.Items == null || metrics.Data.Items.Count == 0)
                    throw new Exception($"No se encontraron market metrics para: {request.Symbols}");

                return new MarketMetricsVolatilityResponse
                {
                    Items = _mapper.Map<List<MarketMetricsVolatilityDto>>(metrics.Data.Items)
                };
            }
            catch (Exception ex)
            {
                throw new Exception($"MarketMetricsVolatilityHandler Error: {ex.Message}");
            }
        }
    }
}
