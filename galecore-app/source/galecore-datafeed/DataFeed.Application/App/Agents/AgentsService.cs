using System.Security.Cryptography;
using System.Text;
using DataFeed.Infrastructure.Providers.Tastytrade;
using DataFeed.Repositories.Entities;

namespace DataFeed.Application.App.Agents
{
    public enum AgentOutcome { Ok, NotFound, Invalid, NoToken, RateLimited, TokenRejected, RoutinePaused, UpstreamFailed }

    /// <summary>Corrida tal como la ve el usuario; <see cref="Status"/> ya trae el estado derivado (<c>no_report</c>).</summary>
    public sealed record AgentRunView(
        Guid Id, string AgentKey, string Origin, string Status, string? Summary, string? ReasonCode, string? TriggerId,
        string? SessionUrl, string? SessionId, DateTime? RequestedAt, DateTime? FiredAt, DateTime? FinishedAt, DateTime CreatedAt,
        string? ResultJson = null);

    /// <summary>Aviso de un agente tal como lo ve el usuario (WS-0099).</summary>
    public sealed record AgentAlertView(string AlertId, string AgentKey, string Title, DateTime CreatedAt);

    public sealed record AlertInput(string? Id, string? Title);

    public sealed record ReportInput(string? Status, string? Summary, string? ReasonCode, string? TriggerId, DateTime? FiredAt, DateTime? FinishedAt,
        string? ResultJson = null, IReadOnlyList<AlertInput>? Alerts = null);

    public sealed record AgentResult<T>(AgentOutcome Outcome, T? Value = default, string? Error = null, int? RetryAfterSeconds = null);

    public sealed record FireTokenStatus(bool Exists, string? TriggerId, string? TokenHint, DateTime? UpdatedAt, DateTime? LastFiredAt);

    public sealed record GeneratedKey(string Key, string Hint, DateTime CreatedAt);

    public sealed record KeyStatus(bool Exists, string? Hint, DateTime? CreatedAt);

    /// <summary>
    /// Agentes que corren solos (WS-0079): clave de identidad por usuario, reporte de corridas, token de disparo y
    /// ejecución sin PC. Todo se resuelve por dueño: nadie ve ni dispara agentes, corridas o tokens de otro.
    /// </summary>
    public sealed class AgentsService
    {
        public const string KeyPrefix = "gca_";
        public static readonly TimeSpan FireInterval = TimeSpan.FromMinutes(5);
        public static readonly TimeSpan ManualMatchWindow = TimeSpan.FromHours(2);
        public static readonly TimeSpan AlertWindow = TimeSpan.FromDays(7);
        public static readonly TimeSpan NoReportAfter = TimeSpan.FromMinutes(30);
        public const string NoReportStatus = "no_report";
        public const string TokenRejectedMessage = "el token de esta rutina no anda: generá otro en claude.ai";

        private static readonly string[] ReportStatuses = { "ok", "error", "skipped" };

        private readonly IAgentStore _store;
        private readonly ITokenProtector _protector;
        private readonly IRoutineFireClient _fire;
        private readonly TimeProvider _time;

        public AgentsService(IAgentStore store, ITokenProtector protector, IRoutineFireClient fire, TimeProvider? time = null)
        {
            _store = store;
            _protector = protector;
            _fire = fire;
            _time = time ?? TimeProvider.System;
        }

        private DateTime Now => _time.GetUtcNow().UtcDateTime;

        // ── Clave de agentes ───────────────────────────────────────────────────────────────────────────────────

