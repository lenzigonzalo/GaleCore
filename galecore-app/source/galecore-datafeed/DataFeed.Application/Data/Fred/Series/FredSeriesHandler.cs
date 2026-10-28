using System.Text.RegularExpressions;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers.Fred;
using MediatR;
using Microsoft.Extensions.Configuration;

namespace DataFeed.Application.Data.Fred.Series
{
    public class FredSeriesRequest : IRequest<SourcedResponse<FredSeriesData>>
    {
        /// <summary>Serie de FRED (ej: DGS10, DFII10, T10YIE, BAMLH0A0HYM2, CPIAUCSL).</summary>
        public string? SeriesId { get; set; }

        /// <summary>Desde (YYYY-MM-DD). Vacío = un año antes de To.</summary>
        public DateTime? From { get; set; }

        /// <summary>Hasta (YYYY-MM-DD). Vacío = hoy.</summary>
        public DateTime? To { get; set; }
    }

    public class FredSeriesHandler : IRequestHandler<FredSeriesRequest, SourcedResponse<FredSeriesData>>
    {
        private static readonly Regex SeriesId = new("^[A-Z0-9_]{1,30}$");

        private readonly IConfiguration _config;
        private readonly IHttpClientFactory _client;

        public FredSeriesHandler(IConfiguration config, IHttpClientFactory client)
        {
            _config = config;
            _client = client;
        }

        public async Task<SourcedResponse<FredSeriesData>> Handle(FredSeriesRequest request, CancellationToken cancellationToken)
        {
            var id = (request.SeriesId ?? "").Trim().ToUpperInvariant();
            if (!SeriesId.IsMatch(id))
                throw new ValidationException($"SeriesId inválido: '{request.SeriesId}'");
            var to = DateOnly.FromDateTime(request.To ?? DateTime.UtcNow);
            var from = request.From is { } f ? DateOnly.FromDateTime(f) : to.AddYears(-1);
            if (to < from)
                throw new ValidationException("Rango inválido: From <= To.");

            var provider = new FredApiProvider(_config, _client.CreateClient());
            var (series, upstreamUrl, sha) = await provider.GetSeriesObservationsAsync(id, from, to, cancellationToken);
            var last = series.Observations.LastOrDefault(o => o.Value != null);

            return new SourcedResponse<FredSeriesData>
            {
                Source = "fred",
                UpstreamUrl = upstreamUrl,
                RetrievedAt = DateTime.UtcNow,
                AsOf = last?.Date ?? "",
                Sha256 = sha,
                Notes = new()
                {
                    $"Vintage leído: {series.RealtimeStart}..{series.RealtimeEnd}; las series macro se revisan y un valor pasado puede cambiar.",
                    "Value null = FRED no tiene dato ese día (feriado o sin publicación); asOf es la última observación con valor.",
                },
                Data = series,
            };
        }
    }
}
