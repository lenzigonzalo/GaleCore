using System.Text.Json.Nodes;

namespace DataFeed.Application.App.SignalGates
{
    /// <summary>Inputs computados que consumen los gates. Los nullables se tratan como "no_data".</summary>
    public class SignalGatesInputs
    {
        public string Symbol { get; set; } = "";
        public double? AtmIv30 { get; set; }        // IV ATM 30d, en % (ej 18.5)
        public double? RealizedVol30 { get; set; }  // RV 30d anualizada trailing, en %
        public double? Vvix { get; set; }           // CBOE VVIX
        public double? Skew25Roc5d { get; set; }    // RoC 5d de IV_put25d/IV_atm
        public double? ShortPutStrike { get; set; }
        public double? PutWall { get; set; }
        public double? Credit { get; set; }         // crédito neto del spread, en $
        public double SpreadWidth { get; set; }     // ancho en $ (puntos)
        public double? ShortPutDeltaAbs { get; set; }
        public string Regime { get; set; } = "normal"; // clave de edge.bars_by_regime
    }

    /// <summary>Resultado de un gate individual, apto para serializar al frontend.</summary>
    public class GateResult
    {
        public string Id { get; set; } = "";
        public string Label { get; set; } = "";
        public bool Enabled { get; set; }
        public bool Pass { get; set; }
        /// <summary>pass | fail | skipped | no_data</summary>
        public string Status { get; set; } = "pass";
        public double? Value { get; set; }
        public double? Threshold { get; set; }
        public string? Detail { get; set; }
        public string? OnFail { get; set; }
    }

    public class SignalGatesResult
    {
        public bool AllPass { get; set; }
        public string? FailedGate { get; set; }
        public List<GateResult> Gates { get; set; } = new();
        /// <summary>Régimen de volatilidad clasificado (clave de edge.bars_by_regime): la etiqueta que
        /// explica qué barra se aplicó al edge. Es macro-independiente (depende de VIX/IV30).</summary>
        public string Regime { get; set; } = "normal";
    }

    /// <summary>
    /// Embudo de signal_gates v1.4.0 (BT-9b..BT-17). Evalúa cada gate declarado en signal_gates.gates,
    /// en orden, con semántica all_must_pass cortocircuitante. Un gate deshabilitado ("enabled":false)
    /// o sin datos ("no_data") NO bloquea — solo un gate habilitado con status "fail" desarma la señal.
    /// La excepción es <c>short_below_put_wall</c> sin put wall, que falla cerrado por declaración del
    /// JSON (<c>on_missing_wall</c>): es el único gate cuyo dato faltante significa "no puedo
    /// comprobar que el short esté protegido" en vez de "todavía no sé". Ver EvalShortBelowPutWall.
    /// Estático y sin estado: cada estrategia le pasa el nodo `signal_gates` de su propio JSON.
    /// </summary>
    public static class SignalGatesEvaluator
    {
        public static SignalGatesResult Evaluate(JsonNode? signalGatesNode, SignalGatesInputs inp, PopCalibrationTable? pop)
        {
            var result = new SignalGatesResult { Regime = inp.Regime };
            var gates = signalGatesNode?["gates"];

            void Add(GateResult g)
            {
                result.Gates.Add(g);
                if (g.Enabled && g.Status == "fail" && result.FailedGate == null)
                    result.FailedGate = g.Id;
            }

            Add(EvalVrp(gates?["volatility_risk_premium"], inp));
            Add(EvalTailScore(gates?["tail_score"], inp));
            Add(EvalGammaSupport(gates?["gamma_support"], inp));
            Add(EvalShortBelowPutWall(gates?["short_below_put_wall"], inp));
            Add(EvalEdge(gates?["edge"], inp, pop));
            Add(EvalCreditMinimum(gates?["credit_minimum"], inp));

            result.AllPass = result.FailedGate == null;
            return result;
        }

