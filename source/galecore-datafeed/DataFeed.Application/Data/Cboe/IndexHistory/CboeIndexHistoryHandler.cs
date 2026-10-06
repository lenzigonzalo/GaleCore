using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers.Cboe;
using MediatR;

namespace DataFeed.Application.Data.Cboe.IndexHistory
{
    public class CboeIndexHistoryRequest : IRequest<SourcedResponse<List<CboeIndexDayDto>>>
    {
        /// <summary>VIX, VVIX o SKEW.</summary>
        public string? Index { get; set; }

        /// <summary>Desde (YYYY-MM-DD). Vacío = un año antes de To.</summary>
        public DateTime? From { get; set; }

        /// <summary>Hasta (YYYY-MM-DD). Vacío = hoy.</summary>
        public DateTime? To { get; set; }
    }

    public record CboeIndexDayDto(string Date, decimal? Open, decimal? High, decimal? Low, decimal Close);

    public class CboeIndexHistoryHandler : IRequestHandler<CboeIndexHistoryRequest, SourcedResponse<List<CboeIndexDayDto>>>
    {
        private readonly IHttpClientFactory _client;

        public CboeIndexHistoryHandler(IHttpClientFactory client)
        {
            _client = client;
        }

        public async Task<SourcedResponse<List<CboeIndexDayDto>>> Handle(CboeIndexHistoryRequest request, CancellationToken cancellationToken)
        {
            var index = (request.Index ?? "").Trim().ToUpperInvariant();
            if (!CboeIndexHistoryProvider.Indices.Contains(index))
                throw new ValidationException($"Index inválido: '{request.Index}' (uno de {string.Join(", ", CboeIndexHistoryProvider.Indices)})");
            var to = DateOnly.FromDateTime(request.To ?? DateTime.UtcNow);
            var from = request.From is { } f ? DateOnly.FromDateTime(f) : to.AddYears(-1);
            if (to < from)
                throw new ValidationException("Rango inválido: From <= To.");

            var provider = new CboeIndexHistoryProvider(_client.CreateClient());
            var (history, fromCache) = await provider.GetHistoryAsync(index, cancellationToken);
            var data = history.Days
                .Where(d => d.Date >= from && d.Date <= to)
                .Select(d => new CboeIndexDayDto(d.Date.ToString("yyyy-MM-dd"), d.Open, d.High, d.Low, d.Close))
                .ToList();

            var notes = new List<string>
            {
                "Historia diaria oficial de CBOE; el último día publicado suele ser el hábil anterior (CBOE actualiza el archivo después del cierre).",
                $"Desde {history.Days[0].Date:yyyy-MM-dd}; el CSV completo se guarda {CboeIndexHistoryProvider.CacheFor.TotalHours:0} h en memoria.",
            };
            if (index != "VIX")
                notes.Add($"{index} publica sólo el cierre: open, high y low vienen vacíos.");

            return new SourcedResponse<List<CboeIndexDayDto>>
            {
                Source = "cboe",
                UpstreamUrl = history.Url,
                RetrievedAt = history.RetrievedAt,
                FromCache = fromCache,
                AsOf = history.Days[^1].Date.ToString("yyyy-MM-dd"),
                Sha256 = history.Sha256,
                Notes = notes,
                Data = data,
            };
        }
    }
}
