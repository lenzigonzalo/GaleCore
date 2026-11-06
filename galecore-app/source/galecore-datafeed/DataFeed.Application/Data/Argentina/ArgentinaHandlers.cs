using System.Globalization;
using System.Text.RegularExpressions;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers;
using DataFeed.Infrastructure.Providers.Argentina;
using MediatR;
using Microsoft.Extensions.Configuration;
using Newtonsoft.Json.Linq;

namespace DataFeed.Application.Data.Argentina
{
    /// <summary>Armado común de las respuestas argentinas (WS-0077): SourcedResponse con procedencia, sin clave en la URL.</summary>
    internal static class ArgentinaResponse
    {
        public static SourcedResponse<JToken> Build(string source, string url, ArgentinaFetch f, string asOf, List<string> notes, JToken data) => new()
        {
            Source = source,
            UpstreamUrl = url,
            RetrievedAt = f.RetrievedAt,
            FromCache = f.FromCache,
            AsOf = asOf,
            Sha256 = f.Sha256,
            Notes = notes,
            Data = data,
        };

        public static string? Str(JToken? t) => t is null || t.Type == JTokenType.Null ? null : t.Type == JTokenType.String ? (string?)t : t.ToString(Newtonsoft.Json.Formatting.None);

        public static decimal? Dec(JToken? t) => t is null || t.Type == JTokenType.Null ? null
            : t.Type is JTokenType.Float or JTokenType.Integer ? (decimal)t
            : decimal.TryParse((string?)t, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : null;

        public static T Required<T>(JToken? t, string source, string what) where T : JToken =>
            t as T ?? throw new UpstreamSourceException(source, $"la respuesta cambió de forma (falta {what})");

        /// <summary>Fecha yyyy-MM-dd opcional; vacía = null.</summary>
        public static string? Date(string? value, string name)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            if (!DateTime.TryParseExact(value.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d))
                throw new ValidationException($"{name} inválida: formato yyyy-MM-dd.");
            return d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        public static string DaysAgo(int days) => DateTime.UtcNow.AddDays(-days).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }

    // ───────────────────────── AC-1 Dólares ─────────────────────────

    public class ArgentinaDolaresRequest : IRequest<SourcedResponse<List<DolarQuote>>> { }

    /// <summary>Una cotización de DolarAPI. BrechaPct = (venta de la casa / venta del oficial − 1) × 100; sólo blue, MEP (bolsa) y CCL.</summary>
    public record DolarQuote(string Casa, string Nombre, decimal? Compra, decimal? Venta, string FechaActualizacion, decimal? BrechaPct);

    public class ArgentinaDolaresHandler : IRequestHandler<ArgentinaDolaresRequest, SourcedResponse<List<DolarQuote>>>
    {
        public const string Url = "https://dolarapi.com/v1/dolares";
        private static readonly string[] ConBrecha = { "blue", "bolsa", "contadoconliqui" };
        private readonly IHttpClientFactory _client;

        public ArgentinaDolaresHandler(IHttpClientFactory client) => _client = client;

        public async Task<SourcedResponse<List<DolarQuote>>> Handle(ArgentinaDolaresRequest request, CancellationToken cancellationToken)
        {
            var f = await new ArgentinaFetcher(_client.CreateClient()).GetAsync("dolarapi", Url, TimeSpan.FromMinutes(1), cancellationToken);
            var rows = ArgentinaResponse.Required<JArray>(f.Json, "dolarapi", "la lista de dólares");
            var quotes = rows.OfType<JObject>().Select(r => new
            {
                Casa = ArgentinaResponse.Str(r["casa"]) ?? "",
                Nombre = ArgentinaResponse.Str(r["nombre"]) ?? "",
                Compra = ArgentinaResponse.Dec(r["compra"]),
                Venta = ArgentinaResponse.Dec(r["venta"]),
                Fecha = ArgentinaResponse.Str(r["fechaActualizacion"]) ?? "",
            }).ToList();
            var oficial = quotes.FirstOrDefault(q => q.Casa == "oficial")?.Venta;
            if (oficial is null or <= 0)
                throw new UpstreamSourceException("dolarapi", "sin dólar oficial: no se puede calcular la brecha");
            var data = quotes.Select(q => new DolarQuote(q.Casa, q.Nombre, q.Compra, q.Venta, q.Fecha,
                ConBrecha.Contains(q.Casa) && q.Venta is > 0 ? Math.Round((q.Venta.Value / oficial.Value - 1m) * 100m, 2) : null)).ToList();
            return new SourcedResponse<List<DolarQuote>>
            {
                Source = "dolarapi",
                UpstreamUrl = Url,
                RetrievedAt = f.RetrievedAt,
                FromCache = f.FromCache,
                AsOf = data.Select(q => q.FechaActualizacion).Where(x => x != "").DefaultIfEmpty("").Max()!,
                Sha256 = f.Sha256,
                Notes = new()
                {
                    "BrechaPct = (venta de la casa / venta del oficial − 1) × 100, calculada en GaleCore para blue, MEP (bolsa) y CCL (contadoconliqui); el oficial no tiene brecha.",
                    "Cada cotización trae su fechaActualizacion (UTC): puede diferir entre casas.",
                    "DolarAPI es un servicio comunitario sin garantía oficial.",
                },
                Data = data,
            };
        }
    }

