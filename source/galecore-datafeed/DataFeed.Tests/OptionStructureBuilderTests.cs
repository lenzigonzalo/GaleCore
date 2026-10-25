using System.Globalization;
using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Application.Data.Tastytrade.OptionChains;

namespace DataFeed.Tests;

/// <summary>
/// WS-0062 inc.4 — estructuras de opciones genéricas: patas declaradas en la spec (delta, puntos o % del precio, strike fijo u offset
/// de otra pata), crédito al precio de fill, pérdida máxima por payoff y una sola raíz. Caso guía: el «sándwich» 0DTE de SPX
/// (cóndor de hierro SPXW PM, vendidas a 5 puntos o más del precio, compradas 5 más afuera, crédito natural mínimo 2,50).
/// </summary>
public class OptionStructureBuilderTests
{
    private static readonly DateTime Now = ShadowRuntimeEngineTests.Now;   // jueves 24/09/2026, 11:00 ET
    private const double Spot = 7623.68;                                   // el SPX del 23/10 en la cadena guardada

    /// <summary>
    /// Un vencimiento como los de la cadena real guardada de SPX (SPXW PM, strikes cada 5, símbolos OCC y de streamer reales).
    /// </summary>
    private static Expiration Chain(string date = "2026-09-24", string root = "SPXW", string settlement = "PM", string type = "Weekly")
    {
        string yymmdd = DateTime.Parse(date, CultureInfo.InvariantCulture).ToString("yyMMdd");
        return new Expiration
        {
            ExpirationDate = date, ExpirationType = type, SettlementType = settlement, DaysToExpiration = 99,
            strikes = Enumerable.Range(0, 61).Select(i => 7500.0 + 5 * i).Select(k => new Strike
            {
                StrikePrice = k.ToString("0.0", CultureInfo.InvariantCulture),
                call = $"{root,-6}{yymmdd}C{(long)(k * 1000):D8}", CallStreamerSymbol = $".{root}{yymmdd}C{k}",
                put = $"{root,-6}{yymmdd}P{(long)(k * 1000):D8}", PutStreamerSymbol = $".{root}{yymmdd}P{k}",
            }).ToList(),
        };
    }

    private static CreditSpreadCandidateBuilderTests.FakeSource Source(params Expiration[] chain)
    {
        var s = new CreditSpreadCandidateBuilderTests.FakeSource
        {
            Expirations = chain.Length > 0 ? chain.ToList() : new() { Chain() },
            Underlying = new UnderlyingQuote(Spot, Now.AddSeconds(-2)),
            Quotes = new(),
        };
        void Q(string sym, double bid, double ask) => s.Quotes[sym] = new LegQuote(bid, ask, Now.AddSeconds(-3));
        Q(".SPXW260924P7615", 2.00, 2.20);   // vendida (put): cobra el bid
        Q(".SPXW260924P7610", 0.90, 1.00);   // comprada (put): paga el ask
        Q(".SPXW260924C7630", 2.20, 2.40);   // vendida (call)
        Q(".SPXW260924C7635", 0.50, 0.60);   // comprada (call)
        return s;
    }

    private static LegTemplate Leg(string id, string side, string type, LegStrikeSelection sel) =>
        new() { Id = id, Side = side, Type = type, StrikeSelection = sel };

    /// <summary>El sándwich: vendidas a ≥ 5 puntos del precio, compradas 5 más afuera, 0DTE, crédito mínimo al fill natural.</summary>
    internal static StrategySpec Sandwich(double minCredit = 2.50)
    {
        var spec = ShadowRuntimeEngineTests.NaturalSpec();
        return spec with
        {
            Structure = spec.Structure with { AllowedStrategies = new() { RuntimeStructures.CustomOptions }, DefaultStructure = RuntimeStructures.CustomOptions },
            CandidateConstruction = spec.CandidateConstruction with
            {
                Legs = new()
                {
                    Leg("put_vendida", "SELL", "PUT", new() { Method = "POINTS_FROM_SPOT", PointsFromSpot = -5 }),
                    Leg("put_comprada", "BUY", "PUT", new() { Method = "OFFSET_FROM_LEG", FromLeg = "put_vendida", OffsetPoints = -5 }),
                    Leg("call_vendida", "SELL", "CALL", new() { Method = "POINTS_FROM_SPOT", PointsFromSpot = 5 }),
                    Leg("call_comprada", "BUY", "CALL", new() { Method = "OFFSET_FROM_LEG", FromLeg = "call_vendida", OffsetPoints = 5 }),
                },
                Constraints = new() { MinDte = 0, MaxDte = 0, MinCredit = minCredit },
            },
        };
    }

