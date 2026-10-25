using System.Text.RegularExpressions;

namespace DataFeed.Application.App.Runtime.Contracts
{
    /// <summary>
    /// ÚNICO lugar donde se declara qué campos de StrategySpec ejecuta el runtime SHADOW y cuáles sólo acepta (WS-0062 inc.8a).
    /// El harness del producto no guarda su propia lista: la lee de POST /App/Runtime/Specs/Check.
    ///
    /// Formato de ruta: nombres JSON en snake_case separados por punto; las listas llevan [] en el contrato ("candidate_construction.legs[].side")
    /// y el índice real en la respuesta ("candidate_construction.legs[0].side"). Una entrada cubre su ruta y todo lo que cuelga de ella
    /// ("risk_limits.loss_brakes" cubre "risk_limits.loss_brakes[].period"); gana la entrada más específica.
    ///
    /// Al agregar un campo al contrato hay que clasificarlo acá: StrategySpecExecutionMapTests falla si una hoja del contrato no
    /// está cubierta o si una entrada ya no existe en el contrato.
    /// </summary>
    public static class StrategySpecExecutionMap
    {
        public enum Kind { Executed, Inert }

        private static readonly Regex Index = new(@"\[\d+\]", RegexOptions.Compiled);

        private static Dictionary<string, Kind> Build()
        {
            var m = new Dictionary<string, Kind>(StringComparer.OrdinalIgnoreCase);
            void Executed(params string[] paths) { foreach (var p in paths) m[p] = Kind.Executed; }
            void Inert(params string[] paths) { foreach (var p in paths) m[p] = Kind.Inert; }

            // Informativos o valores fijos: el cargador los acepta y valida, el runtime no actúa sobre ellos.
            Inert("strategy_spec_version", "content_hash", "canonicalization_version",
                "identity.display_name", "identity.author", "identity.created_at", "identity.parent_version_hash",
                "deployment_constraints.requires_human_approval_for",
                "universe.mode", "universe.excluded", "universe.instrument_types",
                "structure.selection_method",                       // debe ser FIXED: el runtime arma siempre la default_structure
                "entry_filters.signal_layer",                       // se valida y se informa en StrategyData; no decide la entrada
                "candidate_construction.sizing.risk_per_trade_pct",
                "candidate_construction.constraints.max_bid_ask_spread_pct",
                "exits.deterministic.defensive_roll",
                "risk_limits.max_portfolio_heat_pct",
                "operational.calendar", "operational.decimal_precision", "operational.currency", "operational.rounding", "operational.symbology",
                "data_quality.block_on_crossed_market", "data_quality.block_on_missing_critical_data",
                "analytics_refs", "metadata");

            Executed("identity.id", "identity.name", "identity.version",
                "deployment_constraints.eligible_modes",
                "universe.symbols",
                "structure.allowed_strategies", "structure.forbidden_strategies", "structure.default_structure",
                "entry_filters.gate_layer.pass_rule", "entry_filters.gate_layer.on_fail", "entry_filters.gate_layer.gates",
                "entry_filters.gate_layer.gates[].threshold.metric_ref",
                "entry_filters.gate_layer.event_gates",
                "candidate_construction.legs[].id", "candidate_construction.legs[].side", "candidate_construction.legs[].type",
                "candidate_construction.legs[].strike_selection",
                "candidate_construction.sizing.method", "candidate_construction.sizing.fixed_contracts",   // long_equity (acciones fijas)
                "candidate_construction.constraints.min_dte", "candidate_construction.constraints.max_dte",
                "candidate_construction.constraints.min_credit", "candidate_construction.constraints.max_debit",
                "exits.deterministic.take_profit", "exits.deterministic.stop_loss",                         // pct_of_credit | pct_of_cost
                "exits.deterministic.time_exit.max_dte", "exits.deterministic.time_exit.at", "exits.deterministic.time_exit.days_after_entry",
                "exits.deterministic.metric_exit",
                "exits.deterministic.metric_exit.threshold.metric_ref",
                "exits.deterministic.event_exits",
                "execution.fill", "execution.slippage_pct_of_spread", "execution.costs",
                "risk_limits.max_concurrent_positions", "risk_limits.min_minutes_between_entries", "risk_limits.max_risk_per_trade_pct",
                "risk_limits.max_loss_per_trade_usd", "risk_limits.simulated_capital_usd", "risk_limits.reserve_pct",
                "risk_limits.max_open_risk_pct", "risk_limits.max_bet_pct", "risk_limits.loss_brakes",
                "operational.timezone", "operational.session_hours", "operational.entry_window", "operational.trade_limits",
                "data_quality.max_quote_age_seconds");
            return m;
        }

        public static readonly IReadOnlyDictionary<string, Kind> Entries = Build();

        /// <summary>Lo declarado para una ruta normalizada (con [] en lugar de índices): la entrada más específica que la cubre, o null.</summary>
        public static (string Key, Kind Kind)? Find(string normalizedPath)
        {
            string? best = null;
            foreach (var key in Entries.Keys)
                if (Covers(key, normalizedPath) && (best == null || key.Length > best.Length)) best = key;
            return best == null ? null : (best, Entries[best]);
        }

        public static bool Covers(string key, string path) =>
            path.Equals(key, StringComparison.OrdinalIgnoreCase)
            || path.StartsWith(key + ".", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith(key + "[]", StringComparison.OrdinalIgnoreCase);

        public static string Normalize(string concretePath) => Index.Replace(concretePath, "[]");
    }
}
