using System;
using System.Collections.Generic;
using System.Linq;
using DataFeed.Application.Data.Tastytrade.AccountSpreads;
using DataFeed.Application.Data.Tastytrade.StrikeAlerts;
using Xunit;

namespace DataFeed.Tests
{
    public class StrikeProximityTests
    {
        private static readonly DateOnly Today = new(2026, 10, 15);

        private static AccountSpreadDto Ic(string id = "SPY|2026-11-20") => new()
        {
            Id = id, UnderlyingSymbol = "SPY", Expiration = "2026-11-20", Structure = "IC",
            ShortPutStrike = 640, LongPutStrike = 635, ShortCallStrike = 700, LongCallStrike = 705,
        };

        private static List<StrikeAlertDto> Run(double spot, StrikeAlertSettings s, params AccountSpreadDto[] spreads) =>
            StrikeProximity.Evaluate(spreads, new Dictionary<string, double> { ["SPY"] = spot }, s, Today).ToList();

        [Fact]
        public void Sin_cotizacion_del_subyacente_se_declara_sin_evaluar()
        {
            var spxw = Ic("SPXW|2026-11-20");
            spxw.UnderlyingSymbol = "SPXW";
            var prices = new Dictionary<string, double> { ["SPY"] = 670 };

            var sin = Assert.Single(StrikeProximity.Unevaluated(new[] { Ic(), spxw }, prices));
            Assert.Contains("SPXW", sin);
        }

        [Fact]
        public void Lejos_de_los_dos_strikes_no_avisa()
        {
            Assert.Empty(Run(670, new StrikeAlertSettings { Enabled = true, Distance = 15 }, Ic()));
        }

        [Fact]
        public void Cerca_del_put_vendido_avisa_ese_lado_con_id_por_dia()
        {
            var a = Assert.Single(Run(650, new StrikeAlertSettings { Enabled = true, Distance = 15 }, Ic()));
            Assert.Equal("put", a.Side);
            Assert.Equal(10, a.DistancePoints);
            Assert.Equal("SPY|2026-11-20|put|2026-10-15", a.Id);
            Assert.Contains("a 10,0 puntos del put vendido 640", a.Title);
        }

        [Fact]
        public void Iron_condor_vigila_el_call_y_avisa_si_ya_lo_paso()
        {
            var a = Assert.Single(Run(702, new StrikeAlertSettings { Enabled = true, Distance = 15 }, Ic()));
            Assert.Equal("call", a.Side);
            Assert.Equal(-2, a.DistancePoints);
            Assert.Contains("pasó el call vendido 700", a.Title);
        }

        [Fact]
        public void Distancia_en_porcentaje_y_propia_de_la_posicion()
        {
            // 2 % de 650 = 13 puntos: 10 del put entra.
            Assert.Single(Run(650, new StrikeAlertSettings { Enabled = true, Unit = "pct", Distance = 2 }, Ic()));
            // La posición pidió 5 puntos: 10 no entra.
            var own = new StrikeAlertSettings { Enabled = true, Distance = 15, ByPosition = { ["SPY|2026-11-20"] = 5 } };
            Assert.Empty(Run(650, own, Ic()));
        }

        [Fact]
        public void Preferencia_vacia_o_rota_queda_apagada()
        {
            Assert.False(StrikeAlertSettings.Parse(null).Enabled);
            Assert.False(StrikeAlertSettings.Parse("{no es json").Enabled);
            var s = StrikeAlertSettings.Parse("{\"enabled\":true,\"unit\":\"pct\",\"distance\":1.5,\"market_hours_only\":false,\"by_position\":{\"SPY|2026-11-20\":10}}");
            Assert.True(s.Enabled);
            Assert.Equal("pct", s.Unit);
            Assert.Equal(1.5, s.Distance);
            Assert.False(s.MarketHoursOnly);
            Assert.Equal(10, s.ByPosition["SPY|2026-11-20"]);
        }
    }
}
