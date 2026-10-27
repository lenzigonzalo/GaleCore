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
using AutoMapper.Internal;
using DataFeed.Infrastructure.Providers.Fred;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using DataFeed.Infrastructure.Providers.Tastytrade;
using DataFeed.Application.Functions;
using DataFeed.Application.Shared;

namespace DataFeed.Application.Data.Tastytrade.MarketDataTrade
{
    public class MarketDataTradeHandler : IRequestHandler<MarketDataTradeRequest, MarketDataTradeResponse>
    {
        private IConfiguration _config;
        private readonly IMapper _mapper;
        private readonly ITastytradeOAuth _auth;
        private readonly IHttpClientFactory _client;
        private readonly IDxLinkStreamingService _streaming;

        public MarketDataTradeHandler(IConfiguration config, IMapper mapper, ITastytradeOAuth auth, IHttpClientFactory client, IDxLinkStreamingService streaming)
        {
            _config = config;
            _mapper = mapper;
            _auth = auth;
            _client = client;
            _streaming = streaming;
        }

        public async Task<MarketDataTradeResponse> Handle(MarketDataTradeRequest request, CancellationToken cancellationToken)
        {
            try
            {
                var response = new MarketDataTradeResponse();
                var isOption = TastytradeHelper.IsOptionSymbol(request.Symbol);
                var symbol = isOption ? TastytradeHelper.GetOptionSymbolFromTicker(request.Symbol) : request.Symbol;
                var tastyWSProvider = new TastytradeSocketProvider(_config, _auth, _client, _streaming);

                var prices = await tastyWSProvider.GetTradeAsync(symbol, cancellationToken);
                if (prices == null)
                    return new MarketDataTradeResponse();

                response = _mapper.Map<MarketDataTradeResponse>(prices);
                var obsDict = new Dictionary<DateTime, decimal>();
                var shyDict = new Dictionary<DateTime, decimal>();
                return response;
            }
            catch (Exception ex)
            {
                throw new Exception($"MarketDataTradeResponse Error: {ex.Message}");
            }
        }
    }
}