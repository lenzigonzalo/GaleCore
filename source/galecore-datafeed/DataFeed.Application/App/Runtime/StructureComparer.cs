using System.Globalization;
using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Application.App.Shared;
using DataFeed.Application.Functions;

namespace DataFeed.Application.App.Runtime
{
    public record StructureGreeks(double Delta, double Gamma, double ThetaPerDay, double VegaPerVolPoint);

    public record StructureScenario(string Name, double Spot, double VolShift, double Pnl);

    public record StructureOption
    {
        public string Structure { get; init; } = "";
        public bool ExecutableToday { get; init; }
        public string? Note { get; init; }
        public double? Credit { get; init; }
        public double? MaxRisk { get; init; }
        public double? Capital { get; init; }
        public List<double>? Breakevens { get; init; }
        public StructureGreeks? Greeks { get; init; }
        public List<StructureScenario>? Scenarios { get; init; }
        public double? TouchProbability { get; init; }
        public List<CandidateLeg>? Legs { get; init; }
    }

    public record StructureComparison
    {
        public string Symbol { get; init; } = "";
        public double? Spot { get; init; }
        public string? Expiration { get; init; }
        public int? Dte { get; init; }
        public DateTime AsOf { get; init; }
        public string? Error { get; init; }
        public List<StructureOption> Structures { get; init; } = new();
        public List<string> Assumptions { get; init; } = new();
    }

    /// <summary>
    /// PCS, CCS, iron condor y «esperar» para la misma tesis (WS-0016, AC-03/04), con la cadena real.
    ///
    /// El PCS y el CCS son candidatos del constructor del runtime (<see cref="CreditSpreadCandidateBuilder"/>): el CCS es el
    /// espejo del PCS en calls (mismo rango de DTE, |delta| y ancho) y el IC, la suma de los dos. Las griegas y los escenarios salen de
    /// Black-Scholes con la IV de cada pata (tasa 0): el P&amp;L de un escenario es el cambio del valor modelado, así el
    /// sesgo del modelo contra el mid se cancela. Probabilidad de tocar el strike vendido ≈ 2 × |delta|.
    /// Datos reales o nada: si falta una pata, esa estructura dice por qué y no lleva números.
    /// Las tres se ejecutan en SHADOW desde P1-07 (<see cref="RuntimeStructures"/>): la spec elige con default_structure.
    /// </summary>
    public class StructureComparer
    {
        private const double VolJump = 0.05;
        private static readonly (string Name, double Move)[] Gaps = { ("gap -5%", -0.05), ("gap -3%", -0.03), ("gap +3%", 0.03), ("gap +5%", 0.05) };

        private readonly IPcsMarketSource _market;

        public StructureComparer(IPcsMarketSource market)
        {
            _market = market;
        }

