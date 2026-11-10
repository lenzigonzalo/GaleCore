using System.Globalization;
using DataFeed.Application.Data.Argentina;
using DataFeed.Application.Shared;
using MediatR;
using Microsoft.Extensions.DependencyInjection;
using Newtonsoft.Json.Linq;

namespace DataFeed.Application.App.Macro;

/// <summary>
/// Tablero «Argentina» (WS-0095): todo el país en una respuesta para que el Monitor no arme nada. Cada bloque sale de los
/// handlers de Data/Argentina (WS-0077, WS-0090) vía MediatR, con su fuente y la fecha de su último dato; un bloque que
/// falla se declara (Ok=false + Error) y no tumba a los demás. Sin interpretación: sólo armado y variaciones simples
/// (último contra el dato anterior de la misma serie).
/// </summary>
public class MacroArgentinaRequest : IRequest<MacroArgentinaResponse> { }

public class MacroArgentinaResponse
{
    public DateTime AsOf { get; set; }
    /// <summary>Por id: dolares, riesgoPais, inflacion, curvaPesos, reservas, baseMonetaria, tasas, balanza, futurosDolar, agro.</summary>
    public Dictionary<string, ArgentinaBlock> Blocks { get; set; } = new();
}

public class ArgentinaBlock
{
    public string Id { get; set; } = "";
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public string? Source { get; set; }
    /// <summary>Fecha (o fecha y hora) del dato más reciente del bloque, tal como la informa la fuente.</summary>
    public string? AsOf { get; set; }
    public List<string> Notes { get; set; } = new();
    public object? Data { get; set; }
}

public record ArgentinaPoint(string Fecha, decimal Valor);

/// <summary>
/// Una serie con su último dato. ChangeAbs = último − anterior (en la unidad de la serie; en tasas, puntos de TNA);
/// ChangePct = (último / anterior − 1) × 100. Ok=false cuando esa serie no se pudo leer (Error dice por qué).
/// </summary>
public class ArgentinaSeriesItem
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Unit { get; set; } = "";
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public string? Source { get; set; }
    public decimal? Last { get; set; }
    public string? Date { get; set; }
    public decimal? ChangeAbs { get; set; }
    public decimal? ChangePct { get; set; }
    public List<ArgentinaPoint> Series { get; set; } = new();
}

public record ArgentinaDolar(string Casa, string Nombre, decimal? Compra, decimal? Venta, decimal? BrechaPct, string FechaActualizacion,
    decimal? VarDiariaPct, string? VarDiariaContra, List<ArgentinaPoint> Serie);

public record ArgentinaLetra(string Ticker, decimal? Precio, decimal? TnaPct, decimal? TeaPct, decimal? TemPct, string? Vencimiento,
    int? Dias, decimal? VariacionPct);

/// <summary>Interanual = inflación de los 12 meses que terminan en cada fecha, compuesta desde la mensual: (Π(1 + m/100) − 1) × 100. Se compara con el REM a 12 meses.</summary>
public record ArgentinaInflacion(ArgentinaSeriesItem Mensual, ArgentinaSeriesItem Interanual, ArgentinaSeriesItem Rem);

public record ArgentinaFuturos(A3Referencia Referencia, List<A3Futuro> Contratos);

public class MacroArgentinaHandler(IMediator mediator, IServiceScopeFactory? scopes = null) : IRequestHandler<MacroArgentinaRequest, MacroArgentinaResponse>
{
    // Ids a fijar contra Data/Bcra/Variables (10/11/2026).
    private const int BcraReservas = 1;        // Reservas internacionales, millones de USD, diaria
    private const int BcraBase = 15;           // Base monetaria, millones de ARS, diaria
    private const int BcraBadlar = 7;          // BADLAR bancos privados, TNA %
    private const int BcraTamar = 44;          // TAMAR bancos privados, TNA %
    private const int BcraPlazoFijo30 = 1207;  // Depósitos a plazo fijo de 30 días, TNA %
    private const int BcraRem = 29;            // REM: mediana de inflación esperada a 12 meses (%)
    // datos.gob.ar, dataset «Intercambio Comercial Argentino» (INDEC), mensual, millones de USD.
    private const string IndecExportaciones = "74.3_IET_0_M_16";
    private const string IndecImportaciones = "74.3_IIT_0_M_25";
    private const string IndecSaldo = "74.3_ISC_0_M_19";

    private static readonly string[] Casas = { "oficial", "blue", "bolsa", "contadoconliqui", "mayorista", "cripto", "tarjeta" };

