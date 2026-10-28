using DataFeed.Application.Data.Tastytrade.AccountPositions;
using DataFeed.Application.Data.Tastytrade.AccountSpreads;

namespace DataFeed.Tests;

/// <summary>
/// Congela los números de riesgo de las posiciones de la cuenta, que antes calculaba el Monitor
/// (WS-0036): pérdida máxima, POP y griegas netas.
/// </summary>
public class AccountSpreadBuilderTests
{
    private static AccountPositionDto Leg(string occ, string dir, decimal open, decimal close = 0, decimal qty = 2) => new()
    {
        Symbol = occ, InstrumentType = "Equity Option", QuantityDirection = dir, Quantity = qty,
        AverageOpenPrice = open, ClosePrice = close, Multiplier = 100,
    };

    private static readonly AccountPositionDto[] PutSpread =
    {
        Leg("SPY   261120P00640000", "Short", 3.10m, 2.00m),
        Leg("SPY   261120P00635000", "Long", 2.00m, 1.40m),
    };

    [Fact]
    public void PutSpread_SinCotizacion_UsaEntradaYNoInventaGriegas()
    {
        var s = Assert.Single(AccountSpreadBuilder.Build(PutSpread, new Dictionary<string, LegMarket>()));

        Assert.Equal("SPY|2026-11-20", s.Id);
        Assert.Equal("PUT_CS", s.Structure);
        Assert.Equal(5, s.Width);
        Assert.Equal(1.10, s.InitialCredit, 4);
        Assert.Equal(220, s.MaxProfit, 2);           // 1.10 × 100 × 2
        Assert.Equal(780, s.MaxLoss, 2);             // (5 − 1.10) × 100 × 2
        Assert.False(s.HasLiveQuote);
        Assert.Equal(0.60, s.CurrentNetCredit!.Value, 4); // cierre anterior: 2.00 − 1.40
        Assert.Equal("entrada", s.PopBasis);
        Assert.Equal(78, s.Pop!.Value, 1);           // 1 − 1.10/5
        Assert.Equal(89, s.Pop50!.Value, 1);
        Assert.Null(s.Greeks);
    }

    [Fact]
    public void PutSpread_ConCotizacion_PopVivoYGriegasNetas()
    {
        var market = new Dictionary<string, LegMarket>
        {
            [".SPY261120P640"] = new(1.95, 2.05, -0.20, 0.010, -0.15, 0.60, 0.21),
            [".SPY261120P635"] = new(1.35, 1.45, -0.15, 0.008, -0.12, 0.55, 0.23),
        };

        var s = Assert.Single(AccountSpreadBuilder.Build(PutSpread, market));

        Assert.True(s.HasLiveQuote);
        Assert.Equal(0.60, s.CurrentNetCredit!.Value, 4);
        Assert.Equal("vivo", s.PopBasis);
        Assert.Equal(88, s.Pop!.Value, 1);            // 1 − 0.60/5
        Assert.NotNull(s.Greeks);
        Assert.Equal(10, s.Greeks!.Delta, 2);         // (+0.20 − 0.15) × 200
        Assert.Equal(-0.4, s.Greeks.Gamma, 2);
        Assert.Equal(6, s.Greeks.Theta, 2);           // (+0.15 − 0.12) × 200: el spread cobra theta
        Assert.Equal(-10, s.Greeks.Vega, 2);
        Assert.Equal(0.21, s.Greeks.ShortLegIv!.Value, 4);
    }

    [Fact]
    public void IronCondor_PierdeSoloUnLado()
    {
        var legs = new[]
        {
            Leg("SPY   261120P00640000", "Short", 2.00m, qty: 1),
            Leg("SPY   261120P00635000", "Long", 1.20m, qty: 1),
            Leg("SPY   261120C00720000", "Short", 1.50m, qty: 1),
            Leg("SPY   261120C00725000", "Long", 0.90m, qty: 1),
        };

        var s = Assert.Single(AccountSpreadBuilder.Build(legs, new Dictionary<string, LegMarket>()));

        Assert.Equal("IC", s.Structure);
        Assert.Equal(5, s.Width);
        Assert.Equal(1.40, s.InitialCredit, 4);
        Assert.Equal(360, s.MaxLoss, 2);              // (5 − 1.40) × 100, no (10 − 1.40)
    }

