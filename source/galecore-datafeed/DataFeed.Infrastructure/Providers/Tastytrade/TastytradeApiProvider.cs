using Microsoft.Extensions.Configuration;
using System.Text.Json;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using DataFeed.Infrastructure.Providers;
using System.Net.Http;
using static System.Runtime.InteropServices.JavaScript.JSType;
using System.Net.Http.Headers;
using System.Text.Json.Serialization;
//using Newtonsoft.Json;
using System.Threading;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    public class TastytradeApiProvider : ITastytradeApiProvider
    {
        private readonly HttpClient _client;
        private readonly ITastytradeOAuth _auth;
        private readonly IConfiguration _config;
        private readonly HttpRequestHeaders _request;

        public TastytradeApiProvider(IConfiguration config, ITastytradeOAuth auth, IHttpClientFactory client)
        {
            _config = config;
            _client = client.CreateClient();
            _client.BaseAddress = new Uri(_config["Tastytrade:BaseUrl"]);
            _auth = auth;

        }

        public async Task<ByTypeModel?> GetMarketDataByTypeAsync(string symbol, CancellationToken cancellationToken)
        {
            _client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            _client.DefaultRequestHeaders.UserAgent.ParseAdd("PostmanRuntime/7.36.0");
            var request = await _auth.CreateOAuthApiRequestAsync($"/market-data/by-type?equity={symbol}");
            var response = await _client.SendAsync(request);
            response.EnsureSuccessStatusCode();

            var content = await response.Content.ReadAsStringAsync();
            // ByTypeModel usa JsonProperty de Newtonsoft, incluidos nombres con guiones.
            // System.Text.Json ignoraba esos nombres y perdía el cierre previo y la fecha.
            var result = Newtonsoft.Json.JsonConvert.DeserializeObject<ByTypeModel>(content);
            return result;
        }

        public async Task<OptionChainsModel?> GetOptionChainsAsync(string symbol, CancellationToken cancellationToken)
        {
            _client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            _client.DefaultRequestHeaders.UserAgent.ParseAdd("PostmanRuntime/7.36.0");
            var request = await _auth.CreateOAuthApiRequestAsync($"/option-chains/{symbol}/nested");
            var response = await _client.SendAsync(request);
            response.EnsureSuccessStatusCode();

            var content = await response.Content.ReadAsStringAsync();
            var result = JsonSerializer.Deserialize<OptionChainsModel>(content, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });

            return result;
        }

        /// <summary>
        /// GET /symbols/search/{query}. Un texto que no matchea nada devuelve items vacío, no error.
        ///
        /// El 404 se trata como "no hay resultados" y no como falla: acá el texto lo escribe una
        /// persona letra por letra, así que un query sin match es el caso NORMAL de la mitad de las
        /// pulsaciones. Con EnsureSuccessStatusCode pelado, escribir "AAPL" tiraría una excepción
        /// por cada prefijo que Tastytrade no reconozca.
        /// </summary>
        public async Task<SymbolSearchModel?> GetSymbolSearchAsync(string query, CancellationToken cancellationToken)
        {
            _client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            _client.DefaultRequestHeaders.UserAgent.ParseAdd("PostmanRuntime/7.36.0");
            var request = await _auth.CreateOAuthApiRequestAsync($"/symbols/search/{Uri.EscapeDataString(query)}");
            var response = await _client.SendAsync(request, cancellationToken);

            if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
                return new SymbolSearchModel { Data = new SymbolSearchData { Items = new List<SymbolSearchItem>() } };

            response.EnsureSuccessStatusCode();

            var content = await response.Content.ReadAsStringAsync(cancellationToken);
            return JsonSerializer.Deserialize<SymbolSearchModel>(content, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
        }

        /// <summary>
        /// Sólo <c>error.code</c> y <c>error.message</c> del cuerpo, sin caracteres de control y recortados.
        /// El cuerpo crudo no se reenvía: termina en logs y en la respuesta de la API, y no se controla
        /// qué puede traer (Codex, WS-0013).
        /// </summary>
        public static string BrokerErrorSummary(string body)
        {
            static string Clean(string? s) =>
                new string((s ?? "").Where(c => !char.IsControl(c)).Take(120).ToArray());
            try
            {
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("error", out var err) && err.ValueKind == JsonValueKind.Object)
                {
                    var code = err.TryGetProperty("code", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() : null;
                    var msg = err.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() : null;
                    if (code != null || msg != null) return $"{Clean(code)} \"{Clean(msg)}\"";
                }
            }
            catch (JsonException) { }
            return $"(cuerpo sin error reconocible, {body.Length} caracteres)";
        }

        /// <summary>
        /// Como EnsureSuccessStatusCode, pero el error lleva lo que contestó Tastytrade (recortado). Sin
        /// eso un 403 de cuenta era indiagnosticable: el cuerpo dice si es la cuenta, el permiso del
        /// token o la sesión (BL-015). El cuerpo es el error del broker; no lleva el token.
        /// </summary>
        public static async Task EnsureAccountSuccessAsync(HttpResponseMessage response)
        {
            if (response.IsSuccessStatusCode) return;
            var body = "";
            if (response.Content != null)
            {
                // El cliente pide gzip pero no descomprime solo: sin esto el error se lee como binario.
                var bytes = await response.Content.ReadAsByteArrayAsync();
                if (response.Content.Headers.ContentEncoding.Contains("gzip"))
                {
                    try
                    {
                        using var gz = new System.IO.Compression.GZipStream(new MemoryStream(bytes), System.IO.Compression.CompressionMode.Decompress);
                        using var plain = new MemoryStream();
                        await gz.CopyToAsync(plain);
                        bytes = plain.ToArray();
                    }
                    catch (InvalidDataException)
                    {
                        // Un gzip roto no puede tapar el status que se quería diagnosticar.
                        bytes = Array.Empty<byte>();
                    }
                }
                body = System.Text.Encoding.UTF8.GetString(bytes);
            }
            throw new HttpRequestException(
                $"Response status code does not indicate success: {(int)response.StatusCode} ({response.ReasonPhrase}). Tastytrade: {BrokerErrorSummary(body)}",
                null, response.StatusCode);
        }

        /// <param name="credential">
        /// Credencial con la que se pide. Los datos de cuenta son POR USUARIO: pedirlos con la
        /// credencial equivocada devuelve, sin error visible, las posiciones de otra persona. Si
        /// viene null se usa la de sistema, que es el comportamiento previo a multi-usuario.
        /// </param>
        public async Task<AccountBalancesModel?> GetAccountBalancesAsync(string accountNumber, CancellationToken cancellationToken, TastytradeCredential? credential = null)
        {
            _client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            _client.DefaultRequestHeaders.UserAgent.ParseAdd("PostmanRuntime/7.36.0");
            var request = credential == null
                ? await _auth.CreateOAuthApiRequestAsync($"/accounts/{accountNumber}/balances")
                : await _auth.CreateOAuthApiRequestAsync($"/accounts/{accountNumber}/balances", credential);
            var response = await _client.SendAsync(request);
            await EnsureAccountSuccessAsync(response);

            var content = await response.Content.ReadAsStringAsync();
            var options = new JsonSerializerOptions
            {
                NumberHandling = JsonNumberHandling.AllowReadingFromString,
                PropertyNameCaseInsensitive = true
            };
            return JsonSerializer.Deserialize<AccountBalancesModel>(content, options);
        }

        /// <summary>
        /// GET /accounts/{n}/net-liq/history?time-back=1y — valor de la cuenta al cierre de cada día (WS-0036, resultado
        /// por períodos en Inicio). Devuelve (fecha, cierre) en orden.
        /// </summary>
        public async Task<List<(DateTime Time, decimal Close)>> GetNetLiqHistoryAsync(string accountNumber, string timeBack,
            CancellationToken cancellationToken, TastytradeCredential? credential = null)
        {
            _client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            _client.DefaultRequestHeaders.UserAgent.ParseAdd("PostmanRuntime/7.36.0");
            var path = $"/accounts/{accountNumber}/net-liq/history?time-back={Uri.EscapeDataString(timeBack)}";
            var request = credential == null ? await _auth.CreateOAuthApiRequestAsync(path) : await _auth.CreateOAuthApiRequestAsync(path, credential);
            var response = await _client.SendAsync(request, cancellationToken);
            await EnsureAccountSuccessAsync(response);
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            var points = new List<(DateTime, decimal)>();
            if (doc.RootElement.TryGetProperty("data", out var data) && data.TryGetProperty("items", out var items))
                foreach (var it in items.EnumerateArray())
                {
                    if (!it.TryGetProperty("time", out var t) || !it.TryGetProperty("close", out var c)) continue;
                    var close = c.ValueKind == JsonValueKind.Number ? c.GetDecimal()
                        : decimal.TryParse(c.GetString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : (decimal?)null;
                    if (close != null && DateTime.TryParse(t.GetString(), System.Globalization.CultureInfo.InvariantCulture,
                        System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var time))
                        points.Add((time, close.Value));
                }
            return points.OrderBy(p => p.Item1).ToList();
        }

        /// <param name="credential">Ver <see cref="GetAccountBalancesAsync"/>: null = credencial de sistema.</param>
        public async Task<AccountPositionsModel?> GetAccountPositionsAsync(string accountNumber, CancellationToken cancellationToken, TastytradeCredential? credential = null)
        {
            _client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            _client.DefaultRequestHeaders.UserAgent.ParseAdd("PostmanRuntime/7.36.0");
            var request = credential == null
                ? await _auth.CreateOAuthApiRequestAsync($"/accounts/{accountNumber}/positions")
                : await _auth.CreateOAuthApiRequestAsync($"/accounts/{accountNumber}/positions", credential);
            var response = await _client.SendAsync(request);
            await EnsureAccountSuccessAsync(response);

            var content = await response.Content.ReadAsStringAsync();
            var options = new JsonSerializerOptions
            {
                NumberHandling = JsonNumberHandling.AllowReadingFromString,
                PropertyNameCaseInsensitive = true
            };
            return JsonSerializer.Deserialize<AccountPositionsModel>(content, options);
        }

        /// <summary>
        /// GET /instruments/futures?product-code[]=ES&amp;... — los contratos listados de cada producto, con la marca
        /// <c>active-month</c> de Tastytrade y el símbolo de DXLink (Macro, WS-0036).
        /// </summary>
        public async Task<FuturesModel?> GetFuturesAsync(IEnumerable<string> productCodes, CancellationToken cancellationToken)
        {
            _client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            _client.DefaultRequestHeaders.UserAgent.ParseAdd("PostmanRuntime/7.36.0");
            var query = string.Join("&", productCodes.Select(c => "product-code[]=" + Uri.EscapeDataString(c)));
            var request = await _auth.CreateOAuthApiRequestAsync($"/instruments/futures?{query}");
            var response = await _client.SendAsync(request, cancellationToken);
            response.EnsureSuccessStatusCode();
            var content = await response.Content.ReadAsStringAsync(cancellationToken);
            return JsonSerializer.Deserialize<FuturesModel>(content, new JsonSerializerOptions
            {
                NumberHandling = JsonNumberHandling.AllowReadingFromString,
                PropertyNameCaseInsensitive = true
            });
        }

        public async Task<MarketMetricsVolatilityModel?> GetMarketMetricsVolatilityAsync(string symbols, CancellationToken cancellationToken)
        {
            _client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            _client.DefaultRequestHeaders.UserAgent.ParseAdd("PostmanRuntime/7.36.0");
            var request = await _auth.CreateOAuthApiRequestAsync($"/market-metrics?symbols={Uri.EscapeDataString(symbols)}");
            var response = await _client.SendAsync(request);
            response.EnsureSuccessStatusCode();

            var content = await response.Content.ReadAsStringAsync();
            var options = new JsonSerializerOptions
            {
                NumberHandling = JsonNumberHandling.AllowReadingFromString,
                PropertyNameCaseInsensitive = true
            };
            return JsonSerializer.Deserialize<MarketMetricsVolatilityModel>(content, options);
        }
    }
}