    private static Task<CandidateBuildResult> Build(CreditSpreadCandidateBuilderTests.FakeSource source, StrategySpec spec) =>
        new CreditSpreadCandidateBuilder(source).BuildAsync(new StrategyInstance { InstanceId = "i-1" }, spec, "SPX", 15.2, Now);

    // ── El sándwich ─────────────────────────────────────────────

    [Fact]
    public void Sandwich_IsAValidSpec()
    {
        var result = StrategySpecValidator.Validate(Sandwich());
        Assert.True(result.IsValid, string.Join("; ", result.Errors));
    }

    [Fact]
    public async Task Sandwich_StrikesFromThePrice_NaturalCredit_RiskFromThePayoff()
    {
        var source = Source();

        var result = await Build(source, Sandwich());

        var c = Assert.IsType<TradeCandidate>(result.Candidate);
        Assert.Equal("custom_options", c.Structure);
        // Spot 7623,68: put vendida = primer strike ≤ 7618,68 → 7615; call vendida = primer strike ≥ 7628,68 → 7630.
        Assert.Equal(new[] { ("SELL", "PUT", 7615.0), ("BUY", "PUT", 7610.0), ("SELL", "CALL", 7630.0), ("BUY", "CALL", 7635.0) },
            c.Legs.Select(l => (l.Side, l.Type, l.Strike)));
        Assert.Equal(2.6, c.Credit);        // (2.00 − 1.00) + (2.20 − 0.60): bids vendidos − asks comprados
        Assert.Equal(240, c.MaxRisk);       // (5 − 2.60) × 100: sólo un lado pierde a la vez
        Assert.Equal(5, c.Width);
        Assert.Equal(0, c.Dte);
        Assert.Equal(Spot, c.Snapshot.UnderlyingPrice);
        Assert.All(c.Legs, l => { Assert.Equal("2026-09-24", l.Expiration); Assert.StartsWith(".SPXW", l.StreamerSymbol); Assert.StartsWith("SPXW", l.OccSymbol); });
        Assert.Null(source.LastGexRequest);   // sin patas por delta no se piden griegas
        Assert.Equal(Now.AddSeconds(-3), c.Snapshot.OldestQuoteAt);
    }

    [Fact]
    public async Task Sandwich_CreditBelowTheMinimum_Rejected_WithReason()
    {
        var source = Source();
        source.Quotes[".SPXW260924C7635"] = new LegQuote(0.80, 0.90, Now);   // comprada más cara: 1.00 + 1.30 = 2.30

        var result = await Build(source, Sandwich());

        Assert.Null(result.Candidate);
        Assert.Matches(@"^crédito 2[.,]3 menor al mínimo 2[.,]5$", result.RejectReason);
    }

    [Fact]
    public async Task Sandwich_FillMid_UsesTheMids()
    {
        var spec = Sandwich(2.5) with { Execution = new SpecExecution { Fill = "mid" } };

        var c = Assert.IsType<TradeCandidate>((await Build(Source(), spec)).Candidate);

        Assert.Equal(2.9, c.Credit);        // (2.10 − 0.95) + (2.30 − 0.55)
    }

    [Fact]
    public async Task Sandwich_SpotOnAStrike_TakesTheNextOneOutside()
    {
        var source = Source();
        source.Underlying = new UnderlyingQuote(7620, Now);   // 7620 − 5 = 7615 exacto: «5 o más» lo incluye
        source.Quotes[".SPXW260924C7625"] = new LegQuote(2.20, 2.40, Now);
        source.Quotes[".SPXW260924C7630"] = new LegQuote(0.50, 0.60, Now);

        var c = Assert.IsType<TradeCandidate>((await Build(source, Sandwich(1.0))).Candidate);

        Assert.Equal(new[] { 7615.0, 7610.0, 7625.0, 7630.0 }, c.Legs.Select(l => l.Strike));
    }

