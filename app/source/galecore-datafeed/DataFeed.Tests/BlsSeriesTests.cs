using System.Net;
using System.Text;
using DataFeed.Application.Data.Bls.Series;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers;
using DataFeed.Infrastructure.Providers.Bls;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace DataFeed.Tests
{
    /// <summary>
    /// WS-0014: valores oficiales del BLS (API v2) con procedencia. Respuestas grabadas (recorte de la real del 06/10/2026):
    /// nunca se llama a la red; un pedido rechazado (el BLS contesta 200) es error, no una lista vacía.
    /// </summary>
    public class BlsSeriesTests
    {
        private const string Ok = """
            {"status":"REQUEST_SUCCEEDED","responseTime":120,"message":[],"Results":{"series":[
             {"seriesID":"CUUR0000SA0","data":[
              {"year":"2026","period":"M08","periodName":"August","latest":"true","value":"334.980","footnotes":[{}]},
              {"year":"2026","period":"M07","periodName":"July","value":"334.100","footnotes":[{"code":"P","text":"preliminary"}]}]},
             {"seriesID":"LNS14000000","data":[
              {"year":"2026","period":"M09","periodName":"September","latest":"true","value":"4.2","footnotes":[{}]}]}]}}
            """;
        private const string Quota = """
            {"status":"REQUEST_NOT_PROCESSED","responseTime":10,"message":["Request could not be serviced, as the daily threshold for total number of requests allocated to the user has been reached."],"Results":{}}
            """;

        private sealed class Recorded : HttpMessageHandler
        {
            private readonly Func<HttpRequestMessage, HttpResponseMessage> _answer;
            public List<string> Bodies { get; } = new();

            public Recorded(Func<HttpRequestMessage, HttpResponseMessage> answer) => _answer = answer;

            protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            {
                Bodies.Add(await request.Content!.ReadAsStringAsync(ct));
                return _answer(request);
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

        private static IConfiguration Config(string? key = null) =>
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Bls:Key"] = key }).Build();

        public BlsSeriesTests() => BlsProvider.ClearCache();

        [Fact]
        public async Task Series_OrdenaPorPeriodoMarcaPreliminarYUsaLaCache()
        {
            var http = new Recorded(_ => Json(Ok));
            var handler = new BlsSeriesHandler(Config(), new Factory(http));
            var request = new BlsSeriesRequest { Ids = "cuur0000sa0, LNS14000000", StartYear = 2026, EndYear = 2026 };
            var result = await handler.Handle(request, default);

            Assert.Equal("bls", result.Source);
            Assert.Equal("2026-M09", result.AsOf);
            var cpi = result.Data[0];
            Assert.Equal(new[] { "M07", "M08" }, cpi.Observations.Select(o => o.Period));
            Assert.Equal(new[] { "preliminary" }, cpi.Observations[0].Footnotes);
            Assert.True(cpi.Observations[1].Latest);
            Assert.Contains(result.Notes, n => n.Contains("Sin clave"));
            Assert.DoesNotContain("registrationkey", http.Bodies[0]);

            Assert.True((await handler.Handle(request, default)).FromCache);
            Assert.Single(http.Bodies);
        }

        [Fact]
        public async Task Series_ConClaveLaMandaEnElPedidoYNoEnLaProcedencia()
        {
            var http = new Recorded(_ => Json(Ok));
            var result = await new BlsSeriesHandler(Config("SECRETKEY"), new Factory(http))
                .Handle(new BlsSeriesRequest { Ids = "CUUR0000SA0,LNS14000000", StartYear = 2026, EndYear = 2026 }, default);
            Assert.Contains("SECRETKEY", http.Bodies[0]);
            Assert.DoesNotContain("SECRETKEY", result.UpstreamUrl + string.Join(" ", result.Notes));
        }

        [Fact]
        public async Task CupoAgotadoEsUpstreamConElMensajeDelBls()
        {
            var handler = new BlsSeriesHandler(Config(), new Factory(new Recorded(_ => Json(Quota))));
            var ex = await Assert.ThrowsAsync<UpstreamSourceException>(() =>
                handler.Handle(new BlsSeriesRequest { Ids = "CUUR0000SA0", StartYear = 2026, EndYear = 2026 }, default));
            Assert.Contains("daily threshold", ex.Message);
        }

        [Fact]
        public void SeriePedidaQueNoVuelveEsError()
        {
            var ex = Assert.Throws<UpstreamSourceException>(() => BlsProvider.Parse(Ok, new[] { "CUUR0000SA0", "NOEXISTE00" }));
            Assert.Contains("NOEXISTE00", ex.Message);
        }

        [Theory]
        [InlineData("{\"status\":\"REQUEST_SUCCEEDED\",\"Results\":{}}")]
        [InlineData("<html></html>")]
        public void RespuestaQueCambioDeFormaEsError(string json)
        {
            Assert.Throws<UpstreamSourceException>(() => BlsProvider.Parse(json, new[] { "CUUR0000SA0" }));
        }

        [Theory]
        [InlineData(null, null, null)]
        [InlineData("CPI;DROP", null, null)]
        [InlineData("CUUR0000SA0", 2010, 2026)]
        [InlineData("CUUR0000SA0", 2026, 2025)]
        public async Task ParametrosInvalidosSonValidacion(string? ids, int? start, int? end)
        {
            var handler = new BlsSeriesHandler(Config(), new Factory(new Recorded(_ => Json(Ok))));
            await Assert.ThrowsAsync<ValidationException>(() =>
                handler.Handle(new BlsSeriesRequest { Ids = ids, StartYear = start, EndYear = end }, default));
        }
    }
}
