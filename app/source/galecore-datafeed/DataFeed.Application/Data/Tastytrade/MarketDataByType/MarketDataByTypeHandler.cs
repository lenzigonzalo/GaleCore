using AutoMapper;
using MediatR;
using System;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using Newtonsoft.Json;
using System.IO;
using System.Globalization;
using Microsoft.Extensions.Configuration;
using DataFeed.Application.Dtos;
using AutoMapper.Internal;
using DataFeed.Infrastructure.Providers.Fred;
using System.Timers;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using DataFeed.Infrastructure.Providers.Tastytrade;

namespace DataFeed.Application.Data.Tastytrade.MarketDataByType
{
    public class MarketDataByTypeHandler : IRequestHandler<MarketDataByTypeRequest, MarketDataByTypeResponse>
    {
        private IConfiguration _config;
        private readonly IMapper _mapper;
        private readonly ITastytradeOAuth _auth;
        private readonly IHttpClientFactory _client;

        public MarketDataByTypeHandler(IConfiguration config, IMapper mapper, ITastytradeOAuth auth, IHttpClientFactory client)
        {
            _config = config;
            _mapper = mapper;
            _auth = auth;
            _client = client;
        }

        public async Task<MarketDataByTypeResponse> Handle(MarketDataByTypeRequest request, CancellationToken cancellationToken)
        {
            try
            {
                var response = new MarketDataByTypeResponse();
                var provider = new TastytradeApiProvider(_config, _auth, _client);
                
                var data = await provider.GetMarketDataByTypeAsync(request.Symbol, cancellationToken);
                if (data == null)
                    throw new Exception($"No market data found for this symbol: {request.Symbol}");

                response = _mapper.Map<MarketDataByTypeResponse>(data);
                return response;
            }
            catch (Exception ex)
            {
                throw new Exception($"MarketDataByTypeHandler Error: {ex.Message}");
            }
        }
    }
}