    [Fact]
    public async Task Sandwich_ThirdFriday_AmAndPmShareTheDate_OnlyTheSeriePmIsUsed()
    {
        // El 3.er viernes conviven SPX (AM) y SPXW (PM) con la misma fecha: no se mezclan ni se toma la AM.
        var am = Chain(root: "SPX", settlement: "AM", type: "Regular");
        var source = Source(am, Chain());

        var c = Assert.IsType<TradeCandidate>((await Build(source, Sandwich())).Candidate);

        Assert.All(c.Legs, l => Assert.StartsWith(".SPXW", l.StreamerSymbol));
    }

    [Fact]
    public async Task OnlyAmSeriesForTheDate_NoCandidate()
    {
        var source = Source(Chain(root: "SPX", settlement: "AM", type: "Regular"));

        var result = await Build(source, Sandwich());

        Assert.Null(result.Candidate);
        Assert.Contains("AM", result.RejectReason);
    }

    [Fact]
    public async Task GreeksOfAnotherSerie_WithTheSameDate_AreNotMixedIn()
    {
        // Una pata por delta lee las griegas del handler; si vienen de la serie AM (raíz SPX) y el vencimiento elegido es SPXW, no hay candidato.
        var spec = Sandwich();
        var legs = spec.CandidateConstruction.Legs.ToList();
        legs[0] = Leg("put_vendida", "SELL", "PUT", new() { Method = "DELTA", TargetDelta = -0.10, DeltaTolerance = 0.05 });
        spec = spec with { CandidateConstruction = spec.CandidateConstruction with { Legs = legs } };
        var source = Source(Chain(root: "SPX", settlement: "AM", type: "Regular"), Chain());
        source.Gex = _ => new GammaExposureResponse
        {
            Symbol = "SPX", Spot = Spot, Expiration = "2026-09-24", DTE = 0, ExpirationType = "Regular",
            Strikes = new()
            {
                new() { Strike = 7615, PutDelta = -0.10, PutStreamerSymbol = ".SPX260924P7615" },
                new() { Strike = 7610, PutDelta = -0.09, PutStreamerSymbol = ".SPX260924P7610" },
                new() { Strike = 7630, CallDelta = 0.10, CallStreamerSymbol = ".SPX260924C7630" },
                new() { Strike = 7635, CallDelta = 0.09, CallStreamerSymbol = ".SPX260924C7635" },
            },
        };

        var result = await Build(source, spec);

        Assert.Null(result.Candidate);
        Assert.Contains("no se mezclan series", result.RejectReason);
    }

    // ── El precio del subyacente ─────────────────────────────────

    [Fact]
    public async Task NoUnderlyingPrice_NoCandidate()
    {
        var source = Source();
        source.Underlying = null;

        var result = await Build(source, Sandwich());

        Assert.Null(result.Candidate);
        Assert.Contains("sin precio del subyacente SPX", result.RejectReason);
    }

    [Theory]
    [InlineData(-10, "dato viejo")]     // 10 minutos
    [InlineData(5, "futuro")]
    public async Task UnderlyingPriceWithBadTime_NoCandidate(int minutes, string reason)
    {
        var source = Source();
        source.Underlying = new UnderlyingQuote(Spot, Now.AddMinutes(minutes));

        var result = await Build(source, Sandwich());

        Assert.Null(result.Candidate);
        Assert.Contains(reason, result.RejectReason);
    }

    [Fact]
    public async Task UnderlyingPriceWithoutTime_NoCandidate()
    {
        var source = Source();
        source.Underlying = new UnderlyingQuote(Spot, null);

        var result = await Build(source, Sandwich());

        Assert.Null(result.Candidate);
        Assert.Contains("sin hora", result.RejectReason);
    }

    // ── Selectores ──────────────────────────────────────────────

    private static StrategySpec With(StrategySpec spec, params LegTemplate[] legs) =>
        spec with { CandidateConstruction = spec.CandidateConstruction with { Legs = legs.ToList() } };

