using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Application.Data.Tastytrade.OptionChains;

namespace DataFeed.Tests;

/// <summary>
/// GC-0002 — el constructor de candidatos PCS con una fuente de mercado falsa. Lo que se registra
/// (vencimiento, DTE, strikes, deltas, precios) tiene que ser todo del mismo vencimiento (R1-B2), y
/// un parámetro que la spec no declara no se completa con un default (R1-m1).
/// </summary>
public class CreditSpreadCandidateBuilderTests
{
    private static readonly DateTime Now = ShadowRuntimeEngineTests.Now; // jueves 24/09/2026, 11:00 ET

    internal sealed class FakeSource : IPcsMarketSource
    {
        public List<Expiration>? Expirations = new()
        {
            // El DTE del proveedor está mal a propósito: el constructor lo recalcula en fecha ET.
            new() { ExpirationDate = "2026-10-16", ExpirationType = "Regular", DaysToExpiration = 99 },  // 22
            new() { ExpirationDate = "2026-11-03", ExpirationType = "Weekly", DaysToExpiration = 99 },   // 40
            new() { ExpirationDate = "2026-11-20", ExpirationType = "Regular", DaysToExpiration = 99 },  // 57
        };
        public Func<GammaExposureRequest, GammaExposureResponse?>? Gex;
        public GammaExposureRequest? LastGexRequest;
        public Dictionary<string, LegQuote?> Quotes = new()
        {
            [".SPY261103P720"] = new LegQuote(4.10, 4.30, Now.AddSeconds(-3)),
            [".SPY261103P715"] = new LegQuote(3.40, 3.60, Now.AddSeconds(-8)),
        };

        public Task<List<Expiration>?> GetExpirationsAsync(string symbol, CancellationToken ct) => Task.FromResult(Expirations);

        public Task<GammaExposureResponse?> GetGammaExposureAsync(GammaExposureRequest request, CancellationToken ct)
        {
            LastGexRequest = request;
            return Task.FromResult(Gex != null ? Gex(request) : Response("2026-11-03", 40));
        }

        public Task<LegQuote?> GetQuoteAsync(string streamerSymbol, CancellationToken ct)
            => Task.FromResult(Quotes.GetValueOrDefault(streamerSymbol));
    }

    private static GammaExposureResponse Response(string expiration, int dte) => new()
    {
        Symbol = "SPY", Spot = 767.7, Expiration = expiration, DTE = dte, ExpirationType = "Weekly",
        SymbolsWithGreeks = 4,
        Strikes = new()
        {
            new() { Strike = 725, PutDelta = -0.20, PutStreamerSymbol = ".SPY261103P725", PutOI = 10 },
            new() { Strike = 720, PutDelta = -0.17, PutStreamerSymbol = ".SPY261103P720", PutOI = 10 },
            new() { Strike = 715, PutDelta = -0.14, PutStreamerSymbol = ".SPY261103P715", PutOI = 10 },
            new() { Strike = 710, PutDelta = -0.12, PutStreamerSymbol = ".SPY261103P710", PutOI = 10 },
        },
    };

    private static StrategyInstance Instance() => new() { InstanceId = "i-1" };

    internal static Task<CandidateBuildResult> Build(FakeSource source, StrategySpec? spec = null) =>
        new CreditSpreadCandidateBuilder(source).BuildAsync(Instance(), spec ?? ShadowRuntimeEngineTests.Spec(), "SPY", 15.2, Now);

    [Fact]
    public async Task RealData_BuildsCandidate_AllFromTheChosenExpiration()
    {
        var source = new FakeSource();

        var result = await Build(source);

        var c = Assert.IsType<TradeCandidate>(result.Candidate);
        Assert.Equal(40, c.Dte);
        Assert.All(c.Legs, l => Assert.Equal("2026-11-03", l.Expiration));
        Assert.Equal(new[] { 720.0, 715.0 }, c.Legs.Select(l => l.Strike));
        Assert.Equal(0.7, c.Credit);                                 // 4.20 − 3.50
        Assert.Equal(Now.AddSeconds(-8), c.Snapshot.OldestQuoteAt);  // la cotización más vieja
        Assert.Equal(Now, c.Snapshot.AsOf);
    }

    [Fact]
    public async Task GreeksRequest_AsksForWeekliesAndTheChosenDte()
    {
        var source = new FakeSource();

        await Build(source);

        var req = source.LastGexRequest!;
        Assert.Equal(new[] { "Regular", "Weekly", "End-Of-Month", "Quarterly" }, req.ExpirationTypes);
        Assert.Equal(40, req.TargetDte);   // DTE recalculado en ET, no el 99 del proveedor
        Assert.Equal(50, req.MaxDTE);
    }

