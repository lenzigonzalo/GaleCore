using System.Globalization;
using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Application.App.Shared;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Las estructuras que el runtime SHADOW sabe construir (P1-07). Las familias son uno o dos spreads verticales de
    /// crédito del mismo vencimiento (un lado de puts, uno de calls, o los dos: iron condor); custom_options declara sus patas.
    /// </summary>
    public static class RuntimeStructures
    {
        public const string PutCreditSpread = "put_credit_spread";
        public const string CallCreditSpread = "call_credit_spread";
        public const string IronCondor = "iron_condor";

        /// <summary>Opciones con patas declaradas en la spec (WS-0062 inc.4): cualquier cantidad de patas del mismo vencimiento y raíz.</summary>
        public const string CustomOptions = "custom_options";

        /// <summary>Acciones en largo (WS-0061): una pata BUY del subyacente, sin opciones.</summary>
        public const string LongEquity = "long_equity";

        /// <summary>Métodos de selección de strike de las patas de custom_options.</summary>
        public static readonly string[] CustomLegMethods = { "DELTA", "POINTS_FROM_SPOT", "PCT_FROM_SPOT", "FIXED_STRIKE", "OFFSET_FROM_LEG" };

        public static readonly string[] Supported = { PutCreditSpread, CallCreditSpread, IronCondor, CustomOptions, LongEquity };

        public static bool IsSupported(string structure) => Sides(structure) != null || structure == LongEquity || structure == CustomOptions;

        /// <summary>Los lados ("PUT", "CALL") de la estructura, en ese orden; null si el runtime no la construye.</summary>
        public static string[]? Sides(string structure) => structure switch
        {
            PutCreditSpread => new[] { "PUT" },
            CallCreditSpread => new[] { "CALL" },
            IronCondor => new[] { "PUT", "CALL" },
            _ => null,
        };
    }

    /// <summary>
    /// Construye un TradeCandidate de opciones (PCS, CCS, iron condor o custom_options, según structure.default_structure) con datos
    /// de mercado reales. Desde WS-0062 inc.4 hay UN solo camino de construcción, <see cref="OptionStructureBuilder"/>: las familias se
    /// traducen acá a patas genéricas (la vendida por delta y la comprada a un ancho de ella, tolerancia de 1 punto; el iron condor, los dos
    /// lados) y custom_options usa las que declara la spec.
    ///
    /// Datos reales o nada (GC-0002, W-1): si falta la cadena, un strike, un delta, una cotización utilizable de cualquiera de las patas
    /// o un parámetro de la spec, no hay candidato y el resultado dice por qué. Nunca se completa un precio con cero ni un parámetro con
    /// un default. Todo lo que se registra (vencimiento, DTE, strikes, deltas, precios) es del mismo vencimiento y raíz (R1-B2).
    /// </summary>
    public class CreditSpreadCandidateBuilder
    {
        internal static readonly string[] ExpirationTypes = { "Regular", "Weekly", "End-Of-Month", "Quarterly" };   // los de índices (SPXW diarios, fin de mes, trimestrales) también

        /// <summary>Diferencia máxima (en puntos) entre el strike que pide el ancho de un spread y el que existe.</summary>
        private const double WidthStrikeTolerance = 1.0;

        private readonly IPcsMarketSource _market;

        public CreditSpreadCandidateBuilder(IPcsMarketSource market)
        {
            _market = market;
        }

        /// <summary>
        /// Construye un TradeCandidate real, o el motivo por el que no hay candidato viable.
        /// </summary>
        public async Task<CandidateBuildResult> BuildAsync(
            StrategyInstance instance,
            StrategySpec spec,
            string symbol,
            double? vixPrice,
            DateTime nowUtc,
            CancellationToken ct = default)
        {
            var cc = spec.CandidateConstruction;
            var structure = spec.Structure.DefaultStructure;
            List<LegPlan> plans;
            List<string> missing;
            if (structure == RuntimeStructures.CustomOptions)
                (plans, missing) = CustomLegPlans(cc);
            else
            {
                var sideTypes = RuntimeStructures.Sides(structure);
                if (sideTypes == null)
                    return CandidateBuildResult.Rejected($"el runtime no construye la estructura '{structure}'");
                var (familyPlans, familyMissing, error) = FamilyLegPlans(sideTypes, cc);
                if (error != null) return CandidateBuildResult.Rejected(error);
                (plans, missing) = (familyPlans, familyMissing);
            }
            return await new OptionStructureBuilder(_market).BuildAsync(instance, spec, structure, plans, missing, symbol, vixPrice, nowUtc, ct);
        }

        /// <summary>
        /// Las familias como patas genéricas: por lado, una SELL por delta y una BUY a un ancho de ella (put abajo, call arriba). Lo que la
        /// spec no declara (target_delta, delta_tolerance, width) se informa, no se completa con un default (R1-m1).
        /// </summary>
        private static (List<LegPlan> Plans, List<string> Missing, string? Error) FamilyLegPlans(string[] sideTypes, CandidateConstruction cc)
        {
            var plans = new List<LegPlan>();
            var missing = new List<string>();
            foreach (var type in sideTypes)
            {
                var sellLeg = cc.Legs.FirstOrDefault(l => l.Side == "SELL" && l.Type == type);
                var buyLeg = cc.Legs.FirstOrDefault(l => l.Side == "BUY" && l.Type == type);
                if (sellLeg == null || buyLeg == null)
                    return (plans, missing, $"la spec no declara una pata SELL {type} y una BUY {type}");
                if (sellLeg.StrikeSelection.TargetDelta == null) missing.Add("target_delta");
                if (sellLeg.StrikeSelection.DeltaTolerance == null) missing.Add("delta_tolerance");
                if (buyLeg.StrikeSelection.Width == null) missing.Add("width");
                double width = buyLeg.StrikeSelection.Width ?? 0;
                plans.Add(new LegPlan($"sell_{type}", "SELL", type, "DELTA",
                    TargetDelta: sellLeg.StrikeSelection.TargetDelta ?? 0, DeltaTolerance: sellLeg.StrikeSelection.DeltaTolerance ?? 0));
                plans.Add(new LegPlan($"buy_{type}", "BUY", type, "OFFSET_FROM_LEG",
                    FromLeg: $"sell_{type}", Offset: type == "PUT" ? -width : width, Tolerance: WidthStrikeTolerance));
            }
            return (plans, missing, null);
        }

        /// <summary>Las patas de custom_options tal como las declara la spec; lo que falta de cada selector se informa, no se completa.</summary>
        private static (List<LegPlan> Plans, List<string> Missing) CustomLegPlans(CandidateConstruction cc)
        {
            var plans = new List<LegPlan>();
            var missing = new List<string>();
            for (int i = 0; i < cc.Legs.Count; i++)
            {
                var l = cc.Legs[i];
                var s = l.StrikeSelection;
                string id = string.IsNullOrWhiteSpace(l.Id) ? $"leg{i + 1}" : l.Id!;
                var required = s.Method switch
                {
                    "DELTA" => new (string, bool)[] { ("target_delta", s.TargetDelta != null), ("delta_tolerance", s.DeltaTolerance != null) },
                    "POINTS_FROM_SPOT" => new (string, bool)[] { ("points_from_spot", s.PointsFromSpot != null) },
                    "PCT_FROM_SPOT" => new (string, bool)[] { ("pct_from_spot", s.PctFromSpot != null) },
                    "FIXED_STRIKE" => new (string, bool)[] { ("strike", s.Strike != null) },
                    "OFFSET_FROM_LEG" => new (string, bool)[] { ("from_leg", s.FromLeg != null), ("offset_points", s.OffsetPoints != null) },
                    _ => new (string, bool)[] { ($"un strike_selection.method soportado en la pata {id}", false) },
                };
                missing.AddRange(required.Where(r => !r.Item2).Select(r => r.Item1));
                plans.Add(new LegPlan(id, l.Side, l.Type, s.Method, s.TargetDelta, s.DeltaTolerance, s.PointsFromSpot, s.PctFromSpot,
                    s.Strike, s.FromLeg, s.OffsetPoints, s.TolerancePoints ?? 0));
            }
            return (plans, missing);
        }
    }
}