    [Fact]
    public async Task SelectorByPercent_And_FixedStrike()
    {
        // Put vendida 1 % debajo (7623,68 × 0,99 = 7547,44 → 7545), comprada en el strike fijo 7540; call vendida 1 % arriba (7699,92 → 7700), comprada 5 arriba.
        var spec = With(Sandwich(1.0),
            Leg("p1", "SELL", "PUT", new() { Method = "PCT_FROM_SPOT", PctFromSpot = -1 }),
            Leg("p2", "BUY", "PUT", new() { Method = "FIXED_STRIKE", Strike = 7540 }),
            Leg("c1", "SELL", "CALL", new() { Method = "PCT_FROM_SPOT", PctFromSpot = 1 }),
            Leg("c2", "BUY", "CALL", new() { Method = "OFFSET_FROM_LEG", FromLeg = "c1", OffsetPoints = 5 }));
        var source = Source();
        foreach (var (sym, bid, ask) in new[] { (".SPXW260924P7545", 1.0, 1.2), (".SPXW260924P7540", 0.4, 0.5), (".SPXW260924C7700", 0.9, 1.0), (".SPXW260924C7705", 0.2, 0.3) })
            source.Quotes[sym] = new LegQuote(bid, ask, Now);

        var built = await Build(source, spec);
        Assert.True(built.Candidate != null, built.RejectReason);
        var c = built.Candidate!;

        Assert.Equal(new[] { 7545.0, 7540.0, 7700.0, 7705.0 }, c.Legs.Select(l => l.Strike));
        Assert.Equal(1.1, c.Credit);        // (1.0 − 0.5) + (0.9 − 0.3)
    }

    [Fact]
    public async Task SelectorByDelta_ThenOffset_BuildsLikeThePutCreditSpread()
    {
        var spec = ShadowRuntimeEngineTests.Spec();
        spec = spec with
        {
            Structure = spec.Structure with { AllowedStrategies = new() { RuntimeStructures.CustomOptions }, DefaultStructure = RuntimeStructures.CustomOptions },
            CandidateConstruction = spec.CandidateConstruction with
            {
                Legs = new()
                {
                    Leg("corta", "SELL", "PUT", new() { Method = "DELTA", TargetDelta = -0.16, DeltaTolerance = 0.04 }),
                    Leg("larga", "BUY", "PUT", new() { Method = "OFFSET_FROM_LEG", FromLeg = "corta", OffsetPoints = -5, TolerancePoints = 1 }),
                },
            },
        };
        var source = new CreditSpreadCandidateBuilderTests.FakeSource();

        var result = await new CreditSpreadCandidateBuilder(source).BuildAsync(new StrategyInstance { InstanceId = "i-1" }, spec, "SPY", 15.2, Now);

        var c = Assert.IsType<TradeCandidate>(result.Candidate);
        Assert.Equal(new[] { 720.0, 715.0 }, c.Legs.Select(l => l.Strike));
        Assert.Equal(0.7, c.Credit);
        Assert.Equal(430, c.MaxRisk);
        Assert.Equal(-0.17, c.DeltaShort);
    }

    [Fact]
    public async Task OffsetWithoutTheStrike_NoCandidate_UnlessToleranceAllowsIt()
    {
        var spec = With(Sandwich(1.0),
            Leg("p1", "SELL", "PUT", new() { Method = "FIXED_STRIKE", Strike = 7615 }),
            Leg("p2", "BUY", "PUT", new() { Method = "OFFSET_FROM_LEG", FromLeg = "p1", OffsetPoints = -3 }));

        var result = await Build(Source(), spec);

        Assert.Null(result.Candidate);   // 7612 no existe y la tolerancia por defecto es 0
        Assert.Contains("cerca de 7612", result.RejectReason);
    }

    [Fact]
    public async Task FixedStrikeThatDoesNotExist_NoCandidate()
    {
        var spec = With(Sandwich(1.0),
            Leg("p1", "SELL", "PUT", new() { Method = "FIXED_STRIKE", Strike = 7613 }),
            Leg("p2", "BUY", "PUT", new() { Method = "FIXED_STRIKE", Strike = 7610 }));

        var result = await Build(Source(), spec);

        Assert.Null(result.Candidate);
        Assert.Contains("no hay strike 7613", result.RejectReason);
    }

    [Fact]
    public async Task UncoveredShortCall_NoCandidate_UnlimitedRisk()
    {
        var spec = With(Sandwich(1.0),
            Leg("c1", "SELL", "CALL", new() { Method = "POINTS_FROM_SPOT", PointsFromSpot = 5 }));

        var result = await Build(Source(), spec);

        Assert.Null(result.Candidate);
        Assert.Contains("riesgo ilimitado", result.RejectReason);
    }