    [Fact]
    public async Task GreeksFromAnotherExpiration_NoCandidate()
    {
        // Lo que pasaba antes del fix: se elegía el weekly y las griegas venían del mensual.
        var source = new FakeSource { Gex = _ => Response("2026-11-20", 57) };

        var result = await Build(source);

        Assert.Null(result.Candidate);
        Assert.Contains("2026-11-20", result.RejectReason);
        Assert.Contains("2026-11-03", result.RejectReason);
    }

    [Fact]
    public async Task NoExpirationInRange_NoCandidate()
    {
        var source = new FakeSource { Expirations = new() { new() { ExpirationDate = "2026-10-16", ExpirationType = "Regular" } } };

        var result = await Build(source);

        Assert.Null(result.Candidate);
        Assert.Contains("DTE entre 30 y 50", result.RejectReason);
    }

    [Fact]
    public async Task QuoteWithoutProviderTime_NoCandidate()
    {
        var source = new FakeSource();
        source.Quotes[".SPY261103P720"] = new LegQuote(4.10, 4.30, null);
        source.Quotes[".SPY261103P715"] = new LegQuote(3.40, 3.60, null);

        var result = await Build(source);

        Assert.Null(result.Candidate);
        Assert.Contains("sin hora", result.RejectReason);
    }

    [Fact]
    public async Task StaleLeg_NoCandidate_EvenIfTheOtherIsFresh()
    {
        var source = new FakeSource();
        source.Quotes[".SPY261103P720"] = new LegQuote(4.10, 4.30, Now.AddSeconds(-3));
        source.Quotes[".SPY261103P715"] = new LegQuote(3.40, 3.60, Now.AddMinutes(-10));

        var result = await Build(source);

        Assert.Null(result.Candidate);
        Assert.Contains("dato viejo", result.RejectReason);
    }

    [Fact]
    public async Task FutureLegTime_NoCandidate()
    {
        var source = new FakeSource();
        source.Quotes[".SPY261103P720"] = new LegQuote(4.10, 4.30, Now.AddMinutes(5));

        var result = await Build(source);

        Assert.Null(result.Candidate);
        Assert.Contains("futuro", result.RejectReason);
    }

    [Fact]
    public async Task OneLegWithoutTime_NoCandidate()
    {
        var source = new FakeSource();
        source.Quotes[".SPY261103P720"] = new LegQuote(4.10, 4.30, null);

        var result = await Build(source);

        Assert.Null(result.Candidate);
        Assert.Contains("sin hora", result.RejectReason);
    }

    [Fact]
    public async Task InfiniteQuote_NeverReachesTheCandidate()
    {
        // La fuente real filtra con QuoteRules; acá se simula una que no, para probar la segunda barrera.
        var source = new FakeSource();
        source.Quotes[".SPY261103P720"] = new LegQuote(double.PositiveInfinity, double.PositiveInfinity, Now);
        source.Quotes[".SPY261103P715"] = new LegQuote(double.PositiveInfinity, double.PositiveInfinity, Now);

        var result = await Build(source);

        Assert.Null(result.Candidate);
        Assert.Contains("no finito", result.RejectReason);
    }

    [Fact]
    public async Task MissingLegQuote_NoCandidate()
    {
        var source = new FakeSource();
        source.Quotes[".SPY261103P715"] = null;

        var result = await Build(source);

        Assert.Null(result.Candidate);
        Assert.Contains("pata comprada", result.RejectReason);
    }

    [Fact]
    public async Task ZeroDteExpiration_NotChosen_WhenTheSpecDoesNotAskForIt()
    {
        var source = new FakeSource();
        source.Expirations!.Add(new() { ExpirationDate = "2026-09-24", ExpirationType = "Weekly" });   // hoy

        var result = await Build(source);   // spec 30-50

        Assert.Equal(40, Assert.IsType<TradeCandidate>(result.Candidate).Dte);
    }

    [Theory]
    [InlineData("End-Of-Month")]
    [InlineData("Quarterly")]
    public async Task IndexExpirationTypes_AreAccepted(string type)
    {
        var source = new FakeSource { Expirations = new() { new() { ExpirationDate = "2026-11-03", ExpirationType = type } } };

        Assert.NotNull((await Build(source)).Candidate);
    }

