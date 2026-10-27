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

namespace DataFeed.Application.Data.Tastytrade.MarketDataCandle
{
    public class MarketDataCandleHandler : IRequestHandler<MarketDataCandleRequest, MarketDataCandleResponse>
    {
        private IConfiguration _config;
        private readonly IMapper _mapper;
        private readonly ITastytradeOAuth _auth;
        private readonly IHttpClientFactory _client;
        private readonly IDxLinkStreamingService _streaming;

        public MarketDataCandleHandler(IConfiguration config, IMapper mapper, ITastytradeOAuth auth, IHttpClientFactory client, IDxLinkStreamingService streaming)
        {
            _config = config;
            _mapper = mapper;
            _auth = auth;
            _client = client;
            _streaming = streaming;
        }

        /// <summary>
        /// Obtiene candles vía la conexión DXLink persistente (snapshot request/response),
        /// evitando abrir una sesión nueva por llamada. Devuelve un CandleModel equivalente al
        /// que producía TastytradeSocketProvider.GetCandleAsync.
        /// </summary>
        private async Task<CandleModel> FetchCandlesViaStreamingAsync(string streamerSymbol, string interval, DateTime fromTime, CancellationToken ct)
        {
            var symball = streamerSymbol + "{=" + interval + "}";
            var unixFrom = new DateTimeOffset(fromTime, TimeSpan.Zero).ToUnixTimeMilliseconds();

            var items = await _streaming.RequestSnapshotAsync(
                new (string, string, long?)[] { (symball, "Candle", unixFrom) },
                // El snapshot de un símbolo termina con SNAPSHOT_END (0x08) o SNAPSHOT_SNIP (0x10).
                isSymbolComplete: item =>
                {
                    var flags = (int?)item["eventFlags"] ?? 0;
                    return (flags & 0x08) != 0 || (flags & 0x10) != 0;
                },
                timeout: TimeSpan.FromSeconds(30),
                cancellationToken: ct);

            var model = new CandleModel
            {
                type = "FEED_DATA",
                channel = 3,
                data = new List<DataFeed.Infrastructure.Providers.Tastytrade.Models.CandleData>()
            };
            foreach (var it in items)
            {
                var cd = it.ToObject<DataFeed.Infrastructure.Providers.Tastytrade.Models.CandleData>();
                if (cd != null) model.data.Add(cd);
            }
            return model;
        }

