using System.Text.Json.Nodes;
using DataFeed.Application.Data.Tastytrade.AccountOverview;
using DataFeed.Application.Data.Tastytrade.AccountSpreads;

namespace DataFeed.Tests;

/// <summary>Inicio de la cuenta real (WS-0036): riesgo, exposición y lo que pide atención, calculados en el back.</summary>
public class AccountOverviewBuilderTests
{
    private static readonly DateOnly Today = new(2026, 10, 15);   // jueves
    private static readonly JsonObject Rules = JsonNode.Parse("""
        {"monitor":{"trade_management":{"take_profit":{"pct_of_initial_credit":0.5},
          "hard_defense":{"trigger_any":{"unrealized_loss_pct_of_initial_credit_gte":2.0}},
          "defensive_roll":{"trigger_unrealized_loss_pct_of_initial_credit_gte":1.0,"min_dte_remaining":28},
          "time_exit":{"dte_threshold":21}},"risk_limits":{"portfolio_heat_max_pct":0.045}}}
        """)!.AsObject();

    private static AccountSpreadDto Spread(double? openPnl, string expiration = "2026-11-20", double? dayPnl = 3) => new()
    {
        Id = "SPY|" + expiration, UnderlyingSymbol = "SPY", Expiration = expiration, Structure = "PUT_CS",
        MaxProfit = 140, MaxLoss = 1860, OpenPnl = openPnl, DayPnl = dayPnl,
        Greeks = new SpreadGreeksDto { Delta = 6, Theta = 2.5, Vega = -17 },
    };

    private static AccountOverviewResponse Build(AccountSpreadsResponse account, IReadOnlyList<CalendarEvent>? events = null) =>
        AccountOverviewBuilder.Build(2500, 2600, 660, account, new Dictionary<string, double> { ["SPY"] = 1.0 }, Rules, Today,
            events ?? Array.Empty<CalendarEvent>(), new List<string>());

    [Fact]
    public void RiesgoYExposicion_EnSpyEquivalente()
    {
        var o = Build(new AccountSpreadsResponse
        {
            Spreads = { Spread(4) },
            UnderlyingPrices = { ["SPY"] = 770 },
        });

        Assert.Equal(1860, o.MaxRisk);
        Assert.Equal(74.4, o.MaxRiskPct);
        Assert.Equal(4.5, o.MaxRiskLimitPct);
        Assert.Equal("monitor.risk_limits", o.RiskLimitsSource);
        Assert.Equal(3, o.DayPnl);
        Assert.Equal(6, o.Exposure.SpyEquivalentShares);
        Assert.Equal(4620, o.Exposure.SpyEquivalentDollars);
        Assert.Equal(2.5, o.Exposure.Theta);
        Assert.Empty(o.Attention);
        var line = Assert.Single(o.Positions);
        Assert.Equal(("SPY", "PUT_CS", 36), (line.Symbol, line.Structure, line.Dte));
        Assert.Equal(2.86, line.PnlPct);                 // 4 / 140 del crédito
        Assert.Equal((70.0, -280.0, "reglas"), (line.TakeProfit!.Value, line.StopLoss!.Value, line.TargetSource));
    }

    [Fact]
    public void TopesDelPerfil_MarcanLoQueLosPasa_YMandanSobreLasReglas()
    {
        var o = AccountOverviewBuilder.Build(2500, 2600, 660,
            new AccountSpreadsResponse { Spreads = { Spread(4) }, UnderlyingPrices = { ["SPY"] = 770 } },
            new Dictionary<string, double> { ["SPY"] = 1.0 }, Rules, Today, Array.Empty<CalendarEvent>(), new List<string>(),
            maxRiskPerTradePct: 5, maxOpenRiskPct: 15);

        Assert.Equal(15, o.MaxRiskLimitPct);
        Assert.Equal("perfil", o.RiskLimitsSource);
        Assert.Equal(new[] { "riesgo", "riesgo" }, o.Attention.Select(a => a.Kind));
        Assert.Contains("arriesga 1.860 USD", o.Attention[0].Title);
        Assert.Contains("125 USD (5 %)", o.Attention[0].Title);
        Assert.Contains("tope sumado es 375 USD (15 %)", o.Attention[1].Title);
    }

