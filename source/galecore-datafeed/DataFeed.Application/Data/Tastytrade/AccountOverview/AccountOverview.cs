using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json.Nodes;
using DataFeed.Application.Data.Tastytrade.AccountSpreads;
using MediatR;

namespace DataFeed.Application.Data.Tastytrade.AccountOverview
{
    /// <summary>
    /// Inicio de la cuenta real (WS-0036): cuánta plata hay, qué riesgo tenemos, a qué estamos expuestos y qué pide
    /// atención hoy. Todo calculado acá; el Monitor sólo lo muestra.
    /// </summary>
    public class AccountOverviewRequest : IRequest<AccountOverviewResponse>
    {
        public string? AccountNumber { get; set; }
        /// <summary>galecore_rules_core.json: lo pone el controller (gestión y límites del nodo `monitor`).</summary>
        public string? RulesJson { get; set; }
    }

    public class AccountOverviewResponse
    {
        public DateTime AsOf { get; set; }
        public double NetLiq { get; set; }
        public double Cash { get; set; }
        /// <summary>Poder de compra para opciones (el que limita abrir spreads).</summary>
        public double BuyingPower { get; set; }
        public double? DayPnl { get; set; }
        public double? DayPnlPct { get; set; }
        public double? OpenPnl { get; set; }
        /// <summary>Resultado por período: hoy (de las posiciones) y semana, mes y año (del valor de la cuenta).</summary>
        public List<PeriodPnlDto> Periods { get; set; } = new();
        /// <summary>Margen usado (requerimiento de mantenimiento de Tastytrade), en USD y en % del valor de la cuenta.</summary>
        public double? MarginUsed { get; set; }
        public double? MarginUsedPct { get; set; }
        /// <summary>Pérdida máxima sumada de lo abierto (spreads), en USD y en % de la cuenta.</summary>
        public double MaxRisk { get; set; }
        public double? MaxRiskPct { get; set; }
        /// <summary>Límite de riesgo de cartera de la config (portfolio_heat_max_pct), en %.</summary>
        public double? MaxRiskLimitPct { get; set; }
        public ExposureDto Exposure { get; set; } = new();
        public List<AttentionDto> Attention { get; set; } = new();
        /// <summary>Una fila por posición (spread o acción), lista para mostrar.</summary>
        public List<PositionLineDto> Positions { get; set; } = new();
        /// <summary>Lo que no se pudo leer (fuente caída, sin cotización); se declara, no se inventa.</summary>
        public List<string> Missing { get; set; } = new();
    }

    public class ExposureDto
    {
        /// <summary>Delta de la cartera ponderada por beta, en acciones de SPY (como el encabezado de Tastytrade).</summary>
        public double? SpyEquivalentShares { get; set; }
        /// <summary>Lo mismo en dólares de SPY: si SPY sube 1 %, la cartera gana aproximadamente el 1 % de esto.</summary>
        public double? SpyEquivalentDollars { get; set; }
        public double? Theta { get; set; }
        public double? Vega { get; set; }
        public List<UnderlyingExposureDto> ByUnderlying { get; set; } = new();
    }

    public class UnderlyingExposureDto
    {
        public string Symbol { get; set; } = "";
        /// <summary>Delta en dólares (acciones equivalentes × precio).</summary>
        public double? DollarDelta { get; set; }
        public double? Beta { get; set; }
        public double MaxRisk { get; set; }
    }

    /// <summary>
    /// Una posición en una línea: qué es, cuánto va ganando y su objetivo. Mientras el usuario no defina el suyo, el
    /// objetivo es el de las reglas de la plataforma (toma de ganancia y defensa del nodo `monitor`).
    /// </summary>
    public class PositionLineDto
    {
        public string Id { get; set; } = "";
        public string Symbol { get; set; } = "";
        /// <summary>PUT_CS, CALL_CS, IC o EQUITY.</summary>
        public string Structure { get; set; } = "";
        public string? Expiration { get; set; }
        public int? Dte { get; set; }
        public double Quantity { get; set; }
        public double? ShortPutStrike { get; set; }
        public double? LongPutStrike { get; set; }
        public double? ShortCallStrike { get; set; }
        public double? LongCallStrike { get; set; }
        public double? Spot { get; set; }
        public double? Pnl { get; set; }
        /// <summary>En un spread, % del crédito cobrado; en acciones, % del costo.</summary>
        public double? PnlPct { get; set; }
        /// <summary>Objetivo en USD: ganancia a la que se cierra y pérdida a la que se defiende.</summary>
        public double? TakeProfit { get; set; }
        public double? StopLoss { get; set; }
        /// <summary>"reglas" (de la plataforma) mientras el usuario no ponga el suyo.</summary>
        public string? TargetSource { get; set; }

