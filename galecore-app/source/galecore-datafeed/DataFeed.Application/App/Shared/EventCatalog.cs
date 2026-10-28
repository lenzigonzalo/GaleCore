namespace DataFeed.Application.App.Shared
{
    /// <summary>
    /// Cuánto se sabe de cuándo ocurre un evento. DATE: sólo el día (publicaciones de FRED, balances con BMO/AMC): el evento no se
    /// puede ubicar dentro del día y nunca se inventa una hora. TIME: el instante exacto (decisión del FOMC, 14:00 NY).
    /// </summary>
    public enum EventPrecision { Date, Time }

    /// <summary>Un tipo de evento que el proveedor sabe responder. PerSymbol: el evento es de un símbolo y hay que preguntar por símbolo.</summary>
    public record EventTypeInfo(string Type, string Description, bool PerSymbol, EventPrecision Precision, string Source);

    /// <summary>El catálogo con las fuentes que GaleCore ya tiene. Lo usa también el validador de la spec.</summary>
    public static class EventCatalog
    {
        public const string Fomc = "FOMC";
        public const string Earnings = "EARNINGS";

        /// <summary>Publicaciones macro de FRED que GaleCore ya sigue: tipo → release id.</summary>
        public static readonly IReadOnlyDictionary<string, int> FredReleases = new Dictionary<string, int>
        {
            ["RETAIL_SALES"] = 9, ["CPI"] = 10, ["PPI"] = 46, ["EMPLOYMENT"] = 50, ["GDP"] = 53, ["PERSONAL_INCOME"] = 54,
        };

        /// <summary>Los mismos ids como texto para FredReleaseDatesRequest.ReleaseIds: una sola lista de publicaciones macro (ChatSuggestions y AccountOverview la leen de acá).</summary>
        public static string FredReleaseIdsCsv => string.Join(",", FredReleases.Values.OrderBy(i => i));

        public static readonly IReadOnlyCollection<EventTypeInfo> Builtin = new List<EventTypeInfo>
        {
            new(Fomc, "Decisión del FOMC (14:00 NY del último día de la reunión)", false, EventPrecision.Time, "fed"),
            new("CPI", "Publicación del IPC (FRED release 10)", false, EventPrecision.Date, "fred"),
            new("PPI", "Publicación del IPP (FRED release 46)", false, EventPrecision.Date, "fred"),
            new("EMPLOYMENT", "Situación de empleo (FRED release 50)", false, EventPrecision.Date, "fred"),
            new("GDP", "Publicación del PIB (FRED release 53)", false, EventPrecision.Date, "fred"),
            new("RETAIL_SALES", "Ventas minoristas (FRED release 9)", false, EventPrecision.Date, "fred"),
            new("PERSONAL_INCOME", "Ingresos y gastos personales (FRED release 54)", false, EventPrecision.Date, "fred"),
            new(Earnings, "Próximo balance de un símbolo (Tastytrade market-metrics: fecha y BMO/AMC, sin hora)", true, EventPrecision.Date, "tastytrade"),
        };
    }
}
