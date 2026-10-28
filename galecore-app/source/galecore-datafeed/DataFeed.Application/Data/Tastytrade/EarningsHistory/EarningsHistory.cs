using System.Globalization;
using DataFeed.Infrastructure.Providers.Tastytrade;
using MediatR;
using Microsoft.Extensions.Configuration;

namespace DataFeed.Application.Data.Tastytrade.EarningsHistory
{
    public class EarningsHistoryRequest : IRequest<EarningsHistoryResponse>
    {
        public string Symbol { get; set; }
    }

    public class EarningsHistoryResponse
    {
        public string Symbol { get; set; }
        public List<EarningsHistoryDto> Items { get; set; }
    }

    public class EarningsHistoryDto
    {
        public string OccurredDate { get; set; }
        public decimal? Eps { get; set; }
    }

    /// <summary>Balances pasados de un símbolo (fecha y EPS reportado), más recientes primero.</summary>
    public class EarningsHistoryHandler : IRequestHandler<EarningsHistoryRequest, EarningsHistoryResponse>
    {
        private readonly IConfiguration _config;
        private readonly ITastytradeOAuth _auth;
        private readonly IHttpClientFactory _client;

        public EarningsHistoryHandler(IConfiguration config, ITastytradeOAuth auth, IHttpClientFactory client)
        {
            _config = config;
            _auth = auth;
            _client = client;
        }

        public async Task<EarningsHistoryResponse> Handle(EarningsHistoryRequest request, CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(request.Symbol))
                throw new Exception("EarningsHistoryHandler Error: se requiere un símbolo.");

            var symbol = request.Symbol.Trim().ToUpperInvariant();
            try
            {
                var provider = new TastytradeApiProvider(_config, _auth, _client);
                var model = await provider.GetEarningsReportsAsync(symbol, cancellationToken);
                var items = (model?.Data?.Items ?? new())
                    .Select(i => new EarningsHistoryDto
                    {
                        OccurredDate = i.OccurredDate,
                        Eps = decimal.TryParse(i.Eps, NumberStyles.Any, CultureInfo.InvariantCulture, out var eps) ? eps : null,
                    })
                    .OrderByDescending(i => i.OccurredDate, StringComparer.Ordinal)
                    .ToList();
                return new EarningsHistoryResponse { Symbol = symbol, Items = items };
            }
            catch (Exception ex)
            {
                throw new Exception($"EarningsHistoryHandler Error: {ex.Message}");
            }
        }
    }
}