        private static GateResult Base(JsonNode? node, string id)
            => new()
            {
                Id = id,
                Label = node?["label"]?.GetValue<string>() ?? id,
                Enabled = node?["enabled"]?.GetValue<bool>() ?? false,
                OnFail = node?["on_fail"]?.GetValue<string>(),
                Pass = true,
                Status = "pass",
            };

        // Gate deshabilitado o sin datos: no bloquea.
        private static GateResult Skipped(GateResult g) { g.Status = "skipped"; g.Pass = true; return g; }
        private static GateResult NoData(GateResult g, string why) { g.Status = "no_data"; g.Pass = true; g.Detail = why; return g; }
        private static GateResult Pass(GateResult g) { g.Status = "pass"; g.Pass = true; return g; }
        private static GateResult Fail(GateResult g) { g.Status = "fail"; g.Pass = false; return g; }

        private static GateResult EvalVrp(JsonNode? node, SignalGatesInputs inp)
        {
            var g = Base(node, "volatility_risk_premium");
            if (!g.Enabled) return Skipped(g);

            double min = node?["min"]?.GetValue<double>() ?? 1.2;
            g.Threshold = min;
            if (inp.AtmIv30 is not > 0 || inp.RealizedVol30 is not > 0)
                return NoData(g, "IV30 o RV30 no disponibles");

            double vrp = inp.AtmIv30.Value / inp.RealizedVol30.Value;
            g.Value = Math.Round(vrp, 3);
            g.Detail = $"IV30 {inp.AtmIv30:0.0} / RV30 {inp.RealizedVol30:0.0}";
            return vrp >= min ? Pass(g) : Fail(g);
        }

        private static GateResult EvalTailScore(JsonNode? node, SignalGatesInputs inp)
        {
            var g = Base(node, "tail_score");
            if (!g.Enabled) return Skipped(g);

            var comp = node?["components"];
            g.Threshold = 2; // suma >= 2 -> engine_out

            int score = 0;
            var parts = new List<string>();
            bool anyData = false;

            // VVIX: warn=1 / block=2
            var vvix = comp?["vvix"];
            if (inp.Vvix is > 0 && vvix != null)
            {
                anyData = true;
                double warn = vvix["warn"]?.GetValue<double>() ?? 110;
                double block = vvix["block"]?.GetValue<double>() ?? 130;
                int s = inp.Vvix.Value >= block ? 2 : inp.Vvix.Value >= warn ? 1 : 0;
                score += s;
                parts.Add($"vvix {inp.Vvix:0}={s}");
            }
            else parts.Add("vvix=n/d");

            // skew25 RoC 5d: warn=1 / block=2
            var skew = comp?["skew25_roc5d"];
            if (inp.Skew25Roc5d.HasValue && skew != null)
            {
                anyData = true;
                double warn = skew["warn"]?.GetValue<double>() ?? 0.05;
                double block = skew["block"]?.GetValue<double>() ?? 0.08;
                double v = Math.Abs(inp.Skew25Roc5d.Value);
                int s = v >= block ? 2 : v >= warn ? 1 : 0;
                score += s;
                parts.Add($"skewRoC {inp.Skew25Roc5d:0.000}={s}");
            }
            else parts.Add("skewRoC=n/d");

            g.Value = score;
            g.Detail = string.Join(" · ", parts);
            if (!anyData) return NoData(g, "VVIX y skew25 no disponibles");
            return score >= 2 ? Fail(g) : Pass(g);
        }

        private static GateResult EvalGammaSupport(JsonNode? node, SignalGatesInputs inp)
        {
            var g = Base(node, "gamma_support");
            // Apagado por decisión del operador (2026-07-27): el requisito GEX>=0 vive en macro_regime.
            if (!g.Enabled) return Skipped(g);
            return Pass(g); // si se reactiva, requiere el cálculo de gamma agregado (no cableado aún)
        }

