using DataFeed.Infrastructure.Providers.Tastytrade;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using Microsoft.Extensions.Configuration;
using System.Net;

namespace DataFeed.Tests;

public class TastytradeMarketDataTests
{
    [Fact]
    public async Task ByType_PreservesHyphenatedFieldsAndNumericStrings()
    {
        const string json = """
            {"data":{"items":[{"symbol":"SPY","last":"101.5","open":"99",
              "prev-close":"100","updated-at":"2026-10-13T14:00:00Z",
              "instrument-type":"Equity","prev-close-date":"2026-10-12"}]}}
            """;
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Tastytrade:BaseUrl"] = "https://example.test"
        }).Build();
        var provider = new TastytradeApiProvider(config, new Auth(), new Factory(json));
        var result = await provider.GetMarketDataByTypeAsync("SPY", CancellationToken.None);
        var item = Assert.Single(result!.Data.Items);
        Assert.Equal(101.5, item.Last);
        Assert.Equal(100, item.PrevClose);
        Assert.Equal("Equity", item.InstrumentType);
        Assert.Equal("2026-10-12", item.PrevCloseDate);
        Assert.Equal(new DateTime(2026, 10, 13, 14, 0, 0, DateTimeKind.Utc), item.UpdatedAt);
    }

    private sealed class Factory(string json) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new Handler(json));
    }

    private sealed class Handler(string json) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json) });
    }

    private sealed class Auth : ITastytradeOAuth
    {
        public Task<HttpRequestMessage> CreateOAuthApiRequestAsync(string endpoint)
            => Task.FromResult(new HttpRequestMessage(HttpMethod.Get, endpoint));
        public Task<HttpRequestMessage> CreateOAuthApiRequestAsync(string endpoint, TastytradeCredential credential)
            => throw new NotSupportedException();
        public Task<OAuthResponseWSModel> GetWsOAuthApiAsync() => throw new NotSupportedException();
    }
}