    [Fact]
    public async Task DebitSpread_WithMaxDebit_IsBuilt_AndRejectedAboveIt()
    {
        // Call spread de débito: compra la call a ≥ 5 arriba y vende la 5 más afuera.
        StrategySpec Debit(double maxDebit)
        {
            var spec = With(Sandwich(),
                Leg("c1", "BUY", "CALL", new() { Method = "POINTS_FROM_SPOT", PointsFromSpot = 5 }),
                Leg("c2", "SELL", "CALL", new() { Method = "OFFSET_FROM_LEG", FromLeg = "c1", OffsetPoints = 5 }));
            return spec with { CandidateConstruction = spec.CandidateConstruction with { Constraints = new() { MinDte = 0, MaxDte = 0, MaxDebit = maxDebit } } };
        }

        var c = Assert.IsType<TradeCandidate>((await Build(Source(), Debit(2.0))).Candidate);
        Assert.Equal(-1.9, c.Credit);       // 0.50 − 2.40
        Assert.Equal(190, c.MaxRisk);       // el débito pagado: lo que se pierde con el subyacente por debajo
        Assert.Equal(0, c.Width);

        var rejected = await Build(Source(), Debit(1.5));
        Assert.Null(rejected.Candidate);
        Assert.Matches(@"^débito 1[.,]9 mayor al máximo 1[.,]5$", rejected.RejectReason);
    }

    [Fact]
    public async Task SpecWithoutTheSelectorValue_NoCandidate_NothingIsCompleted()
    {
        var spec = With(Sandwich(),
            Leg("p1", "SELL", "PUT", new() { Method = "POINTS_FROM_SPOT" }),
            Leg("p2", "BUY", "PUT", new() { Method = "OFFSET_FROM_LEG", FromLeg = "p1", OffsetPoints = -5 }));

        var result = await Build(Source(), spec);

        Assert.Null(result.Candidate);
        Assert.Contains("points_from_spot", result.RejectReason);
    }

    // ── Payoff ──────────────────────────────────────────────────

    [Fact]
    public void Payoff_Range_OfCondor_Butterfly_AndNakedCall()
    {
        var condor = new[] { ("SELL", "PUT", 100.0), ("BUY", "PUT", 95.0), ("SELL", "CALL", 110.0), ("BUY", "CALL", 117.0) };
        Assert.Equal((0.0, 7.0), OptionPayoff.DebitRange(condor));   // el ala más ancha manda

        var butterfly = new[] { ("BUY", "CALL", 100.0), ("SELL", "CALL", 105.0), ("SELL", "CALL", 105.0), ("BUY", "CALL", 110.0) };
        Assert.Equal((-5.0, 0.0), OptionPayoff.DebitRange(butterfly));

        Assert.Equal(double.PositiveInfinity, OptionPayoff.DebitRange(new[] { ("SELL", "CALL", 100.0) }).Max);
        Assert.Equal(double.NegativeInfinity, OptionPayoff.DebitRange(new[] { ("BUY", "CALL", 100.0) }).Min);
        Assert.Equal(100.0, OptionPayoff.DebitRange(new[] { ("SELL", "PUT", 100.0) }).Max);   // put descubierta: el máximo es el strike (subyacente en 0)
    }

    // ── Validador ───────────────────────────────────────────────

    private static List<string> Errors(StrategySpec spec) => StrategySpecValidator.Validate(spec).Errors;

    [Fact]
    public void Validator_RejectsTwoSelectorsInOneLeg_AndAMethodWithoutItsField()
    {
        var spec = With(Sandwich(),
            Leg("a", "SELL", "PUT", new() { Method = "POINTS_FROM_SPOT", PointsFromSpot = -5, PctFromSpot = -1 }),
            Leg("b", "BUY", "PUT", new() { Method = "FIXED_STRIKE" }));

        var errors = Errors(spec);

        Assert.Contains(errors, e => e.Contains("pct_from_spot does not apply to method POINTS_FROM_SPOT"));
        Assert.Contains(errors, e => e.Contains("strike is required for method FIXED_STRIKE"));
    }

