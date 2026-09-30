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

            // ── Selection method ──
            var validSelectionMethods = new[] { "FIXED", "RULE_BASED", "AI_RECOMMENDED" };
            if (!validSelectionMethods.Contains(spec.Structure.SelectionMethod))
                errors.Add($"structure.selection_method must be one of: {string.Join(", ", validSelectionMethods)}");

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
