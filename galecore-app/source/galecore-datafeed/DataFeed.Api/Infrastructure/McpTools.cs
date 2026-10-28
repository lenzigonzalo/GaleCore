using System.ComponentModel;
using System.Text.Json;
using MediatR;
using ModelContextProtocol.Server;
using DataFeed.Application.Data.Tastytrade.MarketDataByType;
using DataFeed.Application.Data.Tastytrade.MarketDataCandle;
using DataFeed.Application.Data.Tastytrade.MarketDataTrade;
using DataFeed.Application.Data.Tastytrade.MarketDataQuote;
using DataFeed.Application.Data.Tastytrade.MarketDataGreeks;
using DataFeed.Application.Data.Tastytrade.MarketDataTradeQuoteGreeks;
using DataFeed.Application.Data.Tastytrade.OptionChains;
using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.ImpliedVolatility;
using DataFeed.Application.App.IVRank;

namespace DataFeed.Infrastructure
{
    [McpServerToolType]
    public static class McpTools
    {
        private static readonly JsonSerializerOptions _jsonOptions = new()
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            // Sin esto, TODOS los tools de market data fallaban con cualquier símbolo que trajera
            // datos reales: dxFeed manda NaN en los campos que no aplican (un índice no tiene volumen)
            // y System.Text.Json se niega a escribirlo. Ver NonFiniteDoubleConverter.
            Converters = { new DataFeed.Application.Shared.NonFiniteDoubleConverter() },
        };

        [McpServerTool, Description("Obtiene datos de mercado por tipo para un símbolo de equity. Devuelve precio, volumen y datos fundamentales.")]
        public static async Task<string> GetMarketDataByType(
            [Description("Símbolo del equity (ej: AAPL, MSFT, TSLA)")] string symbol,
            IMediator mediator)
        {
            var response = await mediator.Send(new MarketDataByTypeRequest { Symbol = symbol });
            return JsonSerializer.Serialize(response, _jsonOptions);
        }

        [McpServerTool, Description("Obtiene la cadena de opciones (option chain) para un símbolo. Incluye todas las expiraciones y strikes disponibles.")]
        public static async Task<string> GetOptionChains(
            [Description("Símbolo del subyacente (ej: AAPL, MSFT)")] string symbol,
            IMediator mediator)
        {
            var response = await mediator.Send(new OptionChainsRequest { Symbol = symbol });
            return JsonSerializer.Serialize(response, _jsonOptions);
        }

        [McpServerTool, Description("Obtiene candles históricos (OHLCV) para una opción. Incluye volatilidad implícita y Greeks calculados (Delta, Gamma, Theta) via Black-Scholes.")]
        public static async Task<string> GetMarketDataCandle(
            [Description("Símbolo de opción en formato OCC de 21 caracteres (ej: AAPL  250815C00215000)")] string symbol,
            [Description("Intervalo de las candles: d (diario), 1h, 30m, 15m, 5m, 1m")] string interval,
            [Description("Fecha desde en formato yyyy-MM-dd")] string fromTime,
            [Description("Fecha hasta en formato yyyy-MM-dd (opcional, si no se indica trae hasta hoy)")] string toTime,
            IMediator mediator)
        {
            var request = new MarketDataCandleRequest
            {
                Symbol = symbol,
                Interval = interval,
                FromTime = DateTime.Parse(fromTime)
            };

            if (!string.IsNullOrEmpty(toTime))
                request.ToTime = DateTime.Parse(toTime);

            var response = await mediator.Send(request);
            return JsonSerializer.Serialize(response, _jsonOptions);
        }

        [McpServerTool, Description("Obtiene el último trade (precio, volumen, dirección) para un símbolo via WebSocket DXLink.")]
        public static async Task<string> GetMarketDataTrade(
            [Description("Símbolo del equity o opción en formato OCC")] string symbol,
            IMediator mediator)
        {
            var response = await mediator.Send(new MarketDataTradeRequest { Symbol = symbol });
            return JsonSerializer.Serialize(response, _jsonOptions);
        }