    [Fact]
    public void Validator_RejectsUnknownOrCircularFromLeg_AndDuplicateIds()
    {
        var spec = With(Sandwich(),
            Leg("a", "SELL", "PUT", new() { Method = "OFFSET_FROM_LEG", FromLeg = "b", OffsetPoints = -5 }),
            Leg("b", "BUY", "PUT", new() { Method = "OFFSET_FROM_LEG", FromLeg = "a", OffsetPoints = -5 }),
            Leg("c", "BUY", "CALL", new() { Method = "OFFSET_FROM_LEG", FromLeg = "zzz", OffsetPoints = 5 }),
            Leg("c", "SELL", "CALL", new() { Method = "FIXED_STRIKE", Strike = 7700 }));

        var errors = Errors(spec);

        Assert.Contains(errors, e => e.Contains("circular"));
        Assert.Contains(errors, e => e.Contains("from_leg 'zzz' is not a leg"));
        Assert.Contains(errors, e => e.Contains("duplicate leg id 'c'"));
    }

    [Fact]
    public void Validator_RejectsZeroOffsets_BadSides_UnknownMethod()
    {
        var spec = With(Sandwich(),
            Leg("a", "SELL", "PUT", new() { Method = "POINTS_FROM_SPOT", PointsFromSpot = 0 }),
            Leg("b", "HOLD", "FUTURE", new() { Method = "PCT_FROM_SPOT", PctFromSpot = 0 }),
            Leg("c", "BUY", "CALL", new() { Method = "FIXED_WIDTH", Width = 5 }));

        var errors = Errors(spec);

        Assert.Contains(errors, e => e.Contains("points_from_spot must be non-zero"));
        Assert.Contains(errors, e => e.Contains("pct_from_spot must be non-zero"));
        Assert.Contains(errors, e => e.Contains("side must be SELL or BUY"));
        Assert.Contains(errors, e => e.Contains("type must be PUT or CALL"));
        Assert.Contains(errors, e => e.Contains("method must be one of"));
    }

    [Fact]
    public void Validator_NeedsTheDteRange_AndExactlyOneOfMinCreditOrMaxDebit()
    {
        var spec = Sandwich();
        var c = spec.CandidateConstruction;

        Assert.Contains(Errors(spec with { CandidateConstruction = c with { Constraints = new() { MinCredit = 2.5 } } }), e => e.Contains("min_dte and max_dte are required"));
        Assert.Contains(Errors(spec with { CandidateConstruction = c with { Constraints = new() { MinDte = 3, MaxDte = 1, MinCredit = 2.5 } } }), e => e.Contains("max_dte >= min_dte"));
        Assert.Contains(Errors(spec with { CandidateConstruction = c with { Constraints = new() { MinDte = 0, MaxDte = 0 } } }), e => e.Contains("exactly one of min_credit"));
        Assert.Contains(Errors(spec with { CandidateConstruction = c with { Constraints = new() { MinDte = 0, MaxDte = 0, MinCredit = 2.5, MaxDebit = 1 } } }), e => e.Contains("exactly one of min_credit"));
        Assert.Contains(Errors(spec with { CandidateConstruction = c with { Constraints = new() { MinDte = 0, MaxDte = 0, MaxDebit = -1 } } }), e => e.Contains("max_debit must be positive"));
    }

    [Fact]
    public void Validator_DebitStructure_CannotUseTakeProfitOrStopLossOfCredit()
    {
        var spec = Sandwich();
        spec = spec with { CandidateConstruction = spec.CandidateConstruction with { Constraints = new() { MinDte = 0, MaxDte = 0, MaxDebit = 2 } } };

        Assert.Contains(Errors(spec), e => e.Contains("do not apply to a debit structure"));
    }

