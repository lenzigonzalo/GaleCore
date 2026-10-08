using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.Runtime;
using DataFeed.Application.Data.Tastytrade.OptionChains;

namespace DataFeed.Tests;

/// <summary>
/// WS-0016 (AC-03/04) — PCS, CCS, IC y «esperar» con una fuente de mercado falsa: el PCS y el CCS salen del constructor
/// del runtime, los tres son ejecutables desde P1-07 y una pata sin dato deja la estructura sin números.
/// </summary>
public class StructureComparerTests
{
    private static readonly DateTime Now = ShadowRuntimeEngineTests.Now; // jueves 24/09/2026, 11:00 ET

    private sealed class FakeSource : IPcsMarketSource
    {
        public Dictionary<string, LegQuote?> Quotes = new()
        {
            [".SPY261103P720"] = new LegQuote(4.10, 4.30, Now.AddSeconds(-3)),
            [".SPY261103P715"] = new LegQuote(3.40, 3.60, Now.AddSeconds(-3)),
            [".SPY261103C800"] = new LegQuote(2.00, 2.20, Now.AddSeconds(-3)),
            [".SPY261103C805"] = new LegQuote(1.50, 1.70, Now.AddSeconds(-3)),
        };

        public Task<List<Expiration>?> GetExpirationsAsync(string symbol, CancellationToken ct) => Task.FromResult<List<Expiration>?>(new()
        {
            new() { ExpirationDate = "2026-11-03", ExpirationType = "Weekly", DaysToExpiration = 40 },
        });

        public Task<GammaExposureResponse?> GetGammaExposureAsync(GammaExposureRequest request, CancellationToken ct) =>
            Task.FromResult<GammaExposureResponse?>(new()
            {
                Symbol = "SPY", Spot = 767.7, Expiration = "2026-11-03", DTE = 40, ExpirationType = "Weekly",
                Strikes = new()
                {
                    new() { Strike = 720, PutDelta = -0.17, PutIV = 0.18, PutStreamerSymbol = ".SPY261103P720" },
                    new() { Strike = 715, PutDelta = -0.14, PutIV = 0.19, PutStreamerSymbol = ".SPY261103P715" },
                    new() { Strike = 800, CallDelta = 0.17, CallIV = 0.13, CallStreamerSymbol = ".SPY261103C800" },
                    new() { Strike = 805, CallDelta = 0.13, CallIV = 0.13, CallStreamerSymbol = ".SPY261103C805" },
                },
            });

        public Task<LegQuote?> GetQuoteAsync(string streamerSymbol, CancellationToken ct)
            => Task.FromResult(Quotes.GetValueOrDefault(streamerSymbol));
    }

    private static Task<StructureComparison> Compare(FakeSource source, double delta = 0.16) =>
        new StructureComparer(source).CompareAsync("SPY", delta, 0.05, 5, 30, 45, Now);

    [Fact]
    public async Task Compares_pcs_ccs_and_iron_condor_with_real_quotes_all_executable()
    {
        var result = await Compare(new FakeSource());

        Assert.Null(result.Error);
        Assert.Equal(new[] { "put_credit_spread", "call_credit_spread", "iron_condor", "wait" },
            result.Structures.Select(s => s.Structure));
        var (pcs, ccs, ic, wait) = (result.Structures[0], result.Structures[1], result.Structures[2], result.Structures[3]);

        Assert.True(pcs.ExecutableToday);
        Assert.True(ccs.ExecutableToday);
        Assert.True(ic.ExecutableToday);

        Assert.Equal(0.70, pcs.Credit);
        Assert.Equal(430, pcs.MaxRisk);
        Assert.Equal(new[] { 719.3 }, pcs.Breakevens);
        Assert.Equal(0.34, pcs.TouchProbability);
        Assert.Equal(0.50, ccs.Credit);
        Assert.Equal(new[] { 800.5 }, ccs.Breakevens);
        Assert.Equal(1.20, ic.Credit);
        Assert.Equal(380, ic.MaxRisk);
        Assert.Equal(new[] { 718.8, 801.2 }, ic.Breakevens);
        Assert.Equal(4, ic.Legs!.Count);

        // Un PCS pierde con el gap a la baja y gana con el alza; el CCS al revés; la vol arriba les pesa a los dos.
        double Pnl(StructureOption s, string name) => s.Scenarios!.Single(x => x.Name == name).Pnl;
        Assert.True(Pnl(pcs, "gap -5%") < Pnl(pcs, "gap -3%") && Pnl(pcs, "gap -3%") < 0);
        Assert.True(Pnl(pcs, "gap +3%") > 0);
        Assert.True(Pnl(ccs, "gap +5%") < 0 && Pnl(ccs, "gap -3%") > 0);
        Assert.True(Pnl(ic, "vol +5 pts") < 0);
        Assert.True(Pnl(pcs, "gap -5%") >= -pcs.MaxRisk!.Value - pcs.Credit!.Value * 100);
        Assert.True(pcs.Greeks!.Delta > 0 && pcs.Greeks.ThetaPerDay > 0 && pcs.Greeks.VegaPerVolPoint < 0);

        Assert.Null(wait.Credit);
        Assert.True(wait.ExecutableToday);
    }

    [Fact]
    public async Task Without_a_pcs_there_is_nothing_to_compare_and_the_reason_is_given()
    {
        var source = new FakeSource();
        source.Quotes[".SPY261103P715"] = null;

        var result = await Compare(source);

        Assert.Contains("sin PCS", result.Error);
        Assert.Equal("wait", Assert.Single(result.Structures).Structure);
    }

    [Fact]
    public async Task A_call_leg_without_a_quote_leaves_ccs_and_ic_without_numbers()
    {
        var source = new FakeSource();
        source.Quotes[".SPY261103C805"] = null;

        var result = await Compare(source);

        Assert.Equal(0.70, result.Structures[0].Credit);
        foreach (var s in result.Structures.Skip(1).Take(2))
        {
            Assert.Null(s.Credit);
            Assert.Null(s.Scenarios);
            Assert.Contains("C805", s.Note);
        }
    }
}
