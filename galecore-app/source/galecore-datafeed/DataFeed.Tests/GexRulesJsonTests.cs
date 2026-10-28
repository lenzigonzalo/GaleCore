using System;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using Xunit;

namespace DataFeed.Tests;

/// <summary>
/// Congela los invariantes de galecore_rules_gex.json (estrategia GEX, informativa).
///
/// El JSON no es documentacion: GexAnalysisHandler lee `gex.*` para configurar el barrido de la
/// cadena, y CascadeUtils.EvaluateLayer1 lee `macro_regime.checks[].threshold` +
/// `definitions.gex_threshold_by_symbol` + `definitions.zgl_with_buffer` para armar los 6 checks
/// del cuadro Details. Un path que se renombre o se caiga no rompe el build: falla en runtime con
/// el valor por defecto, en silencio. Estos tests son la red.
/// </summary>
public class GexRulesJsonTests
{
    private static string FilesDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, "DataFeed.Api", "Files");
            if (Directory.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        throw new DirectoryNotFoundException("No se encontro DataFeed.Api/Files subiendo desde " + AppContext.BaseDirectory);
    }

    // GEX vive en su subcarpeta, por la regla "archivos por estrategia en Files/<Prefix>/".
    private static JsonObject Gex()
        => JsonNode.Parse(File.ReadAllText(Path.Combine(FilesDir(), "Gex", "galecore_rules_gex.json")))!.AsObject();

    [Fact]
    public void Gex_EsInformativa_YNoHabilitaOperar()
    {
        var meta = Gex()["_meta"]!.AsObject();
        Assert.Equal("gex_gamma_exposure", (string?)meta["strategy"]);
        Assert.Equal("informational", (string?)meta["status"]);
        Assert.False((bool)meta["enabled_for_live"]!);

        // Ninguna estructura permitida: la estrategia no propone operaciones.
        Assert.Empty(Gex()["strategy_scope"]!["allowed_strategies"]!.AsArray());
    }

    /// <summary>
    /// El universo es una lista que el operador edita seguido (arranco SPY+QQQ y ya sumo AAPL y SKM),
    /// asi que congelar los simbolos exactos solo genera un test rojo cada vez que cambia de idea.
    /// Lo que si tiene que valer siempre: que sea usable por el pipeline.
    /// </summary>
    [Fact]
    public void Universo_EsUnaWhitelistUsable()
    {
        var tickers = Gex()["universe"]!["tickers"]!.AsArray()
            .Select(t => (string?)t).ToArray();

        Assert.NotEmpty(tickers);

        // SPY es el simbolo de referencia de la estrategia: si desaparece, algo se rompio.
        Assert.Contains("SPY", tickers);

        foreach (var t in tickers)
        {
            Assert.False(string.IsNullOrWhiteSpace(t), "Hay un ticker vacio en universe.tickers.");

            // GexAnalysisHandler normaliza con ToUpperInvariant y cachea por esa clave; el front, en
            // cambio, usa el string del JSON tal cual para las cards y el market store. Un ticker en
            // minuscula desincroniza las dos puntas.
            Assert.Equal(t!.ToUpperInvariant(), t);
        }

        // Un duplicado son dos cards iguales y dos barridos de la misma cadena, serializados.
        Assert.Equal(tickers.Length, tickers.Distinct().Count());
    }

    /// <summary>
    /// El buscador de simbolos de la pestania. Lo que se congela no son los valores —el operador
    /// puede subir max_results cuando quiera— sino que existan las palancas que el front LEE: la
    /// que falte cae al default hardcodeado y esa parte de la pantalla deja de responder al JSON.
    ///
    /// Las dos que si tienen su valor congelado llevan una decision adentro, no una preferencia.
    /// </summary>
    [Fact]
    public void AdHocSearch_DeclaraLasPalancasQueElFrontLee()
    {
        var search = Gex()["universe"]!["ad_hoc_search"]!.AsObject();

        Assert.True(search.ContainsKey("enabled"), "Sin enabled el buscador no se puede apagar desde el JSON.");
        Assert.True(search.ContainsKey("min_query_length"), "Falta min_query_length: cada tecla pegaria a la API.");
        Assert.True(search.ContainsKey("max_results"), "Falta max_results: el dropdown no tendria tope.");

        // max_pinned es un limite REAL y no decoracion: el front guarda una lista y la recorta a
        // este numero. Si guardara un solo string, subirlo aca no cambiaria nada y el JSON estaria
        // declarando algo que nadie honra.
        Assert.True((int)search["max_pinned"]! >= 1, "max_pinned < 1 deja el buscador sin poder pinear nada.");

        // El simbolo ad-hoc no entra al intervalo del universo. No es una preferencia de UI: los
        // barridos se serializan en un semaforo global (GexAnalysisHandler) y recorrer el universo
        // ya toma ~383s medidos, asi que un simbolo que se refresca solo entra a esa misma ronda.
        Assert.False((bool)search["auto_refresh"]!, "auto_refresh true mete el simbolo ad-hoc en la ronda del barrido.");

        // Lo que el front le pasa a InstrumentTypes del endpoint de busqueda. Vacio traeria futuros,
        // cripto y contratos de opcion sueltos, que no se pueden barrer. Equity incluye ETFs.
        var types = search["allowed_instrument_types"]!.AsArray()
            .Select(t => (string?)t).ToArray();

        Assert.NotEmpty(types);
        Assert.Contains("Equity", types);
    }

    /// <summary>
    /// Contrato con GexAnalysisHandler.ReadScanConfig: si alguno de estos paths desaparece, el
    /// handler cae a sus defaults y el barrido deja de responder al JSON sin que nadie se entere.
    /// </summary>
    [Fact]
    public void NodoGex_DeclaraElAlcanceDelBarrido()
    {
        var gex = Gex()["gex"]!.AsObject();

        // Estado por defecto del switch de la estrategia (AppController lo lee para decidir si el
        // barrido esta habilitado cuando el operador todavia no toco el switch).
        Assert.True(gex.ContainsKey("enabled"), "Falta gex.enabled: el switch no tendria default.");

        Assert.True((int)gex["max_dte"]! > 0);
        Assert.True((bool)gex["include_zero_dte"]!, "La estrategia GEX debe incluir 0DTE.");

        var types = gex["expiration_types"]!.AsArray().Select(t => (string?)t).ToArray();
        Assert.Contains("Regular", types);
        Assert.Contains("Weekly", types);

        var band = gex["oi_delta_band"]!.AsArray();
        Assert.Equal(2, band.Count);
        Assert.True((double)band[0]! < (double)band[1]!);

        Assert.True((int)gex["greeks_batch_size"]! > 0, "Sin batching, la cadena completa hace timeout en DXLink.");
        Assert.True((int)gex["cache_seconds"]! > 0);

        // Sin reintentos, un lote que agota el timeout deja vencimientos enteros sin Greeks y el
        // netGEX global cambia entre corridas (medido 2026-08-05: 271B/12 vtos vs 696B/16 vtos).
        Assert.True((int)gex["greeks_retries"]! > 0, "El barrido global necesita reintentos para ser determinista.");

        // Un barrido incompleto no debe quedar cacheado: el tablero mostraria un GEX al que le
        // faltan vencimientos como si fuera el numero real.
        double minCov = (double)gex["cache_min_coverage_pct"]!;
        Assert.InRange(minCov, 90, 100);

        // El cache tiene que durar mas que un barrido (100-250s medidos), o cada refresco arranca
        // uno nuevo encima del anterior.
        Assert.True((int)gex["cache_seconds"]! >= 300);
    }

    /// <summary>
    /// Contrato con CascadeUtils.EvaluateLayer1: los 6 checks que renderiza el cuadro
    /// Details y los dos nodos de definitions de los que salen sus umbrales.
    /// </summary>
    [Fact]
    public void MacroRegime_TieneLos6ChecksQueLeeElHandler()
    {
        var rules = Gex();
        var ids = rules["macro_regime"]!["checks"]!.AsArray()
            .Select(c => (string?)c!["id"]).ToArray();

        foreach (var id in new[] { "vix_absolute", "vix_term_structure", "iv_rank", "iv_momentum", "gex_total", "spot_vs_zgl" })
            Assert.Contains(id, ids);

        var checks = rules["macro_regime"]!["checks"]!.AsArray();
        JsonNode Check(string id) => checks.First(c => (string?)c!["id"] == id)!;

        Assert.True((double)Check("vix_absolute")["threshold"]!["value"]! > 0);
        Assert.True((double)Check("iv_rank")["threshold"]!["min"]! < (double)Check("iv_rank")["threshold"]!["max"]!);
        Assert.True((double)Check("iv_momentum")["threshold"]!["value"]! > 0);

        var defs = rules["definitions"]!.AsObject();
        var gexThresholds = defs["gex_threshold_by_symbol"]!["values"]!.AsObject();
        Assert.True(gexThresholds.ContainsKey("SPY"));
        Assert.True((double)defs["zgl_with_buffer"]!["buffer_pct"]! > 0);
    }

    /// <summary>
    /// El umbral por simbolo es lo que decide QUE simbolos se evaluan: el que no lo declara se
    /// muestra apagado ("sin umbral") en vez de reprobado. Un umbral declarado para un simbolo que
    /// no esta en el universo es letra muerta — nadie lo va a leer nunca — y suele ser el rastro de
    /// un ticker que se saco del universo y quedo a medio limpiar.
    /// </summary>
    [Fact]
    public void UmbralesDeGex_CorrespondenASimbolosDelUniverso()
    {
        var rules = Gex();
        var universe = rules["universe"]!["tickers"]!.AsArray()
            .Select(t => (string?)t).ToArray();
        var thresholds = rules["definitions"]!["gex_threshold_by_symbol"]!["values"]!.AsObject();

        foreach (var kv in thresholds)
            Assert.Contains(kv.Key, universe);
    }

    /// <summary>
    /// El umbral de gex_total es el SIGNO (0), no un piso en billones, y eso no es un detalle de
    /// calibracion: el GEX de esta estrategia agrega TODA la cadena, asi que es mayor en magnitud
    /// que el de un solo vencimiento y cualquier piso en billones queda descalibrado. Es lo que dice
    /// el _note del nodo desde el principio.
    ///
    /// Hasta el 2026-08-18 los valores eran SPY 200 y QQQ 50 —contradiciendo a su propia nota— y
    /// nadie lo veia: el cuadro Details pintaba el check en rojo con una cruz, y un check reprobado
    /// mas no llama la atencion. Aparecio recien al sacar el semaforo y mostrar la referencia en
    /// texto: "ref >= $200B" al lado de un valor de -$951B se lee solo.
    /// </summary>
    [Fact]
    public void UmbralDeGex_EsElSigno_NoUnPisoEnBillones()
    {
        var thresholds = Gex()["definitions"]!["gex_threshold_by_symbol"]!["values"]!.AsObject();

        Assert.NotEmpty(thresholds);
        foreach (var kv in thresholds)
            Assert.Equal(0d, (double)kv.Value!);
    }

    /// <summary>
    /// El Diagnostico de mercado interpreta el z-score con estos dos umbrales, que el handler busca
    /// en position_builder.layers[id=2].config.structure_selection.thresholds (via GetPositionBuilderLayer).
    /// </summary>
    [Fact]
    public void Layer2_DeclaraLosUmbralesDelZScore()
    {
        var layer2 = Gex()["position_builder"]!["layers"]!.AsArray()
            .First(l => (int?)l!["id"] == 2)!;
        var thresholds = layer2["config"]!["structure_selection"]!["thresholds"]!;

        double neutral = (double)thresholds["neutral_z"]!;
        double extreme = (double)thresholds["extreme_z"]!;
        Assert.True(neutral > 0 && extreme > neutral);
    }

    /// <summary>
    /// La pestana GEX renderiza lo que declara display_config.gex_tab: sin este nodo el frontend
    /// se queda sin contrato (velas 1h x100, sin microstructure, sin setup candidato).
    /// </summary>
    [Fact]
    public void DisplayConfig_DeclaraElContratoDeLaPestana()
    {
        var tab = Gex()["display_config"]!["gex_tab"]!.AsObject();

        // El auto-refresh no puede ser mas corto que el cache del backend: pediria de nuevo mientras
        // el barrido anterior sigue corriendo.
        var gexNode = Gex()["gex"]!;
        Assert.True((int)tab["refresh_seconds"]! >= (int)gexNode["cache_seconds"]!);
        Assert.Equal("1h", (string?)tab["candles"]!["interval"]);
        Assert.Equal(100, (int)tab["candles"]!["count"]!);

        var details = tab["details_panel"]!.AsObject();
        Assert.False((bool)details["microstructure"]!, "Microstructure se elimino del cuadro Details de GEX.");
        Assert.Equal("global", (string?)details["gex_scope"]);

        // El split en dos columnas por componente se reemplazo por grupos tematicos. Ver
        // DetailsPanel_AgrupaPorPreguntaYSeparaLoQueEsDelMercado.
        Assert.False(details.ContainsKey("columns"),
            "details_panel ya no declara columnas por componente: declara groups.");

        var hidden = tab["hidden_blocks"]!.AsArray().Select(h => (string?)h).ToArray();
        Assert.Contains("setup_candidato", hidden);

        // El Expiry Engine es el Strike Engine sin las filas de estructura.
        var rowIds = tab["expiry_engine"]!["rows"]!.AsArray().Select(r => (string?)r!["id"]).ToArray();
        foreach (var id in new[] { "zgl", "call_wall", "put_wall", "expected_move" })
            Assert.Contains(id, rowIds);
        foreach (var forbidden in new[] { "structure", "short_put", "short_call", "strikes_inside_walls" })
            Assert.DoesNotContain(forbidden, rowIds);
    }

    /// <summary>
    /// El boton de la mira encuadra el eje de precio del grafico en la zona gamma, y QUE niveles lo
    /// definen es del JSON: son las mismas tres referencias que el grafico ya dibuja de ese lado.
    /// El front las lee con optional chaining y defaults propios, asi que un nodo caido no rompe el
    /// build — encuadra con un criterio que nadie configuro.
    /// </summary>
    [Fact]
    public void ChartScale_DeclaraLasAnclasDelEncuadre()
    {
        var scale = Gex()["display_config"]!["gex_tab"]!["chart_scale"]!.AsObject();

        // El aire a cada lado se mide en PROPORCION del marco, no en strikes ni en puntos: dos
        // strikes son el 17% del alto en un 0DTE y el 3% a 42 dias, o sea la misma regla vista
        // enorme de un lado y nula del otro.
        Assert.Equal(0.06, (double)scale["padding_pct"]!, 4);
        Assert.False(scale.ContainsKey("padding_strikes"),
            "El aire dejo de medirse en strikes: se declara padding_pct.");

        var arriba = scale["upper_anchors"]!.AsArray().Select(a => (string?)a).ToArray();
        var abajo = scale["lower_anchors"]!.AsArray().Select(a => (string?)a).ToArray();
        foreach (var id in new[] { "expected_move_1sigma", "call_wall", "call_band_high" })
            Assert.Contains(id, arriba);
        foreach (var id in new[] { "expected_move_1sigma", "put_wall", "put_band_low" })
            Assert.Contains(id, abajo);

        // Cada lista mira SU lado de la cadena: un ancla cruzada encuadraria del lado equivocado.
        Assert.DoesNotContain("put_wall", arriba);
        Assert.DoesNotContain("put_band_low", arriba);
        Assert.DoesNotContain("call_wall", abajo);
        Assert.DoesNotContain("call_band_high", abajo);
    }

    /// <summary>
    /// El muro y la banda se reparten el trabajo, y el reparto es el invariante:
    /// <list type="bullet">
    /// <item><b>El muro es el nivel con nombre y valor</b> — tiene fila en el Expiry Engine y
    /// etiqueta en el gráfico. Contesta "qué número".</item>
    /// <item><b>La banda es solo sombreado</b> — sin fila y sin etiqueta, en ningún lado. Contesta
    /// "qué tan ancha es la concentración alrededor", que es una lectura de forma y no de
    /// número.</item>
    /// </list>
    ///
    /// Son dos objetos sobre el mismo eje de precio, así que ponerlos los dos como texto duplica la
    /// lectura. Este test congela que la banda no se cuele como fila.
    /// </summary>
    [Fact]
    public void WallBand_EsSombreadoYNoFila()
    {
        var wb = Gex()["gex"]!["wall_band"]!.AsObject();

        // Los dos parámetros son la fuente de verdad del sombreado; GammaExposureBandTests congela
        // que los defaults del handler coincidan con estos valores.
        Assert.Equal(0.25, (double?)wb["width_em"]);
        Assert.Equal(0.15, (double?)wb["money_zone_em"]);

        // La zona del dinero excluida no es opcional: sin ella la ventana más densa puede SER la
        // pila de gamma del dinero (QQQ 18-Sep: argmax 710 con el spot en 708.02).
        Assert.True((double?)wb["money_zone_em"] > 0,
            "sin excluir la zona del dinero, la ventana más densa puede ser la pila del dinero.");

        var engine = Gex()["display_config"]!["gex_tab"]!["expiry_engine"]!.AsObject();
        foreach (var lista in new[] { "rows", "global_rows" })
        {
            var ids = engine[lista]!.AsArray().Select(r => (string?)r!["id"]).ToArray();
            foreach (var banda in new[] { "call_band", "put_band" })
                Assert.DoesNotContain(banda, ids);
        }
    }

    /// <summary>
    /// El cuadro Details agrupa por la PREGUNTA que contesta cada indicador, y no por el objeto de
    /// la respuesta que lo trae. El invariante que importa es el scope: VIX y VIX9D son indices CBOE
    /// que GexAnalysisHandler pide como simbolos fijos, asi que valen lo mismo en SPY, QQQ o AAPL.
    /// Sin un rotulo que lo diga, cambiar de ticker y ver que esos dos no se mueven es
    /// indistinguible de un dato que quedo colgado del barrido anterior. El scope los mantiene
    /// juntos y primeros; que el panel los dibuje en la misma grilla que el resto o en una franja
    /// aparte es decision del front, no de este contrato.
    ///
    /// Los ids se congelan porque son el contrato con el front: el panel mapea id a celda, asi que
    /// renombrar uno aca no rompe el build. Hace desaparecer la celda, en silencio.
    /// </summary>
    [Fact]
    public void DetailsPanel_AgrupaPorPreguntaYSeparaLoQueEsDelMercado()
    {
        var details = Gex()["display_config"]!["gex_tab"]!["details_panel"]!.AsObject();
        var groups = details["groups"]!.AsArray();

        // La franja de mercado va PRIMERA: es el marco dentro del cual se leen los del simbolo.
        Assert.Equal("market", (string?)groups[0]!["id"]);
        Assert.Equal("market", (string?)groups[0]!["scope"]);

        var scopeOf = groups.ToDictionary(g => (string)g!["id"]!, g => (string?)g!["scope"]);
        var metricsOf = groups.ToDictionary(
            g => (string)g!["id"]!,
            g => g!["metrics"]!.AsArray().Select(m => (string)m!["id"]!).ToArray());

        // Los dos macro viven en el grupo de mercado, y en ningun grupo del simbolo.
        foreach (var macro in new[] { "vix", "vix_term_structure" })
        {
            Assert.Contains(macro, metricsOf["market"]);
            foreach (var id in metricsOf.Keys.Where(k => scopeOf[k] == "symbol"))
                Assert.DoesNotContain(macro, metricsOf[id]);
        }

        // Los once indicadores, exactos y sin repetir: el front mapea cada id a una celda.
        var all = metricsOf.Values.SelectMany(v => v).ToArray();
        Assert.Equal(all.Length, all.Distinct().Count());
        Assert.Equal(new[]
        {
            "gex_global", "gex_skew", "iv_atm", "iv_momentum", "iv_rank", "price_zscore",
            "realized_vol", "spot_vs_zgl", "trend_ema", "vix", "vix_term_structure",
        }, all.OrderBy(x => x, StringComparer.Ordinal).ToArray());

        // IV ATM va pegado a IV Rank: los dos leen el mismo precio del seguro, uno en percentil de
        // su propio ano y el otro en nivel absoluto, y separarlos obliga a buscar el nivel en el
        // tooltip del z-score, que es donde estaba escondido.
        var vol = metricsOf["volatility"];
        Assert.Equal(Array.IndexOf(vol, "iv_rank") + 1, Array.IndexOf(vol, "iv_atm"));

        // Cada grupo y cada metrica traen su etiqueta: el front renderiza lo que el JSON declara.
        foreach (var g in groups)
        {
            Assert.False(string.IsNullOrWhiteSpace((string?)g!["label"]));
            Assert.NotEmpty(g!["metrics"]!.AsArray());
            foreach (var m in g!["metrics"]!.AsArray())
                Assert.False(string.IsNullOrWhiteSpace((string?)m!["label"]));
        }

        // Sin semaforo de PANEL: GEX no tiene gates, y un numero en rojo con una cruz se lee como
        // averia. Lo que si hay es color por celda contra su referencia, declarado metrica por
        // metrica: el flag de arriba tiene que seguir en false o vuelven los checkmarks a todo.
        Assert.False((bool)details["semaphore"]!,
            "GEX es informativa: el cuadro Details no pinta un veredicto de panel.");

        // Las unicas dos celdas con lectura de dentro/fuera de la referencia. Se declara aca y no
        // en el front para que se vea desde las reglas cuales la tienen; el valor 'vs_ref' es el
        // contrato con DetailsPanel.paintVsRef, que ignora cualquier otro.
        var colorOf = groups
            .SelectMany(g => g!["metrics"]!.AsArray())
            .ToDictionary(m => (string)m!["id"]!, m => (string?)m!["color"]);
        Assert.Equal(new[] { "iv_rank", "vix" },
            colorOf.Where(kv => kv.Value != null).Select(kv => kv.Key).OrderBy(x => x, StringComparer.Ordinal).ToArray());
        Assert.Equal("vs_ref", colorOf["vix"]);
        Assert.Equal("vs_ref", colorOf["iv_rank"]);
    }

    /// <summary>
    /// La fila GLOBAL de la lista de vencimientos lleva el grafico y el Expiry Engine al agregado de
    /// toda la cadena. Es una eleccion explicita: default_expiry sigue siendo el mas cercano, porque
    /// el agregado no tiene vencimiento ni DTE y no deberia ser lo primero que se ve sin pedirlo.
    /// </summary>
    [Fact]
    public void OptionsChain_OfreceElScopeGlobalComoEleccionExplicita()
    {
        var tab = Gex()["display_config"]!["gex_tab"]!.AsObject();

        Assert.Equal("nearest", (string?)tab["default_expiry"]);

        var globalRow = tab["options_chain"]!["global_row"]!.AsObject();
        Assert.True((bool)globalRow["enabled"]!);
        Assert.False(string.IsNullOrWhiteSpace((string?)globalRow["label"]));
        Assert.Equal("gex.global", (string?)globalRow["scope"]);
    }

    /// <summary>
    /// En scope global el panel muestra solo lo que el agregado sabe calcular. expected_move tiene
    /// que quedar SIN fuente: es spot * atmIv * sqrt(t) y el agregado no tiene un t. Si alguien le
    /// pone `source`, el panel pasa a mostrar el EM de otro scope como si fuera del que se esta
    /// mirando — el mismo problema que un dato viejo que sobrevive a un error.
    /// </summary>
    [Fact]
    public void ExpiryEngine_EnGlobal_NoInventaExpectedMove()
    {
        var engine = Gex()["display_config"]!["gex_tab"]!["expiry_engine"]!.AsObject();
        var globalRows = engine["global_rows"]!.AsArray();

        JsonNode Row(string id) => globalRows.First(r => (string?)r!["id"] == id)!;

        // Lo que el backend YA calcula sobre los strikes agregados sale de gex.global. Los muros
        // entran acá porque el argmax no necesita EM: es un máximo sobre strikes y nada más.
        foreach (var id in new[] { "net_gex", "zgl", "call_wall", "put_wall" })
            Assert.StartsWith("global.", (string?)Row(id)["source"]);

        // Lo que no existe en el agregado no se rellena con el de un vencimiento.
        Assert.Null((string?)Row("expected_move")["source"]);

        // Y las filas que reemplazan a vencimiento/DTE son hechos del agregado, no de un vencimiento.
        Assert.Equal("gex.config.maxDte", (string?)Row("dte")["source"]);
        Assert.Equal("global.expirationsIncluded", (string?)Row("expirations")["source"]);

        foreach (var r in globalRows)
            Assert.DoesNotContain("byExpiry", (string?)r!["source"] ?? "");
    }
}
