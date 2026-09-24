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
public class PcsCandidateBuilderTests
{
    private static readonly DateTime Now = ShadowRuntimeEngineTests.Now; // jueves 24/09/2026, 11:00 ET

    private sealed class FakeSource : IPcsMarketSource
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

    private static Task<CandidateBuildResult> Build(FakeSource source, StrategySpec? spec = null) =>
        new PcsCandidateBuilder(source).BuildAsync(Instance(), spec ?? ShadowRuntimeEngineTests.Spec(), "SPY", 15.2, Now);

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
        Assert.Equal(new[] { "Regular", "Weekly" }, req.ExpirationTypes);
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
    public async Task QuoteWithoutProviderTime_AgeIsUnknown_NotNow()
    {
        var source = new FakeSource();
        source.Quotes[".SPY261103P720"] = new LegQuote(4.10, 4.30, null);
        source.Quotes[".SPY261103P715"] = new LegQuote(3.40, 3.60, null);

        var result = await Build(source);

        Assert.Null(result.Candidate!.Snapshot.OldestQuoteAt);
        Assert.Equal(2, result.Candidate.Snapshot.QuotesWithoutTime);
    }

    [Fact]
    public async Task StaleLeg_NoCandidate_EvenIfTheOtherHasNoTime()
    {
        var source = new FakeSource();
        source.Quotes[".SPY261103P720"] = new LegQuote(4.10, 4.30, null);
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
    public async Task OneLegWithoutTime_OldestIsTheKnownOne_AndItIsCounted()
    {
        var source = new FakeSource();
        source.Quotes[".SPY261103P720"] = new LegQuote(4.10, 4.30, null);

        var result = await Build(source);

        Assert.Equal(Now.AddSeconds(-8), result.Candidate!.Snapshot.OldestQuoteAt);
        Assert.Equal(1, result.Candidate.Snapshot.QuotesWithoutTime);
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
    public async Task ZeroDteExpiration_NoCandidate_Explained()
    {
        var spec = ShadowRuntimeEngineTests.Spec();
        spec = spec with
        {
            CandidateConstruction = spec.CandidateConstruction with
            {
                Constraints = spec.CandidateConstruction.Constraints with { MinDte = 0, MaxDte = 0 },
            },
        };
        var source = new FakeSource { Expirations = new() { new() { ExpirationDate = "2026-09-24", ExpirationType = "Weekly" } } };

        var result = await Build(source, spec);

        Assert.Null(result.Candidate);
        Assert.Contains("0DTE", result.RejectReason);
        Assert.Null(source.LastGexRequest);
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
}
