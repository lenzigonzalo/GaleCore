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
    /// Los años que ya salieron de la página (hoy, antes de 2021) se leen de su página histórica (BF-0001).
    /// </summary>
    public class FedCalendarProvider
    {
        public const string Url = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";

        public static string HistoricalUrl(int year) => $"https://www.federalreserve.gov/monetarypolicy/fomchistorical{year}.htm";

        private static readonly string[] Months = CultureInfo.InvariantCulture.DateTimeFormat.MonthNames[..12];
        private static readonly Regex Panel = new(
            @"<h4><a id=""\d+"">(\d{4}) FOMC Meetings</a></h4>(.*?)(?=<h4><a id=""\d+"">\d{4} FOMC Meetings|\z)",
            RegexOptions.Singleline);
        private static readonly Regex Meeting = new(
            @"fomc-meeting__month[^>]*><strong>([^<]+)</strong>.*?fomc-meeting__date[^>]*>([^<]+)<", RegexOptions.Singleline);
        private static readonly Regex Days = new(@"^(\d{1,2})(?:-(\d{1,2}))?(\*)?\s*(\(.*\))?$");
        private static readonly Regex HistoricalHeading = new(@"<h5[^>]*>([^<]*-\s*\d{4})\s*</h5>");
        private static readonly Regex HistoricalTitle = new(
            @"^([A-Za-z]+(?:/[A-Za-z]+)?)\s+(\d{1,2})(?:-(?:([A-Za-z]+)\s+)?(\d{1,2}))?\s*(\([^)]*\))?\s*(Meeting|Conference Call)?\s*-\s*(\d{4})$");

        private readonly HttpClient _httpClient;

        public FedCalendarProvider(HttpClient httpClient)
        {
            _httpClient = httpClient;
        }

        /// <summary>Las reuniones de los años pedidos y el sha256 del HTML leído.</summary>
        public async Task<(Dictionary<int, List<FomcMeeting>> Years, string Sha256)> GetMeetingsAsync(
            IReadOnlyCollection<int> years, CancellationToken cancellationToken)
        {
            var html = await ReadAsync(Url, cancellationToken);
            var pages = new List<string> { html };
            var calendar = Parse(html);
            var older = years.Where(y => !calendar.ContainsKey(y) && calendar.Count > 0 && y < calendar.Keys.Min()).ToList();
            var historical = await Task.WhenAll(older.Select(y => ReadAsync(HistoricalUrl(y), cancellationToken)));
            for (var i = 0; i < older.Count; i++)
            {
                pages.Add(historical[i]);
                var meetings = ParseHistorical(historical[i], older[i]);
                if (meetings.Count > 0)
                    calendar[older[i]] = meetings;
            }
            var missing = years.Where(y => !calendar.ContainsKey(y)).ToList();
            if (missing.Count > 0)
                throw new UpstreamSourceException("fed", $"la página no trae (o ya no se reconoce) el calendario de: {string.Join(", ", missing)}");
            var sha = "sha256:" + Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(string.Concat(pages)))).ToLowerInvariant();
            return (years.ToDictionary(y => y, y => calendar[y]), sha);
        }

        private async Task<string> ReadAsync(string url, CancellationToken cancellationToken)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, url);
                request.Headers.UserAgent.ParseAdd("GaleCore-DataFeed/1.0 (fomc calendar, read-only)");
                var response = await _httpClient.SendAsync(request, cancellationToken);
                if (!response.IsSuccessStatusCode)
                    throw new UpstreamSourceException("fed", $"{url} respondió {(int)response.StatusCode}");
                return await response.Content.ReadAsStringAsync(cancellationToken);
            }
            catch (HttpRequestException ex)
            {
                throw new UpstreamSourceException("fed", $"sin respuesta de {url} ({ex.Message})");
            }
        }

        /// <summary>
        /// Una página histórica (un encabezado por reunión: «April/May 30-1 Meeting - 2019», «August 1 Conference Call -
        /// 2011», «October 4 (unscheduled) - 2019», «July 31-August 1 Meeting - 2012» queda July/August 31-1). Conference calls y notas entre paréntesis quedan como no programadas;
        /// las canceladas no son reunión. Projections = el panel trae «Projection Materials».
        /// </summary>
        public static List<FomcMeeting> ParseHistorical(string html, int year)
        {
            var meetings = new List<FomcMeeting>();
            var headings = HistoricalHeading.Matches(html);
            for (var i = 0; i < headings.Count; i++)
            {
                var title = System.Net.WebUtility.HtmlDecode(headings[i].Groups[1].Value).Trim();
                var t = HistoricalTitle.Match(title);
                if (!t.Success)
                    throw new UpstreamSourceException("fed", $"fecha no reconocida: '{title}'");
                if (int.Parse(t.Groups[7].Value, CultureInfo.InvariantCulture) != year)
                    continue;
                var note = t.Groups[5].Success ? t.Groups[5].Value : t.Groups[6].Value == "Conference Call" ? "(conference call)" : "";
                if (note.Contains("cancel", StringComparison.OrdinalIgnoreCase))
                    continue;
                var bodyEnd = i + 1 < headings.Count ? headings[i + 1].Index : html.Length;
                var body = html[(headings[i].Index + headings[i].Length)..bodyEnd];
                var monthText = t.Groups[3].Success ? $"{t.Groups[1].Value}/{t.Groups[3].Value}" : t.Groups[1].Value;
                var daysText = t.Groups[4].Success ? $"{t.Groups[2].Value}-{t.Groups[4].Value}" : t.Groups[2].Value;
                var (m1, m2) = MonthNumbers(monthText);
                var first = int.Parse(t.Groups[2].Value, CultureInfo.InvariantCulture);
                var last = t.Groups[4].Success ? int.Parse(t.Groups[4].Value, CultureInfo.InvariantCulture) : first;
                var endYear = m2 < m1 ? year + 1 : year;
                meetings.Add(new FomcMeeting(year, monthText, note.Length > 0 ? $"{daysText} {note}" : daysText,
                    new DateOnly(year, m1, first), new DateOnly(endYear, m2, last),
                    Projections: body.Contains("Projection", StringComparison.Ordinal), Scheduled: note.Length == 0));
            }
            return meetings;
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
