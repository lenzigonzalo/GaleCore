using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using Xunit;

namespace DataFeed.Tests;

/// <summary>
/// Contrato de galecore_rules_core.json, servido tal cual por GET /App/GaleCore/Rules/Core.
///
/// Desde 2026-08-06 este archivo NO es una estrategia: es la configuracion de la APLICACION.
/// Hasta v1.4.0 fue el JSON de reglas de gale_core_gamma_premium (PCS-only) y este test congelaba
/// sus invariantes de trading mas la validacion de los overlays live/paper; esa estrategia y sus
/// overlays se eliminaron.
///
/// Lo que se congela ahora es lo que el frontend necesita para arrancar: el universo que streamea,
/// las estrategias que Main renderiza como cards, y los umbrales que lee la pestaña Monitor. Un
/// nodo faltante no rompe el build ni la API — rompe el tablero en runtime, en silencio, porque
/// todo el front lee con optional chaining y cae a defaults hardcodeados.
/// </summary>
public class RulesJsonTests
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

    private static JsonObject AppConfig()
        => JsonNode.Parse(File.ReadAllText(Path.Combine(FilesDir(), "galecore_rules_core.json")))!.AsObject();

    // ── El core dejo de ser una estrategia ──

    /// <summary>
    /// Sin esto, alguien vuelve a meter reglas de trading en el config de la app y el archivo
    /// deja de tener un dueño claro. Cada estrategia declara lo suyo en Files/&lt;Prefijo&gt;/.
    /// </summary>
    [Fact]
    public void Core_NoContieneNodosDeEstrategia()
    {
        var cfg = AppConfig();
        foreach (var nodo in new[] { "signal_gates", "position_builder", "macro_regime",
                                     "strategy_scope", "definitions", "execution" })
            Assert.False(cfg.ContainsKey(nodo),
                $"'{nodo}' es de una estrategia: va en Files/<Prefijo>/, no en el config de la app.");
    }

    /// <summary>Los overlays live/paper eran de la estrategia eliminada; no deben volver.</summary>
    [Fact]
    public void Core_NoTieneOverlays()
    {
        foreach (var overlay in new[] { "galecore_rules_live.json", "galecore_rules_paper.json" })
            Assert.False(File.Exists(Path.Combine(FilesDir(), overlay)),
                $"{overlay} era overlay de la estrategia v1.4.0; el DeepMerge que lo aplicaba ya no existe.");
    }

    // ── Universo de streaming ──

    /// <summary>
    /// De aca sale el `Subscribe(symbol)` de useMarketSocket. Vacio = las cards del front se
    /// quedan sin precio en vivo y caen al polling REST.
    /// </summary>
    [Fact]
    public void Universe_TieneTickers()
    {
        var tickers = AppConfig()["universe"]?["tickers"]?.AsArray();
        Assert.NotNull(tickers);
        Assert.NotEmpty(tickers!);
        Assert.All(tickers!, t => Assert.False(string.IsNullOrWhiteSpace((string?)t)));
    }

    // ── Estrategias implementadas ──

    /// <summary>
    /// `strategies[]` es lo que Main renderiza. Una estrategia que no figura aca existe en la API
    /// pero es invisible en el tablero.
    /// </summary>
    [Fact]
    public void Strategies_CadaEntradaTieneElContratoCompleto()
    {
        var strategies = AppConfig()["strategies"]?.AsArray();
        Assert.NotNull(strategies);
        Assert.NotEmpty(strategies!);

        foreach (var s in strategies!)
        {
            var o = s!.AsObject();
            foreach (var campo in new[] { "id", "prefix", "tab", "label", "rules_endpoint", "switch_endpoint" })
                Assert.False(string.IsNullOrWhiteSpace((string?)o[campo]),
                    $"strategies[] con '{campo}' vacio o ausente: {o.ToJsonString()}");
        }

        var ids = strategies!.Select(s => (string?)s!["id"]).ToList();
        Assert.Equal(ids.Count, ids.Distinct().Count());
    }

    /// <summary>
    /// El prefijo no es decorativo: manda la ruta HTTP (/App/&lt;Prefijo&gt;/*) y la carpeta de archivos
    /// (Files/&lt;Prefijo&gt;/). Si no coinciden, la convencion deja de servir para encontrar las cosas.
    /// </summary>
    [Fact]
    public void Strategies_ElPrefijoCoincideConRutasYCarpeta()
    {
        foreach (var s in AppConfig()["strategies"]!.AsArray())
        {
            var prefix = (string?)s!["prefix"]!;

            Assert.True(Directory.Exists(Path.Combine(FilesDir(), prefix!)),
                $"Falta la carpeta Files/{prefix}/ de la estrategia '{(string?)s["id"]}'.");

            Assert.Equal($"/App/{prefix}/Rules", (string?)s["rules_endpoint"]);
            Assert.Equal($"/App/{prefix}/Switch", (string?)s["switch_endpoint"]);
        }
    }

    /// <summary>El JSON de reglas que la estrategia declara servir tiene que existir en disco.</summary>
    [Fact]
    public void Strategies_TienenSuJsonDeReglas()
    {
        foreach (var s in AppConfig()["strategies"]!.AsArray())
        {
            var prefix = (string?)s!["prefix"]!;
            var path = Path.Combine(FilesDir(), prefix!, $"galecore_rules_{prefix!.ToLowerInvariant()}.json");
            Assert.True(File.Exists(path), $"No se encontro {path}");
        }
    }

    // ── Servicios de plataforma ──

    /// <summary>
    /// `services[]` declara los procesos que corren solos y NO son de ninguna estrategia. De aca
    /// salen las cards de la seccion Plataforma de Main y el nivel "reglas" de su switch: un
    /// servicio que no figura aca no se puede prender ni apagar desde el tablero.
    /// </summary>
    [Fact]
    public void Services_CadaEntradaTieneElContratoCompleto()
    {
        var services = AppConfig()["services"]?.AsArray();
        Assert.NotNull(services);
        Assert.NotEmpty(services!);

        foreach (var s in services!)
        {
            var o = s!.AsObject();
            foreach (var campo in new[] { "id", "label", "name", "description", "switch_endpoint" })
                Assert.False(string.IsNullOrWhiteSpace((string?)o[campo]),
                    $"services[] con '{campo}' vacio o ausente: {o.ToJsonString()}");

            // El default tiene que ser explicito: es el nivel de reglas del switch, y dejarlo
            // implicito esconde en un default de codigo si el servicio arranca prendido.
            Assert.True(o["enabled"] is JsonValue,
                $"services[] '{(string?)o["id"]}' sin 'enabled' booleano.");
        }

        var ids = services!.Select(s => (string?)s!["id"]).ToList();
        Assert.Equal(ids.Count, ids.Distinct().Count());
    }

    /// <summary>
    /// El endpoint del switch se arma con el id, igual que en las estrategias con el prefijo. Si no
    /// coinciden, la card de Main apunta a un servicio y muestra el estado de otro.
    /// </summary>
    [Fact]
    public void Services_ElIdCoincideConSuEndpoint()
    {
        foreach (var s in AppConfig()["services"]!.AsArray())
        {
            var id = (string?)s!["id"]!;
            Assert.Equal(id, id!.ToLowerInvariant());
            Assert.Equal($"/App/GaleCore/Services/{id}/Switch", (string?)s["switch_endpoint"]);
        }
    }

    /// <summary>
    /// Los ids que el codigo pregunta en cada tick estan hardcodeados en cada BackgroundService
    /// (ServiceId). Si alguien renombra el id en el JSON, el servicio deja de encontrar su entrada y
    /// se comporta como si no tuviera switch — prendido y sin forma de apagarlo desde el tablero.
    /// </summary>
    [Fact]
    public void Services_EstanLosQueElCodigoPregunta()
    {
        var ids = AppConfig()["services"]!.AsArray().Select(s => (string?)s!["id"]).ToList();

        Assert.Contains("skew", ids);   // SkewSnapshotService.ServiceId
    }

    // ── Config de Monitor ──

    /// <summary>
    /// Los paths exactos que leen PositionMonitor, PositionCard y PortfolioRiskBar. Todos usan
    /// optional chaining con default hardcodeado, asi que un nodo renombrado no da error: el
    /// tablero muestra umbrales que nadie configuro.
    /// </summary>
    [Theory]
    [InlineData("take_profit", "pct_of_initial_credit")]
    [InlineData("defensive_roll", "trigger_unrealized_loss_pct_of_initial_credit_gte")]
    [InlineData("defensive_roll", "min_dte_remaining")]
    [InlineData("time_exit", "dte_threshold")]
    [InlineData("daily_kill_switch", "daily_portfolio_mtm_loss_pct_net_liq_max")]
    public void Monitor_TradeManagement_ExponeLosUmbralesQueLeeElFront(string nodo, string campo)
    {
        var tm = AppConfig()["monitor"]?["trade_management"];
        Assert.NotNull(tm);
        Assert.NotNull(tm![nodo]?[campo]);
    }

    [Fact]
    public void Monitor_TradeManagement_HardDefenseTieneSusDosTriggers()
    {
        var trigger = AppConfig()["monitor"]!["trade_management"]!["hard_defense"]?["trigger_any"];
        Assert.NotNull(trigger);
        Assert.NotNull(trigger!["short_leg_delta_abs_gt"]);
        Assert.NotNull(trigger["unrealized_loss_pct_of_initial_credit_gte"]);
    }

    [Fact]
    public void Monitor_RiskLimits_ExponeMaxPositionsYHeat()
    {
        var rl = AppConfig()["monitor"]?["risk_limits"];
        Assert.NotNull(rl);
        Assert.True((int?)rl!["max_concurrent_positions"] > 0);
        Assert.True((double?)rl["portfolio_heat_max_pct"] > 0);
    }
}
