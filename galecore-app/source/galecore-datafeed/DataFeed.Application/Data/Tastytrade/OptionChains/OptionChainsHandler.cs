using AutoMapper;
using AutoMapper.Internal;
using DataFeed.Application.Dtos;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers.Fred;
using DataFeed.Infrastructure.Providers.Tastytrade;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using MediatR;
using Microsoft.Extensions.Configuration;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Threading;
using System.Threading.Tasks;
using System.Timers;

namespace DataFeed.Application.Data.Tastytrade.OptionChains
{
    public class OptionChainsHandler : IRequestHandler<OptionChainsRequest, OptionChainsResponse>
    {
        private IConfiguration _config;
        private readonly IMapper _mapper;
        private readonly ITastytradeOAuth _auth;
        private readonly IHttpClientFactory _client;

        public OptionChainsHandler(IConfiguration config, IMapper mapper, ITastytradeOAuth auth, IHttpClientFactory client)
        {
            _config = config;
            _mapper = mapper;
            _auth = auth;
            _client = client;
        }

        public async Task<OptionChainsResponse> Handle(OptionChainsRequest request, CancellationToken cancellationToken)
        {
            try
            {
                var response = new OptionChainsResponse();

                var isOption = TastytradeHelper.IsOptionSymbol(request.Symbol);
                if (isOption)
                    throw new Exception("Symbol incorrect. Is option symbol");

                var provider = new TastytradeApiProvider(_config, _auth, _client);
                var optionschains = await provider.GetOptionChainsAsync(request.Symbol, cancellationToken);
                if (optionschains == null)
                    throw new Exception($"No option chains data found for this symbol: {request.Symbol}");
                
                var itemochain = optionschains.data.items.FirstOrDefault();

                response = _mapper.Map<OptionChainsResponse>(itemochain);

                // Filter grouped
                //response = response.GroupBy(x => new { x.ExpirationDate, x.StrikePrice })
                //    .Select(g => g.First())
                //    .ToList();

                return response;
            }
            catch (Exception ex)
            {
                throw new Exception($"OptionChainsReturnsHandler Error: {ex.Message}");
            }
        }
    }
}