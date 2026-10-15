using System.Collections.Concurrent;
using System.Globalization;
using DataFeed.Infrastructure.Providers.Tastytrade;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using MediatR;
using Newtonsoft.Json.Linq;

namespace DataFeed.Application.App.Macro;

/// <summary>
/// Macro como el panel de mercados de un bróker (WS-0036, ok del owner 15/10): una franja con seis números y una tabla
/// por clase de activo con último, hoy, 1 semana, 1 mes y la serie del último mes para el mini gráfico. Los futuros
/// salen de Tastytrade (contrato vigente) y DXLink; tasas, crédito y volatilidad, del snapshot Macro (Tesoro, FRED,
/// CBOE). Todo calculado acá; el Monitor sólo lo muestra.
/// </summary>
public class MacroBoardRequest : IRequest<MacroBoardResponse> { }

public class MacroBoardResponse
{
    public DateTime AsOf { get; set; }
    public List<BoardRow> Strip { get; set; } = new();
    /// <summary>Una sección por pregunta, de lo general a lo específico.</summary>
    public List<BoardSection> Sections { get; set; } = new();
    public BoardCurve? Curve { get; set; }
    public List<BoardEvent> Events { get; set; } = new();
    /// <summary>Lo que no se pudo leer; se declara, no se inventa.</summary>
    public List<string> Missing { get; set; } = new();
}

public class BoardSection
{
    public string Question { get; set; } = "";
    public List<BoardGroup> Groups { get; set; } = new();
}

public class BoardGroup
{
    public string Name { get; set; } = "";
    public List<BoardRow> Rows { get; set; } = new();
}

public class BoardRow
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    /// <summary>Símbolo a mostrar: el contrato vigente en futuros (/ESZ26), la serie en el resto.</summary>
    public string Symbol { get; set; } = "";
    /// <summary>Unidad del último valor: "pts", "%", "pb", "USD".</summary>
    public string Unit { get; set; } = "";
    /// <summary>Unidad de los cambios: "%" (precios) o "pb" / "pts" (tasas y volatilidad).</summary>
    public string ChangeUnit { get; set; } = "";
    public double? Last { get; set; }
    public double? ChangeDay { get; set; }
    public double? ChangeWeek { get; set; }
    public double? ChangeMonth { get; set; }
    /// <summary>Fecha del último dato (las series diarias de FRED y el Tesoro llegan con un día o más de atraso).</summary>
    public string? AsOf { get; set; }
    public string Source { get; set; } = "";
    /// <summary>El último mes (22 datos): mini gráfico de la fila y gráfico del detalle.</summary>
    public List<BoardPoint> Spark { get; set; } = new();
}

public record BoardPoint(string Date, double Value);

public class BoardCurve
{
    public string Date { get; set; } = "";
    public List<BoardCurvePoint> Points { get; set; } = new();
}

public record BoardCurvePoint(string Tenor, double Value);
public record BoardEvent(string Date, string Name);

