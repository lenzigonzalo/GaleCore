using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Tests;

/// <summary>P1-04 — exposición agregada contra límites y reparto de un capital con reserva, apuesta y escalera.</summary>
public class ShadowCapitalTests
{
    private static readonly DateTime T0 = new(2026, 10, 6, 14, 0, 0, DateTimeKind.Utc);

    // Perfil v7 + decisiones del owner del 06/10: reserva 10 %, 5 % por operación, 50 % abierto, 30 % por apuesta.
    private static CapitalLimits Limits(double capital) => new()
    {
        Capital = capital, ReservePct = 10, MaxRiskPerTradePct = 5, MaxOpenRiskPct = 50, MaxBetPct = 30,
    };

    private static ShadowPosition Open(string expiration, double maxRisk = 456, string structure = "put_credit_spread",
        string symbol = "SPY", double credit = 0.44) => new()
    {
        PositionId = Guid.NewGuid().ToString(), Status = "OPEN", Symbol = symbol, Structure = structure,
        EntryCredit = credit, MaxRisk = maxRisk, Width = 5, EntryAt = T0, EntryDte = 40,
        Legs = new List<ShadowLeg>
        {
            new() { Side = "SELL", Type = "PUT", Strike = 640, Expiration = expiration },
            new() { Side = "BUY", Type = "PUT", Strike = 635, Expiration = expiration },
        },
    };

    private static SpecVersionRecord Version(string name, params ShadowPosition[] positions) => new()
    {
        ContentHash = $"sha256:{name}", SpecName = name, SpecVersion = "1.0.5", Instances = 1, Positions = positions.ToList(),
    };

    private static StrategyTerms Spy(params ShadowPosition[] observed) => new()
    {
        SpecName = "spy_pcs", SpecVersion = "1.0.5", Symbol = "SPY", Structure = "put_credit_spread", Width = 5,
        MinDte = 30, MaxDte = 45, MinMinutesBetweenEntries = 1440, MaxConcurrentPositions = 10, MaxLossPerTradeUsd = 500,
        Observed = observed.ToList(),
    };

    [Fact]
    public void Exposure_SmallPositionsSameWeekAreOneBet()
    {
        // Tres de 456 que vencen el mismo semana (lun, mié, vie) = una apuesta de 1.368; otra la semana siguiente.
        var v = Version("spy_pcs", Open("2026-11-16"), Open("2026-11-18"), Open("2026-11-20"), Open("2026-11-23"));
        var rep = ShadowCapital.Exposure(new[] { v }, Limits(10000), T0);

        Assert.Equal(4, rep.PositionsOpen);
        Assert.Equal(1824, rep.OpenMaxRisk);
        Assert.Equal(2, rep.Bets.Count);
        var big = rep.Bets.First();
        Assert.Equal("SPY bullish 2026-W47", big.Key);
        Assert.Equal(3, big.Positions);
        Assert.Equal(1368, big.MaxRisk);
        Assert.Equal(27.4, big.PctOfMaxOpenRisk);          // 1.368 / 5.000
        Assert.All(rep.Checks, c => Assert.True(c.Ok));     // 1.368 ≤ 1.500
        Assert.Equal(8176, rep.IdleUsd);
        Assert.Equal(3176, rep.AvailableForNewRiskUsd);     // min(5.000, 9.000) − 1.824
        Assert.Single(rep.BySymbol);
        Assert.Equal(4, rep.ByExpiration.Count);
    }

    [Fact]
    public void Exposure_FlagsBetOverLimitAndTradeOverLimit()
    {
        var v = Version("spy_pcs", Open("2026-11-16"), Open("2026-11-17"), Open("2026-11-18"), Open("2026-11-19", maxRisk: 600));
        var rep = ShadowCapital.Exposure(new[] { v }, Limits(10000), T0);

        var bet = rep.Checks.Single(c => c.Limit == "bet:SPY bullish 2026-W47");
        Assert.False(bet.Ok);
        Assert.Equal(1968, bet.Used);
        Assert.Equal(1500, bet.Max);
        Assert.Equal(-468, bet.Headroom);
        var perTrade = rep.Checks.Single(c => c.Limit.StartsWith("per_trade:"));
        Assert.False(perTrade.Ok);
        Assert.Equal(600, perTrade.Used);
        Assert.True(rep.Checks.Single(c => c.Limit == "open_risk").Ok);
    }

    [Fact]
    public void Exposure_DirectionSeparatesBets_AndNoOpenIsEmpty()
    {
        var v = Version("x", Open("2026-11-16"), Open("2026-11-16", structure: "call_credit_spread"));
        var rep = ShadowCapital.Exposure(new[] { v }, Limits(10000), T0);
        Assert.Equal(2, rep.Bets.Count);

        var empty = ShadowCapital.Exposure(new[] { Version("x") }, Limits(10000), T0);
        Assert.Equal(0, empty.OpenMaxRisk);
        Assert.Null(empty.UnrealizedPnl);
        Assert.Empty(empty.Bets);
        Assert.Equal(5000, empty.AvailableForNewRiskUsd);
    }