    [Fact]
    public async Task ZeroDteOnly_RejectedWhenTheSpecStartsAtOne()
    {
        var spec = ShadowRuntimeEngineTests.Spec();
        spec = spec with
        {
            CandidateConstruction = spec.CandidateConstruction with
            {
                Constraints = spec.CandidateConstruction.Constraints with { MinDte = 1, MaxDte = 5 },
            },
        };
        var source = new FakeSource { Expirations = new() { new() { ExpirationDate = "2026-09-24", ExpirationType = "Weekly" } } };

        var result = await Build(source, spec);

        Assert.Null(result.Candidate);
        Assert.Null(source.LastGexRequest);
    }

    [Fact]
    public async Task ZeroDteExpiration_IsBuilt_WhenTheSpecRangeIncludesIt()
    {
        var spec = ShadowRuntimeEngineTests.Spec();
        spec = spec with
        {
            CandidateConstruction = spec.CandidateConstruction with
            {
                Constraints = spec.CandidateConstruction.Constraints with { MinDte = 0, MaxDte = 0 },
            },
        };
        var source = new FakeSource
        {
            Expirations = new() { new() { ExpirationDate = "2026-09-24", ExpirationType = "Weekly" } },
            Gex = _ => Response("2026-09-24", 0),
        };

        var result = await Build(source, spec);

        var c = Assert.IsType<TradeCandidate>(result.Candidate);
        Assert.Equal(0, c.Dte);
        Assert.Equal(0, source.LastGexRequest!.MaxDTE);   // el handler no puede elegir otro vencimiento
        Assert.True(source.LastGexRequest.IncludeZeroDte);
    }

    [Fact]
    public async Task ZeroCredit_NoCandidate_EvenWithMinCreditZero()
    {
        var spec = ShadowRuntimeEngineTests.Spec();
        spec = spec with
        {
            CandidateConstruction = spec.CandidateConstruction with
            {
                Constraints = spec.CandidateConstruction.Constraints with { MinCredit = 0 },
            },
        };
        var source = new FakeSource();
        source.Quotes[".SPY261103P720"] = new LegQuote(3.40, 3.60, Now);   // mismo mid que la comprada: crédito 0

        var result = await Build(source, spec);

        Assert.Null(result.Candidate);
        Assert.Contains("no positivo", result.RejectReason);
    }

    [Fact]
    public async Task SpecWithoutParameter_NoCandidate_NoDefault()
    {
        var spec = ShadowRuntimeEngineTests.Spec();
        spec = spec with
        {
            CandidateConstruction = spec.CandidateConstruction with
            {
                Constraints = spec.CandidateConstruction.Constraints with { MinCredit = null },
            },
        };
        var source = new FakeSource();

        var result = await Build(source, spec);

        Assert.Null(result.Candidate);
        Assert.Contains("min_credit", result.RejectReason);
        Assert.Null(source.LastGexRequest);
    }

    // ── P1-07: call credit spread e iron condor ─────────────────────

    /// <summary>La misma cadena con calls fuera del dinero: 805 (δ 0,20), 810 (δ 0,16), 815 (δ 0,13).</summary>
    private static GammaExposureResponse WithCalls(GammaExposureResponse r, params GammaExposureStrike[] calls)
    {
        r.Strikes.AddRange(calls.Length > 0 ? calls : new GammaExposureStrike[]
        {
            new() { Strike = 805, CallDelta = 0.20, CallStreamerSymbol = ".SPY261103C805", CallOI = 10 },
            new() { Strike = 810, CallDelta = 0.16, CallStreamerSymbol = ".SPY261103C810", CallOI = 10 },
            new() { Strike = 815, CallDelta = 0.13, CallStreamerSymbol = ".SPY261103C815", CallOI = 10 },
        });
        return r;
    }

    internal static FakeSource WithCallQuotes()
    {
        var source = new FakeSource { Gex = _ => WithCalls(Response("2026-11-03", 40)) };
        source.Quotes[".SPY261103C810"] = new LegQuote(2.00, 2.20, Now.AddSeconds(-2));
        source.Quotes[".SPY261103C815"] = new LegQuote(1.40, 1.60, Now.AddSeconds(-4));
        return source;
    }

    internal static StrategySpec SpecFor(string structure)
    {
        var spec = ShadowRuntimeEngineTests.Spec();
        var putLegs = spec.CandidateConstruction.Legs;
        var callLegs = new List<LegTemplate>
        {
            new() { Side = "SELL", Type = "CALL", StrikeSelection = new LegStrikeSelection { Method = "DELTA", TargetDelta = 0.16, DeltaTolerance = 0.04 } },
            new() { Side = "BUY", Type = "CALL", StrikeSelection = new LegStrikeSelection { Method = "FIXED_WIDTH", Width = 5 } },
        };
        var legs = structure == RuntimeStructures.CallCreditSpread ? callLegs : putLegs.Concat(callLegs).ToList();
        return spec with
        {
            Structure = spec.Structure with { AllowedStrategies = new() { structure }, DefaultStructure = structure },
            CandidateConstruction = spec.CandidateConstruction with { Legs = legs },
        };
    }