        public static string Hash(string key) =>
            Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key))).ToLowerInvariant();

        /// <summary>Genera (o regenera, invalidando la anterior) la clave. En claro sólo sale acá.</summary>
        public async Task<GeneratedKey> GenerateKeyAsync(Guid ownerId, CancellationToken ct)
        {
            var raw = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
            var key = KeyPrefix + raw;
            var now = Now;
            var hint = key[^4..];
            await _store.UpsertKeyAsync(ownerId, Hash(key), hint, now, ct);
            return new GeneratedKey(key, hint, now);
        }

        public async Task<KeyStatus> KeyStatusAsync(Guid ownerId, CancellationToken ct)
        {
            var k = await _store.GetKeyByOwnerAsync(ownerId, ct);
            return k == null ? new KeyStatus(false, null, null) : new KeyStatus(true, k.KeyHint, k.CreatedAt);
        }

        public Task<bool> RevokeKeyAsync(Guid ownerId, CancellationToken ct) => _store.DeleteKeyAsync(ownerId, ct);

        /// <summary>Dueño de una clave de agentes, o null si no existe. Compara el hash en tiempo constante.</summary>
        public async Task<Guid?> ResolveKeyAsync(string? key, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return null;
            var hash = Hash(key.Trim());
            var row = await _store.GetKeyByHashAsync(hash, ct);
            if (row == null) return null;
            return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(row.KeyHash), Encoding.ASCII.GetBytes(hash))
                ? row.OwnerId : null;
        }

        // ── Lectura de skills (clave de agentes) ───────────────────────────────────────────────────────────────

        /// <summary>
        /// La skill con esa clave para el dueño de la clave: primero la suya, si no una compartida por otro. Sólo el kind
        /// <c>skill</c>; una privada de otro o cualquier otro kind es NotFound.
        /// </summary>
        public async Task<AgentResult<AgentSkillRow>> GetSkillAsync(Guid ownerId, string skillKey, CancellationToken ct)
        {
            var rows = await _store.GetSkillsAsync(ownerId, skillKey, ct);
            var skill = rows.Where(r => r.Kind == "skill" && r.Key == skillKey)
                .Where(r => r.OwnerId == ownerId || r.Visibility == "shared")
                .OrderByDescending(r => r.OwnerId == ownerId).ThenByDescending(r => r.UpdatedAt)
                .FirstOrDefault();
            return skill == null ? new(AgentOutcome.NotFound, Error: "No existe esa skill, o no es tuya ni compartida.") : new(AgentOutcome.Ok, skill);
        }

        // ── Reporte de corridas ────────────────────────────────────────────────────────────────────────────────

        public async Task<AgentResult<AgentRunView>> ReportAsync(Guid ownerId, string agentKey, ReportInput input, CancellationToken ct)
        {
            if (!await _store.AgentExistsAsync(ownerId, agentKey, ct)) return new(AgentOutcome.NotFound, Error: "No existe ese agente.");

            var status = (input.Status ?? "").Trim().ToLowerInvariant();
            if (!ReportStatuses.Contains(status))
                return new(AgentOutcome.Invalid, Error: "status es uno de: ok, error, skipped");
            var summary = input.Summary ?? "";
            if (summary.Length > AgentRun.MaxSummaryLength)
                return new(AgentOutcome.Invalid, Error: $"summary admite hasta {AgentRun.MaxSummaryLength} caracteres");
            if (input.ReasonCode is { Length: > 64 }) return new(AgentOutcome.Invalid, Error: "reason_code admite hasta 64 caracteres");
            if (input.TriggerId is { Length: > 200 }) return new(AgentOutcome.Invalid, Error: "trigger_id admite hasta 200 caracteres");
            if (input.ResultJson is { Length: > AgentRun.MaxResultLength })
                return new(AgentOutcome.Invalid, Error: $"result admite hasta {AgentRun.MaxResultLength} caracteres");
            var alerts = input.Alerts ?? Array.Empty<AlertInput>();
            if (alerts.Count > AgentAlert.MaxPerReport)
                return new(AgentOutcome.Invalid, Error: $"alerts admite hasta {AgentAlert.MaxPerReport} avisos");
            if (alerts.Any(a => string.IsNullOrWhiteSpace(a.Id) || a.Id.Length > AgentAlert.MaxIdLength
                                || string.IsNullOrWhiteSpace(a.Title) || a.Title.Length > AgentAlert.MaxTitleLength))
                return new(AgentOutcome.Invalid, Error: $"cada aviso lleva id (hasta {AgentAlert.MaxIdLength}) y title (hasta {AgentAlert.MaxTitleLength} caracteres)");
            // La conclusión no puede quedar vigente sin cálculo: un ok con el resultado fallido es un error.
            if (status == "ok" && ResultFailed(input.ResultJson)) status = "error";

            var now = Now;
            var firedAt = Utc(input.FiredAt);
            var finishedAt = Utc(input.FinishedAt);
            var triggerId = string.IsNullOrWhiteSpace(input.TriggerId) ? null : input.TriggerId.Trim();
            var reason = string.IsNullOrWhiteSpace(input.ReasonCode) ? null : input.ReasonCode.Trim();
            var open = await _store.FindOpenManualAsync(ownerId, agentKey, triggerId, now - ManualMatchWindow, ct);

            AgentRun run;
            if (open != null)
            {
                run = open;
                run.Status = status;
                run.Summary = summary;
                run.ResultJson = input.ResultJson;
                run.ReasonCode = reason;
                run.FiredAt = firedAt ?? run.FiredAt;
                run.FinishedAt = finishedAt ?? now;
                await _store.UpdateRunAsync(run, ct);
            }
            else
            {
                run = await _store.AddRunAsync(new AgentRun
                {
                    Id = Guid.NewGuid(), OwnerId = ownerId, AgentKey = agentKey, Origin = "schedule", Status = status,
                    Summary = summary, ResultJson = input.ResultJson, ReasonCode = reason, TriggerId = triggerId,
                    FiredAt = firedAt, FinishedAt = finishedAt ?? now, CreatedAt = now,
                }, ct);
                await TrimAsync(ownerId, agentKey, ct);
            }
            // Un aviso sale una sola vez por id. El reporte sólo trae los de las corridas de cálculo que salieron bien
            // (aunque otra corrida haya fallado y el estado sea error).
            if (alerts.Count > 0)
                await _store.AddNewAlertsAsync(ownerId, agentKey, run.Id, alerts.Select(a => (a.Id!.Trim(), a.Title!.Trim())).ToList(), now, ct);
            return new(AgentOutcome.Ok, ToView(run, now));
        }

        private static bool ResultFailed(string? json)
        {
            if (string.IsNullOrEmpty(json)) return false;
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(json);
                if (doc.RootElement.ValueKind != System.Text.Json.JsonValueKind.Object
                    || !doc.RootElement.TryGetProperty("corridas", out var corridas)
                    || corridas.ValueKind != System.Text.Json.JsonValueKind.Array) return false;
                foreach (var c in corridas.EnumerateArray())
                    if (c.ValueKind == System.Text.Json.JsonValueKind.Object
                        && c.TryGetProperty("ok", out var ok) && ok.ValueKind == System.Text.Json.JsonValueKind.False) return true;
                return false;
            }
            catch (System.Text.Json.JsonException) { return false; }
        }

        /// <summary>Avisos de los últimos 7 días del usuario, más recientes primero.</summary>
        public async Task<IReadOnlyList<AgentAlertView>> ListAlertsAsync(Guid ownerId, CancellationToken ct)
        {
            var rows = await _store.ListAlertsAsync(ownerId, Now - AlertWindow, ct);
            return rows.Select(a => new AgentAlertView(a.AlertId, a.AgentKey, a.Title, a.CreatedAt)).ToList();
        }

        /// <summary>Npgsql sólo acepta UTC en timestamptz: un valor sin zona se toma como UTC.</summary>
        private static DateTime? Utc(DateTime? d) => d == null ? null
            : d.Value.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(d.Value, DateTimeKind.Utc) : d.Value.ToUniversalTime();

        private async Task TrimAsync(Guid ownerId, string agentKey, CancellationToken ct)
        {
            var all = await _store.ListRunsAsync(ownerId, agentKey, ct); // más recientes primero
            if (all.Count > AgentRun.MaxPerAgent)
                await _store.DeleteRunsAsync(all.Skip(AgentRun.MaxPerAgent).Select(r => r.Id).ToList(), ct);
            await _store.DeleteAlertsBeforeAsync(ownerId, Now - TimeSpan.FromDays(AgentAlert.KeepDays), ct);
        }

        public static AgentRunView ToView(AgentRun r, DateTime now)
        {
            var status = r.Status == "requested" && r.Origin == "manual" && r.RequestedAt != null && now - r.RequestedAt.Value >= NoReportAfter
                ? NoReportStatus : r.Status;
            return new AgentRunView(r.Id, r.AgentKey, r.Origin, status, r.Summary, r.ReasonCode, r.TriggerId,
                r.SessionUrl, r.SessionId, r.RequestedAt, r.FiredAt, r.FinishedAt, r.CreatedAt, r.ResultJson);
        }

        public async Task<AgentResult<IReadOnlyList<AgentRunView>>> ListRunsAsync(Guid ownerId, string agentKey, CancellationToken ct)
        {
            if (!await _store.AgentExistsAsync(ownerId, agentKey, ct)) return new(AgentOutcome.NotFound, Error: "No existe ese agente.");
            var now = Now;
            var rows = await _store.ListRunsAsync(ownerId, agentKey, ct);
            return new(AgentOutcome.Ok, rows.OrderByDescending(r => r.CreatedAt).Select(r => ToView(r, now)).ToList());
        }

        // ── Token de disparo ───────────────────────────────────────────────────────────────────────────────────

        public async Task<AgentResult<FireTokenStatus>> SetFireTokenAsync(Guid ownerId, string agentKey, string? triggerId, string? token, CancellationToken ct)
        {
            if (!await _store.AgentExistsAsync(ownerId, agentKey, ct)) return new(AgentOutcome.NotFound, Error: "No existe ese agente.");
            triggerId = triggerId?.Trim();
            token = token?.Trim();
            if (string.IsNullOrEmpty(triggerId) || triggerId.Length > 200 || triggerId.Contains('/') || triggerId.Contains(' '))
                return new(AgentOutcome.Invalid, Error: "trigger_id es requerido (hasta 200 caracteres, sin espacios ni barras)");
            if (string.IsNullOrEmpty(token) || token.Length > 2000)
                return new(AgentOutcome.Invalid, Error: "token es requerido (hasta 2000 caracteres)");

            var hint = token.Length >= 8 ? token[^4..] : "";
            await _store.UpsertFireTokenAsync(ownerId, agentKey, triggerId, _protector.Protect(token), hint, Now, ct);
            return await GetFireTokenAsync(ownerId, agentKey, ct);
        }

        public async Task<AgentResult<FireTokenStatus>> GetFireTokenAsync(Guid ownerId, string agentKey, CancellationToken ct)
        {
            if (!await _store.AgentExistsAsync(ownerId, agentKey, ct)) return new(AgentOutcome.NotFound, Error: "No existe ese agente.");
            var t = await _store.GetFireTokenAsync(ownerId, agentKey, ct);
            return new(AgentOutcome.Ok, t == null
                ? new FireTokenStatus(false, null, null, null, null)
                : new FireTokenStatus(true, t.TriggerId, t.TokenHint, t.UpdatedAt, t.LastFiredAt));
        }

        public async Task<AgentResult<bool>> DeleteFireTokenAsync(Guid ownerId, string agentKey, CancellationToken ct)
        {
            if (!await _store.AgentExistsAsync(ownerId, agentKey, ct)) return new(AgentOutcome.NotFound, Error: "No existe ese agente.");
            await _store.DeleteFireTokenAsync(ownerId, agentKey, ct);
            return new(AgentOutcome.Ok, true);
        }

        // ── Ejecutar sin PC ────────────────────────────────────────────────────────────────────────────────────

        public async Task<AgentResult<AgentRunView>> RunAsync(Guid ownerId, string agentKey, string? text, CancellationToken ct)
        {
            if (!await _store.AgentExistsAsync(ownerId, agentKey, ct)) return new(AgentOutcome.NotFound, Error: "No existe ese agente.");
            var t = await _store.GetFireTokenAsync(ownerId, agentKey, ct);
            if (t == null) return new(AgentOutcome.NoToken, Error: "este agente no tiene token de disparo");

            var now = Now;
            if (t.LastFiredAt != null && now - t.LastFiredAt.Value < FireInterval)
            {
                var wait = (int)Math.Ceiling((FireInterval - (now - t.LastFiredAt.Value)).TotalSeconds);
                return new(AgentOutcome.RateLimited, Error: $"ya se ejecutó hace poco: esperá {Math.Ceiling(wait / 60.0)} min para volver a ejecutarlo (un disparo cada 5 minutos)", RetryAfterSeconds: wait);
            }

            string token;
            try { token = _protector.Unprotect(t.TokenCipher); }
            catch (Exception ex) when (ex is CryptographicException or InvalidOperationException or FormatException)
            {
                return new(AgentOutcome.TokenRejected, Error: TokenRejectedMessage);
            }

            var res = await _fire.FireAsync(t.TriggerId, token, text, ct);
            if (res.Outcome == FireOutcome.Unauthorized) return new(AgentOutcome.TokenRejected, Error: TokenRejectedMessage);
            if (res.Outcome == FireOutcome.Paused) return new(AgentOutcome.RoutinePaused, Error: "la rutina está pausada: activala en claude.ai");
            if (res.Outcome != FireOutcome.Ok)
                return new(AgentOutcome.UpstreamFailed, Error: "no se pudo ejecutar la rutina: " + (res.Error ?? "Anthropic no respondió bien"));

            var fired = Now;
            await _store.MarkFiredAsync(ownerId, agentKey, fired, ct);
            var run = await _store.AddRunAsync(new AgentRun
            {
                Id = Guid.NewGuid(), OwnerId = ownerId, AgentKey = agentKey, Origin = "manual", Status = "requested",
                TriggerId = t.TriggerId, SessionUrl = res.SessionUrl, SessionId = res.SessionId,
                RequestedAt = fired, FiredAt = fired, CreatedAt = fired,
            }, ct);
            await TrimAsync(ownerId, agentKey, ct);
            return new(AgentOutcome.Ok, ToView(run, fired));
        }
    }
}