        // Detalle para Cartera (WS-0036): los mismos números que Inicio, sin recalcular en el Monitor.
        /// <summary>Crédito cobrado y valor de cierre hoy, por acción como los cotiza el bróker (spreads).</summary>
        public double? Credit { get; set; }
        public double? CurrentValue { get; set; }
        /// <summary>Pérdida máxima en USD (spreads).</summary>
        public double? MaxLoss { get; set; }
        /// <summary>Probabilidad de ganar al vencimiento, en %.</summary>
        public double? Pop { get; set; }
        public double? Delta { get; set; }
        public double? Theta { get; set; }
        public double? Vega { get; set; }
        /// <summary>Puntos del precio al strike vendido más cercano (negativo: ya lo pasó).</summary>
        public double? ShortDistance { get; set; }
        /// <summary>Acciones: precio promedio de compra y valor de mercado hoy.</summary>
        public double? AverageOpenPrice { get; set; }
        public double? MarketValue { get; set; }
    }

    public class PeriodPnlDto
    {
        public string Label { get; set; } = "";
        public double? Pnl { get; set; }
        public double? Pct { get; set; }
    }

    public class AttentionDto
    {
        /// <summary>"gestion" (una regla de la posición) o "evento" (algo que puede mover lo que tenemos).</summary>
        public string Kind { get; set; } = "";
        public string Title { get; set; } = "";
    }

    public record CalendarEvent(DateOnly Date, string Name);

    /// <summary>Puro: arma Inicio con lo ya leído. Sin red, para poder probarlo.</summary>
    public static class AccountOverviewBuilder
    {
        private static readonly CultureInfo Es = new("es-AR");

        public static readonly Dictionary<string, string> EventNames = new(StringComparer.OrdinalIgnoreCase)
        {
            ["Consumer Price Index"] = "inflación de EE. UU. (CPI)",
            ["Producer Price Index"] = "precios mayoristas de EE. UU. (PPI)",
            ["Advance Monthly Sales for Retail and Food Services"] = "ventas minoristas de EE. UU.",
            ["Employment Situation"] = "empleo de EE. UU. (nóminas)",
            ["Gross Domestic Product"] = "PIB de EE. UU.",
            ["Personal Income and Outlays"] = "ingreso y gasto personal de EE. UU. (PCE)",
            ["FOMC"] = "decisión de tasas de la Fed (FOMC)",
        };

