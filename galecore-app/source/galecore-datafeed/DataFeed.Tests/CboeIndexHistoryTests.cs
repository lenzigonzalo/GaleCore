using System.Net;
using System.Text;
using DataFeed.Application.Data.Cboe.IndexHistory;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers;
using DataFeed.Infrastructure.Providers.Cboe;
using Xunit;

namespace DataFeed.Tests
{
    /// <summary>
    /// WS-0014: historia diaria de VIX, VVIX y SKEW desde los CSV de CBOE, con procedencia. Respuestas grabadas (recortes
    /// de los archivos reales del 06/10/2026): nunca se llama a la red, y un archivo que cambió de forma es error.
    /// </summary>
    [Collection("CboeCache")]
    public class CboeIndexHistoryTests
    {
        private const string VixCsv = "DATE,OPEN,HIGH,LOW,CLOSE\r\n01/02/1990,17.240000,17.240000,17.240000,17.240000\r\n"
            + "10/02/2026,16.150000,16.240000,15.300000,15.310000\r\n10/05/2026,16.240000,16.380000,15.480000,15.520000\r\n";
        private const string VvixCsv = "DATE,VVIX\n03/06/2006,71.730000\n10/02/2026,87.020000\n10/05/2026,85.460000\n";

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

        private static HttpResponseMessage Csv(string body, HttpStatusCode code = HttpStatusCode.OK) =>
            new(code) { Content = new StringContent(body, Encoding.UTF8, "text/csv") };

        public CboeIndexHistoryTests() => CboeIndexHistoryProvider.ClearCache();

        [Fact]
        public void Parse_LeeOhlcDeVixYSoloCierreDeVvix()
        {
            var vix = CboeIndexHistoryProvider.Parse("VIX", VixCsv);
            Assert.Equal(3, vix.Count);
            Assert.Equal(new CboeIndexDay(new DateOnly(2026, 10, 5), 16.24m, 16.38m, 15.48m, 15.52m), vix[^1]);

            var vvix = CboeIndexHistoryProvider.Parse("VVIX", VvixCsv);
            Assert.Equal(new CboeIndexDay(new DateOnly(2006, 3, 6), null, null, null, 71.73m), vvix[0]);
        }

        [Theory]
        [InlineData("DATE,PRICE\n10/05/2026,1\n")]           // cabecera distinta
        [InlineData("DATE,VVIX\n2026-10-05,85.46\n")]         // formato de fecha distinto
        [InlineData("DATE,VVIX\n10/05/2026,n/a\n")]           // valor que no es número
        [InlineData("DATE,VVIX\n")]                           // sin filas
        public void Parse_ArchivoQueCambioDeFormaEsError(string csv)
        {
            Assert.Throws<UpstreamSourceException>(() => CboeIndexHistoryProvider.Parse("VVIX", csv));
        }

        [Fact]
        public async Task Handler_FiltraElRangoConProcedenciaYUsaLaCache()
        {
            var http = new Recorded(_ => Csv(VixCsv));
            var handler = new CboeIndexHistoryHandler(new Factory(http));
            var request = new CboeIndexHistoryRequest { Index = "vix", From = new DateTime(2026, 10, 1), To = new DateTime(2026, 10, 5) };

            var first = await handler.Handle(request, default);
            Assert.Equal("cboe", first.Source);
            Assert.Equal("https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv", first.UpstreamUrl);
            Assert.Equal("2026-10-05", first.AsOf);
            Assert.StartsWith("sha256:", first.Sha256);
            Assert.False(first.FromCache);
            Assert.Equal(new[] { "2026-10-02", "2026-10-05" }, first.Data.Select(d => d.Date));

            var second = await handler.Handle(request, default);
            Assert.True(second.FromCache);
            Assert.Single(http.Urls);
        }

        [Fact]
        public async Task Handler_FuenteCaidaEs502NoListaVacia()
        {
            var handler = new CboeIndexHistoryHandler(new Factory(new Recorded(_ => Csv("", HttpStatusCode.ServiceUnavailable))));
            var ex = await Assert.ThrowsAsync<UpstreamSourceException>(
                () => handler.Handle(new CboeIndexHistoryRequest { Index = "SKEW" }, default));
            Assert.Contains("503", ex.Message);
        }

        [Fact]
        public async Task Handler_TimeoutDeLaFuenteEs502NoUn500()
        {
            var handler = new CboeIndexHistoryHandler(new Factory(new Recorded(_ => throw new TaskCanceledException("timeout"))));
            var ex = await Assert.ThrowsAsync<UpstreamSourceException>(() => handler.Handle(new CboeIndexHistoryRequest { Index = "VIX" }, default));
            Assert.Contains("sin respuesta", ex.Message);
        }

        [Theory]
        [InlineData("SPX", null, null)]
        [InlineData(null, null, null)]
        [InlineData("VIX", "2026-10-05", "2026-10-01")]
        public async Task Handler_ParametrosInvalidosSonValidacion(string? index, string? from, string? to)
        {
            var handler = new CboeIndexHistoryHandler(new Factory(new Recorded(_ => Csv(VixCsv))));
            var request = new CboeIndexHistoryRequest
            {
                Index = index,
                From = from is null ? null : DateTime.Parse(from),
                To = to is null ? null : DateTime.Parse(to),
            };
            await Assert.ThrowsAsync<ValidationException>(() => handler.Handle(request, default));
        }
    }
}
