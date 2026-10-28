using System.Text.Json.Nodes;
using DataFeed.Application.App.SignalGates;
using Xunit;

namespace DataFeed.Tests;

/// <summary>
/// Comportamiento del embudo signal_gates v1.4.0 y de la interpolación de la tabla POP empírica.
/// Congela las fronteras de cada gate y la semántica all_must_pass (deshabilitado/no_data no bloquean).
/// </summary>
public class SignalGatesTests
{
    // JSON mínimo con la estructura real de signal_gates.gates (thresholds de v1.4.0).
    private static JsonNode Gates() => JsonNode.Parse("""
    {
      "gates": {
        "volatility_risk_premium": { "enabled": true, "min": 1.2, "on_fail": "no_trade" },
        "tail_score": { "enabled": true, "components": {
            "vvix": { "warn": 110, "block": 130 },
            "skew25_roc5d": { "warn": 0.05, "block": 0.08 } }, "on_fail": "no_trade" },
        "gamma_support": { "enabled": false, "min": 0, "on_fail": "no_trade" },
        "short_below_put_wall": { "enabled": true, "on_fail": "discard_put_side" },
        "edge": { "enabled": true, "bars_by_regime": { "low_vol": 1.1, "normal": 1.05, "elevated": 1.1, "caution": 1.2 }, "on_fail": "no_trade" },
        "credit_minimum": { "enabled": true, "min_usd": 0.30, "min_ratio_of_width": 0.10, "on_fail": "try_wider_spread_then_discard" }
      }
    }
    """)!;

    // Tabla POP: en delta 0.25 -> pLoss 0.14 (put termina ITM 14% de las veces).
    private static PopCalibrationTable Pop() => PopCalibrationTable.Parse("""
    { "symbols": { "SPY": [
        { "delta": 0.10, "pLoss": 0.055 },
        { "delta": 0.20, "pLoss": 0.110 },
        { "delta": 0.30, "pLoss": 0.180 } ] } }
    """);

    private static SignalGatesInputs GoodInputs() => new()
    {
        Symbol = "SPY",
        AtmIv30 = 18.0, RealizedVol30 = 12.0,   // VRP = 1.5 >= 1.2 OK
        Vvix = 95, Skew25Roc5d = 0.01,          // tail_score = 0 OK
        ShortPutStrike = 690, PutWall = 700,     // 690 <= 700 OK
        Credit = 0.90, SpreadWidth = 5,          // ratio 0.18 >= 0.10 OK
        ShortPutDeltaAbs = 0.25, Regime = "normal",
    };

    [Fact]
    public void TodosLosGatesPasan_ConInputsBuenos()
    {
        var r = SignalGatesEvaluator.Evaluate(Gates(), GoodInputs(), Pop());
        Assert.True(r.AllPass);
        Assert.Null(r.FailedGate);
        // gamma_support deshabilitado -> skipped, no bloquea.
        Assert.Equal("skipped", r.Gates.Single(g => g.Id == "gamma_support").Status);
    }

    [Fact]
    public void Vrp_FallaBajoElMinimo()
    {
        var inp = GoodInputs();
        inp.RealizedVol30 = 18.0; // VRP = 1.0 < 1.2
        var r = SignalGatesEvaluator.Evaluate(Gates(), inp, Pop());
        Assert.False(r.AllPass);
        Assert.Equal("volatility_risk_premium", r.FailedGate);
    }

    [Fact]
    public void Vrp_SinDatos_NoBloquea()
    {
        var inp = GoodInputs();
        inp.RealizedVol30 = null;
        var r = SignalGatesEvaluator.Evaluate(Gates(), inp, Pop());
        var vrp = r.Gates.Single(g => g.Id == "volatility_risk_premium");
        Assert.Equal("no_data", vrp.Status);
        Assert.True(vrp.Pass);
    }

    [Fact]
    public void ShortBelowPutWall_FallaSiElShortQuedaArribaDelMuro()
    {
        var inp = GoodInputs();
        inp.ShortPutStrike = 705; // por encima del put wall 700
        var r = SignalGatesEvaluator.Evaluate(Gates(), inp, Pop());
        Assert.False(r.AllPass);
        Assert.Equal("short_below_put_wall", r.FailedGate);
    }