        public async Task<StructureComparison> CompareAsync(
            string symbol, double delta, double deltaTolerance, double width, int minDte, int maxDte,
            DateTime nowUtc, CancellationToken ct = default)
        {
            var spec = SideSpec(RuntimeStructures.PutCreditSpread, delta, deltaTolerance, width, minDte, maxDte);
            var assumptions = new List<string>
            {
                string.Create(CultureInfo.InvariantCulture, $"PCS: el constructor del runtime con delta {-Math.Abs(delta)} ± {deltaTolerance}, ancho {width}, DTE {minDte}-{maxDte}, sin crédito mínimo"),
                "CCS: espejo en calls (mismo vencimiento, delta en valor absoluto y ancho); IC = PCS + CCS",
                string.Create(CultureInfo.InvariantCulture, $"griegas y escenarios: Black-Scholes con la IV de cada pata, tasa 0, sin dividendos; salto de vol = +{VolJump * 100:0} puntos"),
                "probabilidad de tocar ≈ 2 × delta (valor absoluto) del strike vendido; en IC, la suma, tope 1",
                "crédito y breakevens en puntos del subyacente por acción; riesgo, capital, griegas y P&L en USD por contrato (×100)",
            };
            var wait = new StructureOption { Structure = "wait", ExecutableToday = true, Note = "no abre posición: sin crédito ni riesgo" };

            var built = await new CreditSpreadCandidateBuilder(_market).BuildAsync(
                new StrategyInstance { InstanceId = "structures" }, spec, symbol, null, nowUtc, ct);
            if (built.Candidate is not TradeCandidate pcs)
                return new StructureComparison
                {
                    Symbol = symbol, AsOf = nowUtc, Error = $"sin PCS: {built.RejectReason}",
                    Structures = { wait }, Assumptions = assumptions,
                };

            double spot = pcs.Snapshot.UnderlyingPrice!.Value;
            string expiration = pcs.Legs[0].Expiration!;

            // La misma consulta de griegas que hizo el constructor: IV de las patas y strikes de calls.
            var gex = await _market.GetGammaExposureAsync(new GammaExposureRequest
            {
                Symbol = symbol, TargetDte = pcs.Dte, MaxDTE = maxDte,
                ExpirationTypes = new[] { "Regular", "Weekly" }, IncludeZeroDte = minDte == 0,
            }, ct);
            if (gex?.Strikes == null || gex.Expiration != expiration)
                return new StructureComparison
                {
                    Symbol = symbol, Spot = spot, Expiration = expiration, Dte = pcs.Dte, AsOf = nowUtc,
                    Error = $"las griegas no son del vencimiento {expiration}",
                    Structures = { wait }, Assumptions = assumptions,
                };

            var pcsLegs = WithIv(pcs.Legs, gex.Strikes);
            if (pcsLegs == null)
                return new StructureComparison
                {
                    Symbol = symbol, Spot = spot, Expiration = expiration, Dte = pcs.Dte, AsOf = nowUtc,
                    Error = "sin IV para una pata del PCS", Structures = { wait }, Assumptions = assumptions,
                };
            var (ccsLegs, ccsError) = await CallSideAsync(symbol, delta, deltaTolerance, width, minDte, maxDte, expiration, gex.Strikes, nowUtc, ct);

            var structures = new List<StructureOption>
            {
                Option("put_credit_spread", true, null, pcsLegs, spot, pcs.Dte),
                ccsLegs == null
                    ? new StructureOption { Structure = "call_credit_spread", Note = ccsError }
                    : Option("call_credit_spread", true, null, ccsLegs, spot, pcs.Dte),
                ccsLegs == null
                    ? new StructureOption { Structure = "iron_condor", Note = ccsError }
                    : Option("iron_condor", true, null, pcsLegs.Concat(ccsLegs).ToList(), spot, pcs.Dte),
                wait,
            };
            return new StructureComparison
            {
                Symbol = symbol, Spot = spot, Expiration = expiration, Dte = pcs.Dte, AsOf = nowUtc,
                Structures = structures, Assumptions = assumptions,
            };
        }

        private record PricedLeg(CandidateLeg Leg, double Iv)
        {
            public int Sign => Leg.Side == "BUY" ? 1 : -1;
            public bool IsCall => Leg.Type == "CALL";
            public double Mid => ((Leg.Bid ?? 0) + (Leg.Ask ?? 0)) / 2;
        }

        /// <summary>Las patas con su IV; null si a alguna le falta (sin IV no hay escenarios).</summary>
        private static List<PricedLeg>? WithIv(List<CandidateLeg> legs, List<GammaExposureStrike> strikes)
        {
            var priced = legs.Select(l =>
            {
                var s = strikes.FirstOrDefault(x => x.Strike == l.Strike);
                return new PricedLeg(l, s == null ? 0 : l.Type == "CALL" ? s.CallIV : s.PutIV);
            }).ToList();
            return priced.All(l => l.Iv > 0) ? priced : null;
        }

        /// <summary>
        /// El CCS del constructor del runtime, con la IV de sus patas. Tiene que salir del mismo vencimiento que el PCS: si
        /// no, la suma no sería un iron condor.
        /// </summary>
        private async Task<(List<PricedLeg>? Legs, string? Error)> CallSideAsync(
            string symbol, double delta, double tolerance, double width, int minDte, int maxDte, string expiration,
            List<GammaExposureStrike> strikes, DateTime nowUtc, CancellationToken ct)
        {
            var built = await new CreditSpreadCandidateBuilder(_market).BuildAsync(
                new StrategyInstance { InstanceId = "structures" },
                SideSpec(RuntimeStructures.CallCreditSpread, delta, tolerance, width, minDte, maxDte), symbol, null, nowUtc, ct);
            if (built.Candidate is not TradeCandidate ccs)
                return (null, built.RejectReason);
            if (ccs.Legs[0].Expiration != expiration)
                return (null, $"el CCS salió del vencimiento {ccs.Legs[0].Expiration}, no del {expiration} del PCS");
            var legs = WithIv(ccs.Legs, strikes);
            return legs == null ? (null, "sin IV para una pata del CCS") : (legs, null);
        }

