using System.Text.Json;
using System.Text.RegularExpressions;
using DataFeed.Application.App.Macro;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace DataFeed.Controllers;

[ApiController]
[Route("App/Macro")]
[Tags("App.Macro")]
public class MacroController(IMediator mediator, IConfiguration config) : ControllerBase
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly SemaphoreSlim StoreLock = new(1, 1);
    [HttpGet("Catalog")]
    public IActionResult Catalog() => Ok(new { schemaVersion = "1.0", methodologyVersion = MacroCatalog.Version,
        seriesDefinitions = MacroCatalog.Definitions, regions = new[] { "Global", "US" }, currencies = new[] { "Local" },
        limitations = new[] { "Cobertura US parcial; Global no implica cobertura mundial.", "Sin IA ni replay histórico fiel." } });

    /// <summary>Panel de mercados (WS-0036): franja, tabla por clase de activo, curva y agenda, calculados acá.</summary>
    [HttpGet("Board")]
    public async Task<IActionResult> Board(CancellationToken ct) => Ok(await mediator.Send(new MacroBoardRequest(), ct));

    [HttpGet("Snapshot")]
    public async Task<IActionResult> Snapshot([FromQuery] MacroSnapshotRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(config["Macro:SnapshotDirectory"]))
            return StatusCode(503, new { code = "macro_store_unconfigured", error = "Almacenamiento Macro local no configurado." });
        MacroSnapshot snapshot;
        try { snapshot = await mediator.Send(request, ct); }
        catch (DataFeed.Application.Shared.ValidationException)
        { return BadRequest(new { code = "unsupported_macro_scope", error = "Corte actual, Global/US y moneda Local. Sin replay histórico." }); }
        var payload = JsonSerializer.SerializeToUtf8Bytes(snapshot, Json);
        if (payload.Length > 2 * 1024 * 1024) return StatusCode(507, new { code = "macro_snapshot_too_large" });
        await StoreLock.WaitAsync(ct);
        try
        {
            var directory = config["Macro:SnapshotDirectory"]!;
            Directory.CreateDirectory(directory);
            var path = Path.Combine(directory, snapshot.Id + ".json");
            if (!System.IO.File.Exists(path))
            {
                if (Directory.EnumerateFiles(directory, "*.json").Take(100).Count() >= 100)
                    return StatusCode(507, new { code = "macro_store_full", error = "Límite local de 100 snapshots; conservar/exportar antes de ampliar." });
                var temporary = path + ".tmp";
                await System.IO.File.WriteAllBytesAsync(temporary, payload, ct);
                System.IO.File.Move(temporary, path, false);
            }
        }
        finally { StoreLock.Release(); }
        return Ok(snapshot);
    }

    [HttpGet("Snapshots/{id}")]
    public async Task<IActionResult> Stored(string id, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(config["Macro:SnapshotDirectory"])) return StoreUnavailable();
        var snapshot = await Load(id, ct);
        return snapshot == null ? NotFound(new { code = "macro_snapshot_not_found" }) : Ok(snapshot);
    }
    [HttpGet("Series/{id}")]
    public async Task<IActionResult> Series(string id, [FromQuery] string snapshotId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(config["Macro:SnapshotDirectory"])) return StoreUnavailable();
        var snapshot = await Load(snapshotId, ct);
        var definition = snapshot?.SeriesDefinitions.SingleOrDefault(s => s.Id == id);
        return definition == null ? NotFound(new { code = "macro_series_not_found" }) : Ok(new { definition,
            snapshotId, historicalFidelity = snapshot!.HistoricalFidelity,
            observations = snapshot.Observations.Where(o => o.SeriesId == id), metrics = snapshot.Metrics.Where(m => m.SeriesId == id) });
    }
    [HttpGet("Events")]
    public async Task<IActionResult> Events([FromQuery] string snapshotId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(config["Macro:SnapshotDirectory"])) return StoreUnavailable();
        var snapshot = await Load(snapshotId, ct);
        return snapshot == null ? NotFound(new { code = "macro_snapshot_not_found" }) : Ok(new { snapshotId,
            snapshot.Events, sourceStatuses = snapshot.SourceStatuses.Where(s => s.Id.EndsWith("calendar")) });
    }
    private async Task<MacroSnapshot?> Load(string id, CancellationToken ct)
    {
        var directory = config["Macro:SnapshotDirectory"];
        if (directory == null || !Regex.IsMatch(id, "^[a-f0-9]{64}$")) return null;
        var path = Path.Combine(directory, id + ".json");
        if (!System.IO.File.Exists(path)) return null;
        return JsonSerializer.Deserialize<MacroSnapshot>(await System.IO.File.ReadAllTextAsync(path, ct), Json);
    }
    private ObjectResult StoreUnavailable() => StatusCode(503,
        new { code = "macro_store_unconfigured", error = "Almacenamiento Macro local no configurado." });
}