    /// <summary>
    /// La excepción a "sin datos no bloquea": sin put wall no hay contra qué verificar que el short
    /// esté protegido, así que el gate falla cerrado. Hasta 2026-08-18 caía en no_data y la
    /// restricción de sanidad se apagaba sola justo cuando no había con qué aplicarla.
    /// </summary>
    [Fact]
    public void ShortBelowPutWall_SinMuro_FallaCerrado()
    {
        var inp = GoodInputs();
        inp.PutWall = null;
        var r = SignalGatesEvaluator.Evaluate(Gates(), inp, Pop());

        Assert.False(r.AllPass);
        Assert.Equal("short_below_put_wall", r.FailedGate);
        Assert.Equal("fail", r.Gates.Single(g => g.Id == "short_below_put_wall").Status);
    }

    /// <summary>El JSON puede volver al comportamiento viejo sin tocar código.</summary>
    [Fact]
    public void ShortBelowPutWall_SinMuro_InformOnly_NoBloquea()
    {
        var gates = Gates();
        gates["gates"]!["short_below_put_wall"]!["on_missing_wall"] = "inform_only";
        var inp = GoodInputs();
        inp.PutWall = null;

        var r = SignalGatesEvaluator.Evaluate(gates, inp, Pop());

        Assert.True(r.AllPass);
        Assert.Equal("no_data", r.Gates.Single(g => g.Id == "short_below_put_wall").Status);
    }

    /// <summary>
    /// La otra mitad: sin short put strike NO falta un dato, falta el candidato. Un gate no puede
    /// juzgar lo que todavía no existe, así que sigue en no_data y no bloquea.
    /// </summary>
    [Fact]
    public void ShortBelowPutWall_SinShortPut_SigueEnNoData()
    {
        var inp = GoodInputs();
        inp.ShortPutStrike = null;
        var r = SignalGatesEvaluator.Evaluate(Gates(), inp, Pop());

        Assert.True(r.AllPass);
        Assert.Equal("no_data", r.Gates.Single(g => g.Id == "short_below_put_wall").Status);
    }

    [Fact]
    public void Edge_PasaYFalla_SegunBarraDeRegimen()
    {
        // pLoss(0.25) interpolado = 0.145. edge = (credit/5)/0.145.
        // credit 0.90 -> ratio 0.18 -> edge = 1.241 >= 1.05 (normal) OK.
        var okr = SignalGatesEvaluator.Evaluate(Gates(), GoodInputs(), Pop());
        Assert.Equal("pass", okr.Gates.Single(g => g.Id == "edge").Status);

        // credit 0.60 -> ratio 0.12 -> edge = 0.827 < 1.05 -> falla.
        var inp = GoodInputs();
        inp.Credit = 0.60;
        var failr = SignalGatesEvaluator.Evaluate(Gates(), inp, Pop());
        Assert.False(failr.AllPass);
        Assert.Equal("edge", failr.FailedGate);
    }

    [Fact]
    public void CreditMinimum_FallaBajoElRatioAntiPennies()
    {
        var inp = GoodInputs();
        inp.Credit = 0.40; // ratio 0.08 < 0.10 (aunque > $0.30)
        var r = SignalGatesEvaluator.Evaluate(Gates(), inp, Pop());
        Assert.False(r.AllPass);
        // edge también podría fallar; verificamos que credit_minimum quedó marcado fail.
        Assert.Equal("fail", r.Gates.Single(g => g.Id == "credit_minimum").Status);
    }

    [Fact]
    public void TailScore_BloqueaConVvixEnBlock()
    {
        var inp = GoodInputs();
        inp.Vvix = 135;          // >= block(130) -> 2
        inp.Skew25Roc5d = 0.01;  // 0
        var r = SignalGatesEvaluator.Evaluate(Gates(), inp, Pop());
        Assert.False(r.AllPass);
        Assert.Equal("tail_score", r.FailedGate);
    }

