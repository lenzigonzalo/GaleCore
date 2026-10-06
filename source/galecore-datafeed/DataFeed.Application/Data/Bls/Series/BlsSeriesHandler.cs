using System.Text.RegularExpressions;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers.Bls;
using MediatR;
using Microsoft.Extensions.Configuration;

namespace DataFeed.Application.Data.Bls.Series
{
    public class BlsSeriesRequest : IRequest<SourcedResponse<List<BlsSeries>>>
    {
        /// <summary>Series separadas por coma (ej: CUUR0000SA0,CUSR0000SA0,LNS14000000,CES0000000001).</summary>
        public string? Ids { get; set; }

        /// <summary>Año inicial. Vacío = el anterior a EndYear.</summary>
        public int? StartYear { get; set; }

        /// <summary>Año final. Vacío = el actual.</summary>
        public int? EndYear { get; set; }
    }

    public class BlsSeriesHandler : IRequestHandler<BlsSeriesRequest, SourcedResponse<List<BlsSeries>>>
    {
        private const int MaxYearsWithoutKey = 10;
        private static readonly Regex SeriesId = new("^[A-Z0-9]{5,30}$");

        private readonly IConfiguration _config;
        private readonly IHttpClientFactory _client;

        public BlsSeriesHandler(IConfiguration config, IHttpClientFactory client)
        {
            _config = config;
            _client = client;
        }

        public async Task<SourcedResponse<List<BlsSeries>>> Handle(BlsSeriesRequest request, CancellationToken cancellationToken)
        {
            var ids = (request.Ids ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(i => i.ToUpperInvariant()).Distinct().ToList();
            if (ids.Count == 0 || ids.Count > BlsProvider.MaxSeries || ids.Any(i => !SeriesId.IsMatch(i)))
                throw new ValidationException($"Ids inválidos: entre 1 y {BlsProvider.MaxSeries} series del BLS separadas por coma.");
            var end = request.EndYear ?? DateTime.UtcNow.Year;
            var start = request.StartYear ?? end - 1;
            if (start > end || end > DateTime.UtcNow.Year || end - start + 1 > MaxYearsWithoutKey)
                throw new ValidationException($"Años inválidos: StartYear <= EndYear <= el actual, como mucho {MaxYearsWithoutKey} años.");

            var provider = new BlsProvider(_config, _client.CreateClient());
            var (series, sha, retrievedAt, fromCache) = await provider.GetSeriesAsync(ids, start, end, cancellationToken);
            var latest = series.SelectMany(s => s.Observations).Where(o => o.Value != null)
                .OrderBy(o => o.Year).ThenBy(o => o.Period).LastOrDefault();

            return new SourcedResponse<List<BlsSeries>>
            {
                Source = "bls",
                UpstreamUrl = BlsProvider.Url,
                RetrievedAt = retrievedAt,
                FromCache = fromCache,
                AsOf = latest is null ? "" : $"{latest.Year}-{latest.Period}",
                Sha256 = sha,
                Notes = new()
                {
                    "Valores oficiales del BLS; los meses recientes se revisan en publicaciones siguientes (footnotes lo marcan como preliminar).",
                    "Las fechas de publicación salen de FRED (Data/Fred/ReleaseDates, 10 = CPI, 50 = empleo); el BLS bloquea su calendario a los programas.",
                    provider.HasKey
                        ? "Con clave del BLS (cupo ampliado)."
                        : "Sin clave del BLS: cupo de pocas consultas por día; cada respuesta se guarda 6 h para no gastarlo.",
                },
                Data = series,
            };
        }
    }
}
