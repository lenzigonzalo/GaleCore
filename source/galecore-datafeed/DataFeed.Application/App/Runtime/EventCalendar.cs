using System.Globalization;
using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Application.App.Shared;
using DataFeed.Application.Data.Fed.FomcMeetings;
using DataFeed.Application.Data.Fred.ReleaseDates;
using DataFeed.Application.Data.Tastytrade.MarketMetricsVolatility;
using MediatR;
using Microsoft.Extensions.Logging;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Un evento del calendario. <see cref="Type"/> es un texto del catálogo del proveedor (no un enum del runtime); <see cref="Subject"/>
    /// es el símbolo o null si el evento no es de un símbolo. Con precisión DATE, <see cref="StartUtc"/> es la medianoche UTC de esa
    /// fecha y sólo cuenta su fecha.
    /// </summary>
    public record CalendarEvent(string Type, string? Subject, DateTime StartUtc, EventPrecision Precision, string Source, DateTime RetrievedAt);

    public enum EventQueryStatus { Ok, NoData, UnknownType }

    /// <summary>OK: la lista es completa para el rango (puede estar vacía = no hay). NoData: la fuente no se pudo leer o no cubre el rango. UnknownType: no hay fuente de ese tipo.</summary>
    public record EventQueryResult(EventQueryStatus Status, IReadOnlyList<CalendarEvent> Events, string? Note = null)
    {
        public static EventQueryResult Ok(IEnumerable<CalendarEvent> events) => new(EventQueryStatus.Ok, events.ToList());
        public static EventQueryResult NoData(string note) => new(EventQueryStatus.NoData, Array.Empty<CalendarEvent>(), note);
        public static EventQueryResult Unknown(string type) => new(EventQueryStatus.UnknownType, Array.Empty<CalendarEvent>(), $"no hay fuente de datos para el tipo de evento '{type}'");
    }

    /// <summary>
    /// Lo único que el runtime le pide al calendario de eventos. El runtime no conoce tipos de evento: un proveedor (hoy compuesto por
    /// las fuentes que GaleCore ya tiene; mañana un almacén de eventos) publica su catálogo y responde consultas.
    /// </summary>
    public interface IEventCalendar
    {
        /// <summary>Tipos que este proveedor sabe responder.</summary>
        IReadOnlyCollection<EventTypeInfo> Catalog { get; }

        /// <summary>
        /// Eventos de <paramref name="type"/> (de <paramref name="subject"/> si el tipo es por símbolo; null si no) que ocurren entre
        /// <paramref name="fromUtc"/> y <paramref name="toUtc"/>. Con precisión DATE devuelve los eventos de los días que tocan el rango:
        /// decidir si caen dentro es del evaluador.
        /// </summary>
        Task<EventQueryResult> QueryAsync(string type, string? subject, DateTime fromUtc, DateTime toUtc, CancellationToken ct);
    }

    /// <summary>
    /// Proveedor compuesto sobre los handlers de GaleCore: FOMC (página de la Fed), publicaciones de FRED y próximo balance de Tastytrade.
    /// No crea tablas ni endpoints: lee lo que ya existe. Un almacén de eventos futuro es otra implementación de IEventCalendar.
    /// </summary>
    public class MediatorEventCalendar : IEventCalendar
    {
        private readonly IMediator _mediator;
        private readonly ILogger _logger;

        public MediatorEventCalendar(IMediator mediator, ILogger logger)
        {
            _mediator = mediator;
            _logger = logger;
        }

        public IReadOnlyCollection<EventTypeInfo> Catalog => EventCatalog.Builtin;

        public async Task<EventQueryResult> QueryAsync(string type, string? subject, DateTime fromUtc, DateTime toUtc, CancellationToken ct)
        {
            var info = Catalog.FirstOrDefault(t => string.Equals(t.Type, type, StringComparison.OrdinalIgnoreCase));
            if (info == null) return EventQueryResult.Unknown(type);
            try
            {
                if (info.PerSymbol && string.IsNullOrWhiteSpace(subject))
                    return EventQueryResult.NoData($"{info.Type} se consulta por símbolo y no hay fuente que liste los de todos");
                if (info.Type == EventCatalog.Fomc) return await FomcAsync(fromUtc, toUtc, ct);
                if (EventCatalog.FredReleases.TryGetValue(info.Type, out var releaseId)) return await FredAsync(info, releaseId, fromUtc, toUtc, ct);
                if (info.Type == EventCatalog.Earnings) return await EarningsAsync(info, subject!, fromUtc, toUtc, ct);
                return EventQueryResult.Unknown(type);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "EventCalendar: no se pudo leer {Type} {Subject}", type, subject);
                return EventQueryResult.NoData($"no se pudo leer la fuente de {info.Type}: {ex.Message}");
            }
        }

        private static DateTime DateUtc(DateOnly d) => DateTime.SpecifyKind(d.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc);

        /// <summary>Decisión del FOMC: 14:00 NY del último día de cada reunión. Si algún año del rango no está en la página, no se sabe.</summary>
        private async Task<EventQueryResult> FomcAsync(DateTime fromUtc, DateTime toUtc, CancellationToken ct)
        {
            if (!ShadowSession.TryZone("America/New_York", out var et)) return EventQueryResult.NoData("no se pudo leer la zona horaria de Nueva York para las 14:00 del FOMC");
            var events = new List<CalendarEvent>();
            var retrieved = DateTime.UtcNow;
            for (int year = fromUtc.Year; year <= toUtc.Year; year++)
            {
                var response = await _mediator.Send(new FomcMeetingsRequest { Years = year.ToString(CultureInfo.InvariantCulture) }, ct);
                var meetings = response?.Data?.Where(m => m.Year == year).ToList();
                // El handler falla si la página no trae el año pedido; una lista vacía tampoco es un calendario.
                if (meetings == null || meetings.Count == 0) return EventQueryResult.NoData($"el calendario del FOMC no trae {year}");
                retrieved = response!.RetrievedAt == default ? retrieved : response.RetrievedAt;
                foreach (var m in meetings)
                {
                    var start = TimeZoneInfo.ConvertTimeToUtc(m.End.ToDateTime(new TimeOnly(14, 0)), et);
                    if (start >= fromUtc && start <= toUtc)
                        events.Add(new CalendarEvent(EventCatalog.Fomc, null, start, EventPrecision.Time, "fed", retrieved));
                }
            }
            return EventQueryResult.Ok(events);
        }

        /// <summary>Publicaciones de FRED: sólo fecha. Se piden los días que tocan el rango.</summary>
        private async Task<EventQueryResult> FredAsync(EventTypeInfo info, int releaseId, DateTime fromUtc, DateTime toUtc, CancellationToken ct)
        {
            var response = await _mediator.Send(new FredReleaseDatesRequest
            {
                From = fromUtc.Date.AddDays(-1), To = toUtc.Date.AddDays(1), ReleaseIds = releaseId.ToString(CultureInfo.InvariantCulture),
            }, ct);
            if (response?.Data == null) return EventQueryResult.NoData("FRED no devolvió fechas");
            var events = response.Data
                .Where(r => DateOnly.TryParseExact(r.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
                .Select(r => DateOnly.ParseExact(r.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture))
                .Distinct().OrderBy(d => d)
                .Select(d => new CalendarEvent(info.Type, null, DateUtc(d), EventPrecision.Date, "fred", response.RetrievedAt));
            return EventQueryResult.Ok(events);
        }

        /// <summary>
        /// Próximo balance según Tastytrade. Sin fecha (ETF, índices) o con una fecha ya pasada (el proveedor no publicó la siguiente)
        /// no hay dato: NoData, nunca «no hay balance».
        /// </summary>
        private async Task<EventQueryResult> EarningsAsync(EventTypeInfo info, string symbol, DateTime fromUtc, DateTime toUtc, CancellationToken ct)
        {
            var response = await _mediator.Send(new MarketMetricsVolatilityRequest { Symbols = symbol }, ct);
            var item = response?.Items?.FirstOrDefault(i => string.Equals(i.Symbol, symbol, StringComparison.OrdinalIgnoreCase));
            var text = item?.Earnings?.ExpectedReportDate;
            if (!DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var next))
                return EventQueryResult.NoData($"sin próxima fecha de balance de {symbol} (ETF, índice o el proveedor no la informa)");
            if (next < DateOnly.FromDateTime(fromUtc.AddDays(-1)))
                return EventQueryResult.NoData($"la fecha de balance de {symbol} que informa el proveedor ({next:yyyy-MM-dd}) ya pasó: la siguiente no está publicada");
            var events = DateUtc(next) >= fromUtc.Date.AddDays(-1) && DateUtc(next) <= toUtc.Date.AddDays(1)
                ? new[] { new CalendarEvent(info.Type, symbol.ToUpperInvariant(), DateUtc(next), EventPrecision.Date, "tastytrade", DateTime.UtcNow) }
                : Array.Empty<CalendarEvent>();
            return EventQueryResult.Ok(events);
        }
    }

    /// <summary>
    /// Condición de evento de una spec (entry_filters.gate_layer.event_gates): ¿existe (must: exist) o no existe (must: not_exist) un evento
    /// de un tipo y sujeto dentro de la ventana? Lógica pura sobre un IEventCalendar; no conoce ningún tipo de evento.
    /// </summary>
    public static class EventGates
    {
        public const string Universe = "UNIVERSE";
        public const string Any = "ANY";

        /// <summary>Evalúa todas las event_gates y las suma al resultado de los gates de métricas.</summary>
        public static async Task<EvaluationResult> ApplyAsync(
            EvaluationResult eval, IReadOnlyList<EventGate> gates, IEventCalendar? calendar, SpecOperational operational,
            IReadOnlyList<string> universe, DateTime nowUtc, CancellationToken ct)
        {
            if (gates.Count == 0) return eval;
            var results = new List<GateResult>(eval.GateResults);
            bool pass = eval.OverallPass;
            foreach (var gate in gates)
            {
                var result = await EvaluateAsync(gate, calendar, operational, universe, nowUtc, ct);
                results.Add(result);
                if (result.Status == "FAIL" && gate.OnFail == "NO_TRADE") pass = false;
                if (result.Status == "NO_DATA" && gate.OnNoData == "BLOCK") pass = false;
            }
            return eval with { GateResults = results, OverallPass = pass };
        }

        public static async Task<GateResult> EvaluateAsync(
            EventGate gate, IEventCalendar? calendar, SpecOperational operational, IReadOnlyList<string> universe,
            DateTime nowUtc, CancellationToken ct)
        {
            var label = Describe(gate);
            GateResult Result(string status, double? value) => new()
            {
                GateId = gate.Id, Label = label, Status = status, Value = value, Operator = gate.Must == "exist" ? "EVENT_EXISTS" : "EVENT_NOT_EXISTS", OnFail = gate.OnFail,
            };

            if (calendar == null) return Result("NO_DATA", null);
            if (!ShadowSession.TryZone(operational.Timezone, out var zone)) return Result("NO_DATA", null);
            var window = Window(gate.Window, zone, nowUtc);
            if (window == null) return Result("NO_DATA", null);
            var (from, to, firstDate, lastDate, dayLevel) = window.Value;

            var subjects = gate.Subject?.ToUpperInvariant() switch
            {
                Universe => universe.Select(s => (string?)s).ToList(),
                null or Any => new List<string?> { null },
                var s => new List<string?> { s },
            };

            int matched = 0;
            bool unknown = false, incomplete = false, ambiguous = false;
            foreach (var subject in subjects)
            {
                var response = await QuerySafe(calendar, gate.Type, subject, from, to, ct);
                if (response.Status == EventQueryStatus.UnknownType) { unknown = true; continue; }
                if (response.Status == EventQueryStatus.NoData) { incomplete = true; continue; }
                foreach (var ev in response.Events)
                {
                    if (ev.Precision == EventPrecision.Time)
                    {
                        if (ev.StartUtc >= from && ev.StartUtc < to) matched++;
                        continue;
                    }
                    var date = DateOnly.FromDateTime(ev.StartUtc);
                    if (date < firstDate || date > lastDate) continue;
                    // Sólo el día: dentro de una ventana de día completo es un evento de la ventana; en una ventana de minutos no se puede saber
                    // si cae adentro y no se inventa una hora (NO_DATA).
                    if (dayLevel) matched++; else ambiguous = true;
                }
            }

            bool exists = matched > 0;
            if (unknown && !exists) return Result("NO_DATA", null);
            if (exists) return Result(gate.Must == "exist" ? "PASS" : "FAIL", matched);
            if (incomplete || ambiguous) return Result("NO_DATA", null);
            return Result(gate.Must == "exist" ? "FAIL" : "PASS", 0);
        }

        private static async Task<EventQueryResult> QuerySafe(
            IEventCalendar calendar, string type, string? subject, DateTime from, DateTime to, CancellationToken ct)
        {
            try { return await calendar.QueryAsync(type, subject, from, to, ct); }
            catch (Exception ex) when (ex is not OperationCanceledException) { return EventQueryResult.NoData(ex.Message); }
        }

        /// <summary>La ventana en UTC y las fechas locales que toca; day_start / day_end son el día de la zona de la spec (fin exclusivo).</summary>
        private static (DateTime From, DateTime To, DateOnly FirstDate, DateOnly LastDate, bool DayLevel)? Window(EventGateWindow w, TimeZoneInfo zone, DateTime nowUtc)
        {
            var now = DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc);
            var localNow = TimeZoneInfo.ConvertTimeFromUtc(now, zone);
            DateTime LocalToUtc(DateTime local) => TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), zone);
            var dayStart = localNow.Date;
            var dayEnd = dayStart.AddDays(1);

            DateTime from = w.From switch { "day_start" => LocalToUtc(dayStart), "now" => now, _ => default };
            DateTime to = w.To switch
            {
                "day_end" => LocalToUtc(dayEnd),
                "minutes_after_now" when w.Minutes is > 0 => now.AddMinutes(w.Minutes.Value),
                _ => default,
            };
            if (from == default || to == default || to <= from) return null;
            var firstDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(from, zone));
            var lastDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(to.AddTicks(-1), zone));
            return (from, to, firstDate, lastDate, w.From == "day_start" && w.To == "day_end");
        }

        private static string Describe(EventGate g)
        {
            var subject = g.Subject == null ? "" : $" {g.Subject}";
            var window = g.Window.To == "day_end" ? (g.Window.From == "day_start" ? "hoy" : "el resto de hoy") : $"próximos {g.Window.Minutes} min";
            return $"{g.Type}{subject} {(g.Must == "exist" ? "existe" : "no existe")} ({window})";
        }
    }
}