    // ───────────────────────── AC-2 Series de ArgentinaDatos ─────────────────────────

    public class ArgentinaSeriesRequest : IRequest<SourcedResponse<JToken>>
    {
        /// <summary>riesgo-pais | riesgo-pais-ultimo | inflacion | uva | dolar | letras | plazo-fijo.</summary>
        public string? Serie { get; set; }

        /// <summary>Sólo Serie=dolar: oficial, blue, bolsa, contadoconliqui, mayorista, cripto o tarjeta.</summary>
        public string? Casa { get; set; }

        /// <summary>Fecha inicial yyyy-MM-dd para las series históricas (riesgo-pais, inflacion, uva, dolar). Vacío = último año.</summary>
        public string? Desde { get; set; }
    }

    public class ArgentinaSeriesHandler : IRequestHandler<ArgentinaSeriesRequest, SourcedResponse<JToken>>
    {
        public const string Base = "https://api.argentinadatos.com/v1";
        private static readonly string[] Casas = { "oficial", "blue", "bolsa", "contadoconliqui", "mayorista", "cripto", "tarjeta" };
        private static readonly string[] Historicas = { "riesgo-pais", "inflacion", "uva", "dolar" };
        private readonly IHttpClientFactory _client;

        public ArgentinaSeriesHandler(IHttpClientFactory client) => _client = client;

        public async Task<SourcedResponse<JToken>> Handle(ArgentinaSeriesRequest request, CancellationToken cancellationToken)
        {
            var serie = (request.Serie ?? "").Trim().ToLowerInvariant();
            var casa = (request.Casa ?? "").Trim().ToLowerInvariant();
            var path = serie switch
            {
                "riesgo-pais" => "/finanzas/indices/riesgo-pais",
                "riesgo-pais-ultimo" => "/finanzas/indices/riesgo-pais/ultimo",
                "inflacion" => "/finanzas/indices/inflacion",
                "uva" => "/finanzas/indices/uva",
                "dolar" => Casas.Contains(casa) ? $"/cotizaciones/dolares/{casa}" : null,
                "letras" => "/finanzas/letras",
                "plazo-fijo" => "/finanzas/tasas/plazoFijo",
                _ => throw new ValidationException("Serie inválida: riesgo-pais, riesgo-pais-ultimo, inflacion, uva, dolar, letras o plazo-fijo."),
            };
            if (path is null)
                throw new ValidationException($"Casa inválida para Serie=dolar: {string.Join(", ", Casas)}.");
            var desde = ArgentinaResponse.Date(request.Desde, "Desde");

            var url = Base + path;
            var ttl = serie is "letras" or "riesgo-pais-ultimo" ? TimeSpan.FromMinutes(5) : TimeSpan.FromHours(1);
            var f = await new ArgentinaFetcher(_client.CreateClient()).GetAsync("argentinadatos", url, ttl, cancellationToken);
            var notes = new List<string> { "ArgentinaDatos es un servicio comunitario (no oficial) que republica datos oficiales." };
            JToken data = f.Json;
            var asOf = "";
            if (Historicas.Contains(serie))
            {
                var from = desde ?? ArgentinaResponse.DaysAgo(365);
                var rows = ArgentinaResponse.Required<JArray>(f.Json, "argentinadatos", "la serie");
                var kept = new JArray(rows.Where(r => string.CompareOrdinal(ArgentinaResponse.Str(r["fecha"]) ?? "", from) >= 0));
                data = kept;
                asOf = kept.Select(r => ArgentinaResponse.Str(r["fecha"]) ?? "").DefaultIfEmpty("").Max()!;
                notes.Add($"Serie desde {from} (sin Desde, el último año); la fuente trae toda la historia.");
            }
            else if (f.Json is JObject obj)
                asOf = ArgentinaResponse.Str(obj["fecha"]) ?? ArgentinaResponse.Str(obj["fechaActualizacion"]) ?? "";
            if (serie is "riesgo-pais" or "riesgo-pais-ultimo")
                notes.Add("Riesgo país en puntos básicos, al día hábil anterior.");
            if (serie == "inflacion")
                notes.Add("Inflación mensual en %, INDEC.");
            if (serie == "letras")
                notes.Add("LECAP/BONCAP: curva en pesos con TNA/TEA/TEM por letra; precios con el rezago de la fuente.");
            if (serie == "dolar")
                notes.Add($"Cotización histórica diaria de la casa «{casa}» (compra/venta en pesos).");
            return ArgentinaResponse.Build("argentinadatos", url, f, asOf, notes, data);
        }
    }

