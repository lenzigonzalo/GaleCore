using System.Text.Json.Nodes;
using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;
using static DataFeed.Tests.ShadowRuntimeEngineTests;

namespace DataFeed.Tests;

/// <summary>
/// WS-0062 inc.6 — controles de riesgo que el runtime hace cumplir: tope por apuesta, presupuesto de riesgo, margen intradiario
/// (cuenta de margen de 2.000 USD) y frenos por pérdida (day, week, total).
/// </summary>
public class ShadowInc6Tests
{
    private static StrategySpec WithRisk(SpecRiskLimits risk) => Spec() with { RiskLimits = risk };

    private static SpecRiskLimits Risk(double capital, double? reserve = null, double? openPct = null, double? betPct = null,
        List<SpecLossBrake>? brakes = null) => new()
    {
        MaxConcurrentPositions = 20, SimulatedCapitalUsd = capital, ReservePct = reserve, MaxOpenRiskPct = openPct, MaxBetPct = betPct,
        LossBrakes = brakes,
    };

    private static TradeCandidate Candidate(string expiration, double maxRisk = 415) => RealCandidate() with
    {
        MaxRisk = maxRisk,
        Legs = RealCandidate().Legs.Select(l => l with { Expiration = expiration }).ToList(),
    };

    private static ShadowPosition Pos(string id, string status, double maxRisk = 415, string expiration = "2026-10-30",
        double? realized = null, DateTime? exitAt = null, double? unrealized = null, string instance = "i-1",
        List<string>? problems = null) => new()
    {
        PositionId = id, InstanceId = instance, Symbol = "SPY", Structure = "put_credit_spread", Status = status, MaxRisk = maxRisk,
        EntryAt = Now.AddDays(-10), RealizedPnl = realized, ExitAt = exitAt, UnrealizedPnl = unrealized, ValuationProblems = problems,
        Legs = new()
        {
            new ShadowLeg { Side = "SELL", Type = "PUT", Strike = 720, Expiration = expiration },
            new ShadowLeg { Side = "BUY", Type = "PUT", Strike = 715, Expiration = expiration },
        },
    };