    [Fact]
    public void TailScore_SumaDosWarns_Bloquea()
    {
        var inp = GoodInputs();
        inp.Vvix = 115;          // warn -> 1
        inp.Skew25Roc5d = 0.06;  // warn -> 1  => suma 2
        var r = SignalGatesEvaluator.Evaluate(Gates(), inp, Pop());
        Assert.Equal("fail", r.Gates.Single(g => g.Id == "tail_score").Status);
    }

    [Fact]
    public void TailScore_SinDatos_NoBloquea()
    {
        var inp = GoodInputs();
        inp.Vvix = null; inp.Skew25Roc5d = null;
        var r = SignalGatesEvaluator.Evaluate(Gates(), inp, Pop());
        Assert.Equal("no_data", r.Gates.Single(g => g.Id == "tail_score").Status);
        Assert.True(r.AllPass);
    }

    [Theory]
    [InlineData(0.10, 0.055)]  // bucket exacto
    [InlineData(0.25, 0.145)]  // interpolado entre 0.20 y 0.30
    [InlineData(0.05, 0.055)]  // clamp por debajo
    [InlineData(0.40, 0.180)]  // clamp por encima
    public void PopTable_InterpolaYClampea(double delta, double esperado)
    {
        double? p = Pop().PLoss("SPY", delta);
        Assert.NotNull(p);
        Assert.Equal(esperado, p!.Value, 3);
    }

    [Fact]
    public void PopTable_SimboloDesconocido_DevuelveNull()
        => Assert.Null(Pop().PLoss("IWM", 0.25));

    // ── Clasificador de régimen (edge.bars_by_regime) ──
    private static JsonNode RegimeClassification() => JsonNode.Parse("""
    { "ranges": [
        { "min": 0,  "max": 15,  "value": "low_vol" },
        { "min": 15, "max": 25,  "value": "normal" },
        { "min": 25, "max": 30,  "value": "elevated" },
        { "min": 30, "max": 999, "value": "caution" } ] }
    """)!;

    [Theory]
    [InlineData(12, "low_vol")]
    [InlineData(15, "normal")]    // borde inferior inclusivo
    [InlineData(18, "normal")]
    [InlineData(25, "elevated")]
    [InlineData(28, "elevated")]
    [InlineData(35, "caution")]
    public void ClassifyRegime_MapeaBandasDeVix(double vix, string esperado)
        => Assert.Equal(esperado, DataFeed.Application.App.Shared.CascadeUtils.ClassifyRegime(RegimeClassification(), vix));

    [Fact]
    public void ClassifyRegime_SinVix_DevuelveNormal()
        => Assert.Equal("normal", DataFeed.Application.App.Shared.CascadeUtils.ClassifyRegime(RegimeClassification(), null));

    // ── Historia de skew25 / RoC 5d (tail_score) ──
    private static SkewHistory Skew5() => SkewHistory.Parse("""
    { "SPY": [
        { "date": "2026-07-20", "skew25": 1.00 },
        { "date": "2026-07-21", "skew25": 1.02 },
        { "date": "2026-07-22", "skew25": 1.04 },
        { "date": "2026-07-23", "skew25": 1.06 },
        { "date": "2026-07-24", "skew25": 1.08 } ] }
    """);

    [Fact]
    public void SkewHistory_Roc5d_UsaElValorDeHace5Sesiones()
    {
        // 5 entradas => hace 5 sesiones = la más antigua (1.00). RoC = 1.10/1.00 - 1 = 0.10.
        double? roc = Skew5().Roc5d("SPY", 1.10);
        Assert.NotNull(roc);
        Assert.Equal(0.10, roc!.Value, 4);
    }

    [Fact]
    public void SkewHistory_SinHistoriaSuficiente_DevuelveNull()
    {
        var h = SkewHistory.Parse("""{ "SPY": [ { "date": "2026-07-24", "skew25": 1.08 } ] }""");
        Assert.Null(h.Roc5d("SPY", 1.10));            // solo 1 entrada
        Assert.Null(Skew5().Roc5d("QQQ", 1.10));      // símbolo sin historia
    }
}