    [Fact]
    public void Allocate_10000_TenPositionsThreePerWeek()
    {
        var plan = ShadowCapital.Allocate(new[] { Spy(Open("2026-11-16")) }, Limits(10000), T0);

        Assert.Equal(1000, plan.ReserveUsd);
        Assert.Equal(5000, plan.RiskBudgetUsd);
        Assert.Equal(1500, plan.MaxBetUsd);
        var a = plan.Strategies.Single();
        Assert.True(a.Fits);
        Assert.Equal("observed", a.RiskSource);
        Assert.Equal(456, a.RiskPerContract);
        Assert.Equal(1, a.ContractsPerPosition);
        Assert.Equal(10, a.Positions);                      // por presupuesto 10 (4.560), y la spec permite 10
        Assert.Equal(3, a.PositionsPerWeek);                // 1.500 / 456
        Assert.Equal(4560, plan.AllocatedRiskUsd);
        Assert.Equal(440, plan.UnallocatedRiskUsd);
        Assert.Equal(5440, plan.CashUsd);
        // Una por día, tres por semana: días 1-3, 6-8, 11-13, 16.
        Assert.Equal(new[] { 1, 2, 3, 6, 7, 8, 11, 12, 13, 16 }, plan.Ladder.Select(s => s.Day));
        Assert.Equal(4560, plan.Ladder.Last().CumulativeRiskUsd);
        Assert.All(plan.Ladder.GroupBy(s => s.Week), g => Assert.True(g.Sum(s => s.RiskUsd) <= plan.MaxBetUsd));
    }

    [Fact]
    public void Allocate_5000_SpreadOfFiveDoesNotFit_SaysWidthThatWould()
    {
        var plan = ShadowCapital.Allocate(new[] { Spy(Open("2026-11-16")) }, Limits(5000), T0);

        var a = plan.Strategies.Single();
        Assert.Equal(250, a.MaxRiskPerTradeUsd);            // 5 % de 5.000, menor que los 500 de la spec
        Assert.False(a.Fits);
        Assert.Equal("per_trade", a.BindingLimit);
        Assert.Equal(0, a.Positions);
        Assert.Equal(2, a.MaxWidthThatFits);                // (2 − 0,18) × 100 ≈ 182 ≤ 250; 3 ya pasa
        Assert.Empty(plan.Ladder);
        Assert.Equal(5000, plan.CashUsd);
    }

    [Fact]
    public void Allocate_WithoutObservations_UsesFullWidth_AndSpecCapBinds()
    {
        var terms = Spy() with { MaxConcurrentPositions = 4, Width = 2 };
        var plan = ShadowCapital.Allocate(new[] { terms }, Limits(10000), T0);

        var a = plan.Strategies.Single();
        Assert.Equal("width", a.RiskSource);
        Assert.Equal(200, a.RiskPerContract);
        Assert.Equal(2, a.ContractsPerPosition);            // 500 / 200
        Assert.Equal(4, a.Positions);
        Assert.Equal("max_concurrent", a.BindingLimit);
        Assert.Equal(3, a.PositionsPerWeek);                // 1.500 / 400
    }

    [Fact]
    public void Allocate_TwoStrategiesSplitTheBudget()
    {
        var plan = ShadowCapital.Allocate(new[] { Spy(Open("2026-11-16")), Spy(Open("2026-11-16")) with { SpecName = "otra" } },
            Limits(10000), T0);
        Assert.All(plan.Strategies, a => Assert.Equal(2500, a.BudgetUsd));
        Assert.All(plan.Strategies, a => Assert.Equal(5, a.Positions));
    }

    [Theory]
    [InlineData(0, 10)]
    [InlineData(10000, 120)]
    [InlineData(10000, -1)]
    public void Limits_Invalid(double capital, double reserve)
    {
        var l = Limits(capital) with { ReservePct = reserve };
        Assert.NotNull(l.Problem());
    }

    [Fact]
    public void Terms_TakeWidthAndRiskFromSpec()
    {
        var spec = new StrategySpec
        {
            Identity = new SpecIdentity { Name = "spy_pcs", Version = "1.0.5" },
            Universe = new SpecUniverse { Symbols = new() { "SPY" } },
            Structure = new SpecStructure { DefaultStructure = "put_credit_spread" },
            CandidateConstruction = new CandidateConstruction
            {
                Legs = new()
                {
                    new LegTemplate { Side = "SELL", Type = "PUT", StrikeSelection = new LegStrikeSelection { Method = "DELTA" } },
                    new LegTemplate { Side = "BUY", Type = "PUT", StrikeSelection = new LegStrikeSelection { Method = "FIXED_WIDTH", Width = 5 } },
                },
                Constraints = new ConstructionConstraints { MinDte = 30, MaxDte = 45 },
            },
            RiskLimits = new SpecRiskLimits { MaxConcurrentPositions = 10, MinMinutesBetweenEntries = 1440, MaxLossPerTradeUsd = 500 },
        };
        var t = ShadowCapital.Terms(spec, new[] { Version("spy_pcs", Open("2026-11-16"), Open("2026-11-16") with { Width = 2 }) });
        Assert.Equal(5, t.Width);
        Assert.Equal("SPY", t.Symbol);
        Assert.Single(t.Observed);                          // sólo las del mismo ancho
        Assert.Equal(500, t.MaxLossPerTradeUsd);
    }
}
