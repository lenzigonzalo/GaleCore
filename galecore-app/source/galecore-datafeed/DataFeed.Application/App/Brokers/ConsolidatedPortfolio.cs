using System.Globalization;
using DataFeed.Application.Data.Tastytrade.AccountBalances;
using DataFeed.Application.Data.Tastytrade.AccountPositions;
using Newtonsoft.Json;

namespace DataFeed.Application.App.Brokers
{
    /// <summary>Cotización usada para pasar pesos a dólares (MEP, venta).</summary>
    public sealed class FxView
    {
        public string Pair { get; set; } = "ARS/USD";
        public string Name { get; set; } = "MEP";
        public string Casa { get; set; } = "bolsa";
        public decimal Rate { get; set; }

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public string? AsOf { get; set; }

        public string Source { get; set; } = "dolarapi";
    }

    /// <summary>Un broker en la cartera consolidada. Status: ok | partial | error | missing | invalid | excluded | soon.</summary>
    public sealed class BrokerSliceView
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public string Status { get; set; } = "";

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public string? Message { get; set; }

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public string? Source { get; set; }

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public DateTime? AsOf { get; set; }

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public string? ReportDate { get; set; }

        /// <summary>Dato de cierre (no en vivo).</summary>
        public bool IsClose { get; set; }

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public decimal? TotalUsd { get; set; }