    [Fact]
    public void TopesDelPerfil_DentroDeLimite_NoMarcanNada()
    {
        var o = AccountOverviewBuilder.Build(50000, 50000, 20000,
            new AccountSpreadsResponse { Spreads = { Spread(4) }, UnderlyingPrices = { ["SPY"] = 770 } },
            new Dictionary<string, double> { ["SPY"] = 1.0 }, Rules, Today, Array.Empty<CalendarEvent>(), new List<string>(),
            maxRiskPerTradePct: 5, maxOpenRiskPct: 15);
        Assert.Empty(o.Attention);
    }

    [Theory]
    [InlineData(75.0, "2026-11-20", "SPY put spread · vence 20/11: llegó a la toma de ganancia (54 % del crédito)")]
    [InlineData(-300.0, "2026-11-20", "SPY put spread · vence 20/11: la pérdida llegó a 2,1× el crédito (defensa)")]
    [InlineData(10.0, "2026-11-05", "SPY put spread · vence 05/11: quedan 21 días, salida por tiempo")]
    [InlineData(-150.0, "2026-12-18", "SPY put spread · vence 18/12: pérdida de 1,1× el crédito con 64 días, evaluar roleo")]
    public void ReglasDeGestion_UnaLineaPorPosicion(double openPnl, string expiration, string expected)
    {
        var o = Build(new AccountSpreadsResponse { Spreads = { Spread(openPnl, expiration) } });
        var item = Assert.Single(o.Attention);
        Assert.Equal("gestion", item.Kind);
        Assert.Equal(expected, item.Title);
    }

    [Fact]
    public void Eventos_HastaDosDiasHabiles_SoloConPosiciones()
    {
        var events = new[]
        {
            new CalendarEvent(new DateOnly(2026, 10, 15), "Producer Price Index"),
            new CalendarEvent(new DateOnly(2026, 10, 16), "FOMC"),
            new CalendarEvent(new DateOnly(2026, 10, 22), "Consumer Price Index"),   // 5 días hábiles: no
        };
        var o = Build(new AccountSpreadsResponse { Spreads = { Spread(4) } }, events);
        Assert.Equal(new[] { "Hoy: precios mayoristas de EE. UU. (PPI)", "Mañana: decisión de tasas de la Fed (FOMC)" },
            o.Attention.Select(a => a.Title));

        Assert.Empty(Build(new AccountSpreadsResponse(), events).Attention);   // sin posiciones, nada que mover
    }

    [Fact]
    public void SinCotizacion_NoSumaElDiaYLoDeclara()
    {
        var o = Build(new AccountSpreadsResponse { Spreads = { Spread(null, dayPnl: null) } });
        Assert.Null(o.DayPnl);
        Assert.Contains(o.Missing, m => m.StartsWith("Resultado del día"));
    }

    [Fact]
    public void Periodos_salen_del_valor_de_la_cuenta_contra_el_cierre_anterior_a_cada_fecha()
    {
        var today = new DateOnly(2026, 10, 15);
        var history = new List<(DateOnly, double)> { (new(2026, 3, 2), 2000), (new(2026, 9, 14), 2400), (new(2026, 10, 7), 2500) };
        var p = AccountOverviewBuilder.Periods(2550, 6.5, 0.26, history, today);
        Assert.Equal(new[] { "Hoy", "Semana", "Mes", "Año" }, p.Select(x => x.Label));
        Assert.Equal(6.5, p[0].Pnl);
        Assert.Equal(50, p[1].Pnl);     // contra el 07/10
        Assert.Equal(150, p[2].Pnl);    // contra el 14/09
        Assert.Equal(550, p[3].Pnl);    // cuenta nueva en el año: contra su primer cierre
        Assert.Equal(27.5, p[3].Pct);
        Assert.Null(AccountOverviewBuilder.Periods(2550, null, null, null, today)[2].Pnl);
    }
}