    private static (DateTime At, MacroArgentinaResponse Board)? _last;
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly TimeSpan Ttl = TimeSpan.FromSeconds(60);
    private static int _refreshing;

    /// <summary>
    /// Sirve lo último que se armó al instante; si tiene más de <see cref="Ttl"/> dispara un refresco en segundo plano (uno solo a la
    /// vez). Sólo la primera vez (sin tablero) se espera el armado completo.
    /// </summary>
    public async Task<MacroArgentinaResponse> Handle(MacroArgentinaRequest request, CancellationToken ct)
    {
        if (_last is { } c)
        {
            if (DateTime.UtcNow - c.At >= Ttl) RefreshInBackground();
            return c.Board;
        }
        await Gate.WaitAsync(ct);
        try
        {
            if (_last is { } again) return again.Board;
            var board = await Build(ct);
            _last = (DateTime.UtcNow, board);
            return board;
        }
        finally { Gate.Release(); }
    }

    private void RefreshInBackground()
    {
        if (Interlocked.CompareExchange(ref _refreshing, 1, 0) != 0) return;
        _ = Task.Run(async () =>
        {
            try
            {
                // El refresco sobrevive al pedido que lo disparó: arma con un scope propio, no con el mediator del pedido
                // (ya liberado al responder: «Cannot access a disposed object»).
                if (scopes is null) return;
                using var scope = scopes.CreateScope();
                var own = new MacroArgentinaHandler(scope.ServiceProvider.GetRequiredService<IMediator>());
                await Gate.WaitAsync();
                try { _last = (DateTime.UtcNow, await own.Build(CancellationToken.None)); }
                finally { Gate.Release(); }
            }
            catch { /* se sigue sirviendo el último tablero; el próximo pedido reintenta */ }
            finally { Interlocked.Exchange(ref _refreshing, 0); }
        });
    }

    /// <summary>Vacía el último tablero (lo usan los tests).</summary>
    public static void ResetCache() { _last = null; }

    /// <summary>Arma el tablero sin pasar por el caché (lo usan los tests).</summary>
    public async Task<MacroArgentinaResponse> Build(CancellationToken ct)
    {
        var a3 = Safe(() => mediator.Send(new A3FuturosRequest(), ct));
        var tasks = new (string Id, Task<ArgentinaBlock> Task)[]
        {
            ("dolares", Block("dolares", () => Dolares(ct))),
            ("riesgoPais", Block("riesgoPais", () => RiesgoPais(ct))),
            ("inflacion", Block("inflacion", () => Inflacion(ct))),
            ("curvaPesos", Block("curvaPesos", () => CurvaPesos(ct))),
            ("reservas", Block("reservas", () => BcraBlock("reservas", BcraReservas, "Reservas internacionales", "millones de USD", ct))),
            ("baseMonetaria", Block("baseMonetaria", () => BcraBlock("baseMonetaria", BcraBase, "Base monetaria", "millones de ARS", ct))),
            ("tasas", Block("tasas", () => Tasas(ct))),
            ("balanza", Block("balanza", () => Balanza(ct))),
            ("futurosDolar", Block("futurosDolar", async () => FuturosBlock("futurosDolar", await a3, f => f.Dolar,
                "Devaluación implícita = precio / A3500 − 1; TNA y TEA anualizadas (ver notas de la fuente)."))),
            ("agro", Block("agro", async () => FuturosBlock("agro", await a3, f => f.Agro, "Futuros agro de A3."))),
        };
        await Task.WhenAll(tasks.Select(t => t.Task));
        return new MacroArgentinaResponse { AsOf = DateTime.UtcNow, Blocks = tasks.ToDictionary(t => t.Id, t => t.Task.Result) };
    }

    // Una tarea que ya falló no explota hasta que cada bloque la espera (y la declara).
    private static Task<T> Safe<T>(Func<Task<T>> f)
    {
        try { return f(); }
        catch (Exception e) { return Task.FromException<T>(e); }
    }