    // ───────────────────────── AC-3 BCRA ─────────────────────────

    public class BcraVariablesRequest : IRequest<SourcedResponse<JToken>>
    {
        /// <summary>Filtro opcional por texto en descripción o categoría (ej: inflación, BADLAR, reservas).</summary>
        public string? Texto { get; set; }
    }

    public class BcraVariablesHandler : IRequestHandler<BcraVariablesRequest, SourcedResponse<JToken>>
    {
        public const string Url = "https://api.bcra.gob.ar/estadisticas/v4.0/monetarias?limit=3000";
        private readonly IHttpClientFactory _client;

        public BcraVariablesHandler(IHttpClientFactory client) => _client = client;

        public async Task<SourcedResponse<JToken>> Handle(BcraVariablesRequest request, CancellationToken cancellationToken)
        {
            var f = await new ArgentinaFetcher(_client.CreateClient()).GetAsync("bcra", Url, TimeSpan.FromHours(1), cancellationToken);
            var results = ArgentinaResponse.Required<JArray>(f.Json["results"], "bcra", "results");
            var text = (request.Texto ?? "").Trim();
            var rows = results.Where(r => text == "" || (ArgentinaResponse.Str(r["descripcion"]) ?? "").Contains(text, StringComparison.OrdinalIgnoreCase)
                || (ArgentinaResponse.Str(r["categoria"]) ?? "").Contains(text, StringComparison.OrdinalIgnoreCase)).ToList();
            var asOf = rows.Select(r => ArgentinaResponse.Str(r["ultFechaInformada"]) ?? "").DefaultIfEmpty("").Max()!;
            return ArgentinaResponse.Build("bcra", Url, f, asOf, new()
            {
                "Listado de variables monetarias del BCRA (API v4.0): idVariable para pedir la serie en Data/Bcra/Series.",
                "Ids útiles: 29 = REM, mediana de inflación esperada a 12 meses (%).",
                text == "" ? "Sin filtro: todas las variables." : $"Filtrado por «{text}» en descripción o categoría.",
            }, new JArray(rows));
        }
    }

    public class BcraSeriesRequest : IRequest<SourcedResponse<JToken>>
    {
        /// <summary>Id de la variable (ver Data/Bcra/Variables). 29 = REM, mediana de inflación a 12 meses.</summary>
        public int? IdVariable { get; set; }

        /// <summary>yyyy-MM-dd. Vacío = hace un año.</summary>
        public string? Desde { get; set; }

        /// <summary>yyyy-MM-dd. Vacío = hoy.</summary>
        public string? Hasta { get; set; }
    }

    public class BcraSeriesHandler : IRequestHandler<BcraSeriesRequest, SourcedResponse<JToken>>
    {
        public const string Base = "https://api.bcra.gob.ar/estadisticas/v4.0/monetarias";
        private readonly IHttpClientFactory _client;

        public BcraSeriesHandler(IHttpClientFactory client) => _client = client;

        public async Task<SourcedResponse<JToken>> Handle(BcraSeriesRequest request, CancellationToken cancellationToken)
        {
            if (request.IdVariable is null or <= 0)
                throw new ValidationException("IdVariable inválido: id de una variable del BCRA (ver Data/Bcra/Variables).");
            var desde = ArgentinaResponse.Date(request.Desde, "Desde") ?? ArgentinaResponse.DaysAgo(365);
            var hasta = ArgentinaResponse.Date(request.Hasta, "Hasta") ?? ArgentinaResponse.DaysAgo(0);
            if (string.CompareOrdinal(desde, hasta) > 0)
                throw new ValidationException("Rango inválido: Desde <= Hasta.");
            var url = $"{Base}/{request.IdVariable}?desde={desde}&hasta={hasta}&limit=3000";
            var f = await new ArgentinaFetcher(_client.CreateClient()).GetAsync("bcra", url, TimeSpan.FromHours(1), cancellationToken);
            var results = ArgentinaResponse.Required<JArray>(f.Json["results"], "bcra", "results");
            var detalle = results.FirstOrDefault()?["detalle"] as JArray;
            if (detalle is null || detalle.Count == 0)
                throw new UpstreamSourceException("bcra", $"sin datos para la variable {request.IdVariable} entre {desde} y {hasta}");
            var sorted = new JArray(detalle.OrderBy(d => ArgentinaResponse.Str(d["fecha"]), StringComparer.Ordinal));
            var asOf = ArgentinaResponse.Str(sorted.Last?["fecha"]) ?? "";
            return ArgentinaResponse.Build("bcra", url, f, asOf, new()
            {
                "Serie de una variable monetaria del BCRA (API v4.0), ordenada por fecha ascendente.",
                "Id 29 = REM, mediana de inflación esperada a 12 meses (%), publicada una vez por mes.",
                $"Rango {desde} a {hasta} (sin Desde/Hasta, el último año).",
            }, new JObject { ["idVariable"] = request.IdVariable, ["detalle"] = sorted });
        }
    }

