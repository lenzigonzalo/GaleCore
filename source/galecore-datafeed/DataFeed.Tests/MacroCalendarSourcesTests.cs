using System.Net;
using System.Text;
using DataFeed.Application.Data.Fred.ReleaseDates;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers;
using DataFeed.Infrastructure.Providers.Fed;
using DataFeed.Infrastructure.Providers.Fred;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace DataFeed.Tests
{
    /// <summary>
    /// GC-0006: calendario macro (FRED) y reuniones del FOMC (Fed) con procedencia. Respuestas grabadas: nunca se
    /// llama a la red, y una fuente caída o que cambió de forma es error, no una lista vacía.
    /// </summary>
    public class MacroCalendarSourcesTests
    {
        private const string FedHtml = """
            <h4><a id="1">2026 FOMC Meetings</a></h4>
            <div class="fomc-meeting__month"><strong>January</strong></div><div class="fomc-meeting__date">27-28</div>
            <div class="fomc-meeting__month"><strong>March</strong></div><div class="fomc-meeting__date">17-18*</div>
            <div class="fomc-meeting__month"><strong>Apr/May</strong></div><div class="fomc-meeting__date">28-1</div>
            <div class="fomc-meeting__month"><strong>October</strong></div><div class="fomc-meeting__date">6 (notation vote)</div>
            <h4><a id="2">2027 FOMC Meetings</a></h4>
            <div class="fomc-meeting__month"><strong>Dec/Jan</strong></div><div class="fomc-meeting__date">31-1</div>
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

        private static HttpResponseMessage Json(string body, HttpStatusCode code = HttpStatusCode.OK) =>
            new(code) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

        private static IConfiguration Config(string? key = "SECRETKEY") =>
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["FredApi:Key"] = key }).Build();

        [Fact]
        public void Fed_LeeRangosCruceDeMesYDeAnioProyeccionesYNotationVote()
        {
            var years = FedCalendarProvider.Parse(FedHtml);
            var y26 = years[2026];
            Assert.Equal(4, y26.Count);
            Assert.Equal(new DateOnly(2026, 1, 27), y26[0].Start);
            Assert.Equal(new DateOnly(2026, 1, 28), y26[0].End);
            Assert.True(y26[1].Projections);
            Assert.Equal(new DateOnly(2026, 5, 1), y26[2].End);
            Assert.False(y26[3].Scheduled);
            Assert.Equal(new DateOnly(2028, 1, 1), years[2027][0].End);
        }

        [Fact]
        public async Task Fed_SiLaPaginaCambioDeFormaEsErrorNoListaVacia()
        {
            var provider = new FedCalendarProvider(new HttpClient(new Recorded(_ => Json("<html>otra cosa</html>"))));
            var ex = await Assert.ThrowsAsync<UpstreamSourceException>(() => provider.GetMeetingsAsync(new[] { 2026 }, default));
            Assert.Contains("2026", ex.Message);
        }

        [Fact]
        public async Task Fed_FechaIrreconocibleEsError()
        {
            var html = FedHtml.Replace("27-28", "TBD");
            var provider = new FedCalendarProvider(new HttpClient(new Recorded(_ => Json(html))));
            await Assert.ThrowsAsync<UpstreamSourceException>(() => provider.GetMeetingsAsync(new[] { 2026 }, default));
        }

        [Fact]
        public async Task Fred_PaginaYDevuelveLaUrlSinClave()
        {
            string Page(int offset, int n) =>
                "{\"count\":1500,\"offset\":" + offset + ",\"limit\":1000,\"release_dates\":["
                + string.Join(",", Enumerable.Range(0, n).Select(i => "{\"release_id\":" + (i % 2 == 0 ? 50 : 101) + ",\"release_name\":\"R\",\"date\":\"2026-10-0" + (1 + i % 9) + "\"}"))
                + "]}";
            var handler = new Recorded(r => r.RequestUri!.Query.Contains("offset=0") ? Json(Page(0, 1000)) : Json(Page(1000, 500)));
            var provider = new FredApiProvider(Config(), new HttpClient(handler));
            var (rows, upstream) = await provider.GetReleaseDatesAsync(new DateOnly(2026, 10, 1), new DateOnly(2026, 11, 15), default);
            Assert.Equal(1500, rows.Count);
            Assert.Equal(2, handler.Urls.Count);
            Assert.DoesNotContain("SECRETKEY", upstream);
            Assert.DoesNotContain("api_key", upstream);
        }

        [Fact]
        public async Task Fred_ErrorDeLaFuenteEsUpstreamNoVacio()
        {
            var provider = new FredApiProvider(Config(), new HttpClient(new Recorded(_ => Json("{}", HttpStatusCode.InternalServerError))));
            var ex = await Assert.ThrowsAsync<UpstreamSourceException>(
                () => provider.GetReleaseDatesAsync(new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 31), default));
            Assert.DoesNotContain("SECRETKEY", ex.Message);
        }

        [Fact]
        public async Task Fred_SinClaveConfiguradaLoDice()
        {
            var provider = new FredApiProvider(Config(null), new HttpClient(new Recorded(_ => Json("{}"))));
            await Assert.ThrowsAsync<UpstreamSourceException>(
                () => provider.GetReleaseDatesAsync(new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 31), default));
        }

        /// <summary>Contra FRED y la Fed reales: sólo con GALECORE_LIVE_SOURCES=1 y FRED_API_KEY en el entorno.</summary>
        [Fact]
        public async Task EnVivo_FredYFedResponden()
        {
            if (Environment.GetEnvironmentVariable("GALECORE_LIVE_SOURCES") != "1")
                return;
            var http = new HttpClient();
            var fred = new FredApiProvider(Config(Environment.GetEnvironmentVariable("FRED_API_KEY")), http);
            var (rows, _) = await fred.GetReleaseDatesAsync(new DateOnly(2026, 10, 1), new DateOnly(2026, 11, 15), default);
            Assert.Contains(rows, r => r.ReleaseId == 50);
            var (years, sha) = await new FedCalendarProvider(http).GetMeetingsAsync(new[] { 2026, 2027 }, default);
            Assert.NotEmpty(years[2026]);
            Assert.StartsWith("sha256:", sha);
            Console.WriteLine($"FRED filas={rows.Count} NFP={string.Join(",", rows.Where(r => r.ReleaseId == 50).Select(r => r.Date))} | FOMC 2026={string.Join(",", years[2026].Select(m => m.Start))}");
        }

        [Fact]
        public void Fred_ReleaseIdsInvalidosSeRechazan()
        {
            Assert.Equal(new HashSet<int> { 50, 10 }, FredReleaseDatesHandler.ParseIds("50, 10"));
            Assert.Empty(FredReleaseDatesHandler.ParseIds(null));
            Assert.Throws<ValidationException>(() => FredReleaseDatesHandler.ParseIds("50,abc"));
        }
    }
}
