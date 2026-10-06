using System.Globalization;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Riesgo y capital SHADOW (P1-04): la exposición agregada de lo abierto contra los límites, y el reparto de un
    /// capital («tengo X USD») con reserva, límite por operación, riesgo abierto máximo, tope por apuesta y escalera.
    ///
    /// Los límites llegan como porcentajes del capital (los declara el perfil del usuario y llegan en el pedido). Una
    /// «apuesta» agrupa las posiciones del mismo subyacente y dirección que vencen la misma semana ISO: varias chicas
    /// así son una sola. El riesgo es el máximo del spread ((ancho − crédito) × 100), como lo mide el perfil.
    /// Describe y calcula; no recomienda ni ordena. Función pura: sin I/O.
    /// </summary>
    public record CapitalLimits
    {
        public double Capital { get; init; }
        public double ReservePct { get; init; }
        public double MaxRiskPerTradePct { get; init; }
        public double MaxOpenRiskPct { get; init; }
        /// <summary>Máximo de una sola apuesta, en % del riesgo abierto permitido.</summary>
        public double MaxBetPct { get; init; }

        public double ReserveUsd => Math.Round(Capital * ReservePct / 100, 2);
        public double MaxRiskPerTradeUsd => Math.Round(Capital * MaxRiskPerTradePct / 100, 2);
        public double MaxOpenRiskUsd => Math.Round(Capital * MaxOpenRiskPct / 100, 2);
        public double MaxBetUsd => Math.Round(MaxOpenRiskUsd * MaxBetPct / 100, 2);
        /// <summary>Riesgo que se puede tomar en total: el máximo abierto, sin tocar la reserva.</summary>
        public double RiskBudgetUsd => Math.Min(MaxOpenRiskUsd, Capital - ReserveUsd);

        /// <summary>null si los límites sirven; si no, por qué.</summary>
        public string? Problem()
        {
            if (!(Capital > 0) || double.IsInfinity(Capital)) return "capital debe ser > 0";
            foreach (var (name, v) in new[] { ("reservePct", ReservePct), ("maxRiskPerTradePct", MaxRiskPerTradePct),
                         ("maxOpenRiskPct", MaxOpenRiskPct), ("maxBetPct", MaxBetPct) })
                if (double.IsNaN(v) || v < 0 || v > 100) return $"{name} debe estar entre 0 y 100";
            if (MaxRiskPerTradePct <= 0 || MaxOpenRiskPct <= 0 || MaxBetPct <= 0) return "los límites de riesgo deben ser > 0";
            return null;
        }
    }

    public record LimitCheck
    {
        public string Limit { get; init; } = "";
        public double Used { get; init; }
        public double Max { get; init; }
        public double Headroom { get; init; }
        public bool Ok { get; init; }
    }

    public record ExposureGroup
    {
        public string Key { get; init; } = "";
        public string? Symbol { get; init; }
        /// <summary>"bullish" (put credit), "bearish" (call credit), "neutral" (iron condor), "unknown".</summary>
        public string? Direction { get; init; }
        /// <summary>Semana ISO del vencimiento (p. ej. 2026-W45), en las apuestas.</summary>
        public string? ExpiryWeek { get; init; }
        public int Positions { get; init; }
        public double MaxRisk { get; init; }
        public double PctOfCapital { get; init; }
        public double PctOfMaxOpenRisk { get; init; }
        public List<string> Expirations { get; init; } = new();
        public List<string> PositionIds { get; init; } = new();
    }

    public record ExposureReport
    {
        public DateTime AsOf { get; init; }
        public CapitalLimits Limits { get; init; } = new();
        public double ReserveUsd { get; init; }
        public double MaxRiskPerTradeUsd { get; init; }
        public double MaxOpenRiskUsd { get; init; }
        public double MaxBetUsd { get; init; }
        public int PositionsOpen { get; init; }
        /// <summary>Riesgo máximo sumado de las abiertas.</summary>
        public double OpenMaxRisk { get; init; }
        public double OpenRiskPctOfCapital { get; init; }
        public double? UnrealizedPnl { get; init; }
        public int OpenNotValued { get; init; }
        /// <summary>Capital no comprometido como riesgo: capital − riesgo abierto (incluye la reserva).</summary>
        public double IdleUsd { get; init; }
        /// <summary>Riesgo nuevo que entra hoy sin pasar el máximo abierto ni tocar la reserva (≥ 0).</summary>
        public double AvailableForNewRiskUsd { get; init; }
        /// <summary>Apuestas (subyacente + dirección + semana de vencimiento), la más grande primero.</summary>
        public List<ExposureGroup> Bets { get; init; } = new();
        public List<ExposureGroup> BySymbol { get; init; } = new();
        public List<ExposureGroup> ByStrategy { get; init; } = new();
        public List<ExposureGroup> ByExpiration { get; init; } = new();
        /// <summary>Cada límite con lo usado, el máximo y el margen; los que no se cumplen con Ok = false.</summary>
        public List<LimitCheck> Checks { get; init; } = new();
    }

    /// <summary>Lo que una estrategia aporta al reparto: sus términos aprobados y lo observado en SHADOW.</summary>
    public record StrategyTerms
    {
        public string SpecName { get; init; } = "";
        public string SpecVersion { get; init; } = "";
        public string Symbol { get; init; } = "";
        public string Structure { get; init; } = "";
        /// <summary>Ancho del spread (pata FIXED_WIDTH). null si la spec no lo fija.</summary>
        public double? Width { get; init; }
        public int? MinDte { get; init; }
        public int? MaxDte { get; init; }
        public int? MinMinutesBetweenEntries { get; init; }
        public int? MaxConcurrentPositions { get; init; }
        public double? MaxLossPerTradeUsd { get; init; }
        /// <summary>Posiciones de esta estrategia con ese ancho (todas las versiones), para el riesgo y el crédito típicos.</summary>
        public List<ShadowPosition> Observed { get; init; } = new();
    }

    public record StrategyAllocation
    {
        public string SpecName { get; init; } = "";
        public string SpecVersion { get; init; } = "";
        public string Symbol { get; init; } = "";
        public string Structure { get; init; } = "";
        public double? Width { get; init; }
        /// <summary>Riesgo máximo de un contrato, en USD.</summary>
        public double? RiskPerContract { get; init; }
        /// <summary>De dónde sale: "observed" (promedio de N posiciones) o "width" (ancho sin crédito, el peor caso).</summary>
        public string RiskSource { get; init; } = "";
        public int ObservedPositions { get; init; }
        public double? AvgCredit { get; init; }
        /// <summary>DTE de entrada para estimar el vencimiento: promedio observado, o el punto medio de la spec.</summary>
        public int? EntryDte { get; init; }
        public double BudgetUsd { get; init; }
        /// <summary>Límite por operación que aplica: el menor entre el del capital y el de la spec.</summary>
        public double MaxRiskPerTradeUsd { get; init; }
        public int ContractsPerPosition { get; init; }
        public int Positions { get; init; }
        public double RiskUsd { get; init; }
        /// <summary>Posiciones de esta estrategia que entran solas en una apuesta (el tope se comparte en la escalera).</summary>
        public int PositionsPerWeek { get; init; }
        /// <summary>Qué limita la cantidad: per_trade, budget, max_concurrent, bet, no_width o missing_dte.</summary>
        public string BindingLimit { get; init; } = "";
        public bool Fits { get; init; }
        /// <summary>Si no entra un contrato: el ancho mayor que sí entraría (strikes de a 1 USD, mismo crédito relativo).</summary>
        public double? MaxWidthThatFits { get; init; }
    }

    public record LadderStep
    {
        /// <summary>Día hábil desde el inicio (1 = la primera entrada). No es una fecha: no conoce feriados.</summary>
        public int Day { get; init; }
        public int Week { get; init; }
        /// <summary>Semana estimada de vencimiento, contada desde la semana de inicio (1 = la del inicio).</summary>
        public int ExpiryWeek { get; init; }
        public string SpecName { get; init; } = "";
        public int Contracts { get; init; }
        public double RiskUsd { get; init; }
        public double CumulativeRiskUsd { get; init; }
    }

    public record AllocationPlan
    {
        public DateTime AsOf { get; init; }
        public CapitalLimits Limits { get; init; } = new();
        public double ReserveUsd { get; init; }
        public double MaxRiskPerTradeUsd { get; init; }
        public double MaxOpenRiskUsd { get; init; }
        public double MaxBetUsd { get; init; }
        public double RiskBudgetUsd { get; init; }
        public double AllocatedRiskUsd { get; init; }
        /// <summary>Presupuesto de riesgo que ninguna estrategia toma (no entra otro contrato entero).</summary>
        public double UnallocatedRiskUsd { get; init; }
        /// <summary>Lo que queda sin riesgo: capital − riesgo asignado (incluye la reserva).</summary>
        public double CashUsd { get; init; }
        public List<StrategyAllocation> Strategies { get; init; } = new();
        public List<LadderStep> Ladder { get; init; } = new();
        /// <summary>Supuestos del cálculo, para declararlos.</summary>
        public List<string> Assumptions { get; init; } = new();
        /// <summary>Estrategias pedidas cuya spec no se encontró o no se pudo leer.</summary>
        public List<string> StrategiesNotFound { get; init; } = new();
    }

    public static class ShadowCapital
    {
        public const int TradingDaysPerWeek = 5;

        public static string Direction(string structure) => structure switch
        {
            "put_credit_spread" => "bullish",
            "call_credit_spread" => "bearish",
            "iron_condor" => "neutral",
            _ => "unknown",
        };

        /// <summary>Vencimiento más cercano entre las patas (yyyy-MM-dd), o null.</summary>
        public static DateTime? Expiration(ShadowPosition p) => p.Legs
            .Select(l => DateTime.TryParse(l.Expiration, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : (DateTime?)null)
            .Where(d => d != null).Min();

        public static string? ExpiryWeek(DateTime? expiration) => expiration == null ? null
            : $"{ISOWeek.GetYear(expiration.Value)}-W{ISOWeek.GetWeekOfYear(expiration.Value):00}";

        /// <summary>Los términos de una versión aprobada y las posiciones de la estrategia con el mismo ancho.</summary>
        public static StrategyTerms Terms(StrategySpec spec, IEnumerable<SpecVersionRecord> recordsOfStrategy)
        {
            double? width = spec.CandidateConstruction.Legs
                .FirstOrDefault(l => l.StrikeSelection.Method == "FIXED_WIDTH")?.StrikeSelection.Width;
            var c = spec.CandidateConstruction.Constraints;
            return new StrategyTerms
            {
                SpecName = spec.Identity.Name,
                SpecVersion = spec.Identity.Version,
                Symbol = spec.Universe.Symbols.FirstOrDefault() ?? "",
                Structure = spec.Structure.DefaultStructure,
                Width = width,
                MinDte = c.MinDte,
                MaxDte = c.MaxDte,
                MinMinutesBetweenEntries = spec.RiskLimits.MinMinutesBetweenEntries,
                MaxConcurrentPositions = spec.RiskLimits.MaxConcurrentPositions,
                MaxLossPerTradeUsd = spec.RiskLimits.MaxLossPerTradeUsd,
                Observed = recordsOfStrategy.SelectMany(r => r.Positions)
                    .Where(p => width != null && Math.Abs(p.Width - width.Value) < 1e-9).ToList(),
            };
        }

        public static ExposureReport Exposure(IEnumerable<SpecVersionRecord> records, CapitalLimits limits, DateTime now)
        {
            var open = records.SelectMany(r => r.Positions.Where(p => p.Status == "OPEN").Select(p => (r.SpecName, P: p))).ToList();
            double openRisk = Math.Round(open.Sum(o => o.P.MaxRisk), 2);
            var valued = open.Where(o => o.P.UnrealizedPnl != null).ToList();

            ExposureGroup Group(string key, IEnumerable<(string SpecName, ShadowPosition P)> items, string? symbol = null,
                string? direction = null, string? week = null)
            {
                var list = items.ToList();
                double risk = Math.Round(list.Sum(o => o.P.MaxRisk), 2);
                return new ExposureGroup
                {
                    Key = key, Symbol = symbol, Direction = direction, ExpiryWeek = week,
                    Positions = list.Count, MaxRisk = risk,
                    PctOfCapital = Pct(risk, limits.Capital),
                    PctOfMaxOpenRisk = Pct(risk, limits.MaxOpenRiskUsd),
                    Expirations = list.Select(o => Expiration(o.P)?.ToString("yyyy-MM-dd") ?? "?").Distinct().OrderBy(e => e).ToList(),
                    PositionIds = list.Select(o => o.P.PositionId).ToList(),
                };
            }

            var bets = open.GroupBy(o => (o.P.Symbol, Dir: Direction(o.P.Structure), Week: ExpiryWeek(Expiration(o.P)) ?? "?"))
                .Select(g => Group($"{g.Key.Symbol} {g.Key.Dir} {g.Key.Week}", g, g.Key.Symbol, g.Key.Dir, g.Key.Week))
                .OrderByDescending(g => g.MaxRisk).ThenBy(g => g.Key).ToList();

            var checks = new List<LimitCheck>
            {
                Check("open_risk", openRisk, limits.MaxOpenRiskUsd),
                Check("reserve", openRisk, Math.Round(limits.Capital - limits.ReserveUsd, 2)),
            };
            checks.AddRange(bets.Select(b => Check($"bet:{b.Key}", b.MaxRisk, limits.MaxBetUsd)));
            checks.AddRange(open.Where(o => o.P.MaxRisk > limits.MaxRiskPerTradeUsd)
                .Select(o => Check($"per_trade:{o.P.PositionId}", o.P.MaxRisk, limits.MaxRiskPerTradeUsd)));

            return new ExposureReport
            {
                AsOf = now,
                Limits = limits,
                ReserveUsd = limits.ReserveUsd,
                MaxRiskPerTradeUsd = limits.MaxRiskPerTradeUsd,
                MaxOpenRiskUsd = limits.MaxOpenRiskUsd,
                MaxBetUsd = limits.MaxBetUsd,
                PositionsOpen = open.Count,
                OpenMaxRisk = openRisk,
                OpenRiskPctOfCapital = Pct(openRisk, limits.Capital),
                UnrealizedPnl = valued.Count == 0 ? null : Math.Round(valued.Sum(o => o.P.UnrealizedPnl!.Value), 2),
                OpenNotValued = open.Count - valued.Count,
                IdleUsd = Math.Round(limits.Capital - openRisk, 2),
                AvailableForNewRiskUsd = Math.Max(0, Math.Round(limits.RiskBudgetUsd - openRisk, 2)),
                Bets = bets,
                BySymbol = open.GroupBy(o => o.P.Symbol).Select(g => Group(g.Key, g, g.Key)).OrderByDescending(g => g.MaxRisk).ToList(),
                ByStrategy = open.GroupBy(o => o.SpecName).Select(g => Group(g.Key, g)).OrderByDescending(g => g.MaxRisk).ToList(),
                ByExpiration = open.GroupBy(o => Expiration(o.P)?.ToString("yyyy-MM-dd") ?? "?")
                    .Select(g => Group(g.Key, g)).OrderBy(g => g.Key).ToList(),
                Checks = checks,
            };
        }

        public static AllocationPlan Allocate(IReadOnlyList<StrategyTerms> strategies, CapitalLimits limits, DateTime now)
        {
            double budget = Math.Max(0, limits.RiskBudgetUsd);
            double share = strategies.Count == 0 ? 0 : budget / strategies.Count;
            var allocations = strategies.Select(s => AllocateOne(s, share, limits)).ToList();
            var ladder = Ladder(strategies, allocations, limits.MaxBetUsd);
            // Lo que la escalera no pudo ubicar sin pasar el tope de una apuesta no se propone.
            allocations = allocations.Select(a =>
            {
                int placed = ladder.Count(st => st.SpecName == a.SpecName);
                if (!a.Fits || placed == a.Positions) return a;
                return a with
                {
                    Positions = placed, RiskUsd = Math.Round(ladder.Where(st => st.SpecName == a.SpecName).Sum(st => st.RiskUsd), 2),
                    BindingLimit = "bet", Fits = placed > 0,
                };
            }).ToList();
            double allocated = Math.Round(allocations.Sum(a => a.RiskUsd), 2);
            return new AllocationPlan
            {
                AsOf = now,
                Limits = limits,
                ReserveUsd = limits.ReserveUsd,
                MaxRiskPerTradeUsd = limits.MaxRiskPerTradeUsd,
                MaxOpenRiskUsd = limits.MaxOpenRiskUsd,
                MaxBetUsd = limits.MaxBetUsd,
                RiskBudgetUsd = Math.Round(budget, 2),
                AllocatedRiskUsd = allocated,
                UnallocatedRiskUsd = Math.Round(budget - allocated, 2),
                CashUsd = Math.Round(limits.Capital - allocated, 2),
                Strategies = allocations,
                Ladder = ladder,
                Assumptions = new List<string>
                {
                    "El riesgo es el máximo del spread ((ancho − crédito) × 100); el stop de la estrategia puede cortar antes.",
                    "El presupuesto de riesgo se reparte en partes iguales entre las estrategias pedidas.",
                    "Escalera en días hábiles desde el inicio, al ritmo de la spec (min_minutes_between_entries; sin valor = sin espaciado, como el runtime); sin feriados.",
                    "Con tope compartido, cada día entra primero la estrategia que va antes en la lista pedida.",
                    "Vencimiento estimado = día de entrada + DTE de entrada (promedio observado o punto medio de la spec), arrancando un lunes; el runtime elige el vencimiento real dentro de la ventana de la spec.",
                    "El tope de una apuesta se comparte entre estrategias del mismo subyacente y dirección.",
                    "El reparto es para el capital pedido, aparte de lo que ya está abierto en SHADOW.",
                },
            };
        }

        private static StrategyAllocation AllocateOne(StrategyTerms s, double budget, CapitalLimits limits)
        {
            double perTrade = s.MaxLossPerTradeUsd is > 0 ? Math.Min(limits.MaxRiskPerTradeUsd, s.MaxLossPerTradeUsd.Value)
                : limits.MaxRiskPerTradeUsd;
            var observed = s.Observed.Where(p => p.MaxRisk > 0).ToList();
            double? avgCredit = observed.Count == 0 ? null : Math.Round(observed.Average(p => p.EntryCredit), 4);
            double? rpc = observed.Count > 0 ? Math.Round(observed.Average(p => p.MaxRisk), 2)
                : s.Width is > 0 ? Math.Round(s.Width.Value * 100, 2) : null;
            var baseAlloc = new StrategyAllocation
            {
                SpecName = s.SpecName, SpecVersion = s.SpecVersion, Symbol = s.Symbol, Structure = s.Structure,
                Width = s.Width, RiskPerContract = rpc, RiskSource = observed.Count > 0 ? "observed" : "width",
                ObservedPositions = observed.Count, AvgCredit = avgCredit,
                EntryDte = observed.Count > 0 ? (int)Math.Round(observed.Average(p => p.EntryDte))
                    : s.MinDte != null && s.MaxDte != null ? (s.MinDte + s.MaxDte) / 2 : s.MinDte ?? s.MaxDte,
                BudgetUsd = Math.Round(budget, 2), MaxRiskPerTradeUsd = perTrade,
            };
            if (rpc is not > 0) return baseAlloc with { BindingLimit = "no_width", RiskSource = "none" };
            // Sin DTE no se puede estimar el vencimiento ni, por lo tanto, la apuesta: no se inventa.
            if (baseAlloc.EntryDte == null) return baseAlloc with { BindingLimit = "missing_dte" };

            int contracts = (int)Math.Floor(perTrade / rpc.Value + 1e-9);
            if (contracts < 1)
            {
                // (w − c) × 100 ≤ perTrade, con c = w × crédito relativo → w ≤ perTrade / 100 / (1 − ratio).
                double ratio = s.Width is > 0 && avgCredit != null ? Math.Clamp(avgCredit.Value / s.Width.Value, 0, 0.95) : 0;
                double maxWidth = Math.Floor(perTrade / 100 / (1 - ratio) + 1e-9);
                return baseAlloc with { BindingLimit = "per_trade", MaxWidthThatFits = maxWidth >= 1 ? maxWidth : null };
            }

            double positionRisk = contracts * rpc.Value;
            int byBudget = (int)Math.Floor(budget / positionRisk + 1e-9);
            int byConcurrent = s.MaxConcurrentPositions ?? int.MaxValue;
            int positions = Math.Min(byBudget, byConcurrent);
            string binding = byBudget <= byConcurrent ? "budget" : "max_concurrent";
            int perWeek = Math.Max(0, (int)Math.Floor(limits.MaxBetUsd / positionRisk + 1e-9));
            if (perWeek == 0) { positions = 0; binding = "bet"; }
            return baseAlloc with
            {
                ContractsPerPosition = contracts,
                Positions = positions,
                RiskUsd = Math.Round(positions * positionRisk, 2),
                PositionsPerWeek = perWeek,
                BindingLimit = binding,
                Fits = positions > 0,
            };
        }

        /// <summary>Horizonte de la escalera: si en este plazo no entra una posición, no se propone.</summary>
        public const int LadderHorizonDays = 260;

        /// <summary>
        /// Escalera compartida entre estrategias: cada día hábil, cada estrategia que todavía tiene posiciones y a la
        /// que su ritmo (min_minutes_between_entries) le permite entrar, entra si la apuesta de su vencimiento
        /// (subyacente + dirección + semana de vencimiento) no pasa el tope. El vencimiento se estima como el día de
        /// entrada + el DTE de entrada (observado, o el punto medio de la spec), en días corridos desde un lunes.
        /// </summary>
        private static List<LadderStep> Ladder(IReadOnlyList<StrategyTerms> strategies, List<StrategyAllocation> allocations,
            double maxBet)
        {
            var steps = new List<LadderStep>();
            var betRisk = new Dictionary<(string, string, int), double>();
            var left = allocations.Select(a => a.Fits ? a.Positions : 0).ToArray();
            var nextDay = allocations.Select(_ => 1).ToArray();
            for (int day = 1; day <= LadderHorizonDays && left.Any(n => n > 0); day++)
            {
                int week = (day - 1) / TradingDaysPerWeek, calendar = week * 7 + (day - 1) % TradingDaysPerWeek;
                for (int i = 0; i < allocations.Count; i++)
                {
                    var a = allocations[i];
                    // null = sin espaciado (como en el runtime): puede entrar varias veces el mismo día.
                    int? minutes = strategies[i].MinMinutesBetweenEntries;
                    int cadence = minutes is > 0 ? Math.Max(1, (int)Math.Ceiling(minutes.Value / 1440.0)) : 0;
                    while (left[i] > 0 && day >= nextDay[i])
                    {
                        double risk = Math.Round(a.ContractsPerPosition * a.RiskPerContract!.Value, 2);
                        int expiryWeek = (calendar + a.EntryDte!.Value) / 7;
                        var key = (a.Symbol, Direction(a.Structure), expiryWeek);
                        double used = betRisk.GetValueOrDefault(key);
                        if (used + risk > maxBet + 1e-9) break;
                        betRisk[key] = used + risk;
                        steps.Add(new LadderStep
                        {
                            Day = day, Week = week + 1, ExpiryWeek = expiryWeek + 1, SpecName = a.SpecName,
                            Contracts = a.ContractsPerPosition, RiskUsd = risk,
                        });
                        left[i]--;
                        if (cadence > 0) { nextDay[i] = day + cadence; break; }
                    }
                }
            }
            double cumulative = 0;
            return steps.Select(s =>
            {
                cumulative += s.RiskUsd;
                return s with { CumulativeRiskUsd = Math.Round(cumulative, 2) };
            }).ToList();
        }

        private static LimitCheck Check(string name, double used, double max) => new()
        {
            Limit = name, Used = Math.Round(used, 2), Max = Math.Round(max, 2),
            Headroom = Math.Round(max - used, 2), Ok = used <= max + 1e-9,
        };

        private static double Pct(double value, double of) => of > 0 ? Math.Round(value / of * 100, 1) : 0;
    }
}
