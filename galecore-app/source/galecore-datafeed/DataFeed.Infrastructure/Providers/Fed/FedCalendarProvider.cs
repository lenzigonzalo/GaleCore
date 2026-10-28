using System.Globalization;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace DataFeed.Infrastructure.Providers.Fed
{
    /// <summary>Una reunión del FOMC tal como la publica la Fed.</summary>
    public record FomcMeeting(int Year, string Month, string Days, DateOnly Start, DateOnly End, bool Projections, bool Scheduled);

    /// <summary>
    /// Calendario del FOMC desde la página pública de la Fed (no hay API). Port del lector de GaleCore-AI
    /// (tools/fed_calendar.py, GC-AI-0016): si la página cambia de forma o no trae un año pedido, error explícito.
    /// </summary>
    public class FedCalendarProvider
    {
        public const string Url = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";

        private static readonly string[] Months = CultureInfo.InvariantCulture.DateTimeFormat.MonthNames[..12];
        private static readonly Regex Panel = new(
            @"<h4><a id=""\d+"">(\d{4}) FOMC Meetings</a></h4>(.*?)(?=<h4><a id=""\d+"">\d{4} FOMC Meetings|\z)",
            RegexOptions.Singleline);
        private static readonly Regex Meeting = new(
            @"fomc-meeting__month[^>]*><strong>([^<]+)</strong>.*?fomc-meeting__date[^>]*>([^<]+)<", RegexOptions.Singleline);
        private static readonly Regex Days = new(@"^(\d{1,2})(?:-(\d{1,2}))?(\*)?\s*(\(.*\))?$");

        private readonly HttpClient _httpClient;

        public FedCalendarProvider(HttpClient httpClient)
        {
            _httpClient = httpClient;
        }

        /// <summary>Las reuniones de los años pedidos y el sha256 del HTML leído.</summary>
        public async Task<(Dictionary<int, List<FomcMeeting>> Years, string Sha256)> GetMeetingsAsync(
            IReadOnlyCollection<int> years, CancellationToken cancellationToken)
        {
            string html;
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, Url);
                request.Headers.UserAgent.ParseAdd("GaleCore-DataFeed/1.0 (fomc calendar, read-only)");
                var response = await _httpClient.SendAsync(request, cancellationToken);
                if (!response.IsSuccessStatusCode)
                    throw new UpstreamSourceException("fed", $"la página respondió {(int)response.StatusCode}");
                html = await response.Content.ReadAsStringAsync(cancellationToken);
            }
            catch (HttpRequestException ex)
            {
                throw new UpstreamSourceException("fed", $"sin respuesta ({ex.Message})");
            }
            var sha = "sha256:" + Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(html))).ToLowerInvariant();
            var calendar = Parse(html);
            var missing = years.Where(y => !calendar.ContainsKey(y)).ToList();
            if (missing.Count > 0)
                throw new UpstreamSourceException("fed", $"la página no trae (o ya no se reconoce) el calendario de: {string.Join(", ", missing)}");
            return (years.ToDictionary(y => y, y => calendar[y]), sha);
        }

        /// <summary>Lee los paneles por año. Una fecha que no reconoce es error, no se saltea.</summary>
        public static Dictionary<int, List<FomcMeeting>> Parse(string html)
        {
            var result = new Dictionary<int, List<FomcMeeting>>();
            foreach (Match panel in Panel.Matches(html))
            {
                var year = int.Parse(panel.Groups[1].Value, CultureInfo.InvariantCulture);
                var meetings = new List<FomcMeeting>();
                foreach (Match m in Meeting.Matches(panel.Groups[2].Value))
                {
                    var monthText = m.Groups[1].Value.Trim();
                    var daysText = m.Groups[2].Value.Trim();
                    var d = Days.Match(daysText);
                    if (!d.Success)
                        throw new UpstreamSourceException("fed", $"fecha no reconocida: '{monthText} {daysText}'");
                    var (m1, m2) = MonthNumbers(monthText);
                    var first = int.Parse(d.Groups[1].Value, CultureInfo.InvariantCulture);
                    var last = d.Groups[2].Success ? int.Parse(d.Groups[2].Value, CultureInfo.InvariantCulture) : first;
                    var endYear = m2 < m1 ? year + 1 : year;
                    meetings.Add(new FomcMeeting(year, monthText, daysText, new DateOnly(year, m1, first),
                        new DateOnly(endYear, m2, last), Projections: d.Groups[3].Success, Scheduled: !d.Groups[4].Success));
                }
                result[year] = meetings;
            }
            return result;
        }

        private static (int, int) MonthNumbers(string text)
        {
            int Number(string name)
            {
                var i = Array.FindIndex(Months, full => full.StartsWith(name.Trim()[..3], StringComparison.OrdinalIgnoreCase));
                if (i < 0)
                    throw new UpstreamSourceException("fed", $"mes no reconocido: '{text}'");
                return i + 1;
            }
            var parts = text.Split('/');
            return parts.Length == 2 ? (Number(parts[0]), Number(parts[1])) : (Number(text), Number(text));
        }
    }
}