        public List<string> Warnings { get; set; } = new();
    }

    public sealed class ConsolidatedPositionView
    {
        public string Broker { get; set; } = "";

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)] public string? Account { get; set; }
        public string Symbol { get; set; } = "";
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)] public string? Description { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)] public string? Type { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)] public decimal? Quantity { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)] public decimal? AverageCost { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)] public decimal? LastPrice { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)] public decimal? MarketValue { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)] public string? Currency { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)] public decimal? MarketValueUsd { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)] public decimal? Pnl { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)] public decimal? PnlUsd { get; set; }
    }

    public sealed class ConsolidatedCashView
    {
        public string Broker { get; set; } = "";

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)] public string? Account { get; set; }
        public string Currency { get; set; } = "";
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)] public decimal? Amount { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)] public decimal? AmountUsd { get; set; }
    }

    /// <summary>Respuesta de <c>GET /Data/Portfolio/Consolidated</c> (WS-0108): la cartera de todos los brokers en dólares.</summary>
    public sealed class ConsolidatedPortfolioResponse
    {
        public DateTime AsOf { get; set; }
        public string BaseCurrency { get; set; } = "USD";

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public FxView? Fx { get; set; }

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public decimal? TotalUsd { get; set; }

        public List<BrokerSliceView> Brokers { get; set; } = new();
        public List<ConsolidatedPositionView> Positions { get; set; } = new();
        public List<ConsolidatedCashView> Cash { get; set; } = new();
        public List<string> Notes { get; set; } = new();
    }

    /// <summary>Lo que aporta un broker: su slice más sus posiciones y saldos ya en el modelo único.</summary>
    public sealed record SliceData(BrokerSliceView Slice, List<ConsolidatedPositionView> Positions, List<ConsolidatedCashView> Cash);

    /// <summary>Arma la cartera consolidada a partir de lo que devolvió cada broker. Pura, para probarla sin red.</summary>
    public static class PortfolioConsolidator
    {
        // ── conversión ────────────────────────────────────────────────────────────────────────────────────────

        /// <summary>
        /// Pasa un monto a dólares: USD (y MEP/CCL de IOL, que son dólares) igual; ARS con la venta del MEP; otra moneda con
        /// <paramref name="fxRateToBase"/> si la base es USD. Null si no se puede convertir. Redondea a 2 decimales.
        /// </summary>
        public static decimal? ToUsd(decimal? amount, string? currency, FxView? fx, decimal? fxRateToBase, string? baseCurrency)
        {
            if (amount == null || string.IsNullOrWhiteSpace(currency)) return null;
            var cur = currency.Trim().ToUpperInvariant();
            if (cur is "USD" or "MEP" or "CCL") return Math.Round(amount.Value, 2);
            if (cur == "ARS") return fx is { Rate: > 0 } ? Math.Round(amount.Value / fx.Rate, 2) : null;
            if (fxRateToBase is { } rate && string.Equals(baseCurrency, "USD", StringComparison.OrdinalIgnoreCase))
                return Math.Round(amount.Value * rate, 2);
            return null;
        }

        // ── por broker ────────────────────────────────────────────────────────────────────────────────────────

        public static SliceData FromTastytrade(BrokerView broker, AccountBalancesResponse balances, AccountPositionsResponse positions, FxView? fx)
        {
            var slice = NewSlice(broker, "Tastytrade");
            slice.AsOf = DateTime.TryParse(balances.UpdatedAt, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var at) ? at : null;
            var rows = new List<(ConsolidatedPositionView View, decimal? Rate)>();
            foreach (var p in positions.Positions ?? new List<AccountPositionDto>())
            {
                var sign = string.Equals(p.QuantityDirection, "Short", StringComparison.OrdinalIgnoreCase) ? -1m : 1m;
                rows.Add((new ConsolidatedPositionView
                {
                    Broker = broker.Id,
                    Account = p.AccountNumber,
                    Symbol = p.Symbol,
                    Type = p.InstrumentType,
                    Quantity = p.Quantity,
                    AverageCost = p.AverageOpenPrice,
                    LastPrice = p.ClosePrice,
                    MarketValue = p.Quantity * p.ClosePrice * p.Multiplier * sign,
                    Currency = "USD",
                    Pnl = (p.ClosePrice - p.AverageOpenPrice) * p.Quantity * p.Multiplier * sign,
                }, null));
            }
            var cash = new List<(ConsolidatedCashView View, decimal? Rate)>
            {
                (new ConsolidatedCashView { Broker = broker.Id, Account = balances.AccountNumber, Currency = "USD", Amount = balances.CashBalance }, null),
            };
            return Finish(slice, rows, cash, fx, "USD");
        }

        public static SliceData FromIol(BrokerView broker, IolPortfolioResponse portfolio, FxView? fx)
        {
            var slice = NewSlice(broker, portfolio.Source);
            slice.AsOf = portfolio.AsOf;
            slice.Warnings.AddRange(portfolio.Warnings);
            var rows = portfolio.Positions.Select(p => (new ConsolidatedPositionView
            {
                Broker = broker.Id,
                Account = p.Account,
                Symbol = p.Symbol,
                Description = p.Description,
                Type = p.Type,
                Quantity = p.Quantity,
                AverageCost = p.AverageCost,
                LastPrice = p.LastPrice,
                MarketValue = p.MarketValue,
                Currency = p.Currency,
                Pnl = p.Pnl,
            }, (decimal?)null)).ToList();
            var cash = portfolio.Balances.Select(b => (new ConsolidatedCashView
            {
                Broker = broker.Id,
                Account = b.Account,
                Currency = b.Currency,
                Amount = b.Total,
            }, (decimal?)null)).ToList();
            return Finish(slice, rows, cash, fx, "USD");
        }

        public static SliceData FromIbkr(BrokerView broker, IbkrPortfolioResponse portfolio, FxView? fx)
        {
            var slice = NewSlice(broker, portfolio.Source);
            slice.AsOf = portfolio.AsOf;
            slice.ReportDate = portfolio.ReportDate;
            slice.IsClose = true;
            var baseCurrency = portfolio.Nav.Select(n => n.Currency).FirstOrDefault(c => !string.IsNullOrEmpty(c)) ?? "USD";
            var rows = portfolio.Positions.Select(p => (new ConsolidatedPositionView
            {
                Broker = broker.Id,
                Account = p.Account,
                Symbol = p.Symbol,
                Description = p.Description,
                Type = p.Type,
                Quantity = p.Quantity,
                AverageCost = p.AverageCost,
                LastPrice = p.LastPrice,
                MarketValue = p.MarketValue,
                Currency = p.Currency,
                Pnl = p.Pnl,
            }, p.FxRateToBase)).ToList();
            var cash = portfolio.Balances.Select(b => (new ConsolidatedCashView
            {
                Broker = broker.Id,
                Account = b.Account,
                Currency = b.Currency,
                Amount = b.Total,
            }, (decimal?)null)).ToList();
            var data = Finish(slice, rows, cash, fx, baseCurrency);
            // El aviso de cierre es informativo: no vuelve «partial» al broker.
            if (!string.IsNullOrEmpty(portfolio.ReportDate)) slice.Warnings.Add($"Dato del cierre del {portfolio.ReportDate}.");
            return data;
        }

        /// <summary>Slice de un broker que no se pidió o no respondió: sin datos y con su motivo.</summary>
        public static SliceData Empty(BrokerView broker, string status, string? message) =>
            new(new BrokerSliceView { Id = broker.Id, Name = broker.Name, Status = status, Message = message }, new(), new());

        private static BrokerSliceView NewSlice(BrokerView broker, string source) =>
            new() { Id = broker.Id, Name = broker.Name, Status = "ok", Source = source };

        /// <summary>Convierte a USD, avisa las monedas sin convertir una sola vez y fija el total y el estado del slice.</summary>
        private static SliceData Finish(BrokerSliceView slice, List<(ConsolidatedPositionView View, decimal? Rate)> rows,
            List<(ConsolidatedCashView View, decimal? Rate)> cash, FxView? fx, string baseCurrency)
        {
            var unconverted = new List<string>();
            void Missed(string? currency)
            {
                var key = string.IsNullOrWhiteSpace(currency) ? "Moneda desconocida" : currency.Trim().ToUpperInvariant();
                if (!unconverted.Contains(key)) unconverted.Add(key);
            }

            foreach (var (v, rate) in rows)
            {
                v.MarketValueUsd = ToUsd(v.MarketValue, v.Currency, fx, rate, baseCurrency);
                v.PnlUsd = ToUsd(v.Pnl, v.Currency, fx, rate, baseCurrency);
                if ((v.MarketValue != null && v.MarketValueUsd == null) || (v.Pnl != null && v.PnlUsd == null)) Missed(v.Currency);
            }
            foreach (var (v, rate) in cash)
            {
                v.AmountUsd = ToUsd(v.Amount, v.Currency, fx, rate, baseCurrency);
                if (v.Amount != null && v.AmountUsd == null) Missed(v.Currency);
            }
            foreach (var c in unconverted) slice.Warnings.Add($"{c} sin convertir: no suma al total.");

            if (rows.Count + cash.Count > 0)
                slice.TotalUsd = Math.Round(rows.Sum(r => r.View.MarketValueUsd ?? 0m) + cash.Sum(c => c.View.AmountUsd ?? 0m), 2);
            if (slice.Warnings.Count > 0) slice.Status = "partial";
            return new SliceData(slice, rows.Select(r => r.View).ToList(), cash.Select(c => c.View).ToList());
        }

        // ── total ─────────────────────────────────────────────────────────────────────────────────────────────

        public static ConsolidatedPortfolioResponse Combine(DateTime asOf, FxView? fx, IEnumerable<SliceData> slices)
        {
            var list = slices.ToList();
            var response = new ConsolidatedPortfolioResponse { AsOf = asOf, Fx = fx };
            foreach (var s in list)
            {
                response.Brokers.Add(s.Slice);
                response.Positions.AddRange(s.Positions);
                response.Cash.AddRange(s.Cash);
            }
            var totals = list.Where(s => s.Slice.TotalUsd != null).Select(s => s.Slice.TotalUsd!.Value).ToList();
            if (totals.Count > 0) response.TotalUsd = Math.Round(totals.Sum(), 2);

            if (fx != null) response.Notes.Add("Pesos a dólares con el MEP (venta) de DolarAPI.");
            else if (response.Positions.Any(p => IsArs(p.Currency) && (p.MarketValue != null || p.Pnl != null))
                     || response.Cash.Any(c => IsArs(c.Currency) && c.Amount != null))
                response.Notes.Add("Sin cotización MEP: los pesos no se pasan a dólares.");
            return response;
        }

        private static bool IsArs(string? currency) => string.Equals(currency?.Trim(), "ARS", StringComparison.OrdinalIgnoreCase);
    }
}
