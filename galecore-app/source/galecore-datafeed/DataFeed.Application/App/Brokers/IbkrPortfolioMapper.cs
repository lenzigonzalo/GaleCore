using DataFeed.Infrastructure.Providers.Ibkr;

namespace DataFeed.Application.App.Brokers
{
    public sealed class IbkrPositionView
    {
        public string Account { get; set; } = "";
        public string Symbol { get; set; } = "";
        public string? Description { get; set; }
        public string? Type { get; set; }
        public string? Market { get; set; }
        public decimal? Quantity { get; set; }
        public decimal? Multiplier { get; set; }
        public decimal? AverageCost { get; set; }
        public decimal? LastPrice { get; set; }
        public decimal? MarketValue { get; set; }
        public string? Currency { get; set; }
        public decimal? Pnl { get; set; }
        public decimal? PnlPct { get; set; }
        public string? Underlying { get; set; }
        public string? PutCall { get; set; }
        public decimal? Strike { get; set; }
        public string? Expiry { get; set; }
    }

    public sealed class IbkrBalanceView
    {
        public string Account { get; set; } = "";
        public string Currency { get; set; } = "";
        public decimal? Total { get; set; }
    }

    public sealed class IbkrNavView
    {
        public string Account { get; set; } = "";
        public string? Currency { get; set; }
        public decimal? Total { get; set; }
    }

    /// <summary>Respuesta de <c>GET /Data/Ibkr/Account/Portfolio</c> (WS-0108). Es dato de cierre: el reporte Flex no es en vivo.</summary>
    public sealed class IbkrPortfolioResponse
    {
        /// <summary>Cuándo generó IBKR el reporte (UTC).</summary>
        public DateTime? AsOf { get; set; }
        /// <summary>Fecha de cierre que cubre el reporte (yyyy-MM-dd).</summary>
        public string? ReportDate { get; set; }
        public string Source { get; set; } = "IBKR Flex";
        public List<IbkrPositionView> Positions { get; set; } = new();
        public List<IbkrBalanceView> Balances { get; set; } = new();
        public List<IbkrNavView> Nav { get; set; } = new();
    }

    /// <summary>Pasa el reporte Flex de IBKR a la forma de GaleCore. Pura, para probarla sin red.</summary>
    public static class IbkrPortfolioMapper
    {
        public static IbkrPortfolioResponse Map(IbkrFlexReport report)
        {
            var response = new IbkrPortfolioResponse
            {
                AsOf = report.Statements.Max(s => s.WhenGenerated),
                ReportDate = report.Statements.Select(s => s.ToDate).Where(d => d != null).OrderByDescending(d => d).FirstOrDefault(),
            };
            foreach (var s in report.Statements)
            {
                foreach (var p in s.Positions)
                {
                    var pnl = p.FifoPnlUnrealized;
                    response.Positions.Add(new IbkrPositionView
                    {
                        Account = s.Account,
                        Symbol = p.Symbol,
                        Description = p.Description,
                        Type = p.AssetCategory,
                        Market = p.ListingExchange,
                        Quantity = p.Quantity,
                        Multiplier = p.Multiplier,
                        AverageCost = p.CostBasisPrice,
                        LastPrice = p.MarkPrice,
                        MarketValue = p.PositionValue,
                        Currency = p.Currency,
                        Pnl = pnl,
                        // Sobre el costo en valor absoluto (en cortos el costo es negativo); sin costo no hay porcentaje.
                        PnlPct = pnl.HasValue && p.CostBasisMoney is { } cost && cost != 0 ? pnl / Math.Abs(cost) * 100m : null,
                        Underlying = p.UnderlyingSymbol,
                        PutCall = p.PutCall,
                        Strike = p.Strike,
                        Expiry = p.Expiry,
                    });
                }
                foreach (var c in s.Cash)
                    response.Balances.Add(new IbkrBalanceView { Account = s.Account, Currency = c.Currency, Total = c.EndingCash });
                if (s.Nav != null)
                    response.Nav.Add(new IbkrNavView { Account = s.Account, Currency = s.BaseCurrency, Total = s.Nav });
            }
            return response;
        }
    }
}