        public static AccountOverviewResponse Build(
            double netLiq, double cash, double buyingPower, AccountSpreadsResponse account,
            IReadOnlyDictionary<string, double> betas, JsonObject? rules, DateOnly today,
            IReadOnlyList<CalendarEvent> events, List<string> missing)
        {
            var spreads = account.Spreads;
            var equities = account.Equities;
            var prices = account.UnderlyingPrices;

            var dayParts = spreads.Select(s => s.DayPnl).Concat(equities.Select(e => e.DayPnl)).ToList();
            var openParts = spreads.Select(s => s.OpenPnl).Concat(equities.Select(e => e.OpenPnl)).ToList();
            double? dayPnl = dayParts.Count > 0 && dayParts.All(v => v != null) ? dayParts.Sum(v => v!.Value) : null;
            double? openPnl = openParts.Count > 0 && openParts.All(v => v != null) ? openParts.Sum(v => v!.Value) : null;
            var maxRisk = spreads.Sum(s => s.MaxLoss);

            var monitor = rules?["monitor"];
            var heat = (double?)monitor?["risk_limits"]?["portfolio_heat_max_pct"];

            var response = new AccountOverviewResponse
            {
                AsOf = DateTime.UtcNow,
                NetLiq = R(netLiq), Cash = R(cash), BuyingPower = R(buyingPower),
                DayPnl = dayPnl == null ? null : R(dayPnl.Value),
                DayPnlPct = dayPnl != null && netLiq - dayPnl.Value > 0 ? R(dayPnl.Value / (netLiq - dayPnl.Value) * 100) : null,
                OpenPnl = openPnl == null ? null : R(openPnl.Value),
                MaxRisk = R(maxRisk),
                MaxRiskPct = netLiq > 0 ? R(maxRisk / netLiq * 100) : null,
                MaxRiskLimitPct = heat == null ? null : R(heat.Value * 100),
                Exposure = Exposure(spreads, equities, prices, betas),
                Missing = missing,
            };
            if (dayPnl == null && (spreads.Count > 0 || equities.Count > 0))
                response.Missing.Add("Resultado del día: sin cotización en vivo de alguna posición.");

            response.Attention.AddRange(Management(spreads, monitor, today));
            response.Positions.AddRange(Lines(spreads, equities, prices, monitor, today));
            if (spreads.Count > 0 || equities.Count > 0)   // hay exposición a EE. UU.: los datos y la Fed la mueven
                response.Attention.AddRange(Events(events, today));
            return response;
        }

        private static ExposureDto Exposure(List<AccountSpreadDto> spreads, List<AccountEquityDto> equities,
            IReadOnlyDictionary<string, double> prices, IReadOnlyDictionary<string, double> betas)
        {
            var symbols = spreads.Select(s => s.UnderlyingSymbol).Concat(equities.Select(e => e.Symbol)).Distinct().ToList();
            var rows = new List<UnderlyingExposureDto>();
            var complete = true;
            foreach (var sym in symbols)
            {
                var mine = spreads.Where(s => s.UnderlyingSymbol == sym).ToList();
                var shares = mine.Any(s => s.Greeks == null) ? (double?)null
                    : mine.Sum(s => s.Greeks!.Delta) + equities.Where(e => e.Symbol == sym).Sum(e => e.Quantity);
                double? dollars = shares != null && prices.TryGetValue(sym, out var px) ? shares.Value * px : null;
                double? beta = betas.TryGetValue(sym, out var b) ? b : sym == "SPY" ? 1.0 : null;
                if (dollars == null || beta == null) complete = false;
                rows.Add(new UnderlyingExposureDto
                {
                    Symbol = sym, DollarDelta = dollars == null ? null : R(dollars.Value), Beta = beta,
                    MaxRisk = R(mine.Sum(s => s.MaxLoss)),
                });
            }

            var greeks = spreads.Select(s => s.Greeks).ToList();
            var allGreeks = greeks.All(g => g != null);
            double? spyDollars = complete ? rows.Sum(r => r.DollarDelta!.Value * r.Beta!.Value) : null;
            return new ExposureDto
            {
                SpyEquivalentDollars = spyDollars == null ? null : R(spyDollars.Value),
                SpyEquivalentShares = spyDollars != null && prices.TryGetValue("SPY", out var spy) && spy > 0 ? R(spyDollars.Value / spy) : null,
                Theta = allGreeks ? R(greeks.Sum(g => g!.Theta)) : null,
                Vega = allGreeks ? R(greeks.Sum(g => g!.Vega)) : null,
                ByUnderlying = rows.OrderByDescending(r => Math.Abs(r.DollarDelta ?? 0)).ThenByDescending(r => r.MaxRisk).ToList(),
            };
        }

