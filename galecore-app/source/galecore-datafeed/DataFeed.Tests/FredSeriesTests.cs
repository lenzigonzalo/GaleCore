using System.Net;
using System.Text;
using DataFeed.Application.Data.Fred.Series;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace DataFeed.Tests
{
    /// <summary>
    /// WS-0014: series de FRED a demanda (reemplazo de tools/fred_query.py de GaleCore-AI), con metadatos, vintage y la URL
    /// sin la clave. Respuestas grabadas: nunca se llama a la red.
    /// </summary>
    public class FredSeriesTests
    {
        private const string Meta = """
            {"realtime_start":"2026-10-06","realtime_end":"2026-10-06","seriess":[{"id":"DGS10","realtime_start":"2026-10-06",
            "realtime_end":"2026-10-06","title":"Market Yield on U.S. Treasury Securities at 10-Year Constant Maturity","observation_start":"1962-01-02",
            "observation_end":"2026-10-05","frequency":"Daily","frequency_short":"D","units":"Percent","units_short":"%",
            "seasonal_adjustment":"Not Seasonally Adjusted","seasonal_adjustment_short":"NSA","last_updated":"2026-10-06 15:18:09-05","popularity":95}]}
            """;
        private const string Obs = """
            {"realtime_start":"2026-10-06","realtime_end":"2026-10-06","observation_start":"2026-10-01","observation_end":"2026-10-06",
            "units":"lin","count":4,"offset":0,"limit":10000,"observations":[
             {"realtime_start":"2026-10-06","realtime_end":"2026-10-06","date":"2026-10-01","value":"5.29"},
             {"realtime_start":"2026-10-06","realtime_end":"2026-10-06","date":"2026-10-02","value":"5.30"},
             {"realtime_start":"2026-10-06","realtime_end":"2026-10-06","date":"2026-10-05","value":"5.31"},
             {"realtime_start":"2026-10-06","realtime_end":"2026-10-06","date":"2026-10-06","value":"."}]}
            """;

        private sealed class Recorded : HttpMessageHandler
        {
            private readonly Func<HttpRequestMessage, HttpResponseMessage> _answer;
            public List<string> Urls { get; } = new();

            public Recorded(Func<HttpRequestMessage, HttpResponseMessage> answer) => _answer = answer;

            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            {
                Urls.Add(request.RequestUri!.ToString());
                return Task.FromResult(_answer(request));
            }
        }

        private sealed class Factory : IHttpClientFactory
        {
            private readonly HttpMessageHandler _handler;
            public Factory(HttpMessageHandler handler) => _handler = handler;
            public HttpClient CreateClient(string name) => new(_handler, disposeHandler: false);
        }

        private static HttpResponseMessage Json(string body, HttpStatusCode code = HttpStatusCode.OK) =>
            new(code) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

        private static IConfiguration Config(string? key = "SECRETKEY") =>
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["FredApi:Key"] = key }).Build();

        private static Recorded Answers() =>
            new(r => Json(r.RequestUri!.AbsolutePath.EndsWith("/observations") ? Obs : Meta));

        [Fact]
        public async Task Serie_PaginaHtmlDeMantenimientoSeDiceAsiYNoCambioDeForma()
        {
            var http = new Recorded(_ => new HttpResponseMessage(HttpStatusCode.OK)
            { Content = new StringContent("<!doctype html><title>Site Maintenance</title>", Encoding.UTF8, "text/html") });
            var handler = new FredSeriesHandler(Config(), new Factory(http));
            var ex = await Assert.ThrowsAsync<UpstreamSourceException>(() => handler.Handle(
                new FredSeriesRequest { SeriesId = "dgs10", From = new DateTime(2026, 10, 1), To = new DateTime(2026, 10, 6) }, default));
            Assert.Contains("mantenimiento", ex.Message);
            Assert.DoesNotContain("cambió de forma", ex.Message);
        }

        [Fact]
        public async Task Serie_TraeMetadatosVintageYObservacionesSinLaClaveEnLaProcedencia()
        {
            var http = Answers();
            var handler = new FredSeriesHandler(Config(), new Factory(http));
            var result = await handler.Handle(new FredSeriesRequest { SeriesId = "dgs10", From = new DateTime(2026, 10, 1), To = new DateTime(2026, 10, 6) }, default);

            Assert.Equal("fred", result.Source);
            Assert.DoesNotContain("SECRETKEY", result.UpstreamUrl);
            Assert.All(http.Urls, u => Assert.Contains("api_key=SECRETKEY", u));
            Assert.Equal("Percent", result.Data.Units);
            Assert.Equal("Not Seasonally Adjusted", result.Data.SeasonalAdjustment);
            Assert.Equal("2026-10-06", result.Data.RealtimeStart);
            Assert.Equal(4, result.Data.Observations.Count);
            Assert.Null(result.Data.Observations[^1].Value);
            Assert.Equal("2026-10-05", result.AsOf);
            Assert.Contains(result.Notes, n => n.Contains("Vintage"));
        }

        [Fact]
        public async Task Serie_QueNoExisteEsUpstreamConElMotivoDeFred()
        {
            var http = new Recorded(_ => Json("""{"error_code":400,"error_message":"Bad Request.  The series does not exist."}""", HttpStatusCode.BadRequest));
            var handler = new FredSeriesHandler(Config(), new Factory(http));
            var ex = await Assert.ThrowsAsync<UpstreamSourceException>(() => handler.Handle(new FredSeriesRequest { SeriesId = "NOEXISTE" }, default));
            Assert.Contains("does not exist", ex.Message);
            Assert.DoesNotContain("SECRETKEY", ex.Message);
        }

        [Theory]
        [InlineData("""{"seriess":[]}""")]
        [InlineData("""{"otra":"forma"}""")]
        [InlineData("<html></html>")]
        public async Task Serie_QueCambioDeFormaEsUpstream(string meta)
        {
            var http = new Recorded(r => Json(r.RequestUri!.AbsolutePath.EndsWith("/observations") ? Obs : meta));
            var handler = new FredSeriesHandler(Config(), new Factory(http));
            await Assert.ThrowsAsync<UpstreamSourceException>(() => handler.Handle(new FredSeriesRequest { SeriesId = "DGS10" }, default));
        }

        [Theory]
        [InlineData(null)]
        [InlineData("DGS10&api_key=x")]
        [InlineData("")]
        public async Task Serie_IdInvalidoEsValidacion(string? id)
        {
            var handler = new FredSeriesHandler(Config(), new Factory(Answers()));
            await Assert.ThrowsAsync<ValidationException>(() => handler.Handle(new FredSeriesRequest { SeriesId = id }, default));
        }

        [Fact]
        public async Task Serie_SinClaveConfiguradaLoDice()
        {
            var handler = new FredSeriesHandler(Config(null), new Factory(Answers()));
            var ex = await Assert.ThrowsAsync<UpstreamSourceException>(() => handler.Handle(new FredSeriesRequest { SeriesId = "DGS10" }, default));
            Assert.Contains("FredApi:Key", ex.Message);
        }
    }
}