    [Fact]
    public void Spec_FromJson_WithGenericLegs_LoadsAndValidates()
    {
        const string legs = """
            {"id":"put_vendida","side":"SELL","type":"PUT","strike_selection":{"method":"POINTS_FROM_SPOT","points_from_spot":-5}},
            {"id":"put_comprada","side":"BUY","type":"PUT","strike_selection":{"method":"OFFSET_FROM_LEG","from_leg":"put_vendida","offset_points":-5}}
            """;
        var json = ShadowRuntimeEngineTests.SpecJson();
        var node = System.Text.Json.Nodes.JsonNode.Parse(json)!;
        node["structure"]!["default_structure"] = "custom_options";
        node["structure"]!["allowed_strategies"] = System.Text.Json.Nodes.JsonNode.Parse("[\"custom_options\"]");
        node["candidate_construction"]!["legs"] = System.Text.Json.Nodes.JsonNode.Parse($"[{legs}]");
        node["candidate_construction"]!["constraints"] = System.Text.Json.Nodes.JsonNode.Parse("{\"min_dte\":0,\"max_dte\":0,\"min_credit\":1.0}");

        var result = StrategySpecLoader.LoadFromJson(node.ToJsonString());

        Assert.True(result.Success, string.Join("; ", result.Errors));
        Assert.Equal(-5, result.Spec!.CandidateConstruction.Legs[0].StrikeSelection.PointsFromSpot);
        Assert.Equal("put_vendida", result.Spec.CandidateConstruction.Legs[1].StrikeSelection.FromLeg);
    }

    // ── Lo que consume después: fill, vencimiento, riesgo ────────────────────

    [Fact]
    public async Task Sandwich_Candidate_FillsValuesAndSettlesWithFourLegs()
    {
        var spec = Sandwich();
        var c = Assert.IsType<TradeCandidate>((await Build(Source(), spec)).Candidate);

        Assert.True(ShadowRiskValidator.Validate(c, spec, 0, null, Now).IsValid);
        var pos = ShadowFillSimulator.Fill(c, Now, ExecutionTerms.From(spec));
        Assert.Equal(4, pos.Legs.Count);
        Assert.Equal(2.6, pos.EntryCredit);
        Assert.Equal("SPXW  260924P07615000", pos.Legs[0].OccSymbol);
        Assert.False(Expiry.IsAmSettled(pos));                     // la raíz real (SPXW) viaja en el OCC: liquida PM

        // Vence con el SPX en 7640: la call vendida 7630 vale 10 y la comprada 7635 vale 5 → débito 5 (el ala completa).
        Assert.Equal(5.0, Math.Round(pos.Legs.Sum(l => (l.Side == "SELL" ? 1 : -1) * Expiry.Intrinsic(l, 7640)), 4));
        Assert.Equal(-240.0, ShadowFillSimulator.GrossPnl(pos, 5.0));   // (2.60 − 5) × 100 = −max_risk
        Assert.Equal(c.MaxRisk, -ShadowFillSimulator.GrossPnl(pos, 5.0));
    }

    [Fact]
    public async Task OpenSandwich_Valuation_AcceptsTheRangeOfThePayoff()
    {
        var spec = Sandwich();
        var c = Assert.IsType<TradeCandidate>((await Build(Source(), spec)).Candidate);
        var pos = ShadowFillSimulator.Fill(c, Now, ExecutionTerms.From(spec)) with { InstanceId = "i-1" };
        var (store, _) = ShadowRuntimeEngineTests.NewRuntime();
        store.AddPosition(pos);
        var data = new QuoteOnly(Source().Quotes);

        var outcome = await ShadowRuntimeEngine.ValuePositionAsync(store, data, pos, spec.Exits.Deterministic, Now, default, evaluateExits: false);

        Assert.Equal(ShadowRuntimeEngine.Outcomes.Valued, outcome);
        var valued = store.GetPosition(pos.PositionId)!;
        // Natural: recompra lo vendido al ask y vende lo comprado al bid: (2.20 + 2.40) − (0.90 + 0.50) = 3.20.
        Assert.Equal(3.2, valued.LastSpreadValue);
    }

    private sealed class QuoteOnly : IRuntimeMarketData
    {
        private readonly Dictionary<string, LegQuote?> _quotes;
        public QuoteOnly(Dictionary<string, LegQuote?> quotes) => _quotes = quotes;
        public Task<Dictionary<string, double?>> ResolveMetricsAsync(IEnumerable<string> r, DateTime n, TimeSpan? m, CancellationToken ct)
            => Task.FromResult(r.ToDictionary(x => x, _ => (double?)null));
        public Task<CandidateBuildResult> BuildCandidateAsync(StrategyInstance i, StrategySpec s, string sym, double? v, DateTime n, CancellationToken ct)
            => Task.FromResult(CandidateBuildResult.Rejected("n/a"));
        public Task<LegQuote?> GetQuoteAsync(string s, CancellationToken ct) => Task.FromResult(_quotes.GetValueOrDefault(s));
    }
}