    private static async Task<(string Outcome, ShadowRuntimeStore Store)> Enter(StrategySpec spec, DateTime utc, TradeCandidate candidate,
        params ShadowPosition[] seed)
    {
        var (store, instance) = NewRuntime();
        foreach (var p in seed) store.UpdatePosition(p);
        var data = new FakeData { Build = () => CandidateBuildResult.Built(candidate) };
        return (await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, spec, "SPY", utc, default), store);
    }

    private static (string Reason, string Limit) Skipped(ShadowRuntimeStore store)
    {
        var e = store.GetEvents("i-1").Last(x => x.EventType == "ENTRY_SKIPPED");
        return ((string)e.Payload["reason"]!, (string)e.Payload["limit"]!);
    }

    // ── Tope por apuesta y presupuesto ───────────────────────────────

    [Fact]
    public async Task BetCap_BlocksTheSameBet_AllowsAnotherWeekOrWhatFits()
    {
        // Capital 10.000, riesgo abierto máximo 50 % = 5.000, tope por apuesta 10 % de eso = 500.
        var spec = WithRisk(Risk(10_000, openPct: 50, betPct: 10));
        var open = Pos("p1", "OPEN");
        var (same, store) = await Enter(spec, Now, Candidate("2026-10-30"), open);   // 415 + 415 > 500, misma semana ISO
        Assert.Equal(ShadowRuntimeEngine.Outcomes.RiskLimit, same);
        var (reason, limit) = Skipped(store);
        Assert.Equal("max_bet", limit);
        Assert.Contains("tope por apuesta", reason);
        Assert.Single(store.AllPositions());

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, (await Enter(spec, Now, Candidate("2026-11-13"), open)).Outcome);        // otra semana
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, (await Enter(spec, Now, Candidate("2026-10-30", 80), open)).Outcome);   // 415 + 80 ≤ 500
    }

    [Fact]
    public async Task RiskBudget_BlocksWhenOpenRiskPlusCandidateExceedsIt()
    {
        // Capital 2.000 con 10 % de reserva: presupuesto 1.800. Dos abiertas en semanas distintas (830) + la nueva, en otra semana.
        var spec = WithRisk(Risk(2_000, reserve: 10));
        var seed = new[] { Pos("p1", "OPEN", expiration: "2026-10-30"), Pos("p2", "OPEN", expiration: "2026-11-06") };
        var (outcome, store) = await Enter(spec, Now, Candidate("2026-11-13", 1_050), seed);   // 830 + 1.050 > 1.800
        Assert.Equal(ShadowRuntimeEngine.Outcomes.RiskLimit, outcome);
        Assert.Equal("risk_budget", Skipped(store).Limit);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, (await Enter(spec, Now, Candidate("2026-11-13", 900), seed)).Outcome);   // 830 + 900 ≤ 1.800
    }

    // ── Margen intradiario ───────────────────────────────────────────

    [Fact]
    public async Task IntradayMargin_UsesEquityAfterRealizedLosses()
    {
        // Capital 3.000 y una pérdida realizada neta de 1.000: equity 2.000. Abiertas 830 (dos semanas) + nueva 1.200 > 2.000.
        var spec = WithRisk(Risk(3_000));
        var open = new[] { Pos("p1", "OPEN", expiration: "2026-10-30"), Pos("p2", "OPEN", expiration: "2026-11-06") };
        var loss = Pos("c1", "CLOSED", realized: -1_000, exitAt: Now.AddDays(-5));
        var (outcome, store) = await Enter(spec, Now, Candidate("2026-11-13", 1_200), open.Append(loss).ToArray());
        Assert.Equal(ShadowRuntimeEngine.Outcomes.RiskLimit, outcome);
        Assert.Equal("intraday_margin", Skipped(store).Limit);
        // Sin la pérdida el equity es 3.000 y el mismo candidato entra.
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, (await Enter(spec, Now, Candidate("2026-11-13", 1_200), open)).Outcome);
    }

    [Fact]
    public async Task MarginAccountMinimum_BlocksShortLegsBelow2000_ButNotLongStock()
    {
        // Equity 1.800 (2.500 − 700): la pata corta necesita cuenta de margen.
        var spec = WithRisk(Risk(2_500));
        var loss = Pos("c1", "CLOSED", realized: -700, exitAt: Now.AddDays(-5));
        var (outcome, store) = await Enter(spec, Now, Candidate("2026-10-30", 100), loss);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.RiskLimit, outcome);
        var (reason, limit) = Skipped(store);
        Assert.Equal("margin_account_minimum", limit);
        Assert.Contains("mínimo de 2000.00 USD de cuenta de margen", reason);

        // Acciones en largo (sin pata corta) con equity de 1.000: entran si el costo cabe.
        var stock = new TradeCandidate
        {
            Symbol = "AAPL", Structure = RuntimeStructures.LongEquity, MaxRisk = 500, Credit = -50,
            Legs = new() { new CandidateLeg { Side = "BUY", Type = LongEquityCandidateBuilder.LegType } },
        };
        var small = WithRisk(Risk(1_000));
        Assert.Null(ShadowRiskControls.CandidateBlock(small, stock, Array.Empty<ShadowPosition>()));
        // ...y si el costo supera el capital, no (sin tope declarado la apuesta puede ser todo el capital).
        Assert.Equal("max_bet", ShadowRiskControls.CandidateBlock(small, stock with { MaxRisk = 1_200 }, Array.Empty<ShadowPosition>())!.Limit);
        // Con reserva de 50 % y una pérdida de 100: equity 900, reserva 500, el costo de 450 no cabe en el margen.
        var withReserve = WithRisk(Risk(1_000, reserve: 50));
        Assert.Equal("intraday_margin", ShadowRiskControls.CandidateBlock(withReserve, stock with { MaxRisk = 450 },
            new[] { Pos("c", "CLOSED", realized: -100, exitAt: Now) })!.Limit);
    }

    [Fact]
    public async Task WithoutSimulatedCapital_NothingIsEnforced()
    {
        var spec = WithRisk(new SpecRiskLimits { MaxConcurrentPositions = 20 });
        var (outcome, _) = await Enter(spec, Now, Candidate("2026-10-30", 50_000), Pos("p1", "OPEN"));
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, outcome);
    }

    // ── Freno por pérdida ────────────────────────────────────────────

    private static SpecLossBrake Brake(string period, double? usd = null, double? pct = null, string basis = "realized") =>
        new() { Period = period, MaxLossUsd = usd, MaxLossPctOfCapital = pct, Basis = basis };

    [Fact]
    public async Task LossBrake_Day_BlocksToday_AllowsTheNextDay_AndNeverClosesOpenPositions()
    {
        var spec = WithRisk(Risk(10_000, brakes: new() { Brake("day", usd: 500) }));
        var seed = new[] { Pos("c1", "CLOSED", realized: -600, exitAt: Now.AddHours(-2)), Pos("o1", "OPEN", expiration: "2026-10-30") };
        var (blocked, store) = await Enter(spec, Now, Candidate("2026-11-13"), seed);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.LossBrake, blocked);
        var (reason, limit) = Skipped(store);
        Assert.Equal("loss_brake", limit);
        Assert.Contains("freno por pérdida (day)", reason);
        Assert.Equal("OPEN", store.GetPosition("o1")!.Status);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, (await Enter(spec, Now.AddDays(1), Candidate("2026-11-13"), seed)).Outcome);
    }

    [Fact]
    public async Task LossBrake_RunsBeforeBuildingTheCandidate()
    {
        var spec = WithRisk(Risk(10_000, brakes: new() { Brake("day", usd: 500) }));
        var (store, instance) = NewRuntime();
        store.UpdatePosition(Pos("c1", "CLOSED", realized: -600, exitAt: Now.AddHours(-2)));
        var data = new FakeData { Build = () => CandidateBuildResult.Built(Candidate("2026-11-13")) };
        await ShadowRuntimeEngine.EvaluateEntryAsync(store, data, instance, spec, "SPY", Now, default);
        Assert.Equal(0, data.BuildCalls);
    }

    [Fact]
    public async Task LossBrake_DayIsCountedInTheSpecTimezone()
    {
        var spec = WithRisk(Risk(10_000, brakes: new() { Brake("day", usd: 500) }));
        // Cerró 23:30 ET del miércoles (03:30Z del jueves). A las 14:00Z del jueves ya es otro día en ET; a las 02:00Z del viernes (22:00 ET del jueves) no.
        var loss = Pos("c1", "CLOSED", realized: -600, exitAt: new DateTime(2026, 9, 24, 3, 30, 0, DateTimeKind.Utc));
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened,
            (await Enter(spec, new DateTime(2026, 9, 24, 14, 0, 0, DateTimeKind.Utc), Candidate("2026-11-13"), loss)).Outcome);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.LossBrake,
            (await Enter(spec, new DateTime(2026, 9, 24, 3, 45, 0, DateTimeKind.Utc), Candidate("2026-11-13"), loss)).Outcome);   // 23:45 ET: mismo día
    }

    [Fact]
    public async Task LossBrake_Week_MondayToSunday()
    {
        var spec = WithRisk(Risk(10_000, brakes: new() { Brake("week", usd: 500) }));
        var loss = Pos("c1", "CLOSED", realized: -600, exitAt: new DateTime(2026, 9, 21, 15, 0, 0, DateTimeKind.Utc));   // lunes 21/09
        DateTime At(int day) => new(2026, 9, day, 15, 0, 0, DateTimeKind.Utc);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.LossBrake, (await Enter(spec, At(24), Candidate("2026-11-13"), loss)).Outcome);   // jueves
        Assert.Equal(ShadowRuntimeEngine.Outcomes.LossBrake, (await Enter(spec, At(27), Candidate("2026-11-13"), loss)).Outcome);   // domingo
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, (await Enter(spec, At(28), Candidate("2026-11-13"), loss)).Outcome);      // lunes siguiente
    }

    [Fact]
    public async Task LossBrake_Total_StaysForeverButARedeployedInstanceStartsFromZero()
    {
        var spec = WithRisk(Risk(10_000, brakes: new() { Brake("total", pct: 5) }));   // 5 % de 10.000 = 500
        var loss = Pos("c1", "CLOSED", realized: -520, exitAt: Now.AddDays(-30));
        Assert.Equal(ShadowRuntimeEngine.Outcomes.LossBrake, (await Enter(spec, Now, Candidate("2026-11-13"), loss)).Outcome);
        var (outcome, store) = await Enter(spec, Now.AddDays(60), Candidate("2026-11-13"), loss);
        Assert.Equal(ShadowRuntimeEngine.Outcomes.LossBrake, outcome);
        Assert.Contains("hasta redesplegar", Skipped(store).Reason);

        // Instancia nueva (redespliegue): el total mira sólo sus posiciones; la pérdida de la vieja no cuenta.
        var scope = new[] { loss };
        Assert.NotNull(ShadowRiskControls.LossBrake(spec, scope, scope, Now));
        Assert.Null(ShadowRiskControls.LossBrake(spec, scope, Array.Empty<ShadowPosition>(), Now));
    }

    [Fact]
    public void LossBrake_RealizedPlusOpen_UsesUnrealized_AndNoDataBlocks()
    {
        var spec = WithRisk(Risk(10_000, brakes: new() { Brake("day", usd: 500, basis: "realized_plus_open") }));
        var closed = Pos("c1", "CLOSED", realized: -200, exitAt: Now);
        // Realizada −200 y abierta valuada en −350: −550 ≥ 500.
        var scope = new[] { closed, Pos("o1", "OPEN", unrealized: -350) };
        Assert.Contains("realizada + abiertas", ShadowRiskControls.LossBrake(spec, scope, scope, Now)!.Reason);
        // Abierta valuada en −100: −300 < 500, entra.
        var fine = new[] { closed, Pos("o1", "OPEN", unrealized: -100) };
        Assert.Null(ShadowRiskControls.LossBrake(spec, fine, fine, Now));
        // Una abierta sin valuación (o con la última valuación fallida): NO_DATA, se bloquea.
        var noValue = new[] { closed, Pos("o1", "OPEN", unrealized: null) };
        Assert.StartsWith("NO_DATA", ShadowRiskControls.LossBrake(spec, noValue, noValue, Now)!.Reason);
        var stale = new[] { closed, Pos("o1", "OPEN", unrealized: 10, problems: new() { "sin cotización" }) };
        Assert.StartsWith("NO_DATA", ShadowRiskControls.LossBrake(spec, stale, stale, Now)!.Reason);
        // Con base realizada, las abiertas no cuentan ni hace falta valuarlas.
        var realizedOnly = WithRisk(Risk(10_000, brakes: new() { Brake("day", usd: 500) }));
        Assert.Null(ShadowRiskControls.LossBrake(realizedOnly, noValue, noValue, Now));
    }

    [Fact]
    public async Task WithoutDeclaredControls_BehaviourIsUnchanged()
    {
        var (outcome, _) = await Enter(Spec(), Now, RealCandidate(), Pos("c1", "CLOSED", realized: -99_999, exitAt: Now));
        Assert.Equal(ShadowRuntimeEngine.Outcomes.Opened, outcome);
    }

    // ── Validación y carga ───────────────────────────────────────────

    private static List<string> Errors(SpecRiskLimits r) => StrategySpecValidator.Validate(WithRisk(r)).Errors;

    [Fact]
    public void Validator_AcceptsAWellDeclaredStrategy_AndRejectsBadControls()
    {
        Assert.Empty(Errors(Risk(5_000, reserve: 10, openPct: 60, betPct: 40,
            brakes: new() { Brake("day", pct: 2), Brake("week", usd: 400, basis: "realized_plus_open"), Brake("total", usd: 1_000) })));

        void Bad(SpecRiskLimits r, string expected) => Assert.Contains(Errors(r), e => e.Contains(expected));
        Bad(Risk(0), "simulated_capital_usd must be positive");
        Bad(Risk(1_000, reserve: 100), "reserve_pct");
        Bad(Risk(1_000, openPct: 0), "max_open_risk_pct");
        Bad(Risk(1_000, betPct: 101), "max_bet_pct");
        Bad(new SpecRiskLimits { ReservePct = 10 }, "need risk_limits.simulated_capital_usd");
        Bad(Risk(1_000, brakes: new() { Brake("day", usd: 5, pct: 1) }), "exactly one of");
        Bad(Risk(1_000, brakes: new() { Brake("day") }), "exactly one of");
        Bad(Risk(1_000, brakes: new() { Brake("month", usd: 5) }), "period must be one of");
        Bad(Risk(1_000, brakes: new() { Brake("day", usd: 5, basis: "open") }), "basis must be");
        Bad(Risk(1_000, brakes: new() { Brake("day", usd: -5) }), "max_loss_usd must be positive");
        Bad(Risk(1_000, brakes: new() { Brake("day", pct: 120) }), "max_loss_pct_of_capital must be in");
        Bad(Risk(1_000, brakes: new() { Brake("day", usd: 5), Brake("day", usd: 6) }), "at most one brake per period");
        Bad(Risk(1_000, brakes: new()), "must not be empty");
        Bad(new SpecRiskLimits { LossBrakes = new() { Brake("day", pct: 5) } }, "needs risk_limits.simulated_capital_usd");
    }

    [Fact]
    public void Loader_ParsesTheJsonShape_AndRejectsUnknownKeys()
    {
        var json = JsonNode.Parse(SpecJson())!;
        json["risk_limits"]!["simulated_capital_usd"] = 10_000;
        json["risk_limits"]!["reserve_pct"] = 10;
        json["risk_limits"]!["loss_brakes"] = new JsonArray(
            new JsonObject { ["period"] = "day", ["max_loss_pct_of_capital"] = 2, ["basis"] = "realized_plus_open" },
            new JsonObject { ["period"] = "total", ["max_loss_usd"] = 1_500 });
        var ok = StrategySpecLoader.LoadFromJson(json.ToJsonString());
        Assert.True(ok.Success, string.Join("; ", ok.Errors));
        var brakes = ok.Spec!.RiskLimits.LossBrakes!;
        Assert.Equal(2, brakes.Count);
        Assert.Equal("realized_plus_open", brakes[0].Basis);
        Assert.Equal("realized", brakes[1].Basis);
        Assert.Equal(1_500, brakes[1].MaxLossUsd);

        var bad = JsonNode.Parse(json.ToJsonString())!;
        bad["risk_limits"]!["loss_brakes"]![0]!["max_loss_pct"] = 3;
        Assert.False(StrategySpecLoader.LoadFromJson(bad.ToJsonString()).Success);
        var bad2 = JsonNode.Parse(json.ToJsonString())!;
        bad2["risk_limits"]!["max_drawdown_pct"] = 3;
        Assert.False(StrategySpecLoader.LoadFromJson(bad2.ToJsonString()).Success);
    }
}
