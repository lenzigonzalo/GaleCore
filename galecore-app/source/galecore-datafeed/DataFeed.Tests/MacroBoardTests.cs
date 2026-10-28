using System;
using System.Collections.Generic;
using System.Linq;
using DataFeed.Application.App.Macro;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using Xunit;

namespace DataFeed.Tests
{
    public class MacroBoardTests
    {
        private static readonly DateOnly Today = new(2026, 10, 15);

        [Fact]
        public void Contrato_vigente_es_el_que_Tastytrade_marca_active_month()
        {
            var list = new[]
            {
                new FutureItem { Symbol = "/NGV6", ExpirationDate = "2026-10-28" },
                new FutureItem { Symbol = "/NGX6", ExpirationDate = "2026-11-25", ActiveMonth = true },
                new FutureItem { Symbol = "/NGZ6", ExpirationDate = "2026-12-28" },
            };
            Assert.Equal("/NGX6", FuturesMath.ActiveContract(list, Today)!.Symbol);
        }

        [Fact]
        public void Sin_marca_toma_el_mas_cercano_sin_vencer()
        {
            var list = new[]
            {
                new FutureItem { Symbol = "/ESU6", ExpirationDate = "2026-09-18" },
                new FutureItem { Symbol = "/ESH7", ExpirationDate = "2027-03-19" },
                new FutureItem { Symbol = "/ESZ6", ExpirationDate = "2026-12-18" },
            };
            Assert.Equal("/ESZ6", FuturesMath.ActiveContract(list, Today)!.Symbol);
        }

        private static List<(string, double)> Series(int n, Func<int, double> f) =>
            Enumerable.Range(0, n).Select(i => (Today.AddDays(i - n).ToString("yyyy-MM-dd"), f(i))).ToList();

        [Fact]
        public void Precio_cambia_en_porcentaje_contra_1_5_y_21_datos_atras()
        {
            var row = MacroBoardMath.Row("ES", "S&P 500", "/ESZ6", "pts", "%", 0, Series(30, i => 100 + i), "tastytrade");
            Assert.Equal(129, row.Last);
            Assert.Equal(Math.Round((129.0 / 128 - 1) * 100, 2), row.ChangeDay);
            Assert.Equal(Math.Round((129.0 / 124 - 1) * 100, 2), row.ChangeWeek);
            Assert.Equal(Math.Round((129.0 / 108 - 1) * 100, 2), row.ChangeMonth);
            Assert.Equal(22, row.Spark.Count);
            Assert.Equal(129, row.Spark[^1].Value);
        }

        [Fact]
        public void Tasa_cambia_en_puntos_basicos_y_sin_historia_queda_vacio()
        {
            var row = MacroBoardMath.Row("UST10", "Tesoro 10 años", "UST10", "%", "pb", 100, Series(3, i => 5.0 + i * 0.05), "treasury");
            Assert.Equal(5, row.ChangeDay);
            Assert.Null(row.ChangeWeek);
            var empty = MacroBoardMath.Row("GC", "Oro", "/GCZ6", "pts", "%", 0, new List<(string, double)>(), "tastytrade");
            Assert.Null(empty.Last);
            Assert.Empty(empty.Spark);
        }
    
        [Fact]
        public void Relativo_sube_cuando_la_canasta_le_gana_al_denominador_y_usa_solo_fechas_comunes()
        {
            var a = new List<(string, double)> { ("2026-10-01", 100), ("2026-10-02", 110), ("2026-10-03", 120) };
            var b = new List<(string, double)> { ("2026-10-01", 50), ("2026-10-03", 60) };
            var den = new List<(string, double)> { ("2026-10-01", 10), ("2026-10-02", 10), ("2026-10-03", 11) };
            var rel = MacroBoardMath.Relative(new List<List<(string, double)>> { a, b }, den);
            Assert.Equal(new[] { "2026-10-01", "2026-10-03" }, rel.Select(r => r.Date));
            Assert.Equal(1.0, rel[0].Value, 6);
            Assert.Equal(((1.2 + 1.2) / 2) / 1.1, rel[1].Value, 6);
            Assert.Empty(MacroBoardMath.Relative(new List<List<(string, double)>> { new() }, den));
        }
    
        [Fact]
        public void Valor_sumado_en_el_mes_sale_de_la_capitalizacion_y_la_suba()
        {
            var row = new BoardRow { Id = "NVDA", ChangeMonth = 10 };
            // Hoy vale 1.100: hace un mes, 1.000. Sumó 100.
            Assert.Equal(100, MacroBoardMath.WithValueAdded(row, 1100).ValueAddedMonth);
            Assert.Null(MacroBoardMath.WithValueAdded(row, null).ValueAddedMonth);
            Assert.Null(row.ValueAddedMonth);
        }
    }
}
