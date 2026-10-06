using System.IO.Compression;
using System.Net;
using System.Text;
using DataFeed.Infrastructure.Providers.Tastytrade;
using Newtonsoft.Json;

namespace DataFeed.Tests;

/// <summary>
/// P1-D1: lo que hace falta para leer lo que dice el proveedor. El 403 de cuenta (BL-015) era
/// indiagnosticable porque el cuerpo se descartaba —y además venía en gzip—; el Quote llegaba sin
/// hora porque el FEED_SETUP no pedía bidTime/askTime (BL-013).
/// </summary>
public class TastytradeDiagnosticsTests
{
    private const string NotPermitted = "{\"error\":{\"code\":\"not_permitted\",\"message\":\"User not permitted access\"}}";

    [Fact]
    public async Task El403DeCuentaLlevaLoQueContestoTastytrade_AunqueVengaEnGzip()
    {
        using var gz = new MemoryStream();
        using (var w = new GZipStream(gz, CompressionMode.Compress, leaveOpen: true))
            w.Write(Encoding.UTF8.GetBytes(NotPermitted));
        var content = new ByteArrayContent(gz.ToArray());
        content.Headers.ContentEncoding.Add("gzip");
        var response = new HttpResponseMessage(HttpStatusCode.Forbidden) { Content = content, ReasonPhrase = "Forbidden" };

        var ex = await Assert.ThrowsAsync<HttpRequestException>(() => TastytradeApiProvider.EnsureAccountSuccessAsync(response));

        Assert.Equal(HttpStatusCode.Forbidden, ex.StatusCode);
        Assert.Contains("403 (Forbidden)", ex.Message);
        Assert.Contains("not_permitted", ex.Message);
    }

    [Fact]
    public async Task UnaRespuestaOkNoTira()
    {
        await TastytradeApiProvider.EnsureAccountSuccessAsync(new HttpResponseMessage(HttpStatusCode.OK));
    }

    [Fact]
    public void ElFeedSetupPideLasHorasDelQuote_YConservaLosCamposQueYaSeUsaban()
    {
        var json = JsonConvert.SerializeObject(DxLinkHandshake.FeedSetup);

        Assert.Contains("\"acceptDataFormat\":\"FULL\"", json);
        foreach (var f in new[] { "bidTime", "askTime", "bidPrice", "askPrice", "bidSize", "askSize", "eventTime", "eventSymbol" })
            Assert.Contains($"\"{f}\"", json);
    }
}
