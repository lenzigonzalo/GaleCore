using System.Net;
using System.Text;
using DataFeed.Application.Data.Sec;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers;
using DataFeed.Infrastructure.Providers.Sec;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace DataFeed.Tests
{
    /// <summary>
    /// WS-0014: SEC EDGAR (empresas, presentaciones y hechos XBRL) con procedencia y el User-Agent de la configuración.
    /// Respuestas grabadas (recortes de las reales del 06/10/2026): nunca se llama a la red.
    /// </summary>
    public class SecEdgarTests
    {
        private const string Tickers = """{"0":{"cik_str":320193,"ticker":"AAPL","title":"Apple Inc."},"1":{"cik_str":789019,"ticker":"MSFT","title":"MICROSOFT CORP"}}""";
        private const string Submissions = """
            {"cik":"0000320193","name":"Apple Inc.","sic":"3571","sicDescription":"Electronic Computers","tickers":["AAPL"],
             "filings":{"recent":{
              "accessionNumber":["0000320193-26-000101","0000320193-26-000090","0000320193-26-000080"],
              "filingDate":["2026-10-05","2026-07-31","2026-05-01"],
              "reportDate":["2026-10-03","2026-07-31","2026-03-28"],
              "acceptanceDateTime":["2026-10-05T18:00:00.000Z","2026-07-31T20:30:00.000Z","2026-05-01T20:30:00.000Z"],
              "form":["4","8-K","10-Q"],
              "items":["","2.02,9.01",""],
              "primaryDocument":["xslF345X06/form4.xml","aapl-20260731.htm","aapl-20260328.htm"],
              "primaryDocDescription":["","8-K",""]},"files":[]}}
            """;
        private const string Concept = """
            {"cik":320193,"taxonomy":"us-gaap","tag":"Revenues","label":"Revenues","description":"Amount of revenue","entityName":"Apple Inc.",
             "units":{"USD":[
              {"start":"2018-07-01","end":"2018-09-29","val":62900000000,"accn":"0000320193-18-000145","fy":2018,"fp":"FY","form":"10-K","filed":"2018-11-05","frame":"CY2018Q3"},
              {"start":"2026-04-01","end":"2026-06-27","val":94000000000,"accn":"0000320193-26-000090","fy":2026,"fp":"Q3","form":"10-Q","filed":"2026-08-01"}]}}
            """;

        private sealed class Recorded : HttpMessageHandler
        {
            private readonly Func<HttpRequestMessage, HttpResponseMessage> _answer;
            public List<HttpRequestMessage> Requests { get; } = new();

            public Recorded(Func<HttpRequestMessage, HttpResponseMessage> answer) => _answer = answer;

            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            {
                Requests.Add(request);
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

        private static IConfiguration Config(string? ua = "GaleCore test contacto@example.com") =>
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["SecEdgar:UserAgent"] = ua }).Build();

        private static Recorded Edgar() => new(r =>
        {
            var url = r.RequestUri!.ToString();
            return url.Contains("company_tickers") ? Json(Tickers)
                : url.Contains("/submissions/") ? Json(Submissions)
                : url.Contains("/companyconcept/") ? Json(Concept)
                : Json("", HttpStatusCode.NotFound);
        });

        public SecEdgarTests() => SecEdgarProvider.ClearCache();

        [Fact]
        public async Task Filings_PorTickerFiltraFormularioYFechaConUrlEItemsDelOchoK()
        {
            var http = Edgar();
            var handler = new SecFilingsHandler(Config(), new Factory(http));
            var result = await handler.Handle(new SecFilingsRequest { Ticker = "aapl", Forms = "8-K,10-Q", Since = new DateTime(2026, 6, 1) }, default);

            Assert.Equal("sec", result.Source);
            Assert.Equal("https://data.sec.gov/submissions/CIK0000320193.json", result.UpstreamUrl);
            Assert.Equal("2026-10-05", result.AsOf);
            var filing = Assert.Single(result.Data.Filings);
            Assert.Equal("8-K", filing.Form);
            Assert.Equal(new[] { "2.02", "9.01" }, filing.Items);
            Assert.Equal("https://www.sec.gov/Archives/edgar/data/320193/000032019326000090/aapl-20260731.htm", filing.Url);
            Assert.All(http.Requests, r => Assert.Contains("contacto@example.com", string.Join(" ", r.Headers.GetValues("User-Agent"))));
        }

        [Fact]
        public async Task Facts_PorCikFiltraPorFinDePeriodo()
        {
            var http = Edgar();
            var handler = new SecFactsHandler(Config(), new Factory(http));
            var result = await handler.Handle(new SecFactsRequest { Cik = "320193", Tag = "Revenues", Since = new DateTime(2026, 1, 1) }, default);

            Assert.Equal("https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/Revenues.json", result.UpstreamUrl);
            var fact = Assert.Single(result.Data.Facts);
            Assert.Equal(94_000_000_000m, fact.Value);
            Assert.Equal("Q3", fact.FiscalPeriod);
            Assert.Null(fact.Frame);
            Assert.Single(http.Requests); // con CIK no hace falta la lista de tickers
        }

        [Fact]
        public async Task Company_ResuelveTickerYCacheaLaLista()
        {
            var http = Edgar();
            var handler = new SecCompanyHandler(Config(), new Factory(http));
            var aapl = await handler.Handle(new SecCompanyRequest { Ticker = "AAPL" }, default);
            var msft = await handler.Handle(new SecCompanyRequest { Ticker = "MSFT" }, default);
            Assert.Equal("0000320193", aapl.Data.Cik);
            Assert.Equal("0000789019", msft.Data.Cik);
            Assert.Single(http.Requests);
        }

        [Fact]
        public async Task TickerQueLaSecNoListaEsUpstreamNoVacio()
        {
            var handler = new SecFilingsHandler(Config(), new Factory(Edgar()));
            var ex = await Assert.ThrowsAsync<UpstreamSourceException>(() => handler.Handle(new SecFilingsRequest { Ticker = "ZZZZ" }, default));
            Assert.Contains("ZZZZ", ex.Message);
        }

        [Fact]
        public async Task SinUserAgentConfiguradoLoDiceSinLlamarALaSec()
        {
            var http = Edgar();
            var handler = new SecFilingsHandler(Config(null), new Factory(http));
            var ex = await Assert.ThrowsAsync<UpstreamSourceException>(() => handler.Handle(new SecFilingsRequest { Cik = "320193" }, default));
            Assert.Contains("SecEdgar:UserAgent", ex.Message);
            Assert.Empty(http.Requests);
        }

        [Theory]
        [InlineData("{\"cik\":\"1\",\"name\":\"X\",\"tickers\":[],\"filings\":{}}")]
        [InlineData("<html>Request Rate Threshold Exceeded</html>")]
        public void Submissions_QueCambiaronDeFormaSonError(string json)
        {
            Assert.Throws<UpstreamSourceException>(() => SecEdgarProvider.ParseSubmissions(json));
        }

        [Fact]
        public async Task FuenteCaidaEs502()
        {
            var handler = new SecFactsHandler(Config(), new Factory(new Recorded(_ => Json("", HttpStatusCode.Forbidden))));
            var ex = await Assert.ThrowsAsync<UpstreamSourceException>(() => handler.Handle(new SecFactsRequest { Cik = "320193", Tag = "Revenues" }, default));
            Assert.Contains("403", ex.Message);
        }

        [Theory]
        [InlineData(null, null, "Revenues")]
        [InlineData(null, "12ab", "Revenues")]
        [InlineData(null, "320193", "Revenues/../x")]
        [InlineData("us gaap", "320193", "Revenues")]
        public async Task ParametrosInvalidosSonValidacion(string? taxonomy, string? cik, string tag)
        {
            var handler = new SecFactsHandler(Config(), new Factory(Edgar()));
            await Assert.ThrowsAsync<ValidationException>(() =>
                handler.Handle(new SecFactsRequest { Taxonomy = taxonomy, Cik = cik, Tag = tag }, default));
        }
    }
}