        /// <summary>
        /// Las reglas de gestión del nodo `monitor` (las mismas que el Monitor calculaba en el front): toma de
        /// ganancia, defensa, roleo y salida por tiempo. Una línea por posición, la más importante.
        /// </summary>
        public static IEnumerable<AttentionDto> Management(List<AccountSpreadDto> spreads, JsonNode? monitor, DateOnly today)
        {
            var tm = monitor?["trade_management"];
            var takeProfit = (double?)tm?["take_profit"]?["pct_of_initial_credit"] ?? 0.5;
            var hardLoss = (double?)tm?["hard_defense"]?["trigger_any"]?["unrealized_loss_pct_of_initial_credit_gte"] ?? 2.0;
            var rollLoss = (double?)tm?["defensive_roll"]?["trigger_unrealized_loss_pct_of_initial_credit_gte"] ?? 1.0;
            var rollMinDte = (int?)tm?["defensive_roll"]?["min_dte_remaining"] ?? 28;
            var timeDte = (int?)tm?["time_exit"]?["dte_threshold"] ?? 21;

            foreach (var s in spreads)
            {
                var label = Label(s);
                var dte = DateOnly.TryParse(s.Expiration, CultureInfo.InvariantCulture, out var exp) ? exp.DayNumber - today.DayNumber : (int?)null;
                var pct = s.OpenPnl != null && s.MaxProfit > 0 ? s.OpenPnl.Value / s.MaxProfit : (double?)null;
                string? title =
                    pct != null && pct >= takeProfit ? string.Create(Es, $"{label}: llegó a la toma de ganancia ({pct * 100:0} % del crédito)") :
                    pct != null && pct <= -hardLoss ? string.Create(Es, $"{label}: la pérdida llegó a {-pct:0.#}× el crédito (defensa)") :
                    dte != null && dte <= timeDte ? string.Create(Es, $"{label}: quedan {dte} días, salida por tiempo") :
                    pct != null && pct <= -rollLoss && dte >= rollMinDte ? string.Create(Es, $"{label}: pérdida de {-pct:0.#}× el crédito con {dte} días, evaluar roleo") :
                    null;
                if (title != null) yield return new AttentionDto { Kind = "gestion", Title = title };
            }
        }

        public static IEnumerable<PositionLineDto> Lines(List<AccountSpreadDto> spreads, List<AccountEquityDto> equities,
            IReadOnlyDictionary<string, double> prices, JsonNode? monitor, DateOnly today)
        {
            var tm = monitor?["trade_management"];
            var takeProfit = (double?)tm?["take_profit"]?["pct_of_initial_credit"] ?? 0.5;
            var hardLoss = (double?)tm?["hard_defense"]?["trigger_any"]?["unrealized_loss_pct_of_initial_credit_gte"] ?? 2.0;
            foreach (var s in spreads)
            {
                int? dte = DateOnly.TryParse(s.Expiration, CultureInfo.InvariantCulture, out var exp) ? exp.DayNumber - today.DayNumber : null;
                yield return new PositionLineDto
                {
                    Id = s.Id, Symbol = s.UnderlyingSymbol, Structure = s.Structure, Expiration = s.Expiration, Dte = dte,
                    Quantity = (double)s.Contracts,
                    ShortPutStrike = s.ShortPutStrike, LongPutStrike = s.LongPutStrike,
                    ShortCallStrike = s.ShortCallStrike, LongCallStrike = s.LongCallStrike,
                    Spot = prices.TryGetValue(s.UnderlyingSymbol, out var px) ? px : null,
                    Pnl = s.OpenPnl, PnlPct = s.OpenPnl != null && s.MaxProfit > 0 ? R(s.OpenPnl.Value / s.MaxProfit * 100) : null,
                    TakeProfit = R(s.MaxProfit * takeProfit), StopLoss = R(-Math.Min(s.MaxProfit * hardLoss, s.MaxLoss)),
                    TargetSource = "reglas",
                    Credit = s.InitialCredit, CurrentValue = s.CurrentNetCredit, MaxLoss = R(s.MaxLoss), Pop = s.Pop,
                    Delta = s.Greeks?.Delta, Theta = s.Greeks?.Theta, Vega = s.Greeks?.Vega,
                    ShortDistance = prices.TryGetValue(s.UnderlyingSymbol, out var sp) ? ShortDistance(s, sp) : null,
                };
            }
            foreach (var e in equities)
            {
                var cost = Math.Abs(e.AverageOpenPrice * e.Quantity);
                yield return new PositionLineDto
                {
                    Id = e.Symbol, Symbol = e.Symbol, Structure = "EQUITY", Quantity = e.Quantity, Spot = e.Mid,
                    Pnl = e.OpenPnl, PnlPct = e.OpenPnl != null && cost > 0 ? R(e.OpenPnl.Value / cost * 100) : null,
                    AverageOpenPrice = e.AverageOpenPrice, MarketValue = e.Mid == null ? null : R(e.Mid.Value * e.Quantity),
                    Delta = e.Quantity,
                };
            }
        }