        private static StructureOption Option(string structure, bool executable, string? note, List<PricedLeg> legs, double spot, int dte)
        {
            double credit = Math.Round(-legs.Sum(l => l.Sign * l.Mid), 2);
            double putWidth = Width(legs, call: false), callWidth = Width(legs, call: true);
            double maxRisk = Math.Round((Math.Max(putWidth, callWidth) - credit) * 100, 2);

            var breakevens = new List<double>();
            var shortPut = legs.FirstOrDefault(l => l.Sign < 0 && !l.IsCall);
            var shortCall = legs.FirstOrDefault(l => l.Sign < 0 && l.IsCall);
            if (shortPut != null) breakevens.Add(Math.Round(shortPut.Leg.Strike - credit, 2));
            if (shortCall != null) breakevens.Add(Math.Round(shortCall.Leg.Strike + credit, 2));

            double touch = Math.Min(1, legs.Where(l => l.Sign < 0).Sum(l => 2 * Math.Abs(l.Leg.Delta ?? 0)));

            double value0 = Value(legs, spot, 0, dte);
            var scenarios = Gaps.Select(g => (g.Name, Spot: spot * (1 + g.Move), Vol: 0.0))
                .Append((Name: $"vol +{VolJump * 100:0} pts", Spot: spot, Vol: VolJump))
                .Select(s => new StructureScenario(s.Name, Math.Round(s.Spot, 2), s.Vol,
                    Math.Round((Value(legs, s.Spot, s.Vol, dte) - value0) * 100, 2)))
                .ToList();

            return new StructureOption
            {
                Structure = structure,
                ExecutableToday = executable,
                Note = note,
                Credit = credit,
                MaxRisk = maxRisk,
                Capital = maxRisk,
                Breakevens = breakevens,
                Greeks = Greeks(legs, spot, dte),
                Scenarios = scenarios,
                TouchProbability = Math.Round(touch, 3),
                Legs = legs.Select(l => l.Leg).ToList(),
            };
        }

        private static double Width(List<PricedLeg> legs, bool call)
        {
            var side = legs.Where(l => l.IsCall == call).Select(l => l.Leg.Strike).ToList();
            return side.Count == 2 ? Math.Abs(side[0] - side[1]) : 0;
        }

        /// <summary>Valor modelado de la posición (comprado +, vendido −) por acción.</summary>
        private static double Value(List<PricedLeg> legs, double spot, double volShift, int dte) =>
            legs.Sum(l => l.Sign * BlackScholes.Price(l.IsCall, spot, l.Iv + volShift, l.Leg.Strike, dte, 0));

        private static StructureGreeks Greeks(List<PricedLeg> legs, double spot, int dte)
        {
            double d = 0, g = 0, t = 0, v = 0;
            foreach (var l in legs)
            {
                var x = l.IsCall
                    ? BlackScholes.CallGreeks(spot, l.Iv, l.Leg.Strike, dte, 0)
                    : BlackScholes.PutGreeks(spot, l.Iv, l.Leg.Strike, dte, 0);
                d += l.Sign * x.Delta; g += l.Sign * x.Gamma; t += l.Sign * x.Theta; v += l.Sign * x.Vega;
            }
            // Por contrato: theta anual → por día, vega por 1.00 de vol → por punto.
            return new StructureGreeks(Math.Round(d * 100, 2), Math.Round(g * 100, 4), Math.Round(t * 100 / 365, 2), Math.Round(v, 2));
        }

        /// <summary>Un lado (PCS o CCS) para el constructor: delta con el signo de su tipo, sin crédito mínimo.</summary>
        private static StrategySpec SideSpec(string structure, double delta, double tolerance, double width, int minDte, int maxDte)
        {
            var type = structure == RuntimeStructures.PutCreditSpread ? "PUT" : "CALL";
            double signed = type == "PUT" ? -Math.Abs(delta) : Math.Abs(delta);
            return new()
            {
                Structure = new SpecStructure { DefaultStructure = structure },
                CandidateConstruction = new CandidateConstruction
                {
                    Legs = new()
                    {
                        new LegTemplate { Side = "SELL", Type = type, StrikeSelection = new LegStrikeSelection { TargetDelta = signed, DeltaTolerance = tolerance } },
                        new LegTemplate { Side = "BUY", Type = type, StrikeSelection = new LegStrikeSelection { Width = width } },
                    },
                    Constraints = new ConstructionConstraints { MinDte = minDte, MaxDte = maxDte, MinCredit = 0 },
                },
            };
        }
    }
}
