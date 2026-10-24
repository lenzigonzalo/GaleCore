using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Hard risk validation para candidatos SHADOW (P0 §8.5).
    /// Verifica reglas que NO son negociables — un candidato que no pasa no se ejecuta ni en SHADOW.
    /// Función pura: sin I/O, sin estado.
    /// </summary>
    public static class ShadowRiskValidator
    {
        public static RiskValidationResult Validate(
            TradeCandidate candidate,
            StrategySpec spec,
            int currentOpenPositions,
            double? accountNetLiq,
            DateTime? nowUtc = null)
        {
            var errors = new List<string>();

            // ── Estructura no permitida por el spec ──
            if (!spec.Structure.AllowedStrategies.Contains(candidate.Structure))
                errors.Add($"Structure '{candidate.Structure}' not in spec allowed_strategies");
            if (spec.Structure.ForbiddenStrategies.Contains(candidate.Structure))
                errors.Add($"Structure '{candidate.Structure}' is in spec forbidden_strategies");

            // ── Max concurrent positions ──
            if (spec.RiskLimits.MaxConcurrentPositions.HasValue
                && currentOpenPositions >= spec.RiskLimits.MaxConcurrentPositions.Value)
                errors.Add($"Max concurrent positions reached ({currentOpenPositions}/{spec.RiskLimits.MaxConcurrentPositions.Value})");

            // ── Risk per trade ──
            if (spec.RiskLimits.MaxRiskPerTradePct.HasValue && accountNetLiq.HasValue && accountNetLiq.Value > 0)
            {
                double maxRiskUsd = accountNetLiq.Value * (spec.RiskLimits.MaxRiskPerTradePct.Value / 100.0);
                if (candidate.MaxRisk > maxRiskUsd)
                    errors.Add($"Risk per trade ${candidate.MaxRisk:F2} exceeds {spec.RiskLimits.MaxRiskPerTradePct.Value}% of net liq (${maxRiskUsd:F2})");
            }

            // ── Max loss per trade USD ──
            if (spec.RiskLimits.MaxLossPerTradeUsd.HasValue && candidate.MaxRisk > spec.RiskLimits.MaxLossPerTradeUsd.Value)
                errors.Add($"Risk per trade ${candidate.MaxRisk:F2} exceeds max_loss_per_trade_usd ${spec.RiskLimits.MaxLossPerTradeUsd.Value:F2}");

            // ── Spread debe tener legs ──
            if (candidate.Legs.Count == 0)
                errors.Add("Candidate has no legs");

            // ── Credit debe ser positivo para credit spreads ──
            if ((candidate.Structure.Contains("credit") || RuntimeStructures.Sides(candidate.Structure) != null) && candidate.Credit <= 0)
                errors.Add($"Credit spread must have positive credit, got {candidate.Credit}");

            // ── MaxRisk debe ser positivo ──
            if (candidate.MaxRisk <= 0)
                errors.Add($"MaxRisk must be positive, got {candidate.MaxRisk}");

            // ── Freshness de las cotizaciones ──
            // Se mide con la hora que publica el proveedor (OldestQuoteAt), no con la hora en que el
            // runtime armó el snapshot: esa siempre es "ahora" y el chequeo nunca fallaría (GC-0002,
            // R1-M1). Si el proveedor no informa la hora, la edad es desconocida y no se puede medir;
            // lo que evita operar con precios viejos en ese caso es no simular fills fuera de sesión.
            // El constructor ya rechaza cada pata vieja o con hora futura; esto es la segunda barrera.
            var freshness = DataFreshness.Problem(
                candidate.Snapshot.OldestQuoteAt, nowUtc ?? DateTime.UtcNow, DataFreshness.MaxAge(spec));
            if (freshness != null)
                errors.Add($"Market snapshot not fresh: {freshness}");

            return new RiskValidationResult(errors.Count == 0, errors);
        }
    }

    public record RiskValidationResult(bool IsValid, List<string> Errors);
}
