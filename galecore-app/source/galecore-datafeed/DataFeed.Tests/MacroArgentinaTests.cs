using DataFeed.Application.App.Macro;
using DataFeed.Application.Data.Argentina;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers;
using MediatR;
using Newtonsoft.Json.Linq;
using Xunit;

namespace DataFeed.Tests
{
    /// <summary>WS-0095: armado del tablero Argentina con un mediador falso; un bloque caído no tumba a los demás.</summary>
    public class MacroArgentinaTests
    {
        private sealed class RoutingMediator : IMediator
        {
            public Func<object, object?> Handler = _ => null;
            public Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken ct = default) => Task.FromResult((TResponse)Handler(request)!);
            public Task Send<TRequest>(TRequest request, CancellationToken ct = default) where TRequest : IRequest => throw new NotSupportedException();
            public Task<object?> Send(object request, CancellationToken ct = default) => throw new NotSupportedException();
            public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamRequest<TResponse> request, CancellationToken ct = default) => throw new NotSupportedException();
            public IAsyncEnumerable<object?> CreateStream(object request, CancellationToken ct = default) => throw new NotSupportedException();
            public Task Publish(object notification, CancellationToken ct = default) => throw new NotSupportedException();
            public Task Publish<TNotification>(TNotification notification, CancellationToken ct = default) where TNotification : INotification => throw new NotSupportedException();
        }

        private static SourcedResponse<T> Sourced<T>(string source, string asOf, T data) => new() { Source = source, AsOf = asOf, Data = data, RetrievedAt = DateTime.UtcNow };

        private static object? Answer(object r) => r switch
        {
            ArgentinaDolaresRequest => Sourced("dolarapi", "2026-11-10T13:59:00Z", new List<DolarQuote>
            {
                new("oficial", "Oficial", 1520, 1570, "2026-11-05T18:55:00Z", null),
                new("blue", "Blue", 1535, 1555, "2026-11-10T13:59:00Z", -0.96m),
            }),
            ArgentinaSeriesRequest { Serie: "dolar" } => Sourced<JToken>("argentinadatos", "2026-11-10", JArray.Parse(
                """[{"casa":"blue","compra":1500,"venta":1500,"fecha":"2026-11-09"},{"casa":"blue","compra":1535,"venta":1555,"fecha":"2026-11-10"},{"casa":"blue","compra":1535,"venta":1555,"fecha":"2026-11-10"}]""")),
            ArgentinaSeriesRequest { Serie: "riesgo-pais" } => Sourced<JToken>("argentinadatos", "2026-11-09", JArray.Parse(
                """[{"valor":600,"fecha":"2026-11-06"},{"valor":590,"fecha":"2026-11-09"}]""")),
            ArgentinaSeriesRequest { Serie: "inflacion" } => Sourced<JToken>("argentinadatos", "2026-09-30", JArray.Parse(
                """[{"fecha":"2026-08-31","valor":1.9},{"fecha":"2026-09-30","valor":2.1}]""")),
            ArgentinaSeriesRequest { Serie: "letras" } => Sourced<JToken>("argentinadatos", "", JObject.Parse(
                """{"fechaActualizacion":"2026-11-10T04:17:02Z","letras":[{"ticker":"S30N6","precioArs":128.4,"tnaPorcentaje":22.05,"teaPorcentaje":24.5,"temPorcentaje":1.8,"fechaVencimiento":"2026-11-30","diasAlVencimiento":20},{"ticker":"S13N6","precioArs":109.5,"tnaPorcentaje":25.2,"fechaVencimiento":"2026-11-13","diasAlVencimiento":2}]}""")),
            BcraSeriesRequest q => Sourced<JToken>("bcra", "2026-11-03", JObject.Parse(
                $$"""{"idVariable":{{q.IdVariable}},"detalle":[{"fecha":"2026-11-02","valor":50000},{"fecha":"2026-11-03","valor":50500}]}""")),
            IndecSeriesRequest => Sourced<JToken>("indec", "2026-08-01", JObject.Parse(
                """{"fields":[{"id":"74.3_IET_0_M_16"},{"id":"74.3_IIT_0_M_25"},{"id":"74.3_ISC_0_M_19"}],"data":[["2026-07-01",8000,7000,1000],["2026-08-01",8500,7200,1300]]}""")),
            A3CotizacionesRequest => Sourced<JToken>("a3", "", new JArray()),
            A3FuturosRequest => Sourced("a3-web", "2026-11-10T14:07:40Z", new A3Futuros(new A3Referencia(1545m, "2026-11-05", 1549m, "2026-11-05"),
                new List<A3Futuro> { new("DLR/NOV26", null, null, 1569.5m, 1569.5m, 1573m, null, null, null, "2026-11-30", 20, 1.56m, 28.46m, 32.64m) },
                new List<A3Futuro>())),
            _ => throw new NotSupportedException(r.GetType().Name),
        };

        [Fact]
        public async Task Arma_los_diez_bloques_con_fuente_fecha_y_variaciones_simples()
        {
            var board = await new MacroArgentinaHandler(new RoutingMediator { Handler = Answer }).Build(default);
            Assert.Equal(10, board.Blocks.Count);
            Assert.All(board.Blocks.Values, b => Assert.True(b.Ok, b.Id + ": " + b.Error));
            var dolares = Assert.IsType<List<ArgentinaDolar>>(board.Blocks["dolares"].Data);
            Assert.Equal(-0.96m, dolares[1].BrechaPct);
            Assert.Equal(Math.Round((1555m / 1500m - 1) * 100, 2), dolares[1].VarDiariaPct);   // contra el día anterior, no contra el repetido
            Assert.Equal("2026-11-09", dolares[1].VarDiariaContra);
            var riesgo = Assert.IsType<ArgentinaSeriesItem>(board.Blocks["riesgoPais"].Data);
            Assert.Equal((590m, "2026-11-09", -10m), (riesgo.Last!.Value, riesgo.Date, riesgo.ChangeAbs!.Value));
            var letras = Assert.IsType<List<ArgentinaLetra>>(board.Blocks["curvaPesos"].Data);
            Assert.Equal("S13N6", letras[0].Ticker);   // ordenadas por vencimiento
            var balanza = Assert.IsType<List<ArgentinaSeriesItem>>(board.Blocks["balanza"].Data);
            Assert.Equal(new decimal?[] { 8500, 7200, 1300 }, balanza.Select(i => i.Last));
            var tasas = Assert.IsType<List<ArgentinaSeriesItem>>(board.Blocks["tasas"].Data);
            Assert.DoesNotContain(tasas, t => t.Id == "caucion");   // sin fuente de caución: no se muestra (owner 10/11)
            Assert.Equal(3, tasas.Count(t => t.Ok));
            Assert.Equal("2026-11-03", board.Blocks["reservas"].AsOf);
            Assert.Equal("bcra", board.Blocks["baseMonetaria"].Source);
        }

        [Fact]
        public async Task Un_bloque_caido_se_declara_y_no_tumba_a_los_demas()
        {
            var mediator = new RoutingMediator
            {
                Handler = r => r switch
                {
                    ArgentinaDolaresRequest => throw new UpstreamSourceException("dolarapi", "caída"),
                    A3FuturosRequest => throw new UpstreamSourceException("a3-web", "caída"),
                    _ => Answer(r),
                },
            };
            var board = await new MacroArgentinaHandler(mediator).Build(default);
            var dolares = board.Blocks["dolares"];
            Assert.False(dolares.Ok);
            Assert.Contains("dolarapi", dolares.Error);
            Assert.False(board.Blocks["futurosDolar"].Ok);
            Assert.False(board.Blocks["agro"].Ok);
            Assert.True(board.Blocks["riesgoPais"].Ok);
            Assert.True(board.Blocks["reservas"].Ok);
            Assert.True(board.Blocks["balanza"].Ok);
        }

        [Fact]
        public async Task Una_serie_del_bloque_tasas_que_falla_no_baja_a_las_demas()
        {
            var mediator = new RoutingMediator
            {
                Handler = r => r is BcraSeriesRequest { IdVariable: 7 } ? throw new UpstreamSourceException("bcra", "sin dato") : Answer(r),
            };
            var tasas = Assert.IsType<List<ArgentinaSeriesItem>>((await new MacroArgentinaHandler(mediator).Build(default)).Blocks["tasas"].Data);
            Assert.False(tasas.Single(t => t.Id == "badlar").Ok);
            Assert.True(tasas.Single(t => t.Id == "tamar").Ok);
        }

        [Fact]
        public void Item_calcula_variacion_contra_el_dato_anterior_y_declara_la_serie_vacia()
        {
            var item = MacroArgentinaHandler.Item("x", "X", "%", "t", new() { new("2026-01-01", 20m), new("2026-01-02", 22m) });
            Assert.Equal((22m, 2m, 10m), (item.Last!.Value, item.ChangeAbs!.Value, item.ChangePct!.Value));
            var empty = MacroArgentinaHandler.Item("x", "X", "%", "t", new());
            Assert.False(empty.Ok);
            Assert.NotNull(empty.Error);
        }

        [Fact]
        public void Interanual_compone_los_12_meses_y_omite_ventanas_con_huecos()
        {
            var pts = Enumerable.Range(0, 13).Select(i => new ArgentinaPoint(new DateTime(2025, 1, 1).AddMonths(i).ToString("yyyy-MM-dd"), 2m)).ToList();
            var yoy = MacroArgentinaHandler.Interanual(pts);
            Assert.Equal(2, yoy.Count);
            Assert.Equal(Math.Round((decimal)(Math.Pow(1.02, 12) - 1) * 100, 2), yoy[0].Valor);
            pts.RemoveAt(5);   // un mes faltante: ninguna ventana de 12 consecutivos
            Assert.Empty(MacroArgentinaHandler.Interanual(pts));
        }

        [Fact]
        public async Task Sirve_lo_ultimo_al_instante_y_refresca_en_segundo_plano()
        {
            MacroArgentinaHandler.ResetCache();
            var calls = 0;
            var mediator = new RoutingMediator { Handler = r => { if (r is ArgentinaDolaresRequest) Interlocked.Increment(ref calls); return Answer(r); } };
            var handler = new MacroArgentinaHandler(mediator);
            var first = await handler.Handle(new MacroArgentinaRequest(), default);
            Assert.Equal(1, calls);
            var second = await handler.Handle(new MacroArgentinaRequest(), default);
            Assert.Same(first, second);   // dentro del TTL: no rearma
            Assert.Equal(1, calls);
            MacroArgentinaHandler.ResetCache();
        }
    }
}