public class MacroBoardHandler(IMediator mediator, Microsoft.Extensions.Configuration.IConfiguration config, ITastytradeOAuth auth,
    IHttpClientFactory client, IDxLinkStreamingService streaming)
    : IRequestHandler<MacroBoardRequest, MacroBoardResponse>
{
    // Cada fila del panel se nombra por su fuente: fut: futuro (contrato vigente), eq: acción o ETF (DXLink),
    // ser: serie del snapshot Macro (Tesoro, FRED, CBOE), rel: cociente (desempeño relativo).
    private record Item(string Key, string Name);
    private record Group(string Name, Item[] Items, bool SortByMonth = false);
    private record Section(string Question, Group[] Groups);
    private record Relative(string Id, string Name, string[] Numerator, string Denominator);

    // Tastytrade no lista el índice dólar (/DX es de ICE): se usa el índice amplio de la Fed (FRED, diario).
    private const string Dollar = "DTWEXBGS";

    /// <summary>Las 8 grandes de la historia IA: su promedio (igual peso) contra el S&amp;P.</summary>
    private static readonly string[] AiBasket = { "NVDA", "MSFT", "AVGO", "GOOGL", "META", "AMZN", "AAPL", "TSLA" };

    private static readonly Relative[] Relatives =
    {
        new("RSP_SPY", "Igual peso vs S&P", new[] { "RSP" }, "SPY"),
        new("IWM_SPY", "Chicas vs S&P", new[] { "IWM" }, "SPY"),
        new("QQQ_SPY", "Nasdaq vs S&P", new[] { "QQQ" }, "SPY"),
        new("IWF_IWD", "Crecimiento vs valor", new[] { "IWF" }, "IWD"),
        new("SMH_SPY", "Semiconductores vs S&P", new[] { "SMH" }, "SPY"),
        new("AI_SPY", "Canasta IA vs S&P", AiBasket, "SPY"),
    };

    private static Item F(string code, string name) => new("fut:" + code, name);
    private static Item E(string symbol, string name) => new("eq:" + symbol, name);
    private static Item S(string id, string name) => new("ser:" + id, name);
    private static Item R(string id) => new("rel:" + id, Relatives.First(r => r.Id == id).Name);

    // El panel, de lo general a lo específico: las preguntas para leer la historia del mercado (owner 15/10).
    private static readonly Section[] Layout =
    {
        new("¿Hay apetito por riesgo?", new[]
        {
            new Group("Acciones", new[] { F("ES", "S&P 500"), F("NQ", "Nasdaq 100"), F("RTY", "Russell 2000"), F("YM", "Dow Jones") }),
            new Group("Crédito", new[] { S("BAMLH0A0HYM2", "Spread high yield"), S("BAMLC0A0CM", "Spread grado de inversión") }),
            new Group("Volatilidad", new[] { S("VIX", "VIX"), F("VX", "VIX futuro"), S("VVIX", "VVIX"), S("SKEW", "SKEW") }),
        }),
        new("¿Qué descuentan las tasas?", new[]
        {
            new Group("Tesoro", new[] { S("UST2", "Tesoro 2 años"), S("UST10", "Tesoro 10 años"), S("UST30", "Tesoro 30 años"), S("SLOPE2_10", "Pendiente 2–10") }),
            new Group("Tasa real e inflación esperada", new[] { S("DFII10", "Tasa real 10 años"), S("T10YIE", "Breakeven 10 años") }),
        }),
        new("¿Quién lidera?", new[]
        {
            new Group("Concentración y factores", new[] { R("RSP_SPY"), R("IWM_SPY"), R("QQQ_SPY"), R("IWF_IWD"), R("SMH_SPY"), R("AI_SPY") }),
            new Group("Sectores", new[] { E("XLK", "Tecnología"), E("SMH", "Semiconductores"), E("XLC", "Comunicaciones"), E("XLY", "Consumo discrecional"),
                E("XLF", "Finanzas"), E("XLI", "Industria"), E("XLV", "Salud"), E("XLP", "Consumo básico"), E("XLE", "Energía"),
                E("XLB", "Materiales"), E("XLU", "Servicios públicos"), E("XLRE", "Inmobiliario") }, SortByMonth: true),
            new Group("Canasta IA", new[] { E("NVDA", "Nvidia"), E("MSFT", "Microsoft"), E("AVGO", "Broadcom"), E("GOOGL", "Alphabet"),
                E("META", "Meta"), E("AMZN", "Amazon"), E("AAPL", "Apple"), E("TSLA", "Tesla") }, SortByMonth: true),
        }),
        new("¿Lo confirman los demás mercados?", new[]
        {
            new Group("Monedas", new[] { new Item("ser:" + Dollar, "Dólar amplio (Fed)"), F("6E", "Euro"), F("6J", "Yen"), F("6B", "Libra") }),
            new Group("Commodities", new[] { F("HG", "Cobre"), F("CL", "Petróleo WTI"), F("GC", "Oro"), F("SI", "Plata"), F("NG", "Gas natural"),
                F("ZS", "Soja"), F("ZC", "Maíz"), F("ZW", "Trigo") }),
        }),
    };
    private static readonly string[] StripKeys = { "fut:ES", "ser:UST10", "ser:" + Dollar, "fut:GC", "fut:CL", "ser:VIX" };

    private static readonly ConcurrentDictionary<string, (DateTime At, FutureItem Item)> Contracts = new();
    private static (DateTime At, MacroBoardResponse Board)? _last;
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly TimeSpan BoardTtl = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan ContractTtl = TimeSpan.FromHours(6);

    public async Task<MacroBoardResponse> Handle(MacroBoardRequest request, CancellationToken ct)
    {
        if (_last is { } c && DateTime.UtcNow - c.At < BoardTtl) return c.Board;
        await Gate.WaitAsync(ct);
        try
        {
            if (_last is { } again && DateTime.UtcNow - again.At < BoardTtl) return again.Board;
            var board = await BuildAsync(ct);
            _last = (DateTime.UtcNow, board);
            return board;
        }
        finally { Gate.Release(); }
    }

    private async Task<MacroBoardResponse> BuildAsync(CancellationToken ct)
    {
        var missing = new List<string>();
        var snapshotTask = mediator.Send(new MacroSnapshotRequest(), ct);
        var dollarTask = DollarAsync(missing, ct);
        var contracts = await ContractsAsync(missing, ct);

        // Acciones y ETF: los de las filas más los que piden los cocientes.
        var items = Layout.SelectMany(s => s.Groups).SelectMany(g => g.Items).ToList();
        var equities = items.Where(i => i.Key.StartsWith("eq:")).Select(i => i.Key[3..])
            .Concat(Relatives.SelectMany(r => r.Numerator.Append(r.Denominator))).Distinct().ToList();
        var streamer = new Dictionary<string, string>();
        foreach (var (code, item) in contracts) streamer["fut:" + code] = item.StreamerSymbol!;
        foreach (var e in equities) streamer["eq:" + e] = e;
        var daily = await DailyAsync(streamer, missing, ct);

        var snapshot = await snapshotTask;
        var dollar = await dollarTask;
        foreach (var st in snapshot.SourceStatuses.Where(st => st.Status != "available"))
            missing.Add($"{st.Id}: {(st.Status == "source-error" ? "la fuente falló" : "sin datos")}{(st.AsOf != null ? $" (último dato {st.AsOf})" : "")}.");
        var definitions = snapshot.SeriesDefinitions.ToDictionary(d => d.Id);
        List<(string Date, double Value)> Daily(string key) => daily.TryGetValue(key, out var v) ? v : new();

        BoardRow Build(Item item)
        {
            var kind = item.Key[..3]; var id = item.Key[4..];
            if (kind == "eq:") { kind = "eq"; id = item.Key[3..]; }
            if (kind == "ser" && id == Dollar) return dollar;
            if (kind == "ser")
            {
                definitions.TryGetValue(id, out var d);
                var unit = d?.Unit ?? "";
                var points = snapshot.Observations.Where(o => o.SeriesId == id && o.Value != null)
                    .OrderBy(o => o.ObservationTime, StringComparer.Ordinal).Select(o => (o.ObservationTime, (double)o.Value!.Value)).ToList();
                return MacroBoardMath.Row(id, item.Name, id, unit, unit is "%" or "pb" ? "pb" : "pts", unit == "%" ? 100 : 1, points, d?.Source ?? "");
            }
            if (kind == "rel")
            {
                var rel = Relatives.First(r => r.Id == id);
                var points = MacroBoardMath.Relative(rel.Numerator.Select(n => Daily("eq:" + n)).ToList(), Daily("eq:" + rel.Denominator));
                var label = rel.Numerator.Length > 2 ? $"canasta/{rel.Denominator}" : $"{rel.Numerator[0]}/{rel.Denominator}";
                var row = MacroBoardMath.Row(id, item.Name, label, "rel", "%", 0, points, "tastytrade");
                row.Last = null;   // el nivel del cociente no dice nada; se lee cuánto le ganó o perdió
                return row;
            }
            var pts = Daily(item.Key);
            var symbol = kind == "fut" ? (contracts.TryGetValue(id, out var fc) ? fc.Symbol : "/" + id) : id;
            // El VIX futuro se lee como el VIX: en puntos, no en %.
            return id == "VX" ? MacroBoardMath.Row(id, item.Name, symbol, "pts", "pts", 1, pts, "tastytrade")
                : MacroBoardMath.Row(id, item.Name, symbol, kind == "eq" ? "USD" : "pts", "%", 0, pts, "tastytrade");
        }

        var response = new MacroBoardResponse { AsOf = DateTime.UtcNow, Missing = missing };
        var byKey = new Dictionary<string, BoardRow>();
        foreach (var section in Layout)
        {
            var boardSection = new BoardSection { Question = section.Question };
            foreach (var g in section.Groups)
            {
                var rows = g.Items.Select(i => byKey[i.Key] = Build(i)).ToList();
                if (g.SortByMonth) rows = rows.OrderByDescending(r => r.ChangeMonth ?? double.MinValue).ToList();
                boardSection.Groups.Add(new BoardGroup { Name = g.Name, Rows = rows });
            }
            response.Sections.Add(boardSection);
        }
        response.Strip = StripKeys.Where(byKey.ContainsKey).Select(k => byKey[k]).ToList();
        response.Curve = MacroBoardMath.Curve(snapshot.Observations);
        response.Events = snapshot.Events.Select(e => new BoardEvent(e.Date, e.Name)).ToList();
        foreach (var r in byKey.Values.Where(r => r.Source == "tastytrade" && r.Spark.Count == 0))
            missing.Add($"{r.Name} ({r.Symbol}): sin historia diaria de Tastytrade.");
        return response;
    }

    private async Task<BoardRow> DollarAsync(List<string> missing, CancellationToken ct)
    {
        var points = new List<(string, double)>();
        try
        {
            var r = await mediator.Send(new DataFeed.Application.Data.Fred.Series.FredSeriesRequest
                { SeriesId = Dollar, From = DateTime.UtcNow.Date.AddDays(-60), To = DateTime.UtcNow }, ct);
            points.AddRange(r.Data.Observations.Where(o => o.Value != null).OrderBy(o => o.Date, StringComparer.Ordinal)
                .Select(o => (o.Date, (double)o.Value!.Value)));
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            missing.Add("Índice dólar (FRED DTWEXBGS): no respondió.");
        }
        return MacroBoardMath.Row(Dollar, "Dólar amplio (Fed)", Dollar, "índice", "%", 0, points, "fred");
    }

    /// <summary>Contrato vigente de cada futuro del panel (marca <c>active-month</c> de Tastytrade), con caché de 6 h.</summary>
    private async Task<Dictionary<string, FutureItem>> ContractsAsync(List<string> missing, CancellationToken ct)
    {
        var codes = Layout.SelectMany(s => s.Groups).SelectMany(g => g.Items).Where(i => i.Key.StartsWith("fut:")).Select(i => i.Key[4..]).ToList();
        var stale = codes.Where(c => !Contracts.TryGetValue(c, out var hit) || DateTime.UtcNow - hit.At > ContractTtl).ToList();
        if (stale.Count > 0)
        {
            try
            {
                var listed = (await new TastytradeApiProvider(config, auth, client).GetFuturesAsync(stale, ct))?.Data?.Items ?? new();
                foreach (var code in stale)
                {
                    var pick = FuturesMath.ActiveContract(listed.Where(i => i.ProductCode == code), DateOnly.FromDateTime(DateTime.UtcNow));
                    if (pick != null) Contracts[code] = (DateTime.UtcNow, pick);
                }
            }
            catch (Exception) when (!ct.IsCancellationRequested)
            {
                missing.Add("Contratos de futuros (Tastytrade): no respondió; se usan los últimos conocidos.");
            }
        }
        return codes.Where(Contracts.ContainsKey).Select(c => (Code: c, Item: Contracts[c].Item))
            .Where(x => !string.IsNullOrEmpty(x.Item.StreamerSymbol)).ToDictionary(x => x.Code, x => x.Item);
    }

    /// <summary>Velas diarias de ~45 días por DXLink, en un solo pedido: clave del panel → (fecha, cierre).</summary>
    private async Task<Dictionary<string, List<(string Date, double Value)>>> DailyAsync(Dictionary<string, string> streamer,
        List<string> missing, CancellationToken ct)
    {
        var from = new DateTimeOffset(DateTime.UtcNow.Date.AddDays(-45)).ToUnixTimeMilliseconds();
        var candles = new List<JObject>();
        try
        {
            candles.AddRange(await streaming.RequestSnapshotAsync(
                streamer.Values.Distinct().Select(sym => (sym + "{=d}", "Candle", (long?)from)).ToList(),
                isSymbolComplete: item => (((int?)item["eventFlags"] ?? 0) & 0x18) != 0,
                timeout: TimeSpan.FromSeconds(25), cancellationToken: ct));
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            missing.Add("Velas diarias (DXLink): no respondieron a tiempo.");
        }
        var bySymbol = candles.GroupBy(c => (string?)c["eventSymbol"] ?? "").ToDictionary(g => g.Key, g => g.ToList());
        return streamer.ToDictionary(kv => kv.Key, kv => (bySymbol.TryGetValue(kv.Value + "{=d}", out var list) ? list : new List<JObject>())
            .Select(c => (Time: (long?)c["time"] ?? 0, Close: ToDouble(c["close"])))
            .Where(x => x.Time > 0 && x.Close is > 0)
            .GroupBy(x => x.Time).Select(g => g.Last()).OrderBy(x => x.Time)
            .Select(x => (DateTimeOffset.FromUnixTimeMilliseconds(x.Time).UtcDateTime.ToString("yyyy-MM-dd"), x.Close!.Value)).ToList());
    }

    private static double? ToDouble(JToken? t)
    {
        if (t == null) return null;
        if (t.Type is JTokenType.Float or JTokenType.Integer) { var v = t.Value<double>(); return double.IsFinite(v) ? v : null; }
        return double.TryParse((string?)t, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) && double.IsFinite(d) ? d : null;
    }
}