        public async Task<MarketDataCandleResponse> Handle(MarketDataCandleRequest request, CancellationToken cancellationToken)
        {
            try
            {
                var response = new MarketDataCandleResponse();

                var isOption = TastytradeHelper.IsOptionSymbol(request.Symbol);
                var symbol = isOption ? TastytradeHelper.GetOptionSymbolFromTicker(request.Symbol) : request.Symbol;

                var prices = await FetchCandlesViaStreamingAsync(symbol, request.Interval, request.FromTime, cancellationToken);
                if (prices == null)
                    return new MarketDataCandleResponse();

                response = _mapper.Map<MarketDataCandleResponse>(prices);

                if (request.ToTime.HasValue)
                {
                    var toTimeUtc = new DateTimeOffset(request.ToTime.Value, TimeSpan.Zero).ToUnixTimeMilliseconds();
                    response.data = response.data
                        .Where(c => c.Time <= toTimeUtc)
                        .ToList();
                }

                var obsDict = new Dictionary<DateTime, decimal>();
                var shyDict = new Dictionary<DateTime, decimal>();

                #region OPTIONS

                //Calculate greeks for options historical
                if (isOption)
                {
                    var pricesUnderlying = await FetchCandlesViaStreamingAsync(request.Symbol.Substring(0, 6).Trim(), request.Interval, request.FromTime, cancellationToken);
                    Dictionary<DateTime, double> spotByDate = null;
                    spotByDate = pricesUnderlying.data
                                .GroupBy(b => b.TimeStamp.Date)
                                .ToDictionary(
                                    g => g.Key,
                                    g => Convert.ToDouble(g.Last().Close, CultureInfo.InvariantCulture) // usa Close diario
                                );

                    #region PriceLast

                    //var tastyAPIprovider = new TastytradeAPIProvider(_config, _auth, _client);
                    //var symbolSubyacente = GetStockSymbolFromTicker(request.Symbol);
                    //var price = await tastyAPIprovider.GetPriceLastAsync(symbolSubyacente, cancellationToken);
                    //if (price == null)
                    //    throw new Exception($"No price last data found for symbol: {request.Symbol}");

                    //var quotestr = string.IsNullOrEmpty(price.Data.Items[0].Close) ? price.Data.Items[0].Last : price.Data.Items[0].Close;
                    //var pricelast = ParseValues.ParseDouble(quotestr);

                    #endregion

                    #region fred (r)

                    var httpclient = _client.CreateClient();
                    var fredProvider = new FredApiProvider(_config, httpclient);
                    var observs = await fredProvider.GetObservationsAsync("DGS1", request.FromTime, request.ToTime, cancellationToken);
                    if (observs != null && observs.Observations.Count > 0)        //(fred?.observations != null && fred.observations.Count > 0)
                    {
                        foreach (var o in observs.Observations)
                        {
                            if (DateTime.TryParseExact(o.Date, "yyyy-MM-dd", null,
                                System.Globalization.DateTimeStyles.None, out var date) &&
                                decimal.TryParse(o.Value, System.Globalization.NumberStyles.Any,
                                System.Globalization.CultureInfo.InvariantCulture, out var val))
                            {
                                obsDict[date] = val / 100;
                            }
                        }
                    }

                    #endregion

                    #region greeks

                    decimal? r;
                    var orderedObs = obsDict.OrderBy(x => x.Key).ToList();

                    foreach (var pricehis in response.data)
                    {
                        r = null;

                        //EML
                        if (spotByDate == null || !spotByDate.TryGetValue(pricehis.TimeStamp.Date, out var spot))
                            continue; // fail-soft: sin spot para ese día

                        if (obsDict.TryGetValue(pricehis.TimeStamp.Date, out var obsValue))
                        {
                            r = obsValue;
                        }
                        else
                        {
                            // Si no tiene obs, buscar la fecha más cercana
                            var targetDate = pricehis.TimeStamp.Date;
                            var closest = orderedObs
                                .OrderBy(x => Math.Abs((x.Key - targetDate).Ticks))
                                .FirstOrDefault();
                            if (!closest.Equals(default(KeyValuePair<DateTime, decimal>)))
                            {
                                r = closest.Value;
                            }
                            else
                            {
                                r = (decimal)0.045;
                            }
                        }

                        // greeks
                        if (r != null)
                        {
                            var strike = TastytradeHelper.GetStrikeFromTicker(request.Symbol);
                            var dte = TastytradeHelper.GetDTEFromTicker(request.Symbol, pricehis.TimeStamp);

                            (double Delta, double Gamma, double Theta, double Vega, double Rho) greeks;
                            var optionType = request.Symbol.Substring(12, 1);
                            if (optionType == "C")
                            {
                                greeks = BlackScholes.CallGreeks(
                                    price: spot,        //pricelast,            // close price day
                                    strike: (double)strike,                     // strike price
                                    dte: dte,                                   // dte / 365.0; 0.5 = 6 month 
                                    vol: pricehis.ImpVolatility,                // 0.25 = 25% implied volatility
                                    r: (double)r       //(r / 252 * dte)        // 0.05 = 5% tasa libre de riesgo
                                );
                                //q: 0  // ((double)q / (double)pricelast) * (dte / 252.0)  // 0.02 = 2% dividendos
                            }
                            else  //"PUT"
                            {
                                greeks = BlackScholes.PutGreeks(
                                    price: spot,
                                    strike: (double)strike,
                                    dte: dte,
                                    vol: pricehis.ImpVolatility,
                                    r: (double)r
                                );
                            }

                            pricehis.Delta = (double)greeks.Delta;
                            pricehis.Gamma = (double)greeks.Gamma;
                            pricehis.Theta = (double)greeks.Theta;
                        }
                        else
                        {
                            pricehis.Delta = null;
                            pricehis.Gamma = null;
                            pricehis.Theta = null;
                        }
                    }

                    #endregion
                }

                #endregion

                return response;
            }
            catch (Exception ex)
            {
                throw new Exception($"MarketDataCandleHandler Error: {ex.Message}");
            }
        }

        #region Helper

        //static string GetOptionSymbolFromTicker(string ticker)
        //{
        //    return "." + ticker.Substring(0, 6).Trim(' ') + ticker.Substring(6, 6) + ticker.Substring(12, 1) + Convert.ToInt32(ticker.Substring(13, 5).TrimStart('0')).ToString();
        //}

        //public static string GetStockSymbolFromTicker(string ticker)
        //{
        //    return ticker.Substring(0, 6).Trim(' ');
        //}

        //static decimal GetStrikeFromTicker(string ticker)
        //{
        //    string intpart = ticker.Substring(13, 5);
        //    string decpart = ticker.Substring(18, 3);
        //    decimal value = decimal.Parse(intpart) + decimal.Parse(decpart) / 1000;
        //    return value;
        //}

        //public static int GetDTEFromTicker(string ticker, DateTime priceTime)
        //{
        //    var datePart = ticker.Substring(6, 6);

        //    if (!DateTime.TryParseExact(datePart, "yyMMdd",
        //        System.Globalization.CultureInfo.InvariantCulture,
        //        System.Globalization.DateTimeStyles.None, out DateTime expirationDate))
        //    {
        //        throw new ArgumentException($"Invalid date format in symbol: {datePart}");
        //    }

        //    // Calcular diferencia en días
        //    int dte = (expirationDate.Date - priceTime.Date).Days;

        //    return dte;
        //}

        #endregion
    }
}