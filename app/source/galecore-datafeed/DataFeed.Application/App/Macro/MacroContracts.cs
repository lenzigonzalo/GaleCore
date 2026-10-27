namespace DataFeed.Application.App.Macro;

public record MacroSeriesDefinition(string Id, string Name, string Family, string Region, string Unit,
    string Source, string Frequency, string CalendarId, string InstrumentType, string Currency,
    string MethodologyVersion, string[] SupportedHorizons, string[] Limitations);
public record MacroObservation(string Id, string SeriesId, decimal? Value, string ObservationTime,
    DateTime? PublishedAt, DateTime? AvailableAt, DateTime RetrievedAt, string TimestampPrecision,
    string SourceRef, string? VintageId, string Provenance, string QualityStatus, string[] QualityReasons);
public record MacroMetric(string Id, string SeriesId, string? LevelRef, string? ComparisonRef, decimal? Value,
    string Unit, string Horizon, string? ActualFrom, string? ActualTo, string[] InputRefs,
    string FormulaVersion, string QualityStatus, string[] Limitations);
public record MacroSourceStatus(string Id, string Status, string? AsOf, DateTime? RetrievedAt, string[] Reasons);
public record MacroEvent(string Id, string Name, string Date, string Source, string SourceRef,
    DateTime RetrievedAt, string TimestampPrecision, string[] Limitations);
public record MacroSnapshot(string Id, string SchemaVersion, string Horizon, string Region, string Currency,
    DateTime DataCutoff, DateTime GeneratedAt, MacroSeriesDefinition[] SeriesDefinitions,
    MacroObservation[] Observations, MacroMetric[] Metrics, MacroEvent[] Events,
    MacroSourceStatus[] SourceStatuses, string[] MethodologyVersions, string ContentHash, string HistoricalFidelity);

public static class MacroCatalog
{
    public const string Version = "macro-v1";
    private static MacroSeriesDefinition D(string id, string name, string family, string unit, string source,
        string frequency = "daily") => new(id, name, family, "US", unit, source, frequency,
            "publication-dates", "reference-series", "USD", Version, new[] { "month" },
            new[] { "Historia revisada a hoy; no replay point-in-time. Publicación exacta no disponible.",
                "Derechos de redistribución pendientes de verificar; uso local de fuentes existentes.",
                "Sesión/5 sesiones requieren calendario verificado. Magnitud comparable no habilitada." });
    public static readonly MacroSeriesDefinition[] Definitions =
    {
        D("UST2", "Tesoro 2 años", "rates", "%", "treasury"),
        D("UST5", "Tesoro 5 años", "rates", "%", "treasury"),
        D("UST10", "Tesoro 10 años", "rates", "%", "treasury"),
        D("UST30", "Tesoro 30 años", "rates", "%", "treasury"),
        D("SLOPE2_10", "Pendiente 2–10", "rates", "pb", "treasury"),
        D("SLOPE5_30", "Pendiente 5–30", "rates", "pb", "treasury"),
        D("DFII10", "Tasa real 10 años", "rates", "%", "fred"),
        D("T10YIE", "Breakeven 10 años", "rates", "%", "fred"),
        D("BAMLH0A0HYM2", "High yield OAS", "credit", "%", "fred", "daily-close"),
        D("BAMLC0A0CM", "Investment grade OAS", "credit", "%", "fred", "daily-close"),
        D("VIX", "VIX", "volatility", "puntos", "cboe"),
        D("VVIX", "VVIX", "volatility", "puntos", "cboe"),
        D("SKEW", "SKEW", "volatility", "puntos", "cboe"),
        D("EQUITIES", "Acciones / amplitud", "equities", "%", "unavailable"),
        D("FX", "Dólar amplio", "currencies", "índice", "unavailable"),
        D("COMMODITIES", "Commodities", "commodities", "precio", "unavailable"),
        D("POLICY", "Trayectoria implícita", "rates", "%", "unavailable")
    };
}

public static class MacroCalculations
{
    public static MacroMetric Change(MacroSeriesDefinition definition, MacroObservation[] observations, string horizon)
    {
        var rows = observations.Where(o => o.SeriesId == definition.Id && o.Value != null)
            .OrderBy(o => o.ObservationTime, StringComparer.Ordinal).ToArray();
        var last = rows.LastOrDefault();
        var anchor = last == null ? null : rows.LastOrDefault(o =>
            DateOnly.Parse(o.ObservationTime) <= DateOnly.Parse(last.ObservationTime).AddMonths(-1));
        if (last != null && anchor != null && DateOnly.Parse(last.ObservationTime).AddMonths(-1).DayNumber
            - DateOnly.Parse(anchor.ObservationTime).DayNumber > 7) anchor = null;
        var supported = horizon == "month";
        decimal? value = supported && last != null && anchor != null
            ? (last.Value - anchor.Value) * (definition.Unit == "%" ? 100m : 1m) : null;
        var refs = value == null ? Array.Empty<string>() : new[] { anchor!.Id, last!.Id };
        return new($"{definition.Id}:{horizon}", definition.Id, last?.Id, value == null ? null : anchor?.Id,
            value, definition.Unit == "%" ? "pb" : definition.Unit, horizon,
            value == null ? null : anchor?.ObservationTime, last?.ObservationTime, refs, "difference-v1",
            value == null ? "unavailable" : last!.QualityStatus,
            new[] { supported ? "Mes calendario anclado a última observación válida en o antes del aniversario (tolerancia 7 días); fechas explícitas."
                : "Horizonte sin calendario de sesiones/evento verificable; comparación bloqueada." });
    }

    public static MacroObservation[] Slope(string id, string shortId, string longId, IEnumerable<MacroObservation> rows)
    {
        var shortRows = rows.Where(o => o.SeriesId == shortId).ToDictionary(o => o.ObservationTime);
        return rows.Where(o => o.SeriesId == longId && shortRows.ContainsKey(o.ObservationTime)).Select(longRow =>
        {
            var shortRow = shortRows[longRow.ObservationTime];
            return longRow with { Id = $"{id}:{longRow.ObservationTime}", SeriesId = id,
                Value = (longRow.Value - shortRow.Value) * 100m, Provenance = "calculated",
                QualityStatus = longRow.Value == null || shortRow.Value == null ? "unavailable"
                    : longRow.QualityStatus == "delayed" || shortRow.QualityStatus == "delayed" ? "delayed" : "available",
                QualityReasons = new[] { $"long-minus-short-v1; entradas {longRow.Id}, {shortRow.Id}; fecha común." } };
        }).ToArray();
    }
}
