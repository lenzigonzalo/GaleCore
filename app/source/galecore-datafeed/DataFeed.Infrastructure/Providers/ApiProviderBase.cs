using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace DataFeed.Infrastructure.Providers
{
    public abstract class ApiProviderBase
    {
        protected readonly HttpClient _httpClient;

        protected ApiProviderBase(HttpClient httpClient)
        {
            _httpClient = httpClient;
        }

        protected async Task<T?> GetAsync<T>(string url)
        {
            var response = await _httpClient.GetAsync(url);
            response.EnsureSuccessStatusCode();

            var stream = await response.Content.ReadAsStreamAsync();
            return await JsonSerializer.DeserializeAsync<T>(stream, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
        }
    }
}