    public class BcraCambiariasRequest : IRequest<SourcedResponse<JToken>>
    {
        /// <summary>Código ISO de 3 letras (USD, EUR, BRL…). Vacío = todas las monedas del último día.</summary>
        public string? Moneda { get; set; }

        /// <summary>yyyy-MM-dd. Sin Moneda: el día pedido (vacío = último). Con Moneda se ignora (usar Desde/Hasta).</summary>
        public string? Fecha { get; set; }

        /// <summary>Con Moneda: yyyy-MM-dd inicial. Vacío = hace 30 días.</summary>
        public string? Desde { get; set; }

        /// <summary>Con Moneda: yyyy-MM-dd final. Vacío = hoy.</summary>
        public string? Hasta { get; set; }
    }

    public class BcraCambiariasHandler : IRequestHandler<BcraCambiariasRequest, SourcedResponse<JToken>>
    {
        public const string Base = "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones";
        private static readonly Regex Currency = new("^[A-Z]{3}$");
        private readonly IHttpClientFactory _client;

        public BcraCambiariasHandler(IHttpClientFactory client) => _client = client;

        public async Task<SourcedResponse<JToken>> Handle(BcraCambiariasRequest request, CancellationToken cancellationToken)
        {
            var moneda = (request.Moneda ?? "").Trim().ToUpperInvariant();
            if (moneda != "" && !Currency.IsMatch(moneda))
                throw new ValidationException("Moneda inválida: código ISO de 3 letras (USD, EUR…).");
            string url;
            if (moneda == "")
            {
                var fecha = ArgentinaResponse.Date(request.Fecha, "Fecha");
                url = fecha is null ? Base : $"{Base}?fecha={fecha}";
            }
            else
            {
                var desde = ArgentinaResponse.Date(request.Desde, "Desde") ?? ArgentinaResponse.DaysAgo(30);
                var hasta = ArgentinaResponse.Date(request.Hasta, "Hasta") ?? ArgentinaResponse.DaysAgo(0);
                if (string.CompareOrdinal(desde, hasta) > 0)
                    throw new ValidationException("Rango inválido: Desde <= Hasta.");
                url = $"{Base}/{moneda}?fechadesde={desde}&fechahasta={hasta}&limit=1000";
            }
            var f = await new ArgentinaFetcher(_client.CreateClient()).GetAsync("bcra-cambiarias", url, TimeSpan.FromHours(1), cancellationToken);
            var results = f.Json["results"] ?? throw new UpstreamSourceException("bcra-cambiarias", "la respuesta cambió de forma (falta results)");
            string asOf;
            if (moneda == "")
                asOf = ArgentinaResponse.Str(results["fecha"]) ?? "";
            else
            {
                var list = ArgentinaResponse.Required<JArray>(results, "bcra-cambiarias", "results");
                if (list.Count == 0)
                    throw new UpstreamSourceException("bcra-cambiarias", $"sin cotizaciones de {moneda} en el rango pedido");
                asOf = list.Select(r => ArgentinaResponse.Str(r["fecha"]) ?? "").Max()!;
            }
            return ArgentinaResponse.Build("bcra-cambiarias", url, f, asOf, new()
            {
                "Cotizaciones cambiarias oficiales del BCRA (estadisticascambiarias v1.0). tipoCotizacion = pesos por unidad de moneda; la de USD es la Comunicación A3500; tipoPase = paridad contra el dólar.",
                "Una cotización por día hábil; no hay dato de fines de semana ni feriados.",
            }, results);
        }
    }

    // ───────────────────────── AC-4 INDEC ─────────────────────────

    public class IndecSeriesRequest : IRequest<SourcedResponse<JToken>>
    {
        /// <summary>Ids de series de datos.gob.ar separados por coma (ej: 148.3_INIVELNAL_DICI_M_26 = IPC nivel general nacional).</summary>
        public string? Ids { get; set; }

        /// <summary>Últimos N valores por serie. Vacío = 12 (máximo 1000).</summary>
        public int? Last { get; set; }
    }

