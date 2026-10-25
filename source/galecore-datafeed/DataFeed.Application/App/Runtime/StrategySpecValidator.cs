using DataFeed.Application.App.Shared;
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
        public static SpecValidationResult Validate(StrategySpec spec, IReadOnlyCollection<EventTypeInfo>? eventCatalog = null)
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

            // ── Construcción: sólo lo que el runtime sabe construir (P1-07) ──
            ValidateConstruction(spec, errors);
            ValidateMetricExit(spec.Exits.Deterministic.MetricExit, errors);
            ValidateExits(spec, eventCatalog ?? EventCatalog.Builtin, errors);
            ValidateExecution(spec.Execution, errors);

            // ── Selection method: el runtime no tiene selector, siempre arma la default_structure ──
            if (spec.Structure.SelectionMethod != "FIXED")
                errors.Add($"structure.selection_method must be FIXED (the runtime has no selector), got '{spec.Structure.SelectionMethod}'");

            // ── Entry filters — gates ──
            ValidateGates(spec.EntryFilters.GateLayer.Gates, "entry_filters.gate_layer", errors);
            ValidateGates(spec.EntryFilters.SignalLayer.Gates, "entry_filters.signal_layer", errors);
            ValidateEventGates(spec, eventCatalog ?? EventCatalog.Builtin, errors);

            // ── Risk limits — sanity ──
            if (spec.RiskLimits.MaxRiskPerTradePct.HasValue && spec.RiskLimits.MaxRiskPerTradePct.Value <= 0)
                errors.Add("risk_limits.max_risk_per_trade_pct must be positive");
            if (spec.RiskLimits.MaxConcurrentPositions.HasValue && spec.RiskLimits.MaxConcurrentPositions.Value <= 0)
                errors.Add("risk_limits.max_concurrent_positions must be positive");
            if (spec.RiskLimits.MinMinutesBetweenEntries.HasValue && spec.RiskLimits.MinMinutesBetweenEntries.Value <= 0)
                errors.Add("risk_limits.min_minutes_between_entries must be positive");

            ValidateRiskControls(spec, errors);

            // ── Operational ──
            if (string.IsNullOrWhiteSpace(spec.Operational.Timezone))
                errors.Add("operational.timezone is required");
            ValidateOperationalWindows(spec.Operational, errors);
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
            foreach (var allowed in spec.Structure.AllowedStrategies.Where(a => !RuntimeStructures.IsSupported(a)))
                errors.Add($"structure.allowed_strategies contains '{allowed}', not built by the runtime "
                           + $"(supported: {string.Join(", ", RuntimeStructures.Supported)})");
            if (spec.CandidateConstruction.Constraints.MinCredit is double minCredit && !(minCredit > 0))
                errors.Add($"candidate_construction.constraints.min_credit must be positive, got {minCredit}");
            if (spec.CandidateConstruction.Constraints.MaxDebit is double maxDebit && !(maxDebit > 0))
                errors.Add($"candidate_construction.constraints.max_debit must be positive, got {maxDebit}");

            var structure = spec.Structure.DefaultStructure;
            if (string.IsNullOrWhiteSpace(structure)) return;   // ya informado arriba
            if (structure == RuntimeStructures.LongEquity)
            {
                ValidateLongEquity(spec, errors);
                return;
            }
            if (structure == RuntimeStructures.CustomOptions)
            {
                ValidateCustomOptions(spec, errors);
                return;
            }
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

        /// <summary>
        /// custom_options (WS-0062 inc.4): patas declaradas, cada una con SELL/BUY, PUT/CALL y UN selector de strike (delta, puntos o % del
        /// precio, strike fijo, u offset en puntos de otra pata). Mismo vencimiento (rango de DTE de la spec) y crédito mínimo o débito máximo.
        /// </summary>
        private static void ValidateCustomOptions(StrategySpec spec, List<string> errors)
        {
            const string p = "candidate_construction";
            var legs = spec.CandidateConstruction.Legs;
            var c = spec.CandidateConstruction.Constraints;
            if (legs.Count == 0) errors.Add($"{p}.legs must declare at least one leg for custom_options");
            var ids = legs.Select((l, i) => string.IsNullOrWhiteSpace(l.Id) ? $"leg{i + 1}" : l.Id!).ToList();
            foreach (var dup in ids.GroupBy(i => i).Where(g => g.Count() > 1))
                errors.Add($"{p}.legs: duplicate leg id '{dup.Key}'");

            for (int i = 0; i < legs.Count; i++)
            {
                var leg = legs[i];
                var sel = leg.StrikeSelection;
                var name = $"{p}.legs[{ids[i]}]";
                if (leg.Side != "SELL" && leg.Side != "BUY") errors.Add($"{name}.side must be SELL or BUY, got '{leg.Side}'");
                if (leg.Type != "PUT" && leg.Type != "CALL") errors.Add($"{name}.type must be PUT or CALL, got '{leg.Type}'");

                // Un solo selector: el método fija qué campos lleva y los demás quedan vacíos.
                var all = new (string Name, bool Set)[]
                {
                    ("target_delta", sel.TargetDelta != null), ("delta_tolerance", sel.DeltaTolerance != null), ("width", sel.Width != null),
                    ("points_from_spot", sel.PointsFromSpot != null), ("pct_from_spot", sel.PctFromSpot != null), ("strike", sel.Strike != null),
                    ("from_leg", sel.FromLeg != null), ("offset_points", sel.OffsetPoints != null), ("tolerance_points", sel.TolerancePoints != null),
                };
                var allowed = sel.Method switch
                {
                    "DELTA" => new[] { "target_delta", "delta_tolerance" },
                    "POINTS_FROM_SPOT" => new[] { "points_from_spot" },
                    "PCT_FROM_SPOT" => new[] { "pct_from_spot" },
                    "FIXED_STRIKE" => new[] { "strike" },
                    "OFFSET_FROM_LEG" => new[] { "from_leg", "offset_points", "tolerance_points" },
                    _ => null,
                };
                if (allowed == null)
                {
                    errors.Add($"{name}.strike_selection.method must be one of: {string.Join(", ", RuntimeStructures.CustomLegMethods)}, got '{sel.Method}'");
                    continue;
                }
                foreach (var f in all.Where(f => f.Set && !allowed.Contains(f.Name)))
                    errors.Add($"{name}.strike_selection.{f.Name} does not apply to method {sel.Method} (one selector per leg)");
                foreach (var f in allowed.Where(a => a != "tolerance_points" && !all.First(x => x.Name == a).Set))
                    errors.Add($"{name}.strike_selection.{f} is required for method {sel.Method}");

                if (sel.TargetDelta is double d && (leg.Type == "PUT" ? d >= 0 || d <= -0.5 : d <= 0 || d >= 0.5))
                    errors.Add($"{name}.strike_selection.target_delta must be {(leg.Type == "PUT" ? "between -0.5 and 0" : "between 0 and 0.5")}, got {d}");
                if (sel.DeltaTolerance is double tol && tol <= 0) errors.Add($"{name}.strike_selection.delta_tolerance must be positive");
                if (sel.PointsFromSpot is double pts && (pts == 0 || !double.IsFinite(pts)))
                    errors.Add($"{name}.strike_selection.points_from_spot must be non-zero (negative = below the price, positive = above)");
                if (sel.PctFromSpot is double pct && (pct == 0 || !double.IsFinite(pct) || pct <= -100))
                    errors.Add($"{name}.strike_selection.pct_from_spot must be non-zero and above -100 (negative = below the price, positive = above)");
                if (sel.Strike is double k && !(k > 0)) errors.Add($"{name}.strike_selection.strike must be positive");
                if (sel.OffsetPoints is double off && (off == 0 || !double.IsFinite(off))) errors.Add($"{name}.strike_selection.offset_points must be non-zero");
                if (sel.TolerancePoints is double tp && !(tp >= 0)) errors.Add($"{name}.strike_selection.tolerance_points must be zero or positive");
                if (sel.FromLeg != null)
                {
                    if (!ids.Contains(sel.FromLeg)) errors.Add($"{name}.strike_selection.from_leg '{sel.FromLeg}' is not a leg of this structure");
                    else if (sel.FromLeg == ids[i]) errors.Add($"{name}.strike_selection.from_leg cannot reference the leg itself");
                }
            }

            // from_leg sin ciclos: se sigue la cadena de referencias de cada pata.
            var refs = new Dictionary<string, string>();
            for (int i = 0; i < legs.Count; i++)
                if (legs[i].StrikeSelection.FromLeg is string from && !refs.ContainsKey(ids[i])) refs[ids[i]] = from;
            foreach (var start in refs.Keys)
            {
                var seen = new HashSet<string>();
                var current = start;
                while (refs.TryGetValue(current, out var next))
                {
                    if (!seen.Add(current))
                    {
                        errors.Add($"{p}.legs: the from_leg chain starting at '{start}' is circular");
                        break;
                    }
                    current = next;
                }
            }

            if (c.MinDte is not int minDte || c.MaxDte is not int maxDte)
                errors.Add($"{p}.constraints.min_dte and max_dte are required for custom_options (0 is allowed: 0DTE)");
            else if (minDte < 0 || maxDte < minDte)
                errors.Add($"{p}.constraints: min_dte must be >= 0 and max_dte >= min_dte, got {minDte}..{maxDte}");
            if ((c.MinCredit != null) == (c.MaxDebit != null))
                errors.Add($"{p}.constraints: declare exactly one of min_credit (credit structure) or max_debit (debit structure)");
            // take_profit / stop_loss de una estructura de débito: % del costo (ValidateExits).
        }

        /// <summary>
        /// Estructura de débito: se paga para entrar (custom_options con max_debit, o acciones en largo). Su take_profit y stop_loss
        /// son % del costo (pct_of_cost); en las de crédito, % del crédito (pct_of_credit). Mezclarlos se rechaza.
        /// </summary>
        private static void ValidateExits(StrategySpec spec, IReadOnlyCollection<EventTypeInfo> catalog, List<string> errors)
        {
            var exits = spec.Exits.Deterministic;
            bool debit = spec.Structure.DefaultStructure == RuntimeStructures.LongEquity
                         || (spec.Structure.DefaultStructure == RuntimeStructures.CustomOptions && spec.CandidateConstruction.Constraints.MaxDebit != null);
            foreach (var (name, pctOfCredit, pctOfCost) in new[]
                     {
                         ("take_profit", exits.TakeProfit?.PctOfCredit, exits.TakeProfit?.PctOfCost),
                         ("stop_loss", exits.StopLoss?.PctOfCredit, exits.StopLoss?.PctOfCost),
                     })
            {
                if (pctOfCredit == null) continue;   // la salida no está declarada
                var prefix = $"exits.deterministic.{name}";
                if (debit)
                {
                    if (pctOfCredit != 0)
                        errors.Add($"{prefix}.pct_of_credit does not apply to a debit structure (nothing is received to enter): use pct_of_cost");
                    if (pctOfCost is not double c || !(c > 0) || !double.IsFinite(c))
                        errors.Add($"{prefix}.pct_of_cost is required (and positive) for a debit structure");
                }
                else if (pctOfCost != null)
                    errors.Add($"{prefix}.pct_of_cost only applies to a debit structure (custom_options with max_debit, long_equity); use pct_of_credit");
            }

            var exitIds = new HashSet<string>();
            foreach (var ev in exits.EventExits)
            {
                var name = $"exits.deterministic.event_exits[{ev.Id}]";
                if (string.IsNullOrWhiteSpace(ev.Id)) { errors.Add("exits.deterministic.event_exits: event exit id is required"); continue; }
                if (!exitIds.Add(ev.Id)) errors.Add($"{name}: duplicate id '{ev.Id}'");
                if (ev.Must != "exist" && ev.Must != "not_exist") errors.Add($"{name}.must must be exist or not_exist, got '{ev.Must}'");
                if (ev.OnNoData != "HOLD" && ev.OnNoData != "CLOSE") errors.Add($"{name}.on_no_data must be HOLD or CLOSE");
                ValidateEventCondition(spec, catalog, name, ev.Type, ev.Subject, ev.Window, errors);
            }

            if (exits.TimeExit is TimeExit te)
            {
                bool equity = spec.Structure.DefaultStructure == RuntimeStructures.LongEquity;
                if (te.MaxDte == null && te.At == null)
                    errors.Add("exits.deterministic.time_exit must declare max_dte, at or both");
                if (te.MaxDte is int dte && dte < 0)
                    errors.Add($"exits.deterministic.time_exit.max_dte must be >= 0, got {dte}");
                if (te.MaxDte != null && equity)
                    errors.Add("exits.deterministic.time_exit.max_dte is DTE and does not apply to long_equity (no expiration): use at with days_after_entry");
                if (te.DaysAfterEntry is int days && days < 0)
                    errors.Add($"exits.deterministic.time_exit.days_after_entry must be >= 0, got {days}");
                if (te.DaysAfterEntry != null && te.At == null)
                    errors.Add("exits.deterministic.time_exit.days_after_entry needs at (HH:mm): the close happens at that time");
                if (te.At != null && te.DaysAfterEntry == null && equity)
                    errors.Add("exits.deterministic.time_exit.at needs days_after_entry for long_equity (no expiration day): 0 = same day as the entry");
                if (te.At != null)
                {
                    if (!ShadowSession.TryTime(te.At, out var at))
                        errors.Add($"exits.deterministic.time_exit.at must be HH:mm, got '{te.At}'");
                    else if (SessionRange(spec.Operational) is (TimeSpan start, TimeSpan end) && (at < start || at >= end))
                        errors.Add($"exits.deterministic.time_exit.at {te.At} must be inside operational.session_hours "
                                   + $"({spec.Operational.SessionHours.Start}-{spec.Operational.SessionHours.End}): exits are only evaluated in session");
                }
            }
        }

        private static (TimeSpan Start, TimeSpan End)? SessionRange(SpecOperational o) =>
            ShadowSession.TryTime(o.SessionHours.Start, out var s) && ShadowSession.TryTime(o.SessionHours.End, out var e) ? (s, e) : null;

        /// <summary>Capital simulado y frenos por pérdida de risk_limits (WS-0062 inc.6). Las claves desconocidas ya las rechaza el cargador.</summary>
        private static void ValidateRiskControls(StrategySpec spec, List<string> errors)
        {
            var r = spec.RiskLimits;
            const string p = "risk_limits";
            if (r.SimulatedCapitalUsd is double c && !(c > 0 && double.IsFinite(c))) errors.Add($"{p}.simulated_capital_usd must be positive");
            if (r.ReservePct is double rp && !(rp >= 0 && rp < 100)) errors.Add($"{p}.reserve_pct must be in [0, 100)");
            if (r.MaxOpenRiskPct is double mo && !(mo > 0 && mo <= 100)) errors.Add($"{p}.max_open_risk_pct must be in (0, 100]");
            if (r.MaxBetPct is double mb && !(mb > 0 && mb <= 100)) errors.Add($"{p}.max_bet_pct must be in (0, 100]");
            if ((r.ReservePct != null || r.MaxOpenRiskPct != null || r.MaxBetPct != null) && r.SimulatedCapitalUsd == null)
                errors.Add($"{p}.reserve_pct, max_open_risk_pct and max_bet_pct need risk_limits.simulated_capital_usd");
            if (r.MaxRiskPerTradePct != null && r.SimulatedCapitalUsd == null)
                errors.Add($"{p}.max_risk_per_trade_pct needs risk_limits.simulated_capital_usd (without a capital it measures nothing)");
            if (r.LossBrakes == null) return;
            if (r.LossBrakes.Count == 0) errors.Add($"{p}.loss_brakes must not be empty (omit it for no brakes)");
            foreach (var (b, i) in r.LossBrakes.Select((b, i) => (b, i)))
            {
                string q = $"{p}.loss_brakes[{i}]";
                if (!ShadowRiskControls.Periods.Contains(b.Period)) errors.Add($"{q}.period must be one of day, week, total; got '{b.Period}'");
                if (b.Basis != ShadowRiskControls.BasisRealized && b.Basis != ShadowRiskControls.BasisRealizedPlusOpen)
                    errors.Add($"{q}.basis must be realized or realized_plus_open; got '{b.Basis}'");
                if ((b.MaxLossUsd == null) == (b.MaxLossPctOfCapital == null))
                    errors.Add($"{q} must declare exactly one of max_loss_usd or max_loss_pct_of_capital");
                if (b.MaxLossUsd is double u && !(u > 0 && double.IsFinite(u))) errors.Add($"{q}.max_loss_usd must be positive");
                if (b.MaxLossPctOfCapital is double pc)
                {
                    if (!(pc > 0 && pc <= 100)) errors.Add($"{q}.max_loss_pct_of_capital must be in (0, 100]");
                    if (r.SimulatedCapitalUsd == null) errors.Add($"{q}.max_loss_pct_of_capital needs risk_limits.simulated_capital_usd");
                }
            }
            if (r.LossBrakes.GroupBy(b => b.Period).Any(g => g.Count() > 1))
                errors.Add($"{p}.loss_brakes: at most one brake per period");
        }

        /// <summary>operational.entry_window y operational.trade_limits (WS-0062 inc.5). Las claves desconocidas ya las rechaza el cargador.</summary>
        private static void ValidateOperationalWindows(SpecOperational o, List<string> errors)
        {
            bool needsZone = o.EntryWindow != null || o.TradeLimits != null;
            if (needsZone && !string.IsNullOrWhiteSpace(o.Timezone) && !ShadowSession.TryZone(o.Timezone, out _))
                errors.Add($"operational.timezone '{o.Timezone}' is not a known time zone");

            if (o.EntryWindow is EntryWindow w)
            {
                bool okStart = ShadowSession.TryTime(w.Start, out var start);
                bool okEnd = ShadowSession.TryTime(w.End, out var end);
                if (!okStart) errors.Add($"operational.entry_window.start must be HH:mm, got '{w.Start}'");
                if (!okEnd) errors.Add($"operational.entry_window.end must be HH:mm, got '{w.End}'");
                if (okStart && okEnd)
                {
                    if (end <= start)
                        errors.Add($"operational.entry_window.end ({w.End}) must be after start ({w.Start})");
                    else if (SessionRange(o) is (TimeSpan ss, TimeSpan se) && (start < ss || end > se))
                        errors.Add($"operational.entry_window {w.Start}-{w.End} must be inside operational.session_hours ({o.SessionHours.Start}-{o.SessionHours.End})");
                }
            }

            if (o.TradeLimits is SpecTradeLimits t)
            {
                const string p = "operational.trade_limits";
                if (t.MaxEntriesPerDay is int d && d <= 0) errors.Add($"{p}.max_entries_per_day must be positive");
                if (t.MaxEntriesPerWeek is int wk && wk <= 0) errors.Add($"{p}.max_entries_per_week must be positive");
                if (t.MaxEntriesPerDay is int d2 && t.MaxEntriesPerWeek is int w2 && d2 > 0 && w2 > 0 && w2 < d2)
                    errors.Add($"{p}.max_entries_per_week ({w2}) cannot be below max_entries_per_day ({d2})");
                if (t.MaxEntriesPerDay == null && t.MaxEntriesPerWeek == null)
                    errors.Add($"{p} must declare at least one limit");
            }
        }

        /// <summary>
        /// Acciones en largo (WS-0061): una sola pata BUY STOCK, instrumento EQUITY, cantidad fija de acciones en
        /// sizing.fixed_contracts. Las salidas por % del crédito y por DTE no tienen sentido sin crédito ni vencimiento.
        /// </summary>
        private static void ValidateLongEquity(StrategySpec spec, List<string> errors)
        {
            var legs = spec.CandidateConstruction.Legs;
            if (legs.Count != 1 || legs[0].Side != "BUY" || legs[0].Type != LongEquityCandidateBuilder.LegType)
                errors.Add("candidate_construction.legs must be exactly BUY STOCK for long_equity; got "
                           + (legs.Count == 0 ? "none" : string.Join(", ", legs.Select(l => $"{l.Side} {l.Type}"))));
            if (!spec.Universe.InstrumentTypes.SequenceEqual(new[] { "EQUITY" }))
                errors.Add("universe.instrument_types must be exactly [\"EQUITY\"] for long_equity");
            var constraints = spec.CandidateConstruction.Constraints;
            if (constraints.MinDte != null || constraints.MaxDte != null || constraints.MinCredit != null)
                errors.Add("candidate_construction.constraints: min_dte, max_dte and min_credit need an expiration or a credit and must be null for long_equity");
            foreach (var leg in legs)
            {
                var sel = leg.StrikeSelection;
                if (sel.Method != "NONE" || sel.TargetDelta != null || sel.Width != null)
                    errors.Add("candidate_construction.legs[BUY STOCK].strike_selection must be method NONE with target_delta and width null for long_equity");
            }
            if (spec.Exits.Deterministic.DefensiveRoll?.Enabled == true)
                errors.Add("exits.deterministic.defensive_roll must not be enabled for long_equity (long_equity has no expiration to roll)");
            var sizing = spec.CandidateConstruction.Sizing;
            if (sizing.Method != "FIXED" || sizing.FixedContracts is not > 0)
                errors.Add("candidate_construction.sizing must be FIXED with fixed_contracts > 0 (shares) for long_equity");
        }

        private static void ValidateExecution(SpecExecution? e, List<string> errors)
        {
            if (e == null) return;
            var fills = new[] { ExecutionTerms.Natural, ExecutionTerms.Mid, ExecutionTerms.MidSlippage };
            if (!fills.Contains(e.Fill))
                errors.Add($"execution.fill must be one of: {string.Join(", ", fills)}");
            if (e.Fill == ExecutionTerms.MidSlippage)
            {
                if (e.SlippagePctOfSpread is not double s || !(s >= 0 && s <= 100))
                    errors.Add("execution.slippage_pct_of_spread is required with mid_slippage and must be between 0 and 100");
            }
            else if (e.SlippagePctOfSpread != null)
                errors.Add("execution.slippage_pct_of_spread only applies with fill mid_slippage");
            foreach (var (name, value) in new[]
                     {
                         ("per_contract_usd", e.Costs?.PerContractUsd), ("per_share_usd", e.Costs?.PerShareUsd),
                         ("per_order_usd", e.Costs?.PerOrderUsd),
                     })
                if (value is double v && !(v >= 0 && v <= 1000))
                    errors.Add($"execution.costs.{name} must be between 0 and 1000, got {v}");
        }

        private static void ValidateMetricExit(MetricExit? exit, List<string> errors)
        {
            if (exit == null) return;
            if (string.IsNullOrWhiteSpace(exit.MetricRef))
                errors.Add("exits.deterministic.metric_exit.metric_ref is required");
            var validOperators = new[] { "LT", "LTE", "GT", "GTE", "EQ", "NEQ", "BETWEEN" };
            if (!validOperators.Contains(exit.Operator))
                errors.Add($"exits.deterministic.metric_exit.operator must be one of: {string.Join(", ", validOperators)}");
            else ValidateThreshold(exit.Operator, exit.Threshold, "exits.deterministic.metric_exit", errors);
        }

        /// <summary>
        /// Umbral escalar (value, o min y max para BETWEEN) o métrica contra métrica (threshold.metric_ref): uno u otro, nunca mezclados,
        /// y BETWEEN no admite una métrica (necesitaría dos).
        /// </summary>
        private static void ValidateThreshold(string op, GateThreshold t, string name, List<string> errors)
        {
            if (t.MetricRef != null)
            {
                if (string.IsNullOrWhiteSpace(t.MetricRef))
                    errors.Add($"{name}: threshold.metric_ref must not be empty");
                if (t.Value != null || t.Min != null || t.Max != null)
                    errors.Add($"{name}: threshold.metric_ref cannot be combined with threshold.value, min or max");
                if (op == "BETWEEN")
                    errors.Add($"{name}: BETWEEN does not support threshold.metric_ref (use min and max)");
                return;
            }
            if (op == "BETWEEN" ? !(t.Min.HasValue && t.Max.HasValue) : !t.Value.HasValue)
                errors.Add(op == "BETWEEN"
                    ? $"{name}: BETWEEN requires threshold.min and threshold.max"
                    : $"{name}: operator {op} requires its threshold (threshold.value or threshold.metric_ref)");
        }

        /// <summary>
        /// event_gates: tipo del catálogo del calendario (sin fuente de datos para el tipo, la spec no se despliega: antes hay que traer el dato),
        /// sujeto coherente con el tipo, ventana y must legibles.
        /// </summary>
        private static void ValidateEventGates(StrategySpec spec, IReadOnlyCollection<EventTypeInfo> catalog, List<string> errors)
        {
            var ids = new HashSet<string>();
            foreach (var g in spec.EntryFilters.GateLayer.EventGates)
            {
                var name = $"entry_filters.gate_layer.event_gates[{g.Id}]";
                if (string.IsNullOrWhiteSpace(g.Id)) { errors.Add("entry_filters.gate_layer.event_gates: event gate id is required"); continue; }
                if (!ids.Add(g.Id) || spec.EntryFilters.GateLayer.Gates.Any(x => x.Id == g.Id))
                    errors.Add($"{name}: duplicate gate id '{g.Id}'");
                if (g.Must != "exist" && g.Must != "not_exist") errors.Add($"{name}.must must be exist or not_exist, got '{g.Must}'");
                if (g.OnFail != "NO_TRADE" && g.OnFail != "INFORM_ONLY") errors.Add($"{name}.on_fail must be one of: NO_TRADE, INFORM_ONLY");
                if (g.OnNoData != "BLOCK" && g.OnNoData != "PASS" && g.OnNoData != "INFORM_ONLY") errors.Add($"{name}.on_no_data must be one of: BLOCK, PASS, INFORM_ONLY");

                ValidateEventCondition(spec, catalog, name, g.Type, g.Subject, g.Window, errors);
            }
        }

        /// <summary>Ventana, tipo (del catálogo) y sujeto de una condición de evento (event_gate o event_exit).</summary>
        private static void ValidateEventCondition(StrategySpec spec, IReadOnlyCollection<EventTypeInfo> catalog, string name,
            string type, string? subjectText, EventGateWindow w, List<string> errors)
        {
            {
                if (w.From != "day_start" && w.From != "now") errors.Add($"{name}.window.from must be day_start or now, got '{w.From}'");
                if (w.To != "day_end" && w.To != "minutes_after_now") errors.Add($"{name}.window.to must be day_end or minutes_after_now, got '{w.To}'");
                else if (w.To == "minutes_after_now" && !(w.Minutes is > 0 and <= 1440)) errors.Add($"{name}.window.minutes must be between 1 and 1440 with minutes_after_now");
                else if (w.To == "day_end" && w.Minutes != null) errors.Add($"{name}.window.minutes only applies with minutes_after_now");

                var info = catalog.FirstOrDefault(t => string.Equals(t.Type, type, StringComparison.OrdinalIgnoreCase));
                if (string.IsNullOrWhiteSpace(type)) { errors.Add($"{name}.type is required"); return; }
                if (info == null)
                {
                    errors.Add($"{name}.type '{type}': there is no data source for that event type (known: {string.Join(", ", catalog.Select(t => t.Type))}); "
                               + "the data has to be brought into GaleCore before a strategy can depend on it");
                    return;
                }
                var subject = subjectText?.ToUpperInvariant();
                if (info.PerSymbol)
                {
                    if (subject == null || subject == EventGates.Any)
                        errors.Add($"{name}.subject: {info.Type} is per symbol; use a symbol or UNIVERSE (no source lists every symbol's events)");
                    else if (subject == EventGates.Universe && spec.Universe.Symbols.Count == 0)
                        errors.Add($"{name}.subject UNIVERSE needs universe.symbols");
                }
                else if (subject != null && subject != EventGates.Any)
                    errors.Add($"{name}.subject: {info.Type} is not tied to a symbol; leave subject empty (or ANY), got '{subjectText}'");
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

                if (gate.Operator != "")
                    ValidateThreshold(gate.Operator, gate.Threshold, $"{prefix}.gates[{gate.Id}]", errors);
            }
        }
    }

    public record SpecValidationResult(bool IsValid, List<string> Errors);
}
