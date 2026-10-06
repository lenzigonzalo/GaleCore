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
        Assert.Contains("\"Net\":\"USD_BILLIONS\"", json);
    }
}
