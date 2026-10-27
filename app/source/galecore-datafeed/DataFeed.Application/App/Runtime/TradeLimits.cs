using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Límites de frecuencia de entradas que la spec se impone (operational.trade_limits, WS-0062 inc.5). Función pura: recibe las posiciones de
    /// la estrategia (abiertas y cerradas) y la hora. Sin límite declarado, nunca bloquea. Días y semanas (lunes a domingo) se cuentan en
    /// operational.timezone.
    /// </summary>
    public static class TradeLimits
    {
        /// <summary>El motivo por el que una entrada nueva en <paramref name="nowUtc"/> rompería un límite, o null si puede entrar.</summary>
        public static string? BlockReason(StrategySpec spec, IReadOnlyCollection<ShadowPosition> positions, DateTime nowUtc)
        {
            if (spec.Operational.TradeLimits is not SpecTradeLimits limits) return null;
            if (limits.MaxEntriesPerDay == null && limits.MaxEntriesPerWeek == null) return null;
            if (ShadowSession.LocalTime(spec.Operational, nowUtc) is not DateTime now)
                return $"zona horaria ilegible ({spec.Operational.Timezone}): no se pueden contar las entradas del día";

            var entryDates = positions.Select(p => ShadowSession.LocalTime(spec.Operational, p.EntryAt)?.Date).Where(d => d != null).Select(d => d!.Value).ToList();
            if (limits.MaxEntriesPerDay is int perDay)
            {
                int today = entryDates.Count(d => d == now.Date);
                if (today >= perDay) return $"máximo de entradas por día alcanzado ({today}/{perDay})";
            }
            if (limits.MaxEntriesPerWeek is int perWeek)
            {
                var monday = now.Date.AddDays(-(((int)now.DayOfWeek + 6) % 7));
                int week = entryDates.Count(d => d >= monday && d < monday.AddDays(7));
                if (week >= perWeek) return $"máximo de entradas por semana alcanzado ({week}/{perWeek})";
            }
            return null;
        }
    }
}