public static class FuturesMath
{
    /// <summary>
    /// El contrato que opera el mercado hoy: el que Tastytrade marca <c>active-month</c>; si ninguno, el más cercano sin
    /// vencer. Así el panel pasa solo al siguiente cuando el volumen rolea.
    /// </summary>
    public static FutureItem? ActiveContract(IEnumerable<FutureItem> contracts, DateOnly today)
    {
        var live = contracts.Where(c => !DateOnly.TryParse(c.ExpirationDate, CultureInfo.InvariantCulture, out var e) || e >= today).ToList();
        return live.FirstOrDefault(c => c.ActiveMonth)
            ?? live.OrderBy(c => DateOnly.TryParse(c.ExpirationDate, CultureInfo.InvariantCulture, out var e) ? e : DateOnly.MaxValue).FirstOrDefault();
    }
}

public static class MacroBoardMath
{
    /// <summary>
    /// Una fila con la serie diaria (fecha, valor) en orden. Hoy = contra el dato anterior; 1 semana = 5 datos atrás;
    /// 1 mes = 21 datos atrás. <paramref name="scale"/> 0 = cambio en %; si no, diferencia × escala (100: de % a pb).
    /// </summary>
    public static BoardRow Row(string id, string name, string symbol, string unit, string changeUnit, double scale,
        IReadOnlyList<(string Date, double Value)> points, string source)
    {
        double? Change(int back)
        {
            if (points.Count <= back) return null;
            var last = points[^1].Value; var prev = points[^(back + 1)].Value;
            if (scale == 0) return prev == 0 ? null : Math.Round((last / prev - 1) * 100, 2);
            return Math.Round((last - prev) * scale, 2);
        }
        return new BoardRow
        {
            Id = id, Name = name, Symbol = symbol, Unit = unit,
            ChangeUnit = changeUnit, Source = source,
            Last = points.Count > 0 ? Math.Round(points[^1].Value, 6) : null,
            AsOf = points.Count > 0 ? points[^1].Date : null,
            ChangeDay = Change(1), ChangeWeek = Change(5), ChangeMonth = Change(21),
            Spark = points.TakeLast(22).Select(p => new BoardPoint(p.Date, Math.Round(p.Value, 6))).ToList(),
        };
    }

