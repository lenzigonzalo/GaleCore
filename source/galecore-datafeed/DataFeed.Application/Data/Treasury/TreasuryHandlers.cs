using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers.Treasury;
using MediatR;

namespace DataFeed.Application.Data.Treasury
{
    public class TreasuryYieldCurveRequest : IRequest<SourcedResponse<List<TreasuryCurveDayDto>>>
    {
        /// <summary>Desde (YYYY-MM-DD). Vacío = 30 días antes de To.</summary>
        public DateTime? From { get; set; }

        /// <summary>Hasta (YYYY-MM-DD), como mucho hoy. Vacío = hoy.</summary>
        public DateTime? To { get; set; }
    }

    public record TreasuryCurveDayDto(string Date, IReadOnlyDictionary<string, decimal> Rates);

    public class TreasuryYieldCurveHandler : IRequestHandler<TreasuryYieldCurveRequest, SourcedResponse<List<TreasuryCurveDayDto>>>
    {
        public const int MaxYears = 5;

        private readonly IHttpClientFactory _client;

        public TreasuryYieldCurveHandler(IHttpClientFactory client)
        {
            _client = client;
        }

        public async Task<SourcedResponse<List<TreasuryCurveDayDto>>> Handle(TreasuryYieldCurveRequest request, CancellationToken cancellationToken)
        {
            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var to = request.To is { } t ? DateOnly.FromDateTime(t) : today;
            var from = request.From is { } f ? DateOnly.FromDateTime(f) : to.AddDays(-30);
            if (to < from || to > today || to.Year - from.Year >= MaxYears || from.Year < 1990)
                throw new ValidationException($"Rango inválido: From <= To <= hoy, desde 1990 y como mucho {MaxYears} años calendario.");

            var provider = new TreasuryProvider(_client.CreateClient());
            var data = new List<TreasuryCurveDayDto>();
            var shas = new List<string>();
            var allCached = true;
            var retrievedAt = DateTime.MinValue;
            for (var year = from.Year; year <= to.Year; year++)
            {
                var (days, sha, at, cached) = await provider.GetCurveYearAsync(year, cancellationToken);
                shas.Add($"{year}={sha}");
                allCached &= cached;
                if (at > retrievedAt)
                    retrievedAt = at;
                data.AddRange(days.Where(d => d.Date >= from && d.Date <= to)
                    .Select(d => new TreasuryCurveDayDto(d.Date.ToString("yyyy-MM-dd"), d.Rates)));
            }

            return new SourcedResponse<List<TreasuryCurveDayDto>>
            {
                Source = "treasury",
                UpstreamUrl = TreasuryProvider.CurveUrl(to.Year),
                RetrievedAt = retrievedAt,
                FromCache = allCached,
                AsOf = data.Count > 0 ? data[^1].Date : "",
                Sha256 = string.Join(";", shas),
                Notes = new()
                {
                    "Curva par diaria oficial del Tesoro (tasas en %, base bond-equivalent); un CSV por año, el de cada año en su URL.",
                    "El día hábil se publica por la tarde (hora de EE. UU.); fines de semana y feriados no tienen fila.",
                    "Plazos que un año no publicaba (1.5M y 4M son recientes) no figuran en ese día.",
                },
                Data = data,
            };
        }
    }

    public class TreasuryUpcomingAuctionsRequest : IRequest<SourcedResponse<List<TreasuryAuction>>>
    {
    }

    public class TreasuryUpcomingAuctionsHandler : IRequestHandler<TreasuryUpcomingAuctionsRequest, SourcedResponse<List<TreasuryAuction>>>
    {
        private readonly IHttpClientFactory _client;

        public TreasuryUpcomingAuctionsHandler(IHttpClientFactory client)
        {
            _client = client;
        }

        public async Task<SourcedResponse<List<TreasuryAuction>>> Handle(TreasuryUpcomingAuctionsRequest request, CancellationToken cancellationToken)
        {
            var (auctions, sha) = await new TreasuryProvider(_client.CreateClient()).GetUpcomingAuctionsAsync(cancellationToken);
            return new SourcedResponse<List<TreasuryAuction>>
            {
                Source = "treasury",
                UpstreamUrl = TreasuryProvider.UpcomingAuctionsUrl,
                RetrievedAt = DateTime.UtcNow,
                AsOf = auctions[0].RecordDate.ToString("yyyy-MM-dd"),
                Sha256 = sha,
                Notes = new()
                {
                    "Subastas anunciadas en el último registro de Fiscal Data (upcoming_auctions); asOf es la fecha de ese registro.",
                    "OfferingAmount en USD; vacío mientras el Tesoro no anuncia el monto (las reaperturas lo anuncian unos días antes).",
                },
                Data = auctions,
            };
        }
    }
}
