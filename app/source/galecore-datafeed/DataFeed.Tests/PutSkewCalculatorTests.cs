using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.PutSkew;
using Xunit;

namespace DataFeed.Tests;

/// <summary>El skew 25Δ de cada vencimiento (WS-0057 B): put de delta ≈ −0,25 sobre la IV ATM.</summary>
public class PutSkewCalculatorTests
{
    private static GammaExposureResponse Chain(params GammaExposureStrike[] strikes) => new()
    {
        Symbol = "SPY", Spot = 100, DTE = 30, Expiration = "2026-11-20", Strikes = strikes.ToList(),
    };

    [Fact]
    public void Skew_IsPut25DeltaIv_OverAtmIv()
    {
        var r = PutSkewCalculator.Compute(Chain(
            new() { Strike = 100, CallIV = 0.20, PutIV = 0.20, PutDelta = -0.50 },
            new() { Strike = 95, CallIV = 0.22, PutIV = 0.24, PutDelta = -0.25 },
            new() { Strike = 90, CallIV = 0.25, PutIV = 0.28, PutDelta = -0.10 }));

        Assert.Equal(95, r.Put25DeltaStrike);
        Assert.Equal(1.2, r.PutSkew25d);
    }

    [Fact]
    public void WithoutValidIv_NoSkew()
    {
        var r = PutSkewCalculator.Compute(Chain(new GammaExposureStrike { Strike = 100, CallIV = 0, PutIV = 0, PutDelta = -0.5 }));
        Assert.Null(r.PutSkew25d);
    }
}
