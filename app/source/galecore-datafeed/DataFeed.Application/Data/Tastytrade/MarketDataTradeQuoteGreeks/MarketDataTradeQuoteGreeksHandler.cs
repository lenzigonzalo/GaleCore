using AutoMapper;
using MediatR;
using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using DataFeed.Infrastructure.Providers.Tastytrade;
using DataFeed.Application.Shared;

namespace DataFeed.Application.Data.Tastytrade.MarketDataTradeQuoteGreeks
{
    public class MarketDataTradeQuoteGreeksHandler : IRequestHandler<MarketDataTradeQuoteGreeksRequest, MarketDataTradeQuoteGreeksResponse>
    {
        private readonly IConfiguration _config;
        private readonly IMapper _mapper;
        private readonly ITastytradeOAuth _auth;
        private readonly IHttpClientFactory _client;
        private readonly IDxLinkStreamingService _streaming;

        public MarketDataTradeQuoteGreeksHandler(IConfiguration config, IMapper mapper, ITastytradeOAuth auth, IHttpClientFactory client, IDxLinkStreamingService streaming)
        {
            _config = config;
            _mapper = mapper;
            _auth = auth;
            _client = client;
            _streaming = streaming;
        }

        public async Task<MarketDataTradeQuoteGreeksResponse> Handle(MarketDataTradeQuoteGreeksRequest request, CancellationToken cancellationToken)
        {
            try
            {
                var isOption = TastytradeHelper.IsOptionSymbol(request.Symbol);
                var symbol = isOption ? TastytradeHelper.GetOptionSymbolFromTicker(request.Symbol) : request.Symbol;

                var tastyWSProvider = new TastytradeSocketProvider(_config, _auth, _client, _streaming);
                var data = await tastyWSProvider.GetTradeQuoteGreeksAsync(symbol, isOption, cancellationToken);

                if (data == null)
                    return new MarketDataTradeQuoteGreeksResponse();

                var response = _mapper.Map<MarketDataTradeQuoteGreeksResponse>(data);
                response.Symbol = request.Symbol;
                return response;
            }
            catch (Exception ex)
            {
                throw new Exception($"MarketDataTradeQuoteGreeksHandler Error: {ex.Message}");
            }
        }
    }
}
