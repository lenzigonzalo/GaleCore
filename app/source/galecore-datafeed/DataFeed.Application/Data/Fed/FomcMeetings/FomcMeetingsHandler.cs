using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers.Fed;
using MediatR;

namespace DataFeed.Application.Data.Fed.FomcMeetings
{
    public class FomcMeetingsRequest : IRequest<SourcedResponse<List<FomcMeeting>>>
    {
        /// <summary>Años separados por coma (ej: 2026,2027). Vacío = el actual y el siguiente.</summary>
        public string? Years { get; set; }
    }

    public class FomcMeetingsHandler : IRequestHandler<FomcMeetingsRequest, SourcedResponse<List<FomcMeeting>>>
    {
        private readonly IHttpClientFactory _client;

        public FomcMeetingsHandler(IHttpClientFactory client)
        {
            _client = client;
        }

        public async Task<SourcedResponse<List<FomcMeeting>>> Handle(FomcMeetingsRequest request, CancellationToken cancellationToken)
        {
            var thisYear = DateTime.UtcNow.Year;
            var years = new List<int>();
            foreach (var part in (request.Years ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (!int.TryParse(part, out var y) || y < 2000 || y > thisYear + 2)
                    throw new ValidationException($"Years inválido: '{part}'");
                years.Add(y);
            }
            if (years.Count == 0)
                years.AddRange(new[] { thisYear, thisYear + 1 });

            var distinct = years.Distinct().OrderBy(y => y).ToList();
            // El calendario de la Fed cambia muy rara vez: una lectura diaria (7,4 s en frío, WS-0038).
            return await DailyCache.GetAsync($"fomc-meetings:{string.Join(',', distinct)}", token => Read(distinct, token), cancellationToken);
        }

        private async Task<SourcedResponse<List<FomcMeeting>>> Read(List<int> years, CancellationToken cancellationToken)
        {
            var provider = new FedCalendarProvider(_client.CreateClient());
            var (byYear, sha) = await provider.GetMeetingsAsync(years, cancellationToken);

            return new SourcedResponse<List<FomcMeeting>>
            {
                Source = "fed",
                UpstreamUrl = FedCalendarProvider.Url,
                RetrievedAt = DateTime.UtcNow,
                AsOf = DateTime.UtcNow.ToString("yyyy-MM-dd"),
                Sha256 = sha,
                Notes = new()
                {
                    "Sólo reuniones programadas; una reunión o decisión fuera de calendario aparece cuando la Fed la publica.",
                    "Projections = la reunión trae proyecciones económicas (el * de la página); Scheduled = false es un notation vote.",
                },
                Data = byYear.OrderBy(kv => kv.Key).SelectMany(kv => kv.Value).ToList(),
            };
        }
    }
}