        /// <summary>
        /// Hoy sale de las posiciones (como el encabezado de los brokers); semana, mes y año, de la diferencia del valor de
        /// la cuenta contra el cierre del último día hábil anterior a cada fecha. Los depósitos y retiros entran en la
        /// diferencia: Tastytrade no los separa en esta historia.
        /// </summary>
        public static List<PeriodPnlDto> Periods(double netLiq, double? dayPnl, double? dayPct,
            IReadOnlyList<(DateOnly Date, double Close)>? history, DateOnly today)
        {
            var list = new List<PeriodPnlDto> { new() { Label = "Hoy", Pnl = dayPnl, Pct = dayPct } };
            foreach (var (label, from) in new[] { ("Semana", today.AddDays(-7)), ("Mes", today.AddMonths(-1)), ("Año", new DateOnly(today.Year, 1, 1)) })
            {
                // El cierre del último día antes del período; en el año, si la cuenta es más nueva, su primer cierre.
                var anchor = history?.Where(h => h.Date < from).Select(h => (double?)h.Close).LastOrDefault()
                    ?? (label == "Año" ? history?.Select(h => (double?)h.Close).FirstOrDefault() : null);
                list.Add(anchor is > 0 ? new() { Label = label, Pnl = R(netLiq - anchor.Value), Pct = R((netLiq / anchor.Value - 1) * 100) }
                    : new() { Label = label });
            }
            return list;
        }

        /// <summary>Datos de EE. UU. y la Fed de hoy a dos días hábiles.</summary>
        public static IEnumerable<AttentionDto> Events(IReadOnlyList<CalendarEvent> events, DateOnly today)
        {
            foreach (var e in events.Where(e => e.Date >= today).OrderBy(e => e.Date).DistinctBy(e => (e.Date, e.Name)))
            {
                var ahead = BusinessDays(today, e.Date);
                if (ahead > 2) continue;
                var when = ahead == 0 ? "Hoy" : ahead == 1 ? "Mañana" : e.Date.ToString("dddd d/M", Es);
                var name = EventNames.TryGetValue(e.Name, out var n) ? n : e.Name;
                yield return new AttentionDto { Kind = "evento", Title = $"{Capitalize(when)}: {name}" };
            }
        }

        /// <summary>Puntos al strike vendido más cercano: spot − put vendido o call vendido − spot, el menor.</summary>
        public static double? ShortDistance(AccountSpreadDto s, double spot)
        {
            var gaps = new List<double>();
            if (s.ShortPutStrike is double put) gaps.Add(spot - put);
            if (s.ShortCallStrike is double call) gaps.Add(call - spot);
            return gaps.Count == 0 ? null : R(gaps.Min());
        }

        public static string Label(AccountSpreadDto s)
        {
            var exp = DateOnly.TryParse(s.Expiration, CultureInfo.InvariantCulture, out var d) ? d.ToString("dd/MM") : s.Expiration;
            var kind = s.Structure switch { "PUT_CS" => "put spread", "CALL_CS" => "call spread", "IC" => "iron condor", _ => s.Structure };
            return $"{s.UnderlyingSymbol} {kind} · vence {exp}";
        }

        private static int BusinessDays(DateOnly from, DateOnly to)
        {
            var n = 0;
            for (var d = from; d < to; d = d.AddDays(1))
                if (d.AddDays(1).DayOfWeek is not DayOfWeek.Saturday and not DayOfWeek.Sunday) n++;
            return n;
        }

        private static string Capitalize(string s) => s.Length == 0 ? s : char.ToUpper(s[0]) + s[1..];
        private static double R(double v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);
    }
}
