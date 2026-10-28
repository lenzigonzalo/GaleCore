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
    public async Task UnGzipRoto_NoTapaElStatus()
    {
        var content = new ByteArrayContent(Encoding.UTF8.GetBytes("no es gzip"));
        content.Headers.ContentEncoding.Add("gzip");
        var response = new HttpResponseMessage(HttpStatusCode.Forbidden) { Content = content, ReasonPhrase = "Forbidden" };

        var ex = await Assert.ThrowsAsync<HttpRequestException>(() => TastytradeApiProvider.EnsureAccountSuccessAsync(response));

        Assert.Equal(HttpStatusCode.Forbidden, ex.StatusCode);
    }

    [Fact]
    public async Task UnaRespuestaOkNoTira()
    {
        await TastytradeApiProvider.EnsureAccountSuccessAsync(new HttpResponseMessage(HttpStatusCode.OK));
    }

    [Fact]
    public void ElErrorSoloMuestraCodigoYMensaje_NuncaElCuerpoCrudo()
    {
        Assert.Equal("not_permitted \"User not permitted access\"", TastytradeApiProvider.BrokerErrorSummary(NotPermitted));

        var conExtra = "{\"error\":{\"code\":\"x\",\"message\":\"y\"},\"token\":\"SECRETO\",\"account\":\"5WT00001\"}";
        var resumen = TastytradeApiProvider.BrokerErrorSummary(conExtra);
        Assert.DoesNotContain("SECRETO", resumen);
        Assert.DoesNotContain("5WT00001", resumen);

        Assert.DoesNotContain("SECRETO", TastytradeApiProvider.BrokerErrorSummary("Bearer SECRETO"));
    }

    [Fact]
    public void UnQuoteConHorasSeDeserializaConEllas()
    {
        var item = Newtonsoft.Json.Linq.JObject.Parse(
            "{\"eventType\":\"Quote\",\"eventSymbol\":\"SPY\",\"eventTime\":0,\"bidTime\":1791316800000,\"askTime\":1791316801000,\"bidPrice\":779.5,\"askPrice\":779.6}");

        var q = item.ToObject<DataFeed.Infrastructure.Providers.Tastytrade.Models.QuoteEvent>()!;

        Assert.Equal(1791316800000, q.BidTime);
        Assert.Equal(1791316801000, q.AskTime);
        Assert.Equal(0, q.EventTime);
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