    public class IndecSeriesHandler : IRequestHandler<IndecSeriesRequest, SourcedResponse<JToken>>
    {
        public const string Base = "https://apis.datos.gob.ar/series/api/series/";
        private const int MaxIds = 10;
        private static readonly Regex SeriesId = new(@"^[A-Za-z0-9_.\-]{3,80}$");
        private readonly IHttpClientFactory _client;

        public IndecSeriesHandler(IHttpClientFactory client) => _client = client;

        public async Task<SourcedResponse<JToken>> Handle(IndecSeriesRequest request, CancellationToken cancellationToken)
        {
            var ids = (request.Ids ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct().ToList();
            if (ids.Count == 0 || ids.Count > MaxIds || ids.Any(i => !SeriesId.IsMatch(i)))
                throw new ValidationException($"Ids inválidos: entre 1 y {MaxIds} ids de series de datos.gob.ar separados por coma.");
            var last = request.Last ?? 12;
            if (last is < 1 or > 1000)
                throw new ValidationException("Last inválido: entre 1 y 1000.");
            var url = $"{Base}?ids={string.Join(",", ids)}&last={last}&format=json";
            var f = await new ArgentinaFetcher(_client.CreateClient()).GetAsync("indec", url, TimeSpan.FromHours(6), cancellationToken);
            var obj = ArgentinaResponse.Required<JObject>(f.Json, "indec", "el objeto de la serie");
            if (obj["errors"] is not null)
                throw new UpstreamSourceException("indec", $"rechazó el pedido: {obj["errors"]!.ToString(Newtonsoft.Json.Formatting.None)}");
            var rows = ArgentinaResponse.Required<JArray>(obj["data"], "indec", "data");
            if (rows.Count == 0)
                throw new UpstreamSourceException("indec", "sin datos para las series pedidas");
            var fields = new JArray();
            if (obj["meta"] is JArray meta)
                foreach (var m in meta.Skip(1))
                    fields.Add(new JObject
                    {
                        ["id"] = m["field"]?["id"],
                        ["description"] = m["field"]?["description"],
                        ["units"] = m["field"]?["units"],
                        ["dataset"] = m["dataset"]?["title"],
                        ["source"] = m["dataset"]?["source"],
                    });
            var asOf = rows.Select(r => ArgentinaResponse.Str(r.First) ?? "").Max()!;
            return ArgentinaResponse.Build("indec", url, f, asOf, new()
            {
                "Series de tiempo de datos.gob.ar (INDEC y otras fuentes oficiales). data: filas [fecha, valor de cada serie en el orden de fields]; null = sin dato (aún no publicado).",
                $"Últimos {last} valores por serie. Para el IPC mensual: 148.3_INIVELNAL_DICI_M_26 (nivel general nacional, base dic-2016).",
            }, new JObject { ["fields"] = fields, ["data"] = rows });
        }
    }

    // ───────────────────────── AC-5 BYMA ─────────────────────────

    public class ByMaPanelRequest : IRequest<SourcedResponse<List<ByMaItem>>>
    {
        /// <summary>public-bonds | lebacs | negociable-obligations | cedears | leading-equity | options | index-price.</summary>
        public string? Panel { get; set; }

        /// <summary>CI (contado inmediato) o 24hs. Vacío = 24hs. Ignorado en index-price.</summary>
        public string? Plazo { get; set; }
    }

    /// <summary>Forma común de un instrumento de BYMA. ChangePct = último / cierre anterior − 1 (null sin operaciones).</summary>
    public record ByMaItem(string Symbol, string? Description, decimal? Last, decimal? ChangePct, decimal? Volume, decimal? Amount,
        decimal? Bid, decimal? Ask, string? Plazo, string? Maturity, int? DaysToMaturity, string? Currency, string? Time,
        decimal? Open, decimal? High, decimal? Low, decimal? PrevClose, string? Underlying, string? OptionType);

    public class ByMaPanelHandler : IRequestHandler<ByMaPanelRequest, SourcedResponse<List<ByMaItem>>>
    {
        public const string Base = "https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free/";
        private const int MaxPages = 10;
        private static readonly string[] Panels = { "public-bonds", "lebacs", "negociable-obligations", "cedears", "leading-equity", "options", "index-price" };
        private readonly IHttpClientFactory _client;

        public ByMaPanelHandler(IHttpClientFactory client) => _client = client;