        [McpServerTool, Description("Obtiene la cotización actual (bid/ask/mid) para un símbolo de opción via WebSocket DXLink.")]
        public static async Task<string> GetMarketDataQuote(
            [Description("Símbolo de opción en formato OCC de 21 caracteres")] string symbol,
            IMediator mediator)
        {
            var response = await mediator.Send(new MarketDataQuoteRequest { Symbol = symbol });
            return JsonSerializer.Serialize(response, _jsonOptions);
        }

        [McpServerTool, Description("Obtiene los Greeks actuales (Delta, Gamma, Theta, Vega, Rho, IV) para un símbolo de opción via WebSocket DXLink.")]
        public static async Task<string> GetMarketDataGreeks(
            [Description("Símbolo de opción en formato OCC de 21 caracteres")] string symbol,
            IMediator mediator)
        {
            var response = await mediator.Send(new MarketDataGreeksRequest { Symbol = symbol });
            return JsonSerializer.Serialize(response, _jsonOptions);
        }

        [McpServerTool, Description("Obtiene Trade + Quote + Greeks en una sola llamada optimizada (una sola conexión WebSocket). Greeks se incluye solo si el símbolo es una opción.")]
        public static async Task<string> GetTradeQuoteGreeks(
            [Description("Símbolo del equity o opción en formato OCC")] string symbol,
            IMediator mediator)
        {
            var response = await mediator.Send(new MarketDataTradeQuoteGreeksRequest { Symbol = symbol });
            return JsonSerializer.Serialize(response, _jsonOptions);
        }

        [McpServerTool, Description("Calcula Gamma Exposure (GEX) por strike para un símbolo. Usa una sola conexión WebSocket para obtener OI e IV de todas las opciones de la expiración regular más cercana (hasta 60 DTE), y calcula Greeks con Black-Scholes. Devuelve GEX por strike, delta, gamma, OI, y el nivel Gamma Zero.")]
        public static async Task<string> GetGammaExposure(
            [Description("Símbolo del subyacente (ej: AAPL, MSFT, SPY)")] string symbol,
            [Description("Delta mínimo absoluto para filtrar strikes (default: 0.10)")] double minDelta,
            [Description("Máximo DTE para filtrar expiraciones regulares (default: 60)")] int maxDTE,
            IMediator mediator)
        {
            var response = await mediator.Send(new GammaExposureRequest
            {
                Symbol = symbol,
                MaxDTE = maxDTE > 0 ? maxDTE : 60
            });
            return JsonSerializer.Serialize(response, _jsonOptions);
        }

        [McpServerTool, Description("Calcula IV Rank e IV Percentile de un símbolo usando los últimos 252 trading days. Devuelve IV actual, máxima, mínima, IV Rank, IV Percentile y el historial diario de IV con precio de cierre.")]
        public static async Task<string> GetIVRank(
            [Description("Símbolo del subyacente (ej: AAPL, MSFT, SPY)")] string symbol,
            IMediator mediator)
        {
            var response = await mediator.Send(new IVRankRequest { Symbol = symbol });
            return JsonSerializer.Serialize(response, _jsonOptions);
        }

        [McpServerTool, Description("Calcula la volatilidad implícita de un símbolo vía REST market-metrics. Devuelve IV30_9d (9 días DTE), IV30_30d (30 días DTE) e IV30_90d (90 días DTE) interpolados desde expirationImpliedVolatilities, junto con IV30_0d e IV30_5d para calcular IV30RocPct (tasa de cambio 5 sesiones).")]
        public static async Task<string> GetImpliedVolatility(
            [Description("Símbolo del subyacente (ej: AAPL, MSFT, SPY)")] string symbol,
            IMediator mediator)
        {
            var response = await mediator.Send(new ImpliedVolatilityRequest { Symbol = symbol });
            return JsonSerializer.Serialize(response, _jsonOptions);
        }
    }
}
