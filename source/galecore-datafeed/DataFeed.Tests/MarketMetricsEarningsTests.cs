using System.Text.Json;
using System.Text.Json.Serialization;
using AutoMapper;
using Microsoft.Extensions.Logging.Abstractions;
using DataFeed.Application.Data.Tastytrade.MarketMetricsVolatility;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using Xunit;

namespace DataFeed.Tests
{
    /// <summary>
    /// WS-0042: balance, consenso, perfil y dividendos que Tastytrade ya traía en /market-metrics y GaleCore descartaba.
    /// JSON grabado con la forma de la respuesta real (AAPL y SPY, 16/10/2026): nunca se llama a la red.
    /// </summary>
    public class MarketMetricsEarningsTests
    {
        private const string Json = """
            {"data":{"items":[
              {"symbol":"AAPL","sector":"Technology","industry":"Consumer Electronics","listed-market":"XNAS",
               "earnings-per-share":"8.69","price-earnings-ratio":"38.7",
               "dividend-ex-date":"2026-08-10","dividend-pay-date":"2026-08-13","dividend-rate-per-share":"0.27","dividend-yield":"0.004",
               "earnings":{"visible":true,"expected-report-date":"2026-11-02","estimated":false,"time-of-day":"AMC",
                           "quarter-end-date":"2026-09-01","consensus-estimate":"1.98","actual-eps":"1.85"}},
              {"symbol":"SPY","earnings":{"visible":false}}
            ]}}
            """;

        private static List<MarketMetricsVolatilityDto> Map()
        {
            var cfg = new MapperConfiguration(c => c.AddProfile<MarketMetricsVolatilityMapperProfile>(), NullLoggerFactory.Instance);
            var model = JsonSerializer.Deserialize<MarketMetricsVolatilityModel>(Json, new JsonSerializerOptions
            {
                NumberHandling = JsonNumberHandling.AllowReadingFromString,
                PropertyNameCaseInsensitive = true
            })!;
            return cfg.CreateMapper().Map<List<MarketMetricsVolatilityDto>>(model.Data.Items);
        }

        [Fact]
        public void Balance_y_consenso_salen_del_bloque_earnings()
        {
            var e = Map().Single(i => i.Symbol == "AAPL").Earnings!;
            Assert.Equal("2026-11-02", e.ExpectedReportDate);
            Assert.Equal("AMC", e.TimeOfDay);
            Assert.False(e.Estimated);
            Assert.Equal(1.98m, e.ConsensusEps);
        }

        [Fact]
        public void Perfil_y_dividendos_se_exponen()
        {
            var a = Map().Single(i => i.Symbol == "AAPL");
            Assert.Equal("Technology", a.Sector);
            Assert.Equal("2026-08-10", a.DividendExDate);
            Assert.Equal(0.27m, a.DividendRatePerShare);
            Assert.Equal(38.7m, a.PriceEarningsRatio);
        }

        [Fact]
        public void ETF_sin_balance_devuelve_earnings_nulo()
        {
            Assert.Null(Map().Single(i => i.Symbol == "SPY").Earnings);
        }
    }
}
