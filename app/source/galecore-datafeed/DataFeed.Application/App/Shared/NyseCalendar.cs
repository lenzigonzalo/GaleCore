namespace DataFeed.Application.App.Shared
{
    /// <summary>Qué hace la bolsa de NY en una fecha. Unknown: el año no está en la tabla (no se sabe, nunca se asume abierta).</summary>
    public enum NyseDay { Normal, Closed, EarlyClose, Unknown }

    /// <summary>
    /// Feriados y cierres tempranos (13:00 NY) de NYSE. Fuente: calendario oficial https://www.nyse.com/markets/hours-calendars,
    /// verificado el 25/10/2026. Sólo días hábiles (lunes a viernes); fin de semana lo resuelve quien llama. Un año fuera de la
    /// tabla es Unknown: hay que cargar el calendario del año siguiente antes de que empiece.
    /// </summary>
    public static class NyseCalendar
    {
        public static readonly TimeSpan EarlyCloseTime = new(13, 0, 0);

        private static readonly IReadOnlyDictionary<int, (string[] Closed, string[] Early)> Years = new Dictionary<int, (string[], string[])>
        {
            [2026] = (new[] { "01-01", "01-19", "02-16", "04-03", "05-25", "06-19", "07-03", "09-07", "11-26", "12-25" }, new[] { "11-27", "12-24" }),
            [2027] = (new[] { "01-01", "01-18", "02-15", "03-26", "05-31", "06-18", "07-05", "09-06", "11-25", "12-24" }, new[] { "11-26" }),
            [2028] = (new[] { "01-17", "02-21", "04-14", "05-29", "06-19", "07-04", "09-04", "11-23", "12-25" }, new[] { "07-03", "11-24" }),
        };

        private static readonly TimeZoneInfo NewYork = ResolveZone();

        private static TimeZoneInfo ResolveZone()
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById("America/New_York"); }
            catch (TimeZoneNotFoundException) { return TimeZoneInfo.FindSystemTimeZoneById("Eastern Standard Time"); }
        }

        /// <summary>La fecha de NY de un instante UTC.</summary>
        public static DateOnly NyDate(DateTime nowUtc) =>
            DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc), NewYork));

        public static NyseDay Kind(DateOnly date)
        {
            if (!Years.TryGetValue(date.Year, out var year)) return NyseDay.Unknown;
            var key = date.ToString("MM-dd");
            return year.Closed.Contains(key) ? NyseDay.Closed : year.Early.Contains(key) ? NyseDay.EarlyClose : NyseDay.Normal;
        }

        /// <summary>El instante UTC del cierre de las 13:00 NY de esa fecha.</summary>
        public static DateTime EarlyCloseUtc(DateOnly date) =>
            TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(date.ToDateTime(TimeOnly.FromTimeSpan(EarlyCloseTime)), DateTimeKind.Unspecified), NewYork);
    }
}