        public async Task<SourcedResponse<List<ByMaItem>>> Handle(ByMaPanelRequest request, CancellationToken cancellationToken)
        {
            var panel = (request.Panel ?? "").Trim().ToLowerInvariant();
            if (!Panels.Contains(panel))
                throw new ValidationException($"Panel inválido: {string.Join(", ", Panels)}.");
            var plazo = (request.Plazo ?? "24hs").Trim().ToLowerInvariant();
            if (plazo is not ("ci" or "24hs"))
                throw new ValidationException("Plazo inválido: CI o 24hs.");
            var url = Base + panel;
            var fetcher = new ArgentinaFetcher(_client.CreateClient());
            string Body(int page)
            {
                var b = panel == "index-price"
                    ? new JObject()
                    : new JObject { ["excludeZeroPxAndQty"] = false, ["T2"] = false, ["T1"] = plazo == "24hs", ["T0"] = plazo == "ci" };
                if (page > 1) b["page_number"] = page;
                return b.ToString(Newtonsoft.Json.Formatting.None);
            }

            var first = await fetcher.GetAsync("byma", url, TimeSpan.FromMinutes(2), cancellationToken, postBody: Body(1));
            var items = new List<JToken>();
            var sha = first.Sha256;
            var fromCache = first.FromCache;
            var pageCount = 1;
            if (first.Json is JArray direct)
                items.AddRange(direct);
            else
            {
                pageCount = (int?)first.Json["content"]?["page_count"] ?? 1;
                items.AddRange(ArgentinaResponse.Required<JArray>(first.Json["data"], "byma", "data"));
                for (var page = 2; page <= Math.Min(pageCount, MaxPages); page++)
                {
                    var next = await fetcher.GetAsync("byma", url, TimeSpan.FromMinutes(2), cancellationToken, postBody: Body(page));
                    items.AddRange(ArgentinaResponse.Required<JArray>(next.Json["data"], "byma", "data"));
                    sha += next.Sha256;
                    fromCache &= next.FromCache;
                }
            }
            var data = items.OfType<JObject>().Select(i => Normalize(i, panel == "index-price" ? "" : plazo)).ToList();
            var hours = data.Select(d => d.Time).Where(t => !string.IsNullOrEmpty(t)).ToList();
            var notes = new List<string>
            {
                "BYMA open data: sin documentación oficial ni garantías (puede cambiar sin aviso); precios con unos 20 minutos de demora; horas de Buenos Aires.",
                panel == "index-price" ? "index-price no distingue plazo." : $"Plazo {(plazo == "ci" ? "CI" : "24hs")}.",
                "ChangePct = último / cierre anterior − 1 (en %); Last y ChangePct null cuando el instrumento no operó.",
                "Volume = nominales operados; Amount = monto operado en la moneda del instrumento.",
            };
            if (pageCount > MaxPages)
                notes.Add($"El panel tiene {pageCount} páginas; se leyeron las primeras {MaxPages} (tope).");
            return new SourcedResponse<List<ByMaItem>>
            {
                Source = "byma",
                UpstreamUrl = url,
                RetrievedAt = first.RetrievedAt,
                FromCache = fromCache,
                AsOf = hours.Count == 0 ? "" : hours.Max()!,
                Sha256 = pageCount > 1 ? "sha256:" + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(sha))).ToLowerInvariant() : sha,
                Notes = notes,
                Data = data,
            };
        }

        public static ByMaItem Normalize(JObject i, string requestedPlazo)
        {
            decimal? D(string k) => ArgentinaResponse.Dec(i[k]);
            decimal? NonZero(string k) => D(k) is > 0 ? D(k) : null;
            var last = NonZero("trade") ?? NonZero("price");
            var prev = NonZero("previousClosingPrice");
            var plazo = ArgentinaResponse.Str(i["settlementType"]) switch
            {
                "1" => "CI",
                "2" => "24hs",
                "3" => "48hs",
                _ => requestedPlazo == "" ? null : requestedPlazo,
            };
            return new ByMaItem(
                ArgentinaResponse.Str(i["symbol"]) ?? "",
                NullIfEmpty(ArgentinaResponse.Str(i["description"])) ?? NullIfEmpty(ArgentinaResponse.Str(i["securityDesc"])),
                last,
                last is not null && prev is not null ? Math.Round((last.Value / prev.Value - 1m) * 100m, 2) : null,
                D("volume") ?? D("tradeVolume"), D("volumeAmount"),
                NonZero("bidPrice"), NonZero("offerPrice"),
                plazo, ArgentinaResponse.Str(i["maturityDate"]), (int?)i["daysToMaturity"], ArgentinaResponse.Str(i["denominationCcy"]),
                ArgentinaResponse.Str(i["tradeHour"]) ?? ArgentinaResponse.Str(i["date"]),
                NonZero("openingPrice"), NonZero("tradingHighPrice") ?? NonZero("highestPrice"), NonZero("tradingLowPrice") ?? NonZero("lowestPrice"),
                prev, ArgentinaResponse.Str(i["underlyingSymbol"]), ArgentinaResponse.Str(i["optionType"]));
        }

