using System.Security.Cryptography;
using System.Collections.Concurrent;
using System.Text.Json;
using DataFeed.Application.Data.Treasury;
using DataFeed.Application.Data.Fred.Series;
using DataFeed.Application.Data.Fred.ReleaseDates;
using DataFeed.Application.Data.Fed.FomcMeetings;
using DataFeed.Application.Data.Cboe.IndexHistory;
using DataFeed.Application.Shared;
using MediatR;

namespace DataFeed.Application.App.Macro;

public class MacroSnapshotRequest : IRequest<MacroSnapshot>
{
    public string Horizon { get; set; } = "month";
    public string Region { get; set; } = "Global";
    public string Currency { get; set; } = "Local";
    public string? Cutoff { get; set; }
}

public class MacroSnapshotHandler(IMediator mediator) : IRequestHandler<MacroSnapshotRequest, MacroSnapshot>
{
    // Universo cerrado de diez fuentes; conserva la última respuesta válida con su consulta original.
    private static readonly ConcurrentDictionary<string, Part> LastGood = new();
    public async Task<MacroSnapshot> Handle(MacroSnapshotRequest request, CancellationToken cancellationToken)
    {
        if (!new[] { "session", "five-sessions", "month", "event" }.Contains(request.Horizon)
            || !new[] { "Global", "US" }.Contains(request.Region) || request.Currency != "Local"
            || request.Cutoff != null)
            throw new ValidationException("Alcance no soportado: Global/US, Local, corte actual. Sin vintages no se habilita replay histórico.");
        var cutoff = DateTime.UtcNow;
        var from = cutoff.Date.AddMonths(-3);
        var jobs = new List<Task<Part>> { ReadTreasury(from, cutoff, cancellationToken), ReadFredEvents(cutoff, cancellationToken), ReadFedEvents(cutoff, cancellationToken) };
        foreach (var id in new[] { "DFII10", "T10YIE", "BAMLH0A0HYM2", "BAMLC0A0CM" })
            jobs.Add(ReadFred(id, from, cutoff, cancellationToken));
        foreach (var id in new[] { "VIX", "VVIX", "SKEW" })
            jobs.Add(ReadCboe(id, from, cutoff, cancellationToken));
        var parts = await Task.WhenAll(jobs);
        var rows = parts.SelectMany(p => p.Rows).ToList();
        rows.AddRange(MacroCalculations.Slope("SLOPE2_10", "UST2", "UST10", rows.ToArray()));
        rows.AddRange(MacroCalculations.Slope("SLOPE5_30", "UST5", "UST30", rows.ToArray()));
        var observations = rows.OrderBy(o => o.Id, StringComparer.Ordinal).ToArray();
        var metrics = MacroCatalog.Definitions.Select(d => MacroCalculations.Change(d, observations, request.Horizon)).ToArray();
        var events = parts.SelectMany(p => p.Events).OrderBy(e => e.Date).ThenBy(e => e.Id).ToArray();
        var statuses = parts.Select(p => p.Status).ToArray();
        var hash = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { request.Horizon,
            request.Region, request.Currency, cutoff, observations, metrics, events, statuses }))).ToLowerInvariant();
        return new(hash, "1.0", request.Horizon, request.Region, request.Currency, cutoff, DateTime.UtcNow,
            MacroCatalog.Definitions, observations, metrics, events, statuses, new[] { MacroCatalog.Version }, hash, "revised-history-only");
    }

    private record Part(MacroObservation[] Rows, MacroEvent[] Events, MacroSourceStatus Status);
    private static MacroObservation Row(string id, string date, decimal? value, string url, DateTime at, string? vintage, DateTime cutoff)
        => new($"{id}:{date}", id, value, date, null, null, at, "day", url, vintage, "observed",
            value == null ? "unavailable" : DateOnly.Parse(date) < DateOnly.FromDateTime(cutoff).AddDays(-7) ? "delayed" : "available",
            new[] { "Dato diario; hora de publicación/available_at desconocida. No implica tiempo real ni mercado abierto." });

    private async Task<Part> Read<T>(string id, IRequest<SourcedResponse<T>> request, Func<SourcedResponse<T>, Part> map, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(12));
        try
        {
            var part = map(await mediator.Send(request, timeout.Token).WaitAsync(timeout.Token));
            if (part.Status.Status == "available") LastGood[id] = part;
            return part;
        }
        catch (Exception ex) when (!ct.IsCancellationRequested && ex is not OutOfMemoryException)
        {
            // No propagar mensajes upstream: podrían incluir URLs con credenciales.
            LastGood.TryGetValue(id, out var previous);
            return new(previous?.Rows ?? Array.Empty<MacroObservation>(), previous?.Events ?? Array.Empty<MacroEvent>(),
                new(id, "source-error", previous?.Status.AsOf, previous?.Status.RetrievedAt,
                    new[] { timeout.IsCancellationRequested ? "Tiempo límite 12 s." : $"Fuente fallida ({ex.GetType().Name}); sin datos sustitutos.",
                        previous == null ? "Sin lectura anterior válida." : "Se conserva lectura anterior con fecha original; actualización fallida." }));
        }
    }
    private static MacroSourceStatus Status<T>(string id, SourcedResponse<T> response, bool empty) =>
        new(id, empty ? "unavailable" : "available", response.AsOf, response.RetrievedAt, response.Notes.ToArray());

    private Task<Part> ReadTreasury(DateTime from, DateTime cutoff, CancellationToken ct) => Read("treasury",
        new TreasuryYieldCurveRequest { From = from, To = cutoff }, r =>
        {
            var rows = r.Data.SelectMany(day => new[] { ("2Y", "UST2"), ("5Y", "UST5"), ("10Y", "UST10"), ("30Y", "UST30") }
                .Select(t => Row(t.Item2, day.Date, day.Rates.TryGetValue(t.Item1, out var value) ? value : null,
                    r.UpstreamUrl, r.RetrievedAt, null, cutoff))).ToArray();
            return new(rows, Array.Empty<MacroEvent>(), Status("treasury", r, rows.Length == 0));
        }, ct);
    private Task<Part> ReadFred(string id, DateTime from, DateTime cutoff, CancellationToken ct) => Read(id,
        new FredSeriesRequest { SeriesId = id, From = from, To = cutoff }, r => new(
            r.Data.Observations.Select(o => Row(id, o.Date, o.Value, r.UpstreamUrl, r.RetrievedAt,
                $"{r.Data.RealtimeStart}:{r.Data.RealtimeEnd}", cutoff)).ToArray(), Array.Empty<MacroEvent>(),
            Status(id, r, !r.Data.Observations.Any(o => o.Value != null))), ct);
    private Task<Part> ReadCboe(string id, DateTime from, DateTime cutoff, CancellationToken ct) => Read(id,
        new CboeIndexHistoryRequest { Index = id, From = from, To = cutoff }, r => new(
            r.Data.Select(o => Row(id, o.Date, o.Close, r.UpstreamUrl, r.RetrievedAt, null, cutoff)).ToArray(),
            Array.Empty<MacroEvent>(), Status(id, r, r.Data.Count == 0)), ct);
    private Task<Part> ReadFredEvents(DateTime cutoff, CancellationToken ct) => Read("fred-calendar",
        new FredReleaseDatesRequest { From = cutoff.Date, To = cutoff.Date.AddDays(45), ReleaseIds = "10,50,46,53" }, r => new(
            Array.Empty<MacroObservation>(), r.Data.Select(e => new MacroEvent($"fred:{e.ReleaseId}:{e.Date}",
                e.ReleaseName, e.Date, "fred", "https://fred.stlouisfed.org/releases/calendar", r.RetrievedAt, "day",
                new[] { "Fecha programada; sin hora exacta, consenso ni sorpresa." })).ToArray(), Status("fred-calendar", r, r.Data.Count == 0)), ct);
    private Task<Part> ReadFedEvents(DateTime cutoff, CancellationToken ct) => Read("fed-calendar",
        new FomcMeetingsRequest { Years = $"{cutoff.Year}" }, r => new(Array.Empty<MacroObservation>(),
            r.Data.Where(e => e.End >= DateOnly.FromDateTime(cutoff) && e.End <= DateOnly.FromDateTime(cutoff.AddDays(45)))
                .Select(e => new MacroEvent($"fed:{e.End:yyyy-MM-dd}", e.Scheduled ? "Reunión FOMC" : "FOMC notation vote",
                    e.End.ToString("yyyy-MM-dd"), "fed", r.UpstreamUrl, r.RetrievedAt, "day",
                    new[] { "Fin de reunión; sin hora exacta ni probabilidades implícitas." })).ToArray(), Status("fed-calendar", r, r.Data.Count == 0)), ct);
}
