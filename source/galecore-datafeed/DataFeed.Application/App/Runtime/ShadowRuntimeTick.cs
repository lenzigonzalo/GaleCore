using System.Globalization;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Horario de sesión de la spec (operational.session_hours en operational.timezone).
    ///
    /// Sin calendario de feriados: un feriado de NYSE en día hábil cuenta como sesión abierta. Es una
    /// limitación declarada de GC-0002; lo que queda cubierto es la noche y el fin de semana, cuando
    /// las cotizaciones son las del último cierre. Si la zona o el horario no se pueden leer, la
    /// sesión se considera cerrada (falla cerrado).
    /// </summary>
    public static class ShadowSession
    {
        public static bool IsOpen(SpecOperational operational, DateTime nowUtc)
        {
            if (!TryZone(operational.Timezone, out var zone)) return false;
            if (!TimeSpan.TryParseExact(operational.SessionHours.Start, @"hh\:mm", CultureInfo.InvariantCulture, out var start)
                || !TimeSpan.TryParseExact(operational.SessionHours.End, @"hh\:mm", CultureInfo.InvariantCulture, out var end))
                return false;

            var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc), zone);
            if (local.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday) return false;
            return local.TimeOfDay >= start && local.TimeOfDay < end;
        }

        private static bool TryZone(string id, out TimeZoneInfo zone)
        {
            try { zone = TimeZoneInfo.FindSystemTimeZoneById(id); return true; }
            catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException) { zone = TimeZoneInfo.Utc; return false; }
        }
    }

    /// <summary>
    /// Un tick de cada loop SHADOW, separado del BackgroundService para poder probarlo (R1-M2).
    ///
    /// Entrada: con el switch OFF no evalúa ni abre nada y no toca lo registrado; la instancia queda
    /// en PAUSED. Fuera de sesión tampoco evalúa (OUTSIDE_SESSION): no se simulan fills con
    /// cotizaciones de un mercado cerrado.
    /// Monitor: corre con el switch en cualquier estado (apagar pausa entradas, no el seguimiento de
    /// lo abierto; decisión del owner, 24/09). Fuera de sesión valúa pero no cierra.
    /// </summary>
    public static class ShadowRuntimeTick
    {
        public static class SchedulerStates
        {
            public const string Paused = "PAUSED";
            public const string OutsideSession = "OUTSIDE_SESSION";
            public const string Evaluating = "EVALUATING";
            public const string Idle = "IDLE";
            public const string SpecNotFound = "SPEC_NOT_FOUND";
        }

        /// <summary>Tick de entrada. Devuelve el outcome por símbolo evaluado (vacío si no evaluó).</summary>
        public static async Task<IReadOnlyDictionary<string, string>> RunEntryTickAsync(
            ShadowRuntimeStore store, IRuntimeMarketData data, bool switchEnabled, DateTime nowUtc, CancellationToken ct)
        {
            var outcomes = new Dictionary<string, string>();
            var instance = store.ActiveInstance();
            if (instance == null) return outcomes;

            if (!switchEnabled)
            {
                store.UpdateInstanceState(instance.InstanceId, "RUNNING", SchedulerStates.Paused);
                return outcomes;
            }

            var spec = store.GetSpec(instance.SpecName);
            if (spec == null)
            {
                // No puede pasar por deploy (valida la spec); queda visible en la instancia, sin un evento por minuto.
                store.UpdateInstanceState(instance.InstanceId, "RUNNING", SchedulerStates.SpecNotFound);
                return outcomes;
            }

            if (!ShadowSession.IsOpen(spec.Operational, nowUtc))
            {
                store.UpdateInstanceState(instance.InstanceId, "RUNNING", SchedulerStates.OutsideSession);
                return outcomes;
            }

            store.UpdateInstanceState(instance.InstanceId, "RUNNING", SchedulerStates.Evaluating);
            foreach (var symbol in spec.Universe.Symbols)
            {
                try
                {
                    outcomes[symbol] = await ShadowRuntimeEngine.EvaluateEntryAsync(
                        store, data, instance, spec, symbol, nowUtc, ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    outcomes[symbol] = "ERROR";
                    AddEvent(store, instance.InstanceId, "ERROR", symbol, nowUtc, ("error", ex.Message));
                }
            }
            store.UpdateInstanceState(instance.InstanceId, "RUNNING", SchedulerStates.Idle);
            return outcomes;
        }

        /// <summary>Tick del monitor: valúa cada posición abierta. Devuelve el outcome por posición.</summary>
        public static async Task<IReadOnlyDictionary<string, string>> RunMonitorTickAsync(
            ShadowRuntimeStore store, IRuntimeMarketData data, DateTime nowUtc, CancellationToken ct)
        {
            var outcomes = new Dictionary<string, string>();
            foreach (var pos in store.OpenPositions())
            {
                var instance = store.GetInstance(pos.InstanceId);
                var spec = instance == null ? null : store.GetSpec(instance.SpecName);
                if (spec == null)
                {
                    ShadowRuntimeEngine.RecordValuationProblems(store, pos,
                        new List<string> { $"sin spec para la instancia {pos.InstanceId}" }, nowUtc);
                    outcomes[pos.PositionId] = ShadowRuntimeEngine.Outcomes.NoData;
                    continue;
                }
                try
                {
                    outcomes[pos.PositionId] = await ShadowRuntimeEngine.ValuePositionAsync(
                        store, data, pos, spec.Exits.Deterministic, nowUtc, ct,
                        evaluateExits: ShadowSession.IsOpen(spec.Operational, nowUtc));
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    outcomes[pos.PositionId] = "ERROR";
                    AddEvent(store, pos.InstanceId, "ERROR", pos.Symbol, nowUtc,
                        ("position_id", pos.PositionId), ("error", ex.Message));
                }
            }
            return outcomes;
        }

        private static void AddEvent(ShadowRuntimeStore store, string instanceId, string type, string? symbol,
            DateTime nowUtc, params (string Key, object? Value)[] payload)
        {
            store.AddEvent(new OperationalEvent
            {
                EventId = Guid.NewGuid().ToString(),
                InstanceId = instanceId,
                EventType = type,
                Symbol = symbol,
                Payload = payload.ToDictionary(p => p.Key, p => p.Value),
                Timestamp = nowUtc,
            });
        }
    }
}