        private static string? NullIfEmpty(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;
    }

    // ───────────────────────── AC-6 A3 / MAE ─────────────────────────

    public class A3CotizacionesRequest : IRequest<SourcedResponse<JToken>>
    {
        /// <summary>rentafija | forex | cauciones | repo | derivados.</summary>
        public string? Segmento { get; set; }
    }

    public class A3CotizacionesHandler : IRequestHandler<A3CotizacionesRequest, SourcedResponse<JToken>>
    {
        public const string Base = "https://api.mae.com.ar/MarketData/v1/mercado/cotizaciones/";
        private static readonly string[] Segmentos = { "rentafija", "forex", "cauciones", "repo", "derivados" };
        private readonly IConfiguration _config;
        private readonly IHttpClientFactory _client;

        public A3CotizacionesHandler(IConfiguration config, IHttpClientFactory client)
        {
            _config = config;
            _client = client;
        }

        public async Task<SourcedResponse<JToken>> Handle(A3CotizacionesRequest request, CancellationToken cancellationToken)
        {
            var segmento = (request.Segmento ?? "").Trim().ToLowerInvariant();
            if (!Segmentos.Contains(segmento))
                throw new ValidationException($"Segmento inválido: {string.Join(", ", Segmentos)}.");
            var key = _config["A3:ApiKey"];
            if (string.IsNullOrWhiteSpace(key))
                key = _config["A3_API_KEY"];
            if (string.IsNullOrWhiteSpace(key))
                throw new UpstreamSourceException("a3", "falta la clave: configurá A3:ApiKey o la variable de entorno A3_API_KEY");
            var url = Base + segmento;
            var f = await new ArgentinaFetcher(_client.CreateClient()).GetAsync("a3", url, TimeSpan.FromMinutes(1), cancellationToken, apiKey: key);
            var rows = ArgentinaResponse.Required<JArray>(f.Json, "a3", "la lista de cotizaciones");
            var asOf = rows.Select(r => ArgentinaResponse.Str(r["fecha"]) ?? "").DefaultIfEmpty("").Max()!;
            var notes = new List<string>
            {
                "A3/MAE (Mercado Abierto Electrónico), cotizaciones del segmento tal como las publica la fuente; requiere clave.",
                "Fuera de la rueda o sin operaciones la lista puede venir vacía o con los valores del último día.",
            };
            if (rows.Count == 0)
                notes.Add($"El segmento {segmento} vino vacío (con la clave actual no trae datos).");
            return ArgentinaResponse.Build("a3", url, f, asOf, notes, rows);
        }
    }

    // ───────────────────────── WS-0090 Futuros de A3 (web pública) ─────────────────────────

    public class A3FuturosRequest : IRequest<SourcedResponse<A3Futuros>> { }

    /// <summary>Referencias del dólar: A3500 (Com. A3500 del BCRA) y MTR (Matba Rofex), cada una con la fecha del día hábil que informa.</summary>
    public record A3Referencia(decimal? A3500, string? A3500Fecha, decimal? Mtr, string? MtrFecha);

    /// <summary>Un futuro de A3. Ceros de la fuente = null. Vencimiento, Dias y las tasas sólo en DLR/&lt;MES&gt;&lt;AA&gt; con cálculo posible.</summary>
    public record A3Futuro(string Ticker, decimal? Compra, decimal? Venta, decimal? Ultimo, decimal? Ajuste, decimal? AjusteAnterior,
        decimal? Contratos, decimal? InteresAbierto, decimal? VariacionPct,
        string? Vencimiento = null, int? Dias = null, decimal? DevaluacionPct = null, decimal? TnaPct = null, decimal? TeaPct = null);

    public record A3Futuros(A3Referencia Referencia, List<A3Futuro> Dolar, List<A3Futuro> Agro);

    public class A3FuturosHandler : IRequestHandler<A3FuturosRequest, SourcedResponse<A3Futuros>>
    {
        public const string StreamUrl = "https://a3mercados.com.ar/api/market-data/stream?streams=dollar";
        public const string RefsUrl = "https://a3mercados.com.ar/api/market-data/dollar-refs";
        private const string Source = "a3-web";
        private static readonly string[] Meses = { "ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC" };
        private static readonly Regex Curva = new(@"^DLR/([A-Z]{3})(\d{2})$", RegexOptions.Compiled);
        private readonly IHttpClientFactory _client;
        private readonly TimeProvider _clock;
        private readonly TimeSpan? _timeout;

        public A3FuturosHandler(IHttpClientFactory client, TimeProvider? clock = null, TimeSpan? timeout = null)
        {
            _client = client;
            _clock = clock ?? TimeProvider.System;
            _timeout = timeout;
        }

