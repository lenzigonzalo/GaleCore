using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Construye el candidato de acciones en largo (WS-0061): una sola pata BUY del subyacente, a mid de la cotización
    /// real. Cantidad = sizing.fixed_contracts (método FIXED) interpretado como número de acciones.
    ///
    /// Convención de signos (la de los spreads): Credit = −mid (entrar cuesta, es un crédito negativo por acción);
    /// MaxRisk = costo de la posición = mid × acciones. Sin cotización utilizable (QuoteRules.IsUsable) o vieja, no
    /// hay candidato (GC-0002).
    /// </summary>
    public static class LongEquityCandidateBuilder
    {
        public const string LegType = "STOCK";

        public static async Task<CandidateBuildResult> BuildAsync(
            Func<string, CancellationToken, Task<LegQuote?>> getQuote,
            StrategyInstance instance, StrategySpec spec, string symbol, DateTime nowUtc, CancellationToken ct)
        {
            var sizing = spec.CandidateConstruction.Sizing;
            if (sizing.Method != "FIXED" || sizing.FixedContracts is not int qty || qty <= 0)
                return CandidateBuildResult.Rejected("long_equity exige sizing.method FIXED con fixed_contracts > 0 (acciones)");

            var quote = await getQuote(symbol, ct);
            if (quote == null || !QuoteRules.IsUsable(quote.Bid, quote.Ask))
                return CandidateBuildResult.Rejected($"sin cotización utilizable de {symbol}");
            var stale = DataFreshness.Problem(quote.AsOf, nowUtc, DataFreshness.MaxAge(spec));
            if (stale != null)
                return CandidateBuildResult.Rejected($"cotización de {symbol} no sirve: {stale}");

            var leg = new CandidateLeg
            {
                Side = "BUY", Type = LegType, Strike = 0, StreamerSymbol = symbol,
                Bid = quote.Bid, Ask = quote.Ask, Quantity = qty,
            };
            var mid = ShadowFillSimulator.ComputeMidPrice(leg);
            if (mid is not double m || !(m > 0))
                return CandidateBuildResult.Rejected($"mid de {symbol} no positivo");

            return CandidateBuildResult.Built(new TradeCandidate
            {
                CandidateId = Guid.NewGuid().ToString(),
                InstanceId = instance.InstanceId,
                Symbol = symbol,
                Structure = RuntimeStructures.LongEquity,
                Legs = new List<CandidateLeg> { leg },
                Credit = -m,
                MaxRisk = Math.Round(m * qty, 2),
                Width = 0,
                Dte = 0,
                Snapshot = new MarketSnapshot
                {
                    UnderlyingPrice = m, AsOf = nowUtc, OldestQuoteAt = quote.AsOf,
                    QuotesWithoutTime = quote.AsOf == null ? 1 : 0,
                },
                CreatedAt = nowUtc,
            });
        }
    }
}