    private static async Task<ArgentinaBlock> Block(string id, Func<Task<ArgentinaBlock>> build)
    {
        try { return await build(); }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            return new ArgentinaBlock { Id = id, Ok = false, Error = e.Message };
        }
    }

    private static ArgentinaBlock Ok(string id, string? source, string? asOf, object data, IEnumerable<string>? notes = null) =>
        new() { Id = id, Ok = true, Source = source, AsOf = asOf, Data = data, Notes = notes?.ToList() ?? new() };

    // ───── Series genéricas ─────

    private static decimal? Dec(JToken? t) => t is null || t.Type == JTokenType.Null ? null
        : t.Type is JTokenType.Float or JTokenType.Integer ? (decimal)t
        : decimal.TryParse((string?)t, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : null;

    private static List<ArgentinaPoint> Points(IEnumerable<JToken> rows) => rows
        .Select(r => (Fecha: (string?)r["fecha"], Valor: Dec(r["valor"])))
        .Where(p => p.Fecha != null && p.Valor != null)
        .Select(p => new ArgentinaPoint(p.Fecha!, p.Valor!.Value)).OrderBy(p => p.Fecha, StringComparer.Ordinal).ToList();

    /// <summary>Arma el ítem con último dato, fecha y variación contra el anterior.</summary>
    public static ArgentinaSeriesItem Item(string id, string name, string unit, string source, List<ArgentinaPoint> points)
    {
        var item = new ArgentinaSeriesItem { Id = id, Name = name, Unit = unit, Source = source, Series = points };
        if (points.Count == 0) { item.Ok = false; item.Error = "la fuente no devolvió datos"; return item; }
        var last = points[^1];
        item.Ok = true; item.Last = last.Valor; item.Date = last.Fecha;
        if (points.Count > 1)
        {
            var prev = points[^2].Valor;
            item.ChangeAbs = Math.Round(last.Valor - prev, 4);
            if (prev != 0) item.ChangePct = Math.Round((last.Valor / prev - 1m) * 100m, 2);
        }
        return item;
    }

    private static ArgentinaSeriesItem Failed(string id, string name, string unit, string message) =>
        new() { Id = id, Name = name, Unit = unit, Ok = false, Error = message };

    private static string Day(int daysAgo) => DateTime.UtcNow.AddDays(-daysAgo).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private async Task<ArgentinaSeriesItem> BcraItem(int idVariable, string id, string name, string unit, int days, CancellationToken ct)
    {
        try
        {
            var r = await mediator.Send(new BcraSeriesRequest { IdVariable = idVariable, Desde = Day(days) }, ct);
            var detalle = (r.Data["detalle"] as JArray) ?? new JArray();
            return Item(id, name, unit, "bcra", Points(detalle));
        }
        catch (Exception e) when (e is not OperationCanceledException) { return Failed(id, name, unit, e.Message); }
    }

    private async Task<ArgentinaBlock> BcraBlock(string id, int idVariable, string name, string unit, CancellationToken ct)
    {
        var item = await BcraItem(idVariable, id, name, unit, 730, ct);
        if (!item.Ok) return new ArgentinaBlock { Id = id, Ok = false, Error = item.Error };
        return Ok(id, "bcra", item.Date, item, new[] { $"BCRA, variable {idVariable} ({name}, {unit}); últimos 2 años." });
    }

    // ───── Bloques ─────

    private async Task<ArgentinaBlock> Dolares(CancellationToken ct)
    {
        var quotes = await mediator.Send(new ArgentinaDolaresRequest(), ct);
        var failed = new System.Collections.Concurrent.ConcurrentBag<string>();
        var series = await Task.WhenAll(quotes.Data.Select(async q =>
        {
            if (!Casas.Contains(q.Casa)) return new List<ArgentinaPoint>();
            try
            {
                var s = await mediator.Send(new ArgentinaSeriesRequest { Serie = "dolar", Casa = q.Casa }, ct);
                return Points(((s.Data as JArray) ?? new JArray()).Select(r => new JObject { ["fecha"] = r["fecha"], ["valor"] = r["venta"] }));
            }
            catch (Exception e) when (e is not OperationCanceledException) { failed.Add($"{q.Casa}: {e.Message}"); return new List<ArgentinaPoint>(); }
        }));
        var rows = quotes.Data.Select((q, i) =>
        {
            var s = series[i];
            // Contra el último valor de la serie con fecha anterior a la del dato actual (la serie suele repetir el día).
            var day = (q.FechaActualizacion ?? "").Length >= 10 ? q.FechaActualizacion![..10] : "";
            var prev = day == "" || q.Venta is null ? null
                : s.LastOrDefault(p => string.CompareOrdinal(p.Fecha.Length >= 10 ? p.Fecha[..10] : p.Fecha, day) < 0);
            decimal? daily = prev is { Valor: not 0 } ? Math.Round((q.Venta!.Value / prev.Valor - 1m) * 100m, 2) : null;
            return new ArgentinaDolar(q.Casa, q.Nombre, q.Compra, q.Venta, q.BrechaPct, q.FechaActualizacion, daily, prev?.Fecha, s);
        }).ToList();
        var notes = new List<string>(quotes.Notes) { "VarDiariaPct = venta actual / último valor de la serie diaria de ArgentinaDatos con fecha anterior a la del dato actual − 1 (en %); VarDiariaContra = esa fecha. Serie = venta, último año." };
        foreach (var f in failed) notes.Add($"No se pudo leer la serie diaria de {f}.");
        return Ok("dolares", quotes.Source, quotes.AsOf, rows, notes);
    }

    private async Task<ArgentinaBlock> RiesgoPais(CancellationToken ct)
    {
        var r = await mediator.Send(new ArgentinaSeriesRequest { Serie = "riesgo-pais" }, ct);
        var item = Item("riesgoPais", "Riesgo país", "pb", r.Source, Points((r.Data as JArray) ?? new JArray()));
        return item.Ok ? Ok("riesgoPais", r.Source, item.Date, item, r.Notes) : new ArgentinaBlock { Id = "riesgoPais", Ok = false, Error = item.Error };
    }

    private async Task<ArgentinaBlock> Inflacion(CancellationToken ct)
    {
        var monthly = await mediator.Send(new ArgentinaSeriesRequest
        {
            Serie = "inflacion",
            Desde = DateTime.UtcNow.AddMonths(-38).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        }, ct);
        var all = Points((monthly.Data as JArray) ?? new JArray());
        var months = all.Skip(Math.Max(0, all.Count - 24)).ToList();
        var mensual = Item("inflacionMensual", "Inflación mensual", "%", monthly.Source, months);
        if (!mensual.Ok) return new ArgentinaBlock { Id = "inflacion", Ok = false, Error = mensual.Error };
        var yoy = Interanual(all);
        var interanual = Item("inflacionInteranual", "Inflación interanual", "%", monthly.Source, yoy.Skip(Math.Max(0, yoy.Count - 24)).ToList());
        var rem = await BcraItem(BcraRem, "rem12m", "REM: inflación esperada a 12 meses", "%", 740, ct);
        var notes = new List<string>(monthly.Notes)
        {
            "Interanual = producto de (1 + mensual/100) de los 12 meses que terminan en cada fecha, menos 1 (en %); sólo con 12 meses consecutivos.",
            $"REM: BCRA variable {BcraRem} (mediana de la variación interanual esperada a 12 meses, una publicación por mes); se compara con la interanual.",
        };
        if (!interanual.Ok) notes.Add("No hay 12 meses consecutivos para calcular la interanual.");
        if (!rem.Ok) notes.Add("No se pudo leer el REM: " + rem.Error);
        return Ok("inflacion", monthly.Source, mensual.Date, new ArgentinaInflacion(mensual, interanual, rem), notes);
    }

    /// <summary>Interanual compuesta desde la mensual; omite ventanas con meses faltantes.</summary>
    public static List<ArgentinaPoint> Interanual(List<ArgentinaPoint> monthly)
    {
        static int Idx(string f) => int.Parse(f[..4], CultureInfo.InvariantCulture) * 12 + int.Parse(f[5..7], CultureInfo.InvariantCulture);
        var res = new List<ArgentinaPoint>();
        for (var i = 11; i < monthly.Count; i++)
        {
            if (Idx(monthly[i].Fecha) - Idx(monthly[i - 11].Fecha) != 11) continue;
            var prod = 1m;
            for (var j = i - 11; j <= i; j++) prod *= 1m + monthly[j].Valor / 100m;
            res.Add(new ArgentinaPoint(monthly[i].Fecha, Math.Round((prod - 1m) * 100m, 2)));
        }
        return res;
    }

    private async Task<ArgentinaBlock> CurvaPesos(CancellationToken ct)
    {
        var r = await mediator.Send(new ArgentinaSeriesRequest { Serie = "letras" }, ct);
        var letras = (r.Data["letras"] as JArray) ?? throw new InvalidOperationException("la respuesta de letras cambió de forma (falta letras)");
        var rows = letras.Select(l => new ArgentinaLetra((string?)l["ticker"] ?? "", Dec(l["precioArs"]), Dec(l["tnaPorcentaje"]), Dec(l["teaPorcentaje"]),
                Dec(l["temPorcentaje"]), (string?)l["fechaVencimiento"], (int?)l["diasAlVencimiento"], Dec(l["variacionPorcentaje"])))
            .OrderBy(l => l.Vencimiento, StringComparer.Ordinal).ToList();
        // Una TNA negativa es de un instrumento ajustable (p. ej. dólar linked) que la fuente mezcla en la lista: no es una tasa en pesos comparable.
        var excluded = rows.Where(l => l.TnaPct is < 0).Select(l => l.Ticker).ToList();
        rows = rows.Where(l => l.TnaPct is not < 0).ToList();
        var notes = new List<string>(r.Notes);
        if (excluded.Count > 0) notes.Add($"Excluidas por TNA negativa (instrumentos ajustables): {string.Join(", ", excluded)}.");
        return Ok("curvaPesos", r.Source, (string?)r.Data["fechaActualizacion"] ?? r.AsOf, rows, notes);
    }

    private async Task<ArgentinaBlock> Tasas(CancellationToken ct)
    {
        var badlar = BcraItem(BcraBadlar, "badlar", "BADLAR bancos privados", "% TNA", 365, ct);
        var tamar = BcraItem(BcraTamar, "tamar", "TAMAR bancos privados", "% TNA", 365, ct);
        var plazoFijo = BcraItem(BcraPlazoFijo30, "plazoFijo30", "Plazo fijo a 30 días", "% TNA", 365, ct);
        var items = await Task.WhenAll(badlar, tamar, plazoFijo);
        if (items.All(i => !i.Ok)) return new ArgentinaBlock { Id = "tasas", Ok = false, Error = string.Join("; ", items.Select(i => $"{i.Name}: {i.Error}")) };
        var asOf = items.Where(i => i.Date != null).Select(i => i.Date!).DefaultIfEmpty("").Max();
        return Ok("tasas", "bcra", asOf, items.ToList(),
            new[] { $"BCRA variables {BcraBadlar} (BADLAR), {BcraTamar} (TAMAR), {BcraPlazoFijo30} (plazo fijo 30 días)." });
    }

    private async Task<ArgentinaBlock> Balanza(CancellationToken ct)
    {
        var r = await mediator.Send(new IndecSeriesRequest { Ids = $"{IndecExportaciones},{IndecImportaciones},{IndecSaldo}", Last = 24 }, ct);
        var fields = (r.Data["fields"] as JArray) ?? throw new InvalidOperationException("la respuesta de INDEC cambió de forma (falta fields)");
        var data = (r.Data["data"] as JArray) ?? new JArray();
        ArgentinaSeriesItem Col(string seriesId, string name)
        {
            var idx = fields.Select((f, i) => (Id: (string?)f["id"], i)).FirstOrDefault(f => f.Id == seriesId);
            if (idx.Id == null) return Failed(seriesId, name, "millones de USD", "la serie no vino en la respuesta");
            var pts = data.Select(row => (Fecha: (string?)row[0], Valor: Dec(row[idx.i + 1])))
                .Where(p => p.Fecha != null && p.Valor != null).Select(p => new ArgentinaPoint(p.Fecha!, p.Valor!.Value)).ToList();
            return Item(seriesId, name, "millones de USD", "indec", pts);
        }
        var items = new List<ArgentinaSeriesItem>
        {
            Col(IndecExportaciones, "Exportaciones"), Col(IndecImportaciones, "Importaciones"), Col(IndecSaldo, "Saldo comercial"),
        };
        if (items.All(i => !i.Ok)) return new ArgentinaBlock { Id = "balanza", Ok = false, Error = "INDEC no devolvió datos de la balanza" };
        var asOf = items.Where(i => i.Date != null).Select(i => i.Date!).DefaultIfEmpty("").Max();
        return Ok("balanza", r.Source, asOf, items, new[] { "INDEC, Intercambio Comercial Argentino (datos.gob.ar), mensual, últimos 24 meses." });
    }

    private static ArgentinaBlock FuturosBlock(string id, SourcedResponse<A3Futuros> r, Func<A3Futuros, List<A3Futuro>> pick, string note)
    {
        // Contratos sin ningún precio (la fuente lista vencimientos sin operar) no aportan a la tabla.
        var rows = pick(r.Data).Where(f => f.Ultimo is not null || f.Ajuste is not null || f.Venta is not null || f.Compra is not null).ToList();
        var notes = new List<string>(r.Notes) { note };
        if (rows.Count == 0) notes.Add("A3 no devolvió contratos para este bloque.");
        return Ok(id, r.Source, r.AsOf, new ArgentinaFuturos(r.Data.Referencia, rows), notes);
    }
}
