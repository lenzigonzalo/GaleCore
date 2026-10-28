using Microsoft.Extensions.Configuration;
using System.Text.Json;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using DataFeed.Infrastructure.Providers;
using System.Net.Http;
using static System.Runtime.InteropServices.JavaScript.JSType;
using System.Net.Http.Headers;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Websocket.Client;
using System.Reactive;
using System.Net.Http.Json;
using System.Net.WebSockets;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Globalization;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    public class TastytradeSocketProvider : ITastytradeSocketProvider
    {
        private readonly HttpClient _client;
        private readonly ITastytradeOAuth _auth;
        private readonly IConfiguration _config;
        private readonly HttpRequestHeaders _request;

        private List<CandleModel> candles = new();

        private readonly IDxLinkStreamingService _streaming;

        public TastytradeSocketProvider(IConfiguration config, ITastytradeOAuth auth, IHttpClientFactory client, IDxLinkStreamingService streaming)
        {
            _config = config;
            _client = client.CreateClient();
            _client.BaseAddress = new Uri(_config["Tastytrade:BaseUrl"]);
            _auth = auth;
            _streaming = streaming;
        }

        /// <summary>
        /// Arma un modelo (TradeModel/QuoteModel/GreeksModel/CandleModel) a partir de los items de un
        /// snapshot, recreando el mensaje FEED_DATA original para deserializar con el shape esperado.
        /// </summary>
        private static T BuildModel<T>(IReadOnlyList<JObject> items)
        {
            var arr = new JArray();
            foreach (var it in items) arr.Add(it);
            var msg = new JObject { ["type"] = "FEED_DATA", ["channel"] = 3, ["data"] = arr };
            return msg.ToObject<T>()!;
        }

        #region Socket

        public async Task<CandleModel> GetCandleAsync(string symbol, string interval, DateTime fromTime, DateTime? toTime, CancellationToken cancellationToken)
        {
            // Vía la conexión DXLink persistente (snapshot) — no abre sesión nueva.
            var symball = symbol + "{=" + interval + "}";
            var unixFromTime = new DateTimeOffset(fromTime, TimeSpan.Zero).ToUnixTimeMilliseconds();

            var items = await _streaming.RequestSnapshotAsync(
                new (string, string, long?)[] { (symball, "Candle", unixFromTime) },
                // El snapshot de un símbolo termina con SNAPSHOT_END (0x08) o SNAPSHOT_SNIP (0x10).
                isSymbolComplete: it =>
                {
                    var flags = (int?)it["eventFlags"] ?? 0;
                    return (flags & 0x08) != 0 || (flags & 0x10) != 0;
                },
                timeout: TimeSpan.FromSeconds(30),
                cancellationToken: cancellationToken);

            var response = new CandleModel { type = "FEED_DATA", channel = 3, data = new List<CandleData>() };
            foreach (var it in items)
            {
                var cd = it.ToObject<CandleData>();
                if (cd != null) response.data.Add(cd);
            }
            return response;
        }

        public async Task<TradeModel> GetTradeAsync(string symbol, CancellationToken cancellationToken)
        {
            var items = await _streaming.RequestSnapshotAsync(
                new (string, string, long?)[] { (symbol, "Trade", null) },
                isSymbolComplete: _ => true,
                timeout: TimeSpan.FromSeconds(10),
                cancellationToken: cancellationToken);
            return BuildModel<TradeModel>(items);
        }

        public async Task<QuoteModel> GetQuoteAsync(string symbol, CancellationToken cancellationToken)
        {
            var items = await _streaming.RequestSnapshotAsync(
                new (string, string, long?)[] { (symbol, "Quote", null) },
                isSymbolComplete: _ => true,
                timeout: TimeSpan.FromSeconds(10),
                cancellationToken: cancellationToken);
            return BuildModel<QuoteModel>(items);
        }

        public async Task<GreeksModel> GetGreeksAsync(string symbol, CancellationToken cancellationToken)
        {
            var items = await _streaming.RequestSnapshotAsync(
                new (string, string, long?)[] { (symbol, "Greeks", null) },
                isSymbolComplete: _ => true,
                timeout: TimeSpan.FromSeconds(10),
                cancellationToken: cancellationToken);
            return BuildModel<GreeksModel>(items);
        }

        public async Task<TradeQuoteGreeksModel> GetTradeQuoteGreeksAsync(string symbol, bool includeGreeks, CancellationToken cancellationToken)
        {
            var subs = new List<(string, string, long?)>
            {
                (symbol, "Trade", null),
                (symbol, "Quote", null)
            };
            if (includeGreeks) subs.Add((symbol, "Greeks", null));

            var items = await _streaming.RequestSnapshotAsync(
                subs,
                isSymbolComplete: _ => true, // primer evento de cada tipo
                timeout: TimeSpan.FromSeconds(10),
                cancellationToken: cancellationToken);

            var response = new TradeQuoteGreeksModel();
            var trade = items.Where(i => i["eventType"]?.ToString() == "Trade").Take(1).ToList();
            var quote = items.Where(i => i["eventType"]?.ToString() == "Quote").Take(1).ToList();
            var greeks = items.Where(i => i["eventType"]?.ToString() == "Greeks").Take(1).ToList();

            if (trade.Count > 0) response.Trade = BuildModel<TradeModel>(trade);
            if (quote.Count > 0) response.Quote = BuildModel<QuoteModel>(quote);
            if (greeks.Count > 0) response.Greeks = BuildModel<GreeksModel>(greeks);

            return response;
        }

        #endregion

        #region Helper

        //private static decimal GetDecimalSafe(JsonElement el)
        //{
        //    return el.ValueKind switch
        //    {
        //        JsonValueKind.Number => el.GetDecimal(),
        //        JsonValueKind.String => decimal.TryParse(el.GetString(), out var result) ? result : 0m,
        //        _ => 0m
        //    };
        //}

        //private static double GetDoubleSafe(JsonElement el)
        //{
        //    return el.ValueKind switch
        //    {
        //        JsonValueKind.Number => el.GetDouble(),
        //        JsonValueKind.String => double.TryParse(el.GetString(), out var result) ? result : 0,
        //        _ => 0
        //    };
        //}

        //public static double ParseDoubleOrZero(string value)
        //{
        //    if (string.IsNullOrWhiteSpace(value) || value.Trim() == "NaN")
        //        return 0;

        //    return double.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out double result) ? result : 0;
        //}

        //public static decimal ParseDecimalOrZero(string value)
        //{
        //    if (string.IsNullOrWhiteSpace(value) || value.Trim() == "NaN")
        //        return 0m;

        //    var res = decimal.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out decimal result) ? result : 0m;
        //    return res;
        //}

        #endregion
    }
}