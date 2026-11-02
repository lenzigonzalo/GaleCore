using System.Net;
using System.Text;
using DataFeed.Application.Data.Argentina;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers;
using DataFeed.Infrastructure.Providers.Argentina;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace DataFeed.Tests
{
    /// <summary>
    /// WS-0077: fuentes argentinas (DolarAPI, ArgentinaDatos, BCRA, INDEC, BYMA, A3) con procedencia. Respuestas grabadas
    /// (recortes de las reales del 02/11/2026): nunca se llama a la red; una falla de la fuente es error, no datos inventados.
    /// </summary>
    [Collection("RuntimeStaticCaches")]
    public class ArgentinaTests
    {
        private const string Dolares = """
            [{"moneda":"USD","casa":"oficial","nombre":"Oficial","compra":1515,"venta":1565,"fechaActualizacion":"2026-11-02T12:00:00.000Z"},
             {"moneda":"USD","casa":"blue","nombre":"Blue","compra":1545,"venta":1565,"fechaActualizacion":"2026-11-02T14:58:00.000Z"},
             {"moneda":"USD","casa":"bolsa","nombre":"Bolsa","compra":1567.8,"venta":1580.1,"fechaActualizacion":"2026-11-02T14:58:00.000Z"},
             {"moneda":"USD","casa":"contadoconliqui","nombre":"Contado con liqui","compra":1570,"venta":1600,"fechaActualizacion":"2026-11-02T14:57:00.000Z"},
             {"moneda":"USD","casa":"cripto","nombre":"Cripto","compra":1560,"venta":1561,"fechaActualizacion":"2026-11-02T14:59:00.000Z"}]
            """;
        private const string Riesgo = """[{"valor":937,"fecha":"1999-01-22"},{"valor":790,"fecha":"2020-02-01"},{"valor":790,"fecha":"2026-10-29"},{"valor":787,"fecha":"2026-10-30"}]""";
        private const string BcraSerie = """{"status":200,"metadata":{"resultset":{"count":2,"offset":0,"limit":3000}},"results":[{"idVariable":29,"detalle":[{"fecha":"2026-09-30","valor":21.1},{"fecha":"2026-08-31","valor":21.0}]}]}""";
        private const string BcraVars = """{"status":200,"metadata":{"resultset":{"count":2,"offset":0,"limit":3000}},"results":[{"idVariable":1,"descripcion":"Reservas internacionales","categoria":"Principales Variables","ultFechaInformada":"2026-10-28","ultValorInformado":50603.0},{"idVariable":29,"descripcion":"REM - inflación esperada a 12 meses","categoria":"Expectativas","ultFechaInformada":"2026-09-30","ultValorInformado":21.1}]}""";
        private const string Cambiarias = """{"status":200,"results":{"fecha":"2026-10-30","detalle":[{"codigoMoneda":"USD","descripcion":"DOLAR E.E.U.U.","tipoPase":1.0,"tipoCotizacion":1534.0}]}}""";
        private const string Indec = """{"data":[["2026-06-01",11826.41],["2026-07-01",12076.39]],"count":271,"meta":[{"frequency":"month","start_date":"2026-06-01","end_date":"2026-07-01"},{"catalog":{"title":"x"},"dataset":{"title":"IPC Nacional","source":"INDEC"},"field":{"id":"148.3_INIVELNAL_DICI_M_26","description":"IPC Nivel General","units":"Índice"}}]}""";
        private const string BymaPage1 = """{"content":{"page_number":1,"page_count":2,"page_size":1,"total_elements_count":2},"data":[{"symbol":"AE38","trade":110160,"previousClosingPrice":111150,"bidPrice":110130,"offerPrice":110180,"volume":535698,"volumeAmount":591357757,"settlementType":"2","maturityDate":"2038-01-09","daysToMaturity":4086,"denominationCcy":"ARS","tradeHour":"12:24:54"}]}""";
        private const string BymaPage2 = """{"content":{"page_number":2,"page_count":2,"page_size":1,"total_elements_count":2},"data":[{"symbol":"DT49A","trade":0,"previousClosingPrice":0,"bidPrice":0,"offerPrice":102,"volume":0,"settlementType":"2","tradeHour":"10:00:00"}]}""";
        private const string A3Rows = """[{"fecha":"2026-11-02T00:00:00","ticker":"AL30","precioUltimo":833.9696,"variacion":-1.1047}]""";

        private sealed class Router : HttpMessageHandler
        {
            private readonly Func<HttpRequestMessage, string, HttpResponseMessage> _answer;
            public List<(string Url, string Body, string? Key)> Calls { get; } = new();

            public Router(Func<HttpRequestMessage, string, HttpResponseMessage> answer) => _answer = answer;

            protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            {
                var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
                Calls.Add((request.RequestUri!.ToString(), body, request.Headers.TryGetValues("x-api-key", out var k) ? k.First() : null));
                return _answer(request, body);
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

        private static Router Always(string body, HttpStatusCode code = HttpStatusCode.OK) => new((_, _) => Json(body, code));

        private static IConfiguration Config(string? a3Key = null) =>
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["A3:ApiKey"] = a3Key }).Build();

        public ArgentinaTests() => ArgentinaFetcher.ClearCache();

        [Fact]
        public async Task Dolares_CalculaLaBrechaContraElOficialSoloParaBlueMepYCcl()
        {
            var http = Always(Dolares);
            var handler = new ArgentinaDolaresHandler(new Factory(http));
            var result = await handler.Handle(new ArgentinaDolaresRequest(), default);

            Assert.Equal("dolarapi", result.Source);
            Assert.Equal("2026-11-02T14:59:00.000Z", result.AsOf);
            Assert.StartsWith("sha256:", result.Sha256);
            decimal? Brecha(string casa) => result.Data.Single(q => q.Casa == casa).BrechaPct;
            Assert.Null(Brecha("oficial"));
            Assert.Equal(0m, Brecha("blue"));
            Assert.Equal(0.96m, Brecha("bolsa"));   // 1580.1 / 1565 − 1
            Assert.Equal(2.24m, Brecha("contadoconliqui")); // 1600 / 1565 − 1
            Assert.Null(Brecha("cripto"));
            Assert.Equal("2026-11-02T12:00:00.000Z", result.Data[0].FechaActualizacion);

            Assert.True((await handler.Handle(new ArgentinaDolaresRequest(), default)).FromCache);
            Assert.Single(http.Calls);
        }

        [Fact]
        public async Task Dolares_SinOficialEsErrorYNoUnaBrechaInventada()
        {
            var handler = new ArgentinaDolaresHandler(new Factory(Always("""[{"casa":"blue","nombre":"Blue","compra":1,"venta":2,"fechaActualizacion":"x"}]""")));
            await Assert.ThrowsAsync<UpstreamSourceException>(() => handler.Handle(new ArgentinaDolaresRequest(), default));
        }

        [Fact]
        public async Task Dolares_FuenteCaidaOCambiadaDeFormaEsUpstream()
        {
            await Assert.ThrowsAsync<UpstreamSourceException>(() =>
                new ArgentinaDolaresHandler(new Factory(Always("boom", HttpStatusCode.BadGateway))).Handle(new ArgentinaDolaresRequest(), default));
            ArgentinaFetcher.ClearCache();
            await Assert.ThrowsAsync<UpstreamSourceException>(() =>
                new ArgentinaDolaresHandler(new Factory(Always("<html></html>"))).Handle(new ArgentinaDolaresRequest(), default));
            ArgentinaFetcher.ClearCache();
            await Assert.ThrowsAsync<UpstreamSourceException>(() =>
                new ArgentinaDolaresHandler(new Factory(Always("""{"a":1}"""))).Handle(new ArgentinaDolaresRequest(), default));
        }

        [Fact]
        public async Task Series_RiesgoPaisFiltraDesdeYSinDesdeDevuelveElUltimoAnio()
        {
            var handler = new ArgentinaSeriesHandler(new Factory(Always(Riesgo)));
            var result = await handler.Handle(new ArgentinaSeriesRequest { Serie = "riesgo-pais", Desde = "2020-01-01" }, default);
            Assert.Equal(3, ((Newtonsoft.Json.Linq.JArray)result.Data).Count);
            Assert.Equal("2026-10-30", result.AsOf);
            Assert.Equal("https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais", result.UpstreamUrl);

            var year = await handler.Handle(new ArgentinaSeriesRequest { Serie = "riesgo-pais" }, default);
            Assert.True(((Newtonsoft.Json.Linq.JArray)year.Data).Count <= 3);
            Assert.DoesNotContain("1999-01-22", year.Data.ToString());
        }

        [Fact]
        public async Task Series_DolarPorCasaYLetrasUsanLaRutaCorrecta()
        {
            var http = Always("""{"fechaActualizacion":"2026-11-02T01:42:07.799Z","letras":[{"ticker":"S13N6","tnaPorcentaje":22.68,"temPorcentaje":1.9}]}""");
            var handler = new ArgentinaSeriesHandler(new Factory(http));
            var letras = await handler.Handle(new ArgentinaSeriesRequest { Serie = "letras" }, default);
            Assert.Equal("2026-11-02T01:42:07.799Z", letras.AsOf);
            Assert.Equal("S13N6", (string?)letras.Data["letras"]![0]!["ticker"]);

            ArgentinaFetcher.ClearCache();
            var dolar = new ArgentinaSeriesHandler(new Factory(Always("""[{"casa":"blue","compra":1545,"venta":1565,"fecha":"2026-10-30"}]""")));
            var r = await dolar.Handle(new ArgentinaSeriesRequest { Serie = "dolar", Casa = "blue", Desde = "2026-10-01" }, default);
            Assert.EndsWith("/cotizaciones/dolares/blue", r.UpstreamUrl);
            Assert.Equal("2026-10-30", r.AsOf);
        }

        [Theory]
        [InlineData(null, null, null)]
        [InlineData("../etc", null, null)]
        [InlineData("dolar", null, null)]
        [InlineData("dolar", "euro", null)]
        [InlineData("uva", null, "30/10/2026")]
        public async Task Series_ParametrosInvalidosSonValidacion(string? serie, string? casa, string? desde)
        {
            var handler = new ArgentinaSeriesHandler(new Factory(Always("[]")));
            await Assert.ThrowsAsync<ValidationException>(() => handler.Handle(new ArgentinaSeriesRequest { Serie = serie, Casa = casa, Desde = desde }, default));
        }

        [Fact]
        public async Task Bcra_VariablesFiltraPorTextoYSeriesOrdenaAscendente()
        {
            var vars = await new BcraVariablesHandler(new Factory(Always(BcraVars))).Handle(new BcraVariablesRequest { Texto = "inflación" }, default);
            Assert.Single((Newtonsoft.Json.Linq.JArray)vars.Data);
            Assert.Contains(vars.Notes, n => n.Contains("29 = REM"));
            Assert.Equal("2026-09-30", vars.AsOf);

            var http = Always(BcraSerie);
            var series = await new BcraSeriesHandler(new Factory(http)).Handle(new BcraSeriesRequest { IdVariable = 29, Desde = "2026-06-01", Hasta = "2026-11-01" }, default);
            Assert.Equal("2026-08-31", (string?)series.Data["detalle"]![0]!["fecha"]);
            Assert.Equal("2026-09-30", series.AsOf);
            Assert.Contains("/monetarias/29?desde=2026-06-01&hasta=2026-11-01", http.Calls[0].Url);
        }

        [Fact]
        public async Task Bcra_SerieSinDatosEsError()
        {
            var handler = new BcraSeriesHandler(new Factory(Always("""{"status":200,"results":[{"idVariable":29,"detalle":[]}]}""")));
            await Assert.ThrowsAsync<UpstreamSourceException>(() => handler.Handle(new BcraSeriesRequest { IdVariable = 29 }, default));
        }

        [Theory]
        [InlineData(null, null, null)]
        [InlineData(0, null, null)]
        [InlineData(29, "ayer", null)]
        [InlineData(29, "2026-11-01", "2026-06-01")]
        public async Task Bcra_ParametrosInvalidosSonValidacion(int? id, string? desde, string? hasta)
        {
            var handler = new BcraSeriesHandler(new Factory(Always(BcraSerie)));
            await Assert.ThrowsAsync<ValidationException>(() => handler.Handle(new BcraSeriesRequest { IdVariable = id, Desde = desde, Hasta = hasta }, default));
        }

        [Fact]
        public async Task Bcra_CambiariasSinMonedaYConMoneda()
        {
            var all = await new BcraCambiariasHandler(new Factory(Always(Cambiarias))).Handle(new BcraCambiariasRequest(), default);
            Assert.Equal("2026-10-30", all.AsOf);
            Assert.Contains(all.Notes, n => n.Contains("A3500"));

            ArgentinaFetcher.ClearCache();
            var http = Always("""{"status":200,"results":[{"fecha":"2026-10-30","detalle":[{"codigoMoneda":"USD","tipoCotizacion":1534.0}]},{"fecha":"2026-10-29","detalle":[{"codigoMoneda":"USD","tipoCotizacion":1539.0}]}]}""");
            var usd = await new BcraCambiariasHandler(new Factory(http)).Handle(new BcraCambiariasRequest { Moneda = "usd", Desde = "2026-10-27", Hasta = "2026-10-30" }, default);
            Assert.Equal("2026-10-30", usd.AsOf);
            Assert.Contains("/Cotizaciones/USD?fechadesde=2026-10-27&fechahasta=2026-10-30", http.Calls[0].Url);
            await Assert.ThrowsAsync<ValidationException>(() =>
                new BcraCambiariasHandler(new Factory(http)).Handle(new BcraCambiariasRequest { Moneda = "DOLAR" }, default));
        }

        [Fact]
        public async Task Indec_DevuelveFilasYCamposYRechazaErrores()
        {
            var http = Always(Indec);
            var result = await new IndecSeriesHandler(new Factory(http)).Handle(new IndecSeriesRequest { Ids = "148.3_INIVELNAL_DICI_M_26", Last = 2 }, default);
            Assert.Equal("2026-07-01", result.AsOf);
            Assert.Equal("IPC Nivel General", (string?)result.Data["fields"]![0]!["description"]);
            Assert.Equal(2, ((Newtonsoft.Json.Linq.JArray)result.Data["data"]!).Count);
            Assert.Contains("ids=148.3_INIVELNAL_DICI_M_26&last=2&format=json", http.Calls[0].Url);

            ArgentinaFetcher.ClearCache();
            await Assert.ThrowsAsync<UpstreamSourceException>(() =>
                new IndecSeriesHandler(new Factory(Always("""{"errors":[{"error":"x"}]}"""))).Handle(new IndecSeriesRequest { Ids = "abc.def" }, default));
            await Assert.ThrowsAsync<ValidationException>(() =>
                new IndecSeriesHandler(new Factory(http)).Handle(new IndecSeriesRequest { Ids = "a b;c" }, default));
            await Assert.ThrowsAsync<ValidationException>(() =>
                new IndecSeriesHandler(new Factory(http)).Handle(new IndecSeriesRequest { Ids = "abc.def", Last = 0 }, default));
        }

        [Fact]
        public async Task Byma_RecorreLasPaginasNormalizaYMandaElPlazo()
        {
            var http = new Router((_, body) => Json(body.Contains("page_number") ? BymaPage2 : BymaPage1));
            var result = await new ByMaPanelHandler(new Factory(http)).Handle(new ByMaPanelRequest { Panel = "public-bonds", Plazo = "24hs" }, default);

            Assert.Equal(2, http.Calls.Count);
            Assert.Contains("\"T1\":true", http.Calls[0].Body);
            Assert.Contains("\"T0\":false", http.Calls[0].Body);
            Assert.Contains("\"page_number\":2", http.Calls[1].Body);
            var ae38 = result.Data.Single(i => i.Symbol == "AE38");
            Assert.Equal(110160m, ae38.Last);
            Assert.Equal(-0.89m, ae38.ChangePct);
            Assert.Equal(110130m, ae38.Bid);
            Assert.Equal(110180m, ae38.Ask);
            Assert.Equal("24hs", ae38.Plazo);
            Assert.Equal("12:24:54", ae38.Time);
            var sin = result.Data.Single(i => i.Symbol == "DT49A");
            Assert.Null(sin.Last);
            Assert.Null(sin.ChangePct);
            Assert.Equal(102m, sin.Ask);
            Assert.Equal("12:24:54", result.AsOf);
            Assert.Contains(result.Notes, n => n.Contains("sin documentación oficial"));
        }

        [Fact]
        public async Task Byma_ArrayDirectoYCIUsanT0()
        {
            var http = Always("""[{"symbol":"AAL","trade":11010.0,"previousClosingPrice":10380.0,"settlementType":"1","tradeHour":"12:25:00"}]""");
            var result = await new ByMaPanelHandler(new Factory(http)).Handle(new ByMaPanelRequest { Panel = "cedears", Plazo = "CI" }, default);
            Assert.Single(http.Calls);
            Assert.Contains("\"T0\":true", http.Calls[0].Body);
            Assert.Equal("CI", result.Data[0].Plazo);
            Assert.Equal(6.07m, result.Data[0].ChangePct);
        }

        [Theory]
        [InlineData(null, null)]
        [InlineData("rofex", null)]
        [InlineData("cedears", "48hs")]
        public async Task Byma_ParametrosInvalidosSonValidacion(string? panel, string? plazo)
        {
            await Assert.ThrowsAsync<ValidationException>(() =>
                new ByMaPanelHandler(new Factory(Always("[]"))).Handle(new ByMaPanelRequest { Panel = panel, Plazo = plazo }, default));
        }

        [Fact]
        public async Task A3_MandaLaClaveEnElHeaderYNuncaEnLaProcedencia()
        {
            var http = Always(A3Rows);
            var result = await new A3CotizacionesHandler(Config("SECRETKEY"), new Factory(http)).Handle(new A3CotizacionesRequest { Segmento = "rentafija" }, default);
            Assert.Equal("SECRETKEY", http.Calls[0].Key);
            Assert.DoesNotContain("SECRETKEY", http.Calls[0].Url);
            Assert.DoesNotContain("SECRETKEY", result.UpstreamUrl + string.Join(" ", result.Notes) + result.Data.ToString());
            Assert.Equal("2026-11-02T00:00:00", result.AsOf);
            Assert.EndsWith("/cotizaciones/rentafija", result.UpstreamUrl);

            Assert.True((await new A3CotizacionesHandler(Config("SECRETKEY"), new Factory(http)).Handle(new A3CotizacionesRequest { Segmento = "rentafija" }, default)).FromCache);
            Assert.Single(http.Calls);
        }

        [Fact]
        public async Task A3_SinClaveRechazadaYVacioSeAvisa()
        {
            var ex = await Assert.ThrowsAsync<UpstreamSourceException>(() =>
                new A3CotizacionesHandler(Config(), new Factory(Always(A3Rows))).Handle(new A3CotizacionesRequest { Segmento = "forex" }, default));
            Assert.Contains("A3_API_KEY", ex.Message);

            var vacio = await new A3CotizacionesHandler(Config("K"), new Factory(Always("[]"))).Handle(new A3CotizacionesRequest { Segmento = "derivados" }, default);
            Assert.Empty((Newtonsoft.Json.Linq.JArray)vacio.Data);
            Assert.Contains(vacio.Notes, n => n.Contains("vino vacío"));

            ArgentinaFetcher.ClearCache();
            var forbidden = await Assert.ThrowsAsync<UpstreamSourceException>(() =>
                new A3CotizacionesHandler(Config("K"), new Factory(Always("""{"message":"Forbidden"}""", HttpStatusCode.Forbidden))).Handle(new A3CotizacionesRequest { Segmento = "forex" }, default));
            Assert.Contains("403", forbidden.Message);
            await Assert.ThrowsAsync<ValidationException>(() =>
                new A3CotizacionesHandler(Config("K"), new Factory(Always("[]"))).Handle(new A3CotizacionesRequest { Segmento = "futuros" }, default));
        }
    }
}
