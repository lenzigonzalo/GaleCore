using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers.Fred;
using DataFeed.Infrastructure.Providers.Fred.Models;
using MediatR;
using Microsoft.Extensions.Configuration;

namespace DataFeed.Application.Data.Fred.ReleaseDates
{
    public class FredReleaseDatesRequest : IRequest<SourcedResponse<List<FredReleaseDateDto>>>
    {
        /// <summary>Desde (YYYY-MM-DD).</summary>
        public DateTime From { get; set; }

        /// <summary>Hasta (YYYY-MM-DD), como mucho 180 días después de From.</summary>
        public DateTime To { get; set; }

        /// <summary>Publicaciones a devolver, separadas por coma (ej: 50,10,46,53,54,9). Vacío = todas.</summary>
        public string? ReleaseIds { get; set; }
    }

    public record FredReleaseDateDto(int ReleaseId, string ReleaseName, string Date);

    public class FredReleaseDatesHandler : IRequestHandler<FredReleaseDatesRequest, SourcedResponse<List<FredReleaseDateDto>>>
    {
        public const int MaxDays = 180;

        private readonly IConfiguration _config;
        private readonly IHttpClientFactory _client;

        public FredReleaseDatesHandler(IConfiguration config, IHttpClientFactory client)
        {
            _config = config;
            _client = client;
        }

        public async Task<SourcedResponse<List<FredReleaseDateDto>>> Handle(FredReleaseDatesRequest request, CancellationToken cancellationToken)
        {
            var from = DateOnly.FromDateTime(request.From);
            var to = DateOnly.FromDateTime(request.To);
            if (request.From == default || request.To == default || to < from || to.DayNumber - from.DayNumber > MaxDays)
                throw new ValidationException($"Rango inválido: From <= To y como mucho {MaxDays} días.");
            var ids = ParseIds(request.ReleaseIds);

            var provider = new FredApiProvider(_config, _client.CreateClient());
            // Con ReleaseIds se piden sólo esas publicaciones: el listado de todas tarda ~35 s por dos meses y FRED
            // corta con 504 en rangos más largos (WS-0015, historia de reacción a los datos).
            List<FredReleaseDate> rows;
            string upstreamUrl;
            if (ids.Count == 0)
                (rows, upstreamUrl) = await provider.GetReleaseDatesAsync(from, to, cancellationToken);
            else
            {
                rows = new();
                var urls = new List<string>();
                foreach (var id in ids.OrderBy(i => i))
                {
                    var (part, url) = await provider.GetReleaseDatesAsync(id, from, to, cancellationToken);
                    rows.AddRange(part);
                    urls.Add(url);
                }
                upstreamUrl = string.Join(" ", urls);
            }
            var data = rows
                .Where(r => ids.Count == 0 || ids.Contains(r.ReleaseId))
                .Select(r => new FredReleaseDateDto(r.ReleaseId, r.ReleaseName, r.Date))
                .OrderBy(r => r.Date).ThenBy(r => r.ReleaseId)
                .ToList();

            return new SourcedResponse<List<FredReleaseDateDto>>
            {
                Source = "fred",
                UpstreamUrl = upstreamUrl,
                RetrievedAt = DateTime.UtcNow,
                AsOf = DateTime.UtcNow.ToString("yyyy-MM-dd"),
                Notes = new()
                {
                    "Fechas programadas por cada agencia; se pueden mover (cierre de gobierno, reprogramación) y FRED lo refleja cuando la agencia lo publica.",
                    "La publicación 101 «FOMC Press Release» figura todos los días: no sirve para saber cuándo se reúne la Fed (usar Data/Fed/FomcMeetings).",
                },
                Data = data,
            };
        }

        public static HashSet<int> ParseIds(string? text)
        {
            var ids = new HashSet<int>();
            foreach (var part in (text ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (!int.TryParse(part, out var id) || id <= 0)
                    throw new ValidationException($"ReleaseIds inválido: '{part}'");
                ids.Add(id);
            }
            return ids;
        }
    }
}
