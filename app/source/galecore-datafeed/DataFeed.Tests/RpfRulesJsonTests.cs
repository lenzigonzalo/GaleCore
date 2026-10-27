using System;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using DataFeed.Application.App.Shared;
using DataFeed.Application.App.SignalGates;
using Xunit;

namespace DataFeed.Tests;

/// <summary>
/// Fase 4 de la alineacion de RPF ("Disparo por prima real"): test de consistencia
/// doc &lt;-&gt; JSON &lt;-&gt; codigo sobre galecore_rules_rpf.json.
///
/// Congela los invariantes de la config de referencia (BT-17 variante C + capa gamma:
/// PCS-only, SPY-only, delta 0.25, GEX&gt;=0, VRP 1.2, barras edge, sin iv_rank, paper_only)
/// y verifica que el JSON de RPF es LEIDO por el codigo ya existente (SignalGatesEvaluator,
/// ClassifyRegime, PopCalibrationTable) sin cambios — la premisa de la Decision de Fork A.
///
/// Fuente de verdad de los valores: docs/rpf/galecore-rpf-reconciliacion.md.
/// </summary>
public class RpfRulesJsonTests
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

    private static JsonObject Load(string file)
        => JsonNode.Parse(File.ReadAllText(Path.Combine(FilesDir(), file)))!.AsObject();

    // RPF vive en su subcarpeta (regla "archivos por estrategia").
    private static JsonObject Rpf() => Load(Path.Combine("Rpf", "galecore_rules_rpf.json"));

    private static JsonObject StrikeEngine(JsonObject rules)
        => rules["position_builder"]!["layers"]!.AsArray()
            .First(l => (string?)l!["name"] == "strike_engine")!["config"]!.AsObject();

    private static JsonObject RiskAndSizing(JsonObject rules)
        => rules["position_builder"]!["layers"]!.AsArray()
            .First(l => (string?)l!["name"] == "risk_and_sizing")!["config"]!.AsObject();

    // ── Invariantes de identidad de la estrategia ──

    [Fact]
    public void Rpf_EsPcsOnly_SpyOnly_Paper()
    {
        var r = Rpf();
        var meta = r["_meta"]!.AsObject();
        Assert.Equal("paper_only", (string?)meta["status"]);
        Assert.False((bool)meta["enabled_for_live"]!);

        Assert.Equal(new[] { "SPY" }, r["universe"]!["tickers"]!.AsArray().Select(x => (string?)x));

        var scope = r["strategy_scope"]!.AsObject();
        Assert.Equal(new[] { "put_credit_spread" }, scope["allowed_strategies"]!.AsArray().Select(x => (string?)x));
        var forbidden = scope["forbidden_strategies"]!.AsArray().Select(x => (string?)x).ToHashSet();
        Assert.Contains("iron_condor", forbidden);
        Assert.Contains("call_credit_spread", forbidden);
    }

    [Fact]
    public void Rpf_MacroRegime_SinIvRank_ConGexTotal()
    {
        var checks = Rpf()["macro_regime"]!["checks"]!.AsArray().Select(c => (string?)c!["id"]).ToList();
        Assert.DoesNotContain("iv_rank", checks);   // Fork B: removido
        Assert.Contains("gex_total", checks);        // GEX>=0 vive aca, no en signal_gates
        Assert.Contains("vix_absolute", checks);
    }

    [Fact]
    public void Rpf_GexThreshold_EsCero()
    {
        var gt = Rpf()["definitions"]!["gex_threshold_by_symbol"]!["values"]!.AsObject();
        Assert.Equal(0d, (double)gt["SPY"]!);
    }

    // ── Valores calibrados por research (BT-3 run-2, congelados BT-9..17) ──
    //
    // Hasta 2026-08-06 este test comparaba contra galecore_rules_core.json, cuando el core era el
    // JSON de la estrategia v1.4.0 y RPF espejaba sus numeros. Esa estrategia se elimino y el core
    // paso a ser config de la app: RPF es ahora el dueño unico de estos valores, asi que se
    // congelan literales. Fuente: docs/rpf/galecore-rpf-reconciliacion.md.

    [Fact]
    public void Rpf_SignalGates_ValoresCalibradosCongelados()
    {
        var rg = Rpf()["signal_gates"]!["gates"]!.AsObject();

        Assert.Equal(1.2d, (double)rg["volatility_risk_premium"]!["min"]!);

        var barras = new (string regime, double bar)[] {
            ("low_vol", 1.1), ("normal", 1.05), ("elevated", 1.1), ("caution", 1.2),
        };
        foreach (var (regime, bar) in barras)
            Assert.Equal(bar, (double)rg["edge"]!["bars_by_regime"]![regime]!);

        Assert.Equal(0.3d, (double)rg["credit_minimum"]!["min_usd"]!);
        Assert.Equal(0.1d, (double)rg["credit_minimum"]!["min_ratio_of_width"]!);

        var tail = rg["tail_score"]!["components"]!;
        Assert.Equal(110d, (double)tail["vvix"]!["warn"]!);
        Assert.Equal(130d, (double)tail["vvix"]!["block"]!);
        Assert.Equal(0.05d, (double)tail["skew25_roc5d"]!["warn"]!);
        Assert.Equal(0.08d, (double)tail["skew25_roc5d"]!["block"]!);
    }

    // ── Reuse de codigo: el JSON de RPF lo leen los evaluadores existentes (Fork A) ──

    [Fact]
    public void Rpf_SignalGates_LosLeeElEvaluadorExistente()
    {
        // El nodo signal_gates del JSON de RPF pasa directo a SignalGatesEvaluator.
        var signalGates = Rpf()["signal_gates"];
        var pop = PopCalibrationTable.Parse(File.ReadAllText(Path.Combine(FilesDir(), "pop_calibration.json")));

        // Setup bueno tipico: VRP 1.5, tail 0, short bajo el muro, credito rico, delta 0.25.
        var good = new SignalGatesInputs
        {
            Symbol = "SPY",
            AtmIv30 = 18.0, RealizedVol30 = 12.0,
            Vvix = 95, Skew25Roc5d = 0.01,
            ShortPutStrike = 690, PutWall = 700,
            Credit = 0.90, SpreadWidth = 5,
            ShortPutDeltaAbs = 0.25, Regime = "normal",
        };
        var okr = SignalGatesEvaluator.Evaluate(signalGates, good, pop);
        Assert.True(okr.AllPass, $"gate fallido inesperado: {okr.FailedGate}");

        // VRP por debajo del minimo desarma la senal (gate load-bearing).
        var lowVrp = good; lowVrp.RealizedVol30 = 18.0; // VRP 1.0 < 1.2
        var failr = SignalGatesEvaluator.Evaluate(signalGates, lowVrp, pop);
        Assert.False(failr.AllPass);
        Assert.Equal("volatility_risk_premium", failr.FailedGate);
    }

    /// <summary>
    /// El JSON declara que un put wall ausente BLOQUEA, y el evaluador lo obedece. Sin muro no hay
    /// contra que verificar que el short este protegido: dejarlo pasar apagaba la restriccion de
    /// sanidad justo cuando no habia con que aplicarla. Se volvio alcanzable el 2026-08-18, cuando
    /// los muros pasaron a exigir que el neto del strike tenga el signo de su lado.
    /// </summary>
    [Fact]
    public void Rpf_ShortBelowPutWall_SinMuro_Bloquea()
    {
        var gate = Rpf()["signal_gates"]!["gates"]!["short_below_put_wall"]!;
        Assert.Equal("no_trade", (string?)gate["on_missing_wall"]);

        var pop = PopCalibrationTable.Parse(File.ReadAllText(Path.Combine(FilesDir(), "pop_calibration.json")));
        var sinMuro = new SignalGatesInputs
        {
            Symbol = "SPY",
            AtmIv30 = 18.0, RealizedVol30 = 12.0,
            Vvix = 95, Skew25Roc5d = 0.01,
            ShortPutStrike = 690, PutWall = null,   // el caso: candidato si, muro no
            Credit = 0.90, SpreadWidth = 5,
            ShortPutDeltaAbs = 0.25, Regime = "normal",
        };

        var r = SignalGatesEvaluator.Evaluate(Rpf()["signal_gates"], sinMuro, pop);
        Assert.False(r.AllPass);
        Assert.Equal("short_below_put_wall", r.FailedGate);
    }

    [Theory]
    [InlineData(12, "low_vol")]
    [InlineData(18, "normal")]
    [InlineData(27, "elevated")]
    [InlineData(35, "caution")]
    public void Rpf_RegimeClassification_LaMapeaElClasificadorExistente(double iv, string esperado)
    {
        var rc = Rpf()["definitions"]!["regime_classification"];
        Assert.Equal(esperado, CascadeUtils.ClassifyRegime(rc, iv));
    }

    [Fact]
    public void Rpf_PopCalibration_ServedFileParseaYDaPLoss()
    {
        var pop = PopCalibrationTable.Parse(File.ReadAllText(Path.Combine(FilesDir(), "pop_calibration.json")));
        double? p = pop.PLoss("SPY", 0.25);
        Assert.NotNull(p);
        Assert.InRange(p!.Value, 0.10, 0.20); // delta 0.25 -> ITM real ~14% (BT-1: el delta sobrestima el put)
    }

    // ── Config de referencia: strike engine, riesgo, gestion ──

    [Fact]
    public void Rpf_StrikeEngine_Delta025_Ancho5_PcsForzado()
    {
        var se = StrikeEngine(Rpf());
        Assert.Equal(0.25d, (double)se["delta_target"]!["put_short"]!);
        Assert.Equal(5d, (double)se["spread_width"]!["symbol_overrides"]!["SPY"]!["default"]!);

        var structSel = se["structure_selection"]!.AsObject();
        Assert.False((bool)structSel["enabled"]!);
        Assert.Equal("put_credit_spread", (string?)structSel["forced_structure_while_disabled"]);
    }

    [Fact]
    public void Rpf_Riesgo_V2_DosPosiciones_Heat7()
    {
        var rs = RiskAndSizing(Rpf());
        Assert.Equal(2, (int)rs["max_positions"]!);
        Assert.Equal("V2", (string?)rs["portfolio_variant"]);
        Assert.Equal(0.07d, (double)rs["max_heat_pct_net_liq"]!);
        Assert.Equal(16000d, (double)rs["capital"]!["base_reference_usd"]!);
    }

    [Fact]
    public void Rpf_Gestion_HardDefense042_SinSalidaForzadaDte()
    {
        var tm = Rpf()["trade_management"]!.AsObject();
        Assert.Equal(0.5d, (double)tm["take_profit"]!["pct_of_initial_credit"]!);
        Assert.Equal(0.42d, (double)tm["hard_defense"]!["trigger_any"]!["short_leg_delta_abs_gt"]!);
        Assert.False((bool)tm["time_exit"]!["enabled"]!); // BT-4 refuto la salida a 21 DTE
    }

    [Fact]
    public void Rpf_OrquestacionActivadaEnPaper_RealSigueBloqueado()
    {
        var r = Rpf();
        // Activada en paper 2026-07-29: el loop corre y emite.
        Assert.True((bool)r["state_machine"]!["enabled"]!);
        Assert.True((bool)r["trade_suggestion"]!["enabled"]!);
        Assert.True((bool)r["orchestration"]!["enabled"]!);
        // Pero el gate de real sigue cerrado: la orquestacion es paper-only, nunca ejecuta.
        var meta = r["_meta"]!.AsObject();
        Assert.Equal("paper_only", (string?)meta["status"]);
        Assert.False((bool)meta["enabled_for_live"]!);
    }

    [Fact]
    public void Rpf_StateMachine_SieteEstados_ConPrecedencia()
    {
        var sm = Rpf()["state_machine"]!.AsObject();

        var estados = sm["states"]!.AsObject().Select(kv => kv.Key).ToHashSet();
        var esperados = new[] { "IN_POSITION", "VETOED", "DORMANT", "ARMED", "WAITING_CAPACITY", "COOLDOWN", "TRIGGERED" };
        foreach (var e in esperados) Assert.Contains(e, estados);
        Assert.Equal(esperados.Length, estados.Count);

        // La precedencia (orden de evaluación) declara VETOED primero — autoridad safety-first —
        // y WAITING_CAPACITY antes que IN_POSITION (V2: el 2º cupo se señaliza aunque el libro esté lleno).
        var prec = sm["precedence"]!.AsArray().Select(x => (string?)x).ToList();
        Assert.Equal("VETOED", prec[0]);
        Assert.True(prec.IndexOf("WAITING_CAPACITY") < prec.IndexOf("IN_POSITION"),
            "WAITING_CAPACITY debe evaluarse antes que IN_POSITION (semántica V2)");
        Assert.Equal(esperados.OrderBy(x => x), prec.OrderBy(x => x)); // mismo conjunto, distinto orden
    }

    [Fact]
    public void Rpf_TradeSuggestion_AckExplicito_TtlMultiploDeTierB()
    {
        var ts = Rpf()["trade_suggestion"]!.AsObject();
        Assert.Equal("explicit_operator", (string?)ts["ack"]!["mode"]);
        var methods = ts["ack"]!["methods"]!.AsArray().Select(x => (string?)x).ToHashSet();
        Assert.Contains("AcceptSuggestion", methods);
        Assert.Contains("DismissSuggestion", methods);
        Assert.Equal("multiple_of_tier_b", (string?)ts["ttl"]!["mode"]);
        Assert.Equal("in_memory_singleton", (string?)ts["persistence"]);
    }

    [Fact]
    public void Rpf_Orchestration_TierBMasRapidoQueTierA()
    {
        var o = Rpf()["orchestration"]!.AsObject();
        var tierA = (int)o["tier_a_refresh_seconds"]!;
        var tierB = (int)o["tier_b_tick_seconds"]!;
        Assert.True(tierB < tierA, "Tier B (dispara) debe tickear más rápido que el refresh de Tier A (arma)");
    }

    [Fact]
    public void Rpf_Parsea() => Assert.NotNull(Rpf());
}