    [Fact]
    public void DosPutSpreads_MismoVencimiento_NoSeColapsan()
    {
        var legs = new[]
        {
            Leg("SPY   261120P00640000", "Short", 3.10m, qty: 1),
            Leg("SPY   261120P00635000", "Long", 2.00m, qty: 1),
            Leg("SPY   261120P00620000", "Short", 1.50m, qty: 2),
            Leg("SPY   261120P00610000", "Long", 0.80m, qty: 2),
        };

        var (spreads, unpaired) = AccountSpreadBuilder.Analyze(legs, new Dictionary<string, LegMarket>());

        Assert.Empty(unpaired);
        Assert.Equal(2, spreads.Count);
        Assert.All(spreads, s => Assert.Equal("PUT_CS", s.Structure));
        Assert.Equal(2, spreads.Select(s => s.Id).Distinct().Count());
        Assert.Contains(spreads, s => s.Id == "SPY|2026-11-20|P640-635" && s.MaxLoss == 390);   // (5 − 1.10) × 100 × 1
        Assert.Contains(spreads, s => s.Id == "SPY|2026-11-20|P620-610" && s.MaxLoss == 1860);  // (10 − 0.70) × 100 × 2
        Assert.Equal(2250, spreads.Sum(s => s.MaxLoss));                                         // suma de las dos
    }

    [Fact]
    public void IronCondor_MasPutSpread_ArmaLosDosYSumaTodo()
    {
        var legs = new[]
        {
            Leg("SPY   261120P00640000", "Short", 2.00m, qty: 1),
            Leg("SPY   261120P00635000", "Long", 1.20m, qty: 1),
            Leg("SPY   261120C00720000", "Short", 1.50m, qty: 1),
            Leg("SPY   261120C00725000", "Long", 0.90m, qty: 1),
            Leg("SPY   261120P00600000", "Short", 1.00m, qty: 1),
            Leg("SPY   261120P00595000", "Long", 0.50m, qty: 1),
        };

        var (spreads, unpaired) = AccountSpreadBuilder.Analyze(legs, new Dictionary<string, LegMarket>());

        Assert.Empty(unpaired);
        Assert.Equal(2, spreads.Count);
        var ic = Assert.Single(spreads, s => s.Structure == "IC");
        Assert.Equal(640, ic.ShortPutStrike);                // el put más cercano al dinero forma el IC
        Assert.Equal(720, ic.ShortCallStrike);
        var put = Assert.Single(spreads, s => s.Structure == "PUT_CS");
        Assert.Equal(600, put.ShortPutStrike);
        Assert.Equal(360 + 450, spreads.Sum(s => s.MaxLoss));
    }

    [Fact]
    public void PataSinPareja_OCantidadDistinta_SeDeclara()
    {
        var legs = new[]
        {
            Leg("SPY   261120P00640000", "Short", 3.10m, qty: 2),
            Leg("SPY   261120P00635000", "Long", 2.00m, qty: 1),   // otra cantidad: no es el mismo spread
            Leg("SPY   261120C00720000", "Long", 0.90m, qty: 1),   // sin vendida
        };

        var (spreads, unpaired) = AccountSpreadBuilder.Analyze(legs, new Dictionary<string, LegMarket>());

        Assert.Empty(spreads);
        Assert.Equal(3, unpaired.Count);
        Assert.Contains(unpaired, u => u.Contains("put 640 vendido"));
    }

    [Fact]
    public void PataSuelta_NoArmaSpread()
    {
        Assert.Empty(AccountSpreadBuilder.Build(new[] { Leg("SPY   261120P00640000", "Short", 3m) }, new Dictionary<string, LegMarket>()));
    }
}