        /// <summary>
        /// El único gate del embudo que puede fallar por falta de dato, y por eso separa los dos
        /// "no hay" que antes caían juntos en no_data:
        /// <list type="bullet">
        /// <item><b>Sin short put strike</b> — no falta un dato, falta el candidato. El gate no
        /// aplica todavía y sigue en no_data (no bloquea).</item>
        /// <item><b>Sin put wall</b> — falta la referencia contra la que se verifica. Ahí no_data
        /// significaba "no puedo comprobar que el short esté protegido, sigan adelante": la
        /// restricción de sanidad se apagaba sola justo cuando no había con qué verificarla.
        /// Lo declara <c>on_missing_wall</c> en el JSON; el default es fallar cerrado.</item>
        /// </list>
        /// Se volvió relevante el 2026-08-18: desde que los muros exigen que el neto del strike
        /// tenga el signo de su lado (ver <c>GammaExposureHandler.SelectPutWall</c>), un PutWall
        /// null dejó de ser una rareza de datos y pasó a ser un resultado legítimo.
        /// </summary>
        private static GateResult EvalShortBelowPutWall(JsonNode? node, SignalGatesInputs inp)
        {
            var g = Base(node, "short_below_put_wall");
            if (!g.Enabled) return Skipped(g);
            if (inp.ShortPutStrike is not > 0)
                return NoData(g, "short put no disponible");

            if (inp.PutWall is not > 0)
            {
                g.Value = inp.ShortPutStrike;
                g.Detail = "sin put wall: ningún strike bajo el spot con gamma neto negativo";
                return node?["on_missing_wall"]?.GetValue<string>() != "inform_only"
                    ? Fail(g)
                    : NoData(g, g.Detail);
            }

            g.Value = inp.ShortPutStrike;
            g.Threshold = inp.PutWall;
            g.Detail = $"short {inp.ShortPutStrike:0.##} vs put wall {inp.PutWall:0.##}";
            return inp.ShortPutStrike.Value <= inp.PutWall.Value ? Pass(g) : Fail(g);
        }

        private static GateResult EvalEdge(JsonNode? node, SignalGatesInputs inp, PopCalibrationTable? pop)
        {
            var g = Base(node, "edge");
            if (!g.Enabled) return Skipped(g);

            var bars = node?["bars_by_regime"];
            double bar = bars?[inp.Regime]?.GetValue<double>()
                ?? bars?["normal"]?.GetValue<double>() ?? 1.05;
            g.Threshold = bar;

            if (inp.Credit is not > 0 || inp.SpreadWidth <= 0 || inp.ShortPutDeltaAbs is not > 0 || pop == null)
                return NoData(g, "crédito, ancho, delta o tabla POP no disponibles");

            double? pLoss = pop.PLoss(inp.Symbol, inp.ShortPutDeltaAbs.Value);
            if (pLoss is not > 0) return NoData(g, "sin bucket POP para el símbolo/delta");

            double edge = (inp.Credit.Value / inp.SpreadWidth) / pLoss.Value;
            g.Value = Math.Round(edge, 3);
            g.Detail = $"(cr/w {inp.Credit / inp.SpreadWidth:0.000}) / pLoss {pLoss:0.000} · régimen {inp.Regime}";
            return edge >= bar ? Pass(g) : Fail(g);
        }

        private static GateResult EvalCreditMinimum(JsonNode? node, SignalGatesInputs inp)
        {
            var g = Base(node, "credit_minimum");
            if (!g.Enabled) return Skipped(g);

            double minUsd = node?["min_usd"]?.GetValue<double>() ?? 0.30;
            double minRatio = node?["min_ratio_of_width"]?.GetValue<double>() ?? 0.10;
            g.Threshold = minUsd;
            if (inp.Credit is not > 0 || inp.SpreadWidth <= 0)
                return NoData(g, "crédito o ancho no disponibles");

            double ratio = inp.Credit.Value / inp.SpreadWidth;
            g.Value = Math.Round(inp.Credit.Value, 2);
            g.Detail = $"${inp.Credit:0.00} (ratio {ratio:0.000} ≥ {minRatio})";
            return inp.Credit.Value >= minUsd && ratio >= minRatio ? Pass(g) : Fail(g);
        }
    }
}