    /// <summary>
    /// Desempeño relativo: el promedio (igual peso) de los numeradores normalizados a la primera fecha común, sobre el
    /// denominador normalizado. Sube cuando el numerador le gana al denominador. Sólo fechas con todos los datos.
    /// </summary>
    public static List<(string Date, double Value)> Relative(IReadOnlyList<List<(string Date, double Value)>> numerators,
        List<(string Date, double Value)> denominator)
    {
        if (numerators.Count == 0 || numerators.Any(n => n.Count == 0) || denominator.Count == 0) return new();
        var maps = numerators.Select(n => n.GroupBy(x => x.Date).ToDictionary(g => g.Key, g => g.Last().Value)).ToList();
        var den = denominator.GroupBy(x => x.Date).ToDictionary(g => g.Key, g => g.Last().Value);
        var dates = den.Keys.Where(d => maps.All(m => m.ContainsKey(d))).OrderBy(d => d, StringComparer.Ordinal).ToList();
        if (dates.Count == 0) return new();
        var first = dates[0];
        return dates.Select(d => (d, maps.Average(m => m[d] / m[first]) / (den[d] / den[first]))).ToList();
    }

    public static BoardCurve? Curve(IEnumerable<MacroObservation> observations)
    {
        var tenors = new[] { ("UST2", "2 años"), ("UST5", "5 años"), ("UST10", "10 años"), ("UST30", "30 años") };
        var rows = observations.Where(o => o.Value != null && tenors.Any(t => t.Item1 == o.SeriesId)).ToList();
        var date = rows.Select(o => o.ObservationTime).Distinct().OrderByDescending(d => d, StringComparer.Ordinal)
            .FirstOrDefault(d => tenors.All(t => rows.Any(o => o.SeriesId == t.Item1 && o.ObservationTime == d)));
        if (date == null) return null;
        return new BoardCurve
        {
            Date = date,
            Points = tenors.Select(t => new BoardCurvePoint(t.Item2, (double)rows.First(o => o.SeriesId == t.Item1 && o.ObservationTime == date).Value!.Value)).ToList(),
        };
    }
}
