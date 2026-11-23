using DataFeed.Infrastructure.Providers.Iol;

namespace DataFeed.Application.App.Brokers
{
    public sealed class IolPositionView
    {
        public string Symbol { get; set; } = "";
        public string? Description { get; set; }
        public string? Type { get; set; }
        public string? Market { get; set; }
        public decimal? Quantity { get; set; }
        public decimal? AverageCost { get; set; }
        public decimal? LastPrice { get; set; }
        public decimal? MarketValue { get; set; }
        /// <summary>ARS | USD (| MEP | CCL).</summary>
        public string? Currency { get; set; }
        public decimal? Pnl { get; set; }
        public decimal? PnlPct { get; set; }
    }

    public sealed class IolBalanceView
    {
        /// <summary>País de la cuenta: AR | US.</summary>
        public string Account { get; set; } = "";
        public string Currency { get; set; } = "";
        public decimal? Available { get; set; }
        public decimal? Total { get; set; }
    }

    /// <summary>Respuesta de <c>GET /Data/Iol/Account/Portfolio</c> (WS-0108).</summary>
    public sealed class IolPortfolioResponse
    {
        /// <summary>Hora de la consulta (UTC).</summary>
        public DateTime AsOf { get; set; }
        public string Source { get; set; } = "IOL";
        public List<IolPositionView> Positions { get; set; } = new();
        public List<IolBalanceView> Balances { get; set; } = new();
    }

    /// <summary>Pasa lo que devuelve IOL a la forma de GaleCore. Pura, para probarla sin red.</summary>
    public static class IolPortfolioMapper
    {
        public static IolPortfolioResponse Map(DateTime asOf, IolBalances ar, IolBalances us, IolPositions arPositions, IolPositions usPositions)
        {
            var response = new IolPortfolioResponse { AsOf = asOf };
            AddBalance(response, "AR", ar.Ars);
            AddBalance(response, "AR", ar.Usd);
            AddBalance(response, "US", us.Usd);
            AddPositions(response, arPositions);
            AddPositions(response, usPositions);
            return response;
        }

        private static void AddBalance(IolPortfolioResponse response, string country, IolCurrencyBalance? b)
        {
            if (b == null) return;
            response.Balances.Add(new IolBalanceView
            {
                Account = country,
                Currency = NormalizeCurrency(b.Currency) ?? "",
                Available = b.Available?.T0,
                Total = b.Totals?.T0,
            });
        }

        private static void AddPositions(IolPortfolioResponse response, IolPositions data)
        {
            foreach (var p in data.Positions ?? new List<IolPosition>())
            {
                var price = p.MarketValue?.CurrentPrice;
                // La API no trae el valor total de la posición. Se toma el costo más la ganancia no realizada (cierra con la
                // contabilidad del broker aunque el precio sea por cada 100 nominales, como los bonos); si falta alguno,
                // cantidad por precio.
                decimal? value = p.CostBasis?.TotalCost is { } cost && p.ProfitLoss?.UnrealizedPl is { } pl
                    ? cost + pl
                    : p.Quantity.HasValue && price.HasValue ? p.Quantity * price : null;
                response.Positions.Add(new IolPositionView
                {
                    Symbol = p.Instrument?.Symbol ?? "",
                    Description = p.Instrument?.Name,
                    Type = p.Instrument?.Type ?? p.Instrument?.AssetClass,
                    Market = p.Instrument?.Exchange,
                    Quantity = p.Quantity,
                    AverageCost = p.CostBasis?.AverageEntryPrice,
                    LastPrice = price,
                    MarketValue = value,
                    // Moneda de valuación de la cuenta; si no vino, la del instrumento.
                    Currency = NormalizeCurrency(data.Currency) ?? NormalizeCurrency(p.Instrument?.Currency),
                    Pnl = p.ProfitLoss?.UnrealizedPl,
                    PnlPct = p.ProfitLoss?.UnrealizedPlPercent,
                });
            }
        }

        /// <summary>ARS / USD tal cual vengan; «peso_Argentino» y «dolar_Estadounidense» (nombres largos) se normalizan.</summary>
        public static string? NormalizeCurrency(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            var v = raw.Trim().ToLowerInvariant();
            if (v.StartsWith("peso")) return "ARS";
            if (v.StartsWith("dolar") || v.StartsWith("dólar")) return "USD";
            return raw.Trim().ToUpperInvariant();
        }
    }
}
