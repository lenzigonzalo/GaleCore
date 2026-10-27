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

namespace DataFeed.Application.Data.Tastytrade.MarketDataGreeks
{
    public class MarketDataGreeksHandler : IRequestHandler<MarketDataGreeksRequest, MarketDataGreeksResponse>
    {
        private IConfiguration _config;
        private readonly IMapper _mapper;
        private readonly ITastytradeOAuth _auth;
        private readonly IHttpClientFactory _client;
        private readonly IDxLinkStreamingService _streaming;

        public MarketDataGreeksHandler(IConfiguration config, IMapper mapper, ITastytradeOAuth auth, IHttpClientFactory client, IDxLinkStreamingService streaming)
        {
            _config = config;
            _mapper = mapper;
            _auth = auth;
            _client = client;
            _streaming = streaming;
        }

        /// <summary>
        /// Acepta el OCC de 21 caracteres y el símbolo streamer de DXLink (el que devuelve la cadena); devuelve el streamer.
        /// </summary>
        public static string ResolveSymbol(string? symbol)
        {
            symbol = symbol?.Trim();
            if (!string.IsNullOrEmpty(symbol))
            {
                if (TastytradeHelper.IsStreamerOptionSymbol(symbol)) return symbol;
                if (TastytradeHelper.IsOptionSymbol(symbol)) return TastytradeHelper.GetOptionSymbolFromTicker(symbol);
            }
            throw new DataFeed.Application.Shared.ValidationException("Symbol inválido. Símbolo de opción en formato OCC de 21 caracteres (6+6+1+8, ej: 'SPXW  261026P06800000') o streamer de DXLink (ej: '.SPXW261026P6800').");
        }

        public async Task<MarketDataGreeksResponse> Handle(MarketDataGreeksRequest request, CancellationToken cancellationToken)
        {
            // Fuera del try: un símbolo mal armado es 400 (ValidationException), no el 500 de abajo.
            var symbol = ResolveSymbol(request.Symbol);

            try
            {
                var response = new MarketDataGreeksResponse();

                var tastyWSProvider = new TastytradeSocketProvider(_config, _auth, _client, _streaming);

                var prices = await tastyWSProvider.GetGreeksAsync(symbol, cancellationToken);
                if (prices == null)
                    return new MarketDataGreeksResponse();

                response = _mapper.Map<MarketDataGreeksResponse>(prices);
                var obsDict = new Dictionary<DateTime, decimal>();
                var shyDict = new Dictionary<DateTime, decimal>();
                return response;
            }
            catch (Exception ex)
            {
                throw new Exception($"MarketDataGreeksHandler Error: {ex.Message}");
            }
        }
    }
}