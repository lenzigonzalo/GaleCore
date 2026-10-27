using System.Net;
using System.Text;
using DataFeed.Application.Data.Treasury;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers;
using DataFeed.Infrastructure.Providers.Treasury;
using Xunit;

namespace DataFeed.Tests
{
    /// <summary>
    /// WS-0014: curva par diaria y subastas próximas del Tesoro, con procedencia. Respuestas grabadas (recortes de las
    /// reales del 06/10/2026): nunca se llama a la red, y una respuesta que cambió de forma es error.
    /// </summary>
    public class TreasurySourcesTests
    {
        private const string Curve2026 = "Date,\"1 Mo\",\"1.5 Month\",\"2 Mo\",\"3 Mo\",\"4 Mo\",\"6 Mo\",\"1 Yr\",\"2 Yr\",\"3 Yr\",\"5 Yr\",\"7 Yr\",\"10 Yr\",\"20 Yr\",\"30 Yr\"\n"
            + "10/06/2026,4.06,4.12,4.13,4.21,4.26,4.28,4.46,4.79,4.88,5.03,5.15,5.27,5.68,5.64\n"
            + "10/05/2026,4.05,4.10,4.13,4.22,4.27,4.30,4.47,4.84,4.97,5.06,5.19,5.31,5.70,5.66\n";
        private const string Curve2025 = "Date,\"1 Mo\",\"2 Mo\",\"3 Mo\",\"6 Mo\",\"1 Yr\",\"2 Yr\",\"3 Yr\",\"5 Yr\",\"7 Yr\",\"10 Yr\",\"20 Yr\",\"30 Yr\"\n"
            + "12/31/2025,4.10,4.12,4.15,4.20,4.25,4.30,4.35,4.40,4.50,4.60,4.90,4.95\n";
        private const string Auctions = """
            {"data":[
             {"record_date":"2026-10-02","security_type":"Bill","security_term":"17-Week","reopening":"No","cusip":"912797WY9","offering_amt":"75000000000","announcemt_date":"2026-10-06","auction_date":"2026-10-07","issue_date":"2026-10-13"},
             {"record_date":"2026-10-02","security_type":"Bill","security_term":"26-Week","reopening":"Yes","cusip":"912797UE5","offering_amt":"null","announcemt_date":"2026-10-08","auction_date":"2026-10-13","issue_date":"2026-10-15"},
             {"record_date":"2026-09-25","security_type":"Note","security_term":"2-Year","reopening":"No","cusip":"91282CQQ1","offering_amt":"69000000000","announcemt_date":"2026-09-18","auction_date":"2026-09-29","issue_date":"2026-09-30"}
            ],"meta":{"count":3}}
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

        private static HttpResponseMessage Text(string body, HttpStatusCode code = HttpStatusCode.OK) =>
            new(code) { Content = new StringContent(body, Encoding.UTF8, "text/plain") };

        public TreasurySourcesTests() => TreasuryProvider.ClearCache();

        [Fact]
        public void Curva_LeePlazosPorNombreYOrdenaPorFecha()
        {
            var days = TreasuryProvider.ParseCurve(Curve2026);
            Assert.Equal(new DateOnly(2026, 10, 5), days[0].Date);
            Assert.Equal(4.10m, days[0].Rates["1.5M"]);
            Assert.Equal(5.64m, days[1].Rates["30Y"]);
            Assert.Equal(14, days[1].Rates.Count);
            Assert.False(TreasuryProvider.ParseCurve(Curve2025)[0].Rates.ContainsKey("4M"));
        }

        [Theory]
        [InlineData("Fecha,\"1 Mo\"\n10/06/2026,4.06\n")]   // cabecera distinta
        [InlineData("Date,\"1 Week\"\n10/06/2026,4.06\n")]  // plazo desconocido
        [InlineData("Date,\"1 Mo\"\n2026-10-06,4.06\n")]    // formato de fecha distinto
        [InlineData("Date,\"1 Mo\"\n10/06/2026,N/A\n")]     // tasa que no es número
        [InlineData("")]                                    // vacío
        public void Curva_QueCambioDeFormaEsError(string csv)
        {
            Assert.Throws<UpstreamSourceException>(() => TreasuryProvider.ParseCurve(csv));
        }

        [Fact]
        public async Task Curva_RangoQueCruzaElAnioLeeUnCsvPorAnio()
        {
            var http = new Recorded(r => Text(r.RequestUri!.ToString().Contains("/2025/") ? Curve2025 : Curve2026));
            var handler = new TreasuryYieldCurveHandler(new Factory(http));
            var result = await handler.Handle(new TreasuryYieldCurveRequest { From = new DateTime(2025, 12, 1), To = new DateTime(2026, 10, 5) }, default);

            Assert.Equal("treasury", result.Source);
            Assert.Equal(new[] { "2025-12-31", "2026-10-05" }, result.Data.Select(d => d.Date));
            Assert.Equal("2026-10-05", result.AsOf);
            Assert.Equal(2, http.Urls.Count);
            Assert.Contains("2025=sha256:", result.Sha256);
        }

        [Fact]
        public async Task Curva_RangoFueraDeLimitesEsValidacion()
        {
            var handler = new TreasuryYieldCurveHandler(new Factory(new Recorded(_ => Text(Curve2026))));
            await Assert.ThrowsAsync<ValidationException>(() =>
                handler.Handle(new TreasuryYieldCurveRequest { From = new DateTime(2015, 1, 1), To = new DateTime(2026, 1, 1) }, default));
            await Assert.ThrowsAsync<ValidationException>(() =>
                handler.Handle(new TreasuryYieldCurveRequest { To = DateTime.UtcNow.AddDays(5) }, default));
        }

        [Fact]
        public async Task Subastas_SoloElUltimoRegistroOrdenadasConMontoVacioSiNoSeAnuncio()
        {
            var handler = new TreasuryUpcomingAuctionsHandler(new Factory(new Recorded(_ => Text(Auctions))));
            var result = await handler.Handle(new TreasuryUpcomingAuctionsRequest(), default);

            Assert.Equal("2026-10-02", result.AsOf);
            Assert.Equal(new[] { "17-Week", "26-Week" }, result.Data.Select(a => a.SecurityTerm));
            Assert.Equal(75_000_000_000m, result.Data[0].OfferingAmount);
            Assert.Null(result.Data[1].OfferingAmount);
            Assert.True(result.Data[1].Reopening);
        }

        [Theory]
        [InlineData("{\"data\":[]}")]
        [InlineData("{\"rows\":[]}")]
        [InlineData("<html>mantenimiento</html>")]
        public void Subastas_QueCambiaronDeFormaSonError(string json)
        {
            Assert.Throws<UpstreamSourceException>(() => TreasuryProvider.ParseAuctions(json));
        }

        [Fact]
        public async Task FuenteCaidaEs502NoListaVacia()
        {
            var handler = new TreasuryUpcomingAuctionsHandler(new Factory(new Recorded(_ => Text("", HttpStatusCode.BadGateway))));
            var ex = await Assert.ThrowsAsync<UpstreamSourceException>(() => handler.Handle(new TreasuryUpcomingAuctionsRequest(), default));
            Assert.Contains("502", ex.Message);
        }
    }
}
