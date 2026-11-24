using DataFeed.Infrastructure.Providers.Iol;

namespace DataFeed.Application.App.Brokers
{
    public sealed class IolPositionView
    {
        /// <summary>País de la cuenta: AR | US.</summary>
        public string Account { get; set; } = "";
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
        /// <summary>Avisos de la consulta, p. ej. una cuenta de IOL que no respondió y quedó afuera.</summary>
        public List<string> Warnings { get; set; } = new();
    }

    /// <summary>Pasa lo que devuelve IOL a la forma de GaleCore. Pura, para probarla sin red.</summary>
    public static class IolPortfolioMapper
    {
        public static IolPortfolioResponse Map(DateTime asOf, IolBalances? ar, IolBalances? us, IolPositions? arPositions, IolPositions? usPositions)
        {
            var response = new IolPortfolioResponse { AsOf = asOf };
            AddBalance(response, "AR", ar?.Ars);
            AddBalance(response, "AR", ar?.Usd);
            AddBalance(response, "US", us?.Usd);
            AddPositions(response, "AR", arPositions);
            AddPositions(response, "US", usPositions);
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

        private static void AddPositions(IolPortfolioResponse response, string country, IolPositions? data)
        {
            if (data == null) return;
            foreach (var p in data.Positions ?? new List<IolPosition>())
            {
                var price = p.MarketValue?.CurrentPrice;
                // La API no trae el valor total de la posición: cantidad por precio, dividido por 100 si el precio es por cada
                // 100 nominales (bonos y letras). La escala se deduce de la ganancia no realizada (que viene bien escalada);
                // si no alcanza, del tipo de instrumento. El costo total del broker no se usa: no viene escalado.
                decimal? value = p.Quantity is { } qty && price is { } px ? qty * px / PriceScale(p, qty, px) : null;
                response.Positions.Add(new IolPositionView
                {
                    Account = country,
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

        private static decimal PriceScale(IolPosition p, decimal qty, decimal price)
        {
            var avg = p.CostBasis?.AverageEntryPrice;
            var pnl = p.ProfitLoss?.UnrealizedPl;
            if (avg is { } a && pnl is { } l && l != 0)
            {
                var ratio = qty * (price - a) / l;
                if (Math.Abs(ratio - 100m) <= 1m) return 100m;
                if (Math.Abs(ratio - 1m) <= 0.01m) return 1m;
            }
            var type = p.Instrument?.Type?.ToUpperInvariant() ?? "";
            return type.Contains("PUBLICO") || type.Contains("LETRA") || type.Contains("OBLIGACION") ? 100m : 1m;
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
