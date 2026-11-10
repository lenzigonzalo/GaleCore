using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Tests;

/// <summary>WS-0098 inc.3 — ficha de estrategia: ventana, entradas por día y límites en USD derivados de la spec.</summary>
public class StrategyCardTests
{
    private static StrategySpec Spec(SpecRiskLimits risk) => new() { RiskLimits = risk };

    [Fact]
    public void Limits_Sandwich130_Style()
    {
        var c = StrategyCard.Build(Spec(new SpecRiskLimits
        {
            SimulatedCapitalUsd = 10000, MaxRiskPerTradePct = 3, MaxOpenRiskPct = 3, MaxLossPerTradeUsd = 300, MaxBetPct = 3,
        }));
        Assert.Equal(10000, c.LimitsUsd.Capital);
        Assert.Equal(300, c.LimitsUsd.PerTrade);
        Assert.Equal(300, c.LimitsUsd.OpenRisk);
        Assert.Equal(9, c.LimitsUsd.PerBet!.Value, 9);
    }

    [Fact]
    public void Limits_Sandwich132_Style_FullBet()
    {
        var c = StrategyCard.Build(Spec(new SpecRiskLimits
        {
            SimulatedCapitalUsd = 10000, MaxRiskPerTradePct = 3, MaxOpenRiskPct = 3, MaxLossPerTradeUsd = 300, MaxBetPct = 100,
        }));
        Assert.Equal(300, c.LimitsUsd.PerBet);
    }

    [Fact]
    public void PerTrade_FallsBackToPctOfCapital()
    {
        var c = StrategyCard.Build(Spec(new SpecRiskLimits { SimulatedCapitalUsd = 10000, MaxRiskPerTradePct = 3 }));
        Assert.Equal(300, c.LimitsUsd.PerTrade);
    }

    [Fact]
    public void MissingFields_GiveNulls()
    {
        var c = StrategyCard.Build(Spec(new SpecRiskLimits { MaxRiskPerTradePct = 3, MaxOpenRiskPct = 3, MaxBetPct = 3 }));
        Assert.Null(c.LimitsUsd.Capital);
        Assert.Null(c.LimitsUsd.PerTrade);
        Assert.Null(c.LimitsUsd.OpenRisk);
        Assert.Null(c.LimitsUsd.PerBet);

    }

    [Fact]
    public void Undeclared_Limits_Use_The_Engines_Defaults_Of_100_Percent()
    {
        // ShadowRiskControls.CapitalOf: lo no declarado es 100 % (riesgo por operación, riesgo abierto y apuesta).
        var c = StrategyCard.Build(Spec(new SpecRiskLimits { SimulatedCapitalUsd = 10000 }));
        Assert.Equal(10000, c.LimitsUsd.PerTrade);
        Assert.Equal(10000, c.LimitsUsd.OpenRisk);
        Assert.Equal(10000, c.LimitsUsd.PerBet);

        var onlyBet = StrategyCard.Build(Spec(new SpecRiskLimits { SimulatedCapitalUsd = 10000, MaxOpenRiskPct = 3 }));
        Assert.Equal(300, onlyBet.LimitsUsd.OpenRisk);
        Assert.Equal(300, onlyBet.LimitsUsd.PerBet);     // apuesta 100 % del riesgo abierto máximo
    }

    [Fact]
    public void PerTrade_Is_The_Lower_Of_Pct_And_Fixed_Usd_Like_The_Engine()
    {
        var c = StrategyCard.Build(Spec(new SpecRiskLimits { SimulatedCapitalUsd = 10000, MaxRiskPerTradePct = 3, MaxLossPerTradeUsd = 250 }));
        Assert.Equal(250, c.LimitsUsd.PerTrade);
    }

    [Fact]
    public void Window_And_MaxEntriesPerDay_Mapping()
    {
        var spec = new StrategySpec
        {
            Operational = new SpecOperational
            {
                EntryWindow = new EntryWindow { Start = "13:45", End = "13:50" },
                TradeLimits = new SpecTradeLimits { MaxEntriesPerDay = 1 },
            },
        };
        var c = StrategyCard.Build(spec);
        Assert.Equal(new StrategyCardWindow("13:45", "13:50", "America/New_York"), c.Window);
        Assert.Equal(1, c.MaxEntriesPerDay);

        var none = StrategyCard.Build(new StrategySpec());
        Assert.Null(none.Window);
        Assert.Null(none.MaxEntriesPerDay);
    }
}