        public async Task<SourcedResponse<A3Futuros>> Handle(A3FuturosRequest request, CancellationToken cancellationToken)
        {
            var fetcher = new ArgentinaFetcher(_client.CreateClient());
            var f = await fetcher.GetSseSnapshotAsync(Source, StreamUrl, TimeSpan.FromMinutes(1), cancellationToken, "snapshot", _timeout);
            var data = f.Json["data"] as JObject;
            var dollar = data?["dollar"] as JArray
                ?? throw new UpstreamSourceException(Source, "la respuesta cambió de forma (falta data.dollar)");
            var agro = data["agro"] as JArray ?? new JArray();

            var notes = new List<string>
            {
                "Web pública de A3 (a3mercados.com.ar), no es una API documentada: puede cambiar sin aviso.",
                "Ceros de la fuente = sin dato (null). DLR/PF0 es un pase, no un vencimiento: queda sin cálculo.",
                "Devaluación implícita = precio / A3500 − 1; TNA = devaluación × 365 / días; TEA = (1 + devaluación)^(365 / días) − 1. Precio = ajuste si > 0, si no último; sin ninguno, sin cálculo.",
                "Vencimiento = último día hábil del mes (lunes a viernes): no descuenta feriados. Días = vencimiento − hoy (hora Argentina); con días ≤ 0 no se calcula.",
                "Las referencias A3500 y MTR son del día hábil de su fecha (a3500Fecha / mtrFecha), no de hoy.",
            };

            A3Referencia refs = new(null, null, null, null);
            try
            {
                var r = await fetcher.GetAsync(Source, RefsUrl, TimeSpan.FromMinutes(1), cancellationToken);
                refs = new A3Referencia(
                    ArgentinaResponse.Dec(r.Json["bcra"]?["value"]), ArgentinaResponse.Str(r.Json["bcra"]?["date"]),
                    ArgentinaResponse.Dec(r.Json["matba"]?["value"]), ArgentinaResponse.Str(r.Json["matba"]?["date"]));
            }
            catch (UpstreamSourceException ex)
            {
                notes.Add($"No se pudo leer el A3500 ({ex.Message}): los futuros van sin devaluación implícita ni tasas.");
            }
            if (refs.A3500 is not > 0 && notes.All(n => !n.StartsWith("No se pudo leer el A3500")))
                notes.Add("La referencia A3500 vino sin valor: los futuros van sin devaluación implícita ni tasas.");

            var hoy = _clock.GetUtcNow().UtcDateTime.AddHours(-3).Date;
            var dolar = dollar.OfType<JObject>().Select(r => Calcular(Fila(r), refs.A3500, hoy)).ToList();
            var agroRows = agro.OfType<JObject>().Select(Fila).ToList();
            return new SourcedResponse<A3Futuros>
            {
                Source = Source,
                UpstreamUrl = StreamUrl,
                RetrievedAt = f.RetrievedAt,
                FromCache = f.FromCache,
                AsOf = f.RetrievedAt.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture),
                Sha256 = f.Sha256,
                Notes = notes,
                Data = new A3Futuros(refs, dolar, agroRows),
            };
        }

        private static A3Futuro Fila(JObject r)
        {
            decimal? Nz(string k) => ArgentinaResponse.Dec(r[k]) is { } v && v != 0 ? v : null;
            return new A3Futuro(ArgentinaResponse.Str(r["ticker"]) ?? "", Nz("bi"), Nz("of"), Nz("la"), Nz("se"), Nz("pse"), Nz("tv"), Nz("oi"), Nz("variation"));
        }

        private static A3Futuro Calcular(A3Futuro row, decimal? a3500, DateTime hoy)
        {
            var m = Curva.Match(row.Ticker);
            if (!m.Success || a3500 is not > 0) return row;
            var mes = Array.IndexOf(Meses, m.Groups[1].Value) + 1;
            if (mes == 0) return row;
            var precio = row.Ajuste is > 0 ? row.Ajuste : row.Ultimo;
            if (precio is not > 0) return row;
            var venc = new DateTime(2000 + int.Parse(m.Groups[2].Value), mes, DateTime.DaysInMonth(2000 + int.Parse(m.Groups[2].Value), mes));
            while (venc.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday) venc = venc.AddDays(-1);
            var dias = (venc - hoy).Days;
            if (dias <= 0) return row;
            var dev = precio.Value / a3500.Value - 1m;
            var tea = Math.Pow(1d + (double)dev, 365d / dias) - 1d;
            return row with
            {
                Vencimiento = venc.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                Dias = dias,
                DevaluacionPct = Math.Round(dev * 100m, 2),
                TnaPct = Math.Round(dev * 365m / dias * 100m, 2),
                TeaPct = Math.Round((decimal)tea * 100m, 2),
            };
        }
    }
}