    [Fact]
    public async Task CallCreditSpread_SellsTheCallByDelta_AndBuysTheOneAbove()
    {
        var result = await Build(WithCallQuotes(), SpecFor(RuntimeStructures.CallCreditSpread));

        var c = Assert.IsType<TradeCandidate>(result.Candidate);
        Assert.Equal("call_credit_spread", c.Structure);
        Assert.Equal(new[] { ("SELL", "CALL", 810.0), ("BUY", "CALL", 815.0) }, c.Legs.Select(l => (l.Side, l.Type, l.Strike)));
        Assert.Equal(0.6, c.Credit);         // 2.10 − 1.50
        Assert.Equal(440, c.MaxRisk);        // (5 − 0.60) × 100
        Assert.Equal(0.16, c.DeltaShort);
        Assert.Equal("SPY   261103C00810000", c.Legs[0].OccSymbol);
        Assert.All(c.Legs, l => Assert.Equal("2026-11-03", l.Expiration));
    }

    [Fact]
    public async Task IronCondor_IsBothSides_SameExpiration_RiskOfTheWiderSide()
    {
        var result = await Build(WithCallQuotes(), SpecFor(RuntimeStructures.IronCondor));

        var c = Assert.IsType<TradeCandidate>(result.Candidate);
        Assert.Equal("iron_condor", c.Structure);
        Assert.Equal(new[] { 720.0, 715.0, 810.0, 815.0 }, c.Legs.Select(l => l.Strike));
        Assert.Equal(1.3, c.Credit);         // (4.20 − 3.50) + (2.10 − 1.50)
        Assert.Equal(370, c.MaxRisk);        // sólo un lado pierde a la vez: (5 − 1.30) × 100
        Assert.Equal(5, c.Width);
        Assert.Equal(-0.17, c.DeltaShort);   // el de la put vendida, como en el PCS
        Assert.Equal(Now.AddSeconds(-8), c.Snapshot.OldestQuoteAt);
        Assert.Equal(0, c.Snapshot.QuotesWithoutTime);
    }

    [Fact]
    public async Task IronCondor_WithoutAQuoteOnTheCallSide_NoCandidate()
    {
        var source = WithCallQuotes();
        source.Quotes.Remove(".SPY261103C815");

        var result = await Build(source, SpecFor(RuntimeStructures.IronCondor));

        Assert.Null(result.Candidate);
        Assert.Contains(".SPY261103C815", result.RejectReason);
    }

    [Fact]
    public async Task CallSideOutsideTheDeltaTolerance_NoCandidate()
    {
        var source = WithCallQuotes();
        source.Gex = _ => WithCalls(Response("2026-11-03", 40),
            new GammaExposureStrike { Strike = 830, CallDelta = 0.05, CallStreamerSymbol = ".SPY261103C830" });

        var result = await Build(source, SpecFor(RuntimeStructures.CallCreditSpread));

        Assert.Null(result.Candidate);
        Assert.Contains("delta de call", result.RejectReason);
    }

    [Fact]
    public async Task StructureTheRuntimeDoesNotBuild_NoCandidate_WithoutAskingTheMarket()
    {
        var spec = ShadowRuntimeEngineTests.Spec();
        var source = new FakeSource();

        var result = await Build(source, spec with { Structure = spec.Structure with { DefaultStructure = "butterfly" } });

        Assert.Null(result.Candidate);
        Assert.Contains("'butterfly'", result.RejectReason);
        Assert.Null(source.LastGexRequest);
    }

    [Fact]
    public async Task WidthBelowTheStrikeStep_WouldBuyTheSameStrike_NoCandidate()
    {
        var spec = SpecFor(RuntimeStructures.CallCreditSpread);
        var legs = spec.CandidateConstruction.Legs.Select(l => l.Side == "BUY"
            ? l with { StrikeSelection = l.StrikeSelection with { Width = 0.5 } } : l).ToList();

        var result = await Build(WithCallQuotes(), spec with { CandidateConstruction = spec.CandidateConstruction with { Legs = legs } });

        Assert.Null(result.Candidate);
        Assert.Contains("no queda arriba de la vendida", result.RejectReason);
    }
}
