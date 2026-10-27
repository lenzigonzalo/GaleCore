using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.Gex;
using Newtonsoft.Json;

namespace DataFeed.Tests;

/// <summary>
/// Congela que la escala declarada en <see cref="GexUnits"/> es la que de verdad producen los
/// cálculos (BL-002). Si alguien cambia una división del GEX sin tocar la declaración, o al revés,
/// esto se rompe.
/// </summary>
public class GexUnitsTests
{
    [Fact]
    public void ElNetoEsLaSumaDeLosLadosDivididaPorMil_MillonesABillones()
    {
        var r = new GammaExposureResponse
        {
            Strikes =
            {
                new GammaExposureStrike { Strike = 500, CallGEX = 1500, PutGEX = -300 },
                new GammaExposureStrike { Strike = 505, CallGEX = 800, PutGEX = -900 },
            }
        };

        Assert.Equal(2300, r.CallGEX);   // millones
        Assert.Equal(-1200, r.PutGEX);   // millones
        Assert.Equal(1.1, r.NetGEX);     // billones: (2300 - 1200) / 1000

        Assert.Equal("USD_MILLIONS", r.Units.Side);
        Assert.Equal("USD_MILLIONS", r.Units.Strike);
        Assert.Equal("USD_BILLIONS", r.Units.Net);
    }

    [Fact]
    public void LaEscalaViajaEnLaRespuestaDeGexAnalysis()
    {
        var json = JsonConvert.SerializeObject(new GexAnalysisResponse());

        Assert.Contains("\"Units\":{", json);
        Assert.Contains("\"Method\":{", json);   // WS-0045: la fórmula viaja con el dato
        Assert.Contains("gamma × OI × 100 × spot²", GexMethod.Current.StrikeFormula);
        Assert.Contains("\"Net\":\"USD_BILLIONS\"", json);
    }

    [Fact]
    public void ElUltimoBarridoSobreviveAlDisco_ConSuHora()
    {
        var symbol = "TST" + Guid.NewGuid().ToString("N")[..6].ToUpperInvariant();
        var at = new DateTime(2026, 10, 19, 15, 30, 0, DateTimeKind.Utc);
        var r = new GexAnalysisResponse { Symbol = symbol, Timestamp = at, SpotPrice = 710.5 };
        r.Gex.ByExpiry.Add(new GexExpiryScope { Expiration = "2026-10-20", Dte = 1, NetGex = 2.5 });

        GexAnalysisDisk.Save(symbol, r);
        var back = GexAnalysisDisk.Load(symbol);

        Assert.NotNull(back);
        Assert.Equal(at, back!.Timestamp);
        Assert.Equal(710.5, back.SpotPrice);
        Assert.Equal("2026-10-20", back.Gex.ByExpiry[0].Expiration);
        Assert.Null(GexAnalysisDisk.Load("NOEXISTE"));
    }
}
