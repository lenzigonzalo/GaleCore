using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Evalúa gates del StrategySpec contra valores de métricas resueltos.
    /// Función pura: no hace I/O, no resuelve métricas — recibe un diccionario metric_ref → valor.
    /// El MetricResolver (Step E) se encarga de poblar ese diccionario.
    ///
    /// Patrón: mismo espíritu que SignalGatesEvaluator, pero genérico — evalúa cualquier
    /// GateDefinition del spec sin conocer la estrategia.
    /// </summary>
    public static class GenericGateEvaluator
    {
        /// <summary>
        /// Evalúa una capa de gates (gate_layer o signal_layer) contra métricas resueltas.
        /// </summary>
        /// <param name="gates">Gates del spec.</param>
        /// <param name="passRule">"ALL" — todos deben pasar.</param>
        /// <param name="layerOnFail">"NO_TRADE" | "INFORM_ONLY" — comportamiento default de la capa.</param>
        /// <param name="metrics">Valores resueltos: metric_ref → valor (null = no data).</param>
        /// <param name="evaluatedAt">Reloj del que llama (el runtime pasa el suyo); por defecto, ahora.</param>
        public static EvaluationResult Evaluate(
            List<GateDefinition> gates,
            string passRule,
            string layerOnFail,
            Dictionary<string, double?> metrics,
            string instanceId,
            string symbol,
            DateTime? evaluatedAt = null)
        {
            var results = new List<GateResult>();
            bool overallPass = true;

            foreach (var gate in gates)
            {
                var result = EvaluateGate(gate, metrics);
                results.Add(result);

                if (result.Status == "FAIL" && gate.OnFail == "NO_TRADE")
                    overallPass = false;
                if (result.Status == "NO_DATA" && gate.OnNoData == "BLOCK")
                    overallPass = false;
            }

            // passRule == "ALL": si cualquier gate bloqueante falló, overall = false
            // (ya se aplica arriba por gate)

            return new EvaluationResult
            {
                EvaluationId = Guid.NewGuid().ToString(),
                InstanceId = instanceId,
                Symbol = symbol,
                OverallPass = overallPass,
                GateResults = results,
                EvaluatedAt = evaluatedAt ?? DateTime.UtcNow
            };
        }

        /// <summary>Evalúa un gate individual contra su métrica.</summary>
        public static GateResult EvaluateGate(GateDefinition gate, Dictionary<string, double?> metrics)
        {
            // ── Resolver valor ──
            if (!metrics.TryGetValue(gate.MetricRef, out var value) || !value.HasValue)
            {
                return new GateResult
                {
                    GateId = gate.Id,
                    Label = gate.Label,
                    Status = "NO_DATA",
                    Value = null,
                    Threshold = gate.Threshold.Value,
                    Operator = gate.Operator,
                    OnFail = gate.OnFail
                };
            }

            // ── Evaluar operador ──
            bool pass = EvaluateOperator(gate.Operator, value.Value, gate.Threshold);

            return new GateResult
            {
                GateId = gate.Id,
                Label = gate.Label,
                Status = pass ? "PASS" : "FAIL",
                Value = value.Value,
                Threshold = gate.Operator == "BETWEEN" ? gate.Threshold.Min : gate.Threshold.Value,
                Operator = gate.Operator,
                OnFail = gate.OnFail
            };
        }

        /// <summary>Evalúa un operador contra un valor y threshold. Función pura.</summary>
        public static bool EvaluateOperator(string op, double value, GateThreshold threshold)
        {
            return op switch
            {
                "LT" => threshold.Value.HasValue && value < threshold.Value.Value,
                "LTE" => threshold.Value.HasValue && value <= threshold.Value.Value,
                "GT" => threshold.Value.HasValue && value > threshold.Value.Value,
                "GTE" => threshold.Value.HasValue && value >= threshold.Value.Value,
                "EQ" => threshold.Value.HasValue && Math.Abs(value - threshold.Value.Value) < 1e-10,
                "NEQ" => threshold.Value.HasValue && Math.Abs(value - threshold.Value.Value) >= 1e-10,
                "BETWEEN" => threshold.Min.HasValue && threshold.Max.HasValue
                             && value >= threshold.Min.Value && value <= threshold.Max.Value,
                _ => false
            };
        }
    }
}
