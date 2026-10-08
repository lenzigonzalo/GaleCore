using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Validación estructural + semántica mínima de un StrategySpec (P0 §5.5).
    /// Fail-fast: devuelve todos los errores encontrados, no solo el primero.
    /// content_hash NO se valida acá — lo calcula StrategySpecHasher.
    /// </summary>
    public static class StrategySpecValidator
    {
        public static SpecValidationResult Validate(StrategySpec spec)
        {
            var errors = new List<string>();

            // ── Identity ──
            if (string.IsNullOrWhiteSpace(spec.Identity.Id))
                errors.Add("identity.id is required");
            if (string.IsNullOrWhiteSpace(spec.Identity.Name))
                errors.Add("identity.name is required");
            if (string.IsNullOrWhiteSpace(spec.Identity.Version))
                errors.Add("identity.version is required");
            if (spec.Identity.CreatedAt == default)
                errors.Add("identity.created_at is required");

            var validAuthorTypes = new[] { "HUMAN", "AI", "COLLABORATIVE" };
            if (!validAuthorTypes.Contains(spec.Identity.Author.Type))
                errors.Add($"identity.author.type must be one of: {string.Join(", ", validAuthorTypes)}");

            // ── Deployment constraints ──
            var validModes = new[] { "SHADOW", "PAPER", "LIVE" };
            foreach (var mode in spec.DeploymentConstraints.EligibleModes)
            {
                if (!validModes.Contains(mode))
                    errors.Add($"deployment_constraints.eligible_modes contains invalid mode: {mode}");
            }
            if (spec.DeploymentConstraints.EligibleModes.Count == 0)
                errors.Add("deployment_constraints.eligible_modes must not be empty");

            // ── Universe ──
            var validUniverseModes = new[] { "WHITELIST", "BLACKLIST", "DYNAMIC" };
            if (!validUniverseModes.Contains(spec.Universe.Mode))
                errors.Add($"universe.mode must be one of: {string.Join(", ", validUniverseModes)}");
            if (spec.Universe.Mode == "WHITELIST" && spec.Universe.Symbols.Count == 0)
                errors.Add("universe.symbols must not be empty when mode is WHITELIST");

            // ── Structure ──
            if (spec.Structure.AllowedStrategies.Count == 0)
                errors.Add("structure.allowed_strategies must not be empty");
            if (string.IsNullOrWhiteSpace(spec.Structure.DefaultStructure))
                errors.Add("structure.default_structure is required");
            if (!string.IsNullOrWhiteSpace(spec.Structure.DefaultStructure)
                && spec.Structure.AllowedStrategies.Count > 0
                && !spec.Structure.AllowedStrategies.Contains(spec.Structure.DefaultStructure))
                errors.Add("structure.default_structure must be in allowed_strategies");

            // Superposición allowed/forbidden (P0 §5.5 regla 3)
            var overlap = spec.Structure.AllowedStrategies
                .Intersect(spec.Structure.ForbiddenStrategies)
                .ToList();
            if (overlap.Count > 0)
                errors.Add($"structure: overlap between allowed and forbidden strategies: {string.Join(", ", overlap)}");

            // Prohibición absoluta de la plataforma (CLAUDE.md)
            var platformForbidden = new[] { "naked_short", "ratio_spread", "long_directional" };
            foreach (var allowed in spec.Structure.AllowedStrategies)
            {
                if (platformForbidden.Contains(allowed))
                    errors.Add($"structure.allowed_strategies contains platform-forbidden strategy: {allowed}");
            }

            // ── Construcción: sólo lo que el runtime sabe construir (P1-07) ──
            ValidateConstruction(spec, errors);

            // ── Selection method: el runtime no tiene selector, siempre arma la default_structure ──
            if (spec.Structure.SelectionMethod != "FIXED")
                errors.Add($"structure.selection_method must be FIXED (the runtime has no selector), got '{spec.Structure.SelectionMethod}'");

            // ── Entry filters — gates ──
            ValidateGates(spec.EntryFilters.GateLayer.Gates, "entry_filters.gate_layer", errors);
            ValidateGates(spec.EntryFilters.SignalLayer.Gates, "entry_filters.signal_layer", errors);

            // ── Risk limits — sanity ──
            if (spec.RiskLimits.MaxRiskPerTradePct.HasValue && spec.RiskLimits.MaxRiskPerTradePct.Value <= 0)
                errors.Add("risk_limits.max_risk_per_trade_pct must be positive");
            if (spec.RiskLimits.MaxConcurrentPositions.HasValue && spec.RiskLimits.MaxConcurrentPositions.Value <= 0)
                errors.Add("risk_limits.max_concurrent_positions must be positive");
            if (spec.RiskLimits.MinMinutesBetweenEntries.HasValue && spec.RiskLimits.MinMinutesBetweenEntries.Value <= 0)
                errors.Add("risk_limits.min_minutes_between_entries must be positive");

            // ── Operational ──
            if (string.IsNullOrWhiteSpace(spec.Operational.Timezone))
                errors.Add("operational.timezone is required");
            if (string.IsNullOrWhiteSpace(spec.Operational.Currency))
                errors.Add("operational.currency is required");

            // ── Metadata ──
            if (string.IsNullOrWhiteSpace(spec.Metadata.SchemaVersion))
                errors.Add("metadata.schema_version is required");

            return new SpecValidationResult(errors.Count == 0, errors);
        }

        /// <summary>
        /// La estructura por defecto tiene que ser una que el runtime construye, y las patas, exactamente las suyas:
        /// por lado, una SELL por DELTA (put con delta negativo, call con positivo) y una BUY a un ancho fijo. Una pata
        /// de más o un método que el constructor no conoce se rechazan: si no, la spec se desplegaría sin esa regla.
        /// </summary>
        private static void ValidateConstruction(StrategySpec spec, List<string> errors)
        {
            foreach (var allowed in spec.Structure.AllowedStrategies.Where(a => RuntimeStructures.Sides(a) == null))
                errors.Add($"structure.allowed_strategies contains '{allowed}', not built by the runtime "
                           + $"(supported: {string.Join(", ", RuntimeStructures.Supported)})");
            if (spec.CandidateConstruction.Constraints.MinCredit is double minCredit && !(minCredit > 0))
                errors.Add($"candidate_construction.constraints.min_credit must be positive, got {minCredit}");

            var structure = spec.Structure.DefaultStructure;
            if (string.IsNullOrWhiteSpace(structure)) return;   // ya informado arriba
            var sides = RuntimeStructures.Sides(structure);
            if (sides == null)
            {
                errors.Add($"structure.default_structure '{structure}' is not built by the runtime "
                           + $"(supported: {string.Join(", ", RuntimeStructures.Supported)})");
                return;
            }

            var legs = spec.CandidateConstruction.Legs;
            var expected = sides.SelectMany(type => new[] { ("SELL", type), ("BUY", type) }).ToList();
            var actual = legs.Select(l => (l.Side, l.Type)).ToList();
            if (actual.Count != expected.Count || expected.Any(e => actual.Count(a => a == e) != 1))
            {
                errors.Add($"candidate_construction.legs must be exactly {string.Join(", ", expected.Select(e => $"{e.Item1} {e.Item2}"))} "
                           + $"for {structure}; got {(actual.Count == 0 ? "none" : string.Join(", ", actual.Select(a => $"{a.Side} {a.Type}")))}");
                return;
            }

            foreach (var leg in legs)
            {
                var name = $"candidate_construction.legs[{leg.Side} {leg.Type}]";
                var sel = leg.StrikeSelection;
                if (leg.Side == "SELL")
                {
                    if (sel.Method != "DELTA")
                        errors.Add($"{name}.strike_selection.method must be DELTA, got '{sel.Method}'");
                    if (sel.TargetDelta is double d && (leg.Type == "PUT" ? d >= 0 : d <= 0))
                        errors.Add($"{name}.strike_selection.target_delta must be {(leg.Type == "PUT" ? "negative" : "positive")}, got {d}");
                    if (sel.DeltaTolerance is double tol && tol <= 0)
                        errors.Add($"{name}.strike_selection.delta_tolerance must be positive");
                }
                else
                {
                    if (sel.Method != "FIXED_WIDTH")
                        errors.Add($"{name}.strike_selection.method must be FIXED_WIDTH, got '{sel.Method}'");
                    if (sel.Width is double w && w <= 0)
                        errors.Add($"{name}.strike_selection.width must be positive");
                }
            }
        }

        private static void ValidateGates(List<GateDefinition> gates, string prefix, List<string> errors)
        {
            var validOperators = new[] { "LT", "LTE", "GT", "GTE", "EQ", "NEQ", "BETWEEN" };
            var validOnFail = new[] { "NO_TRADE", "INFORM_ONLY" };
            var validOnNoData = new[] { "BLOCK", "PASS", "INFORM_ONLY" };

            var ids = new HashSet<string>();
            foreach (var gate in gates)
            {
                if (string.IsNullOrWhiteSpace(gate.Id))
                {
                    errors.Add($"{prefix}.gates: gate id is required");
                    continue;
                }
                if (!ids.Add(gate.Id))
                    errors.Add($"{prefix}.gates: duplicate gate id '{gate.Id}'");
                if (string.IsNullOrWhiteSpace(gate.MetricRef))
                    errors.Add($"{prefix}.gates[{gate.Id}].metric_ref is required");
                if (!validOperators.Contains(gate.Operator))
                    errors.Add($"{prefix}.gates[{gate.Id}].operator must be one of: {string.Join(", ", validOperators)}");
                if (!validOnFail.Contains(gate.OnFail))
                    errors.Add($"{prefix}.gates[{gate.Id}].on_fail must be one of: {string.Join(", ", validOnFail)}");
                if (!validOnNoData.Contains(gate.OnNoData))
                    errors.Add($"{prefix}.gates[{gate.Id}].on_no_data must be one of: {string.Join(", ", validOnNoData)}");

                if (gate.Operator == "BETWEEN")
                {
                    if (!gate.Threshold.Min.HasValue || !gate.Threshold.Max.HasValue)
                        errors.Add($"{prefix}.gates[{gate.Id}]: BETWEEN requires threshold.min and threshold.max");
                }
                else if (gate.Operator != "" && !gate.Threshold.Value.HasValue)
                {
                    errors.Add($"{prefix}.gates[{gate.Id}]: operator {gate.Operator} requires threshold.value");
                }
            }
        }
    }

    public record SpecValidationResult(bool IsValid, List<string> Errors);
}
