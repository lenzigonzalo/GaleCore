using DataFeed.Api.Controllers.Dtos;
using DataFeed.Api.Infrastructure;
using DataFeed.Application.App.Agents;
using DataFeed.Infrastructure.Providers.Tastytrade;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;

namespace DataFeed.Controllers
{
    /// <summary>
    /// Agentes que corren solos (WS-0079). Clave de agentes del usuario, reporte de corridas (con esa clave, sin login),
    /// token de disparo de la rutina, ejecución sin PC y listado de corridas. El token de disparo nunca sale de la API.
    /// </summary>
    [ApiController]
    [Route("App")] // mismo prefijo que AppController: /App/GaleCore/Agents/...
    [Tags("App.GaleCore")]
    public class AgentsController : ControllerBase
    {
        public const string AgentKeyHeader = "X-GaleCore-Agent-Key";

        private readonly ICurrentUser _currentUser;
        private readonly UserStore _users;
        private readonly IServiceProvider _services;

        public AgentsController(ICurrentUser currentUser, UserStore users, IServiceProvider services)
        {
            _currentUser = currentUser;
            _users = users;
            _services = services;
        }

        public sealed class ReportRequest
        {
            [JsonProperty("status")] public string? Status { get; set; }
            [JsonProperty("summary")] public string? Summary { get; set; }
            [JsonProperty("reason_code")] public string? ReasonCode { get; set; }
            [JsonProperty("trigger_id")] public string? TriggerId { get; set; }
            [JsonProperty("fired_at")] public DateTime? FiredAt { get; set; }
            [JsonProperty("finished_at")] public DateTime? FinishedAt { get; set; }
        }

        public sealed class FireTokenRequest
        {
            [JsonProperty("trigger_id")] public string? TriggerId { get; set; }
            [JsonProperty("token")] public string? Token { get; set; }
        }

        public sealed class RunRequest
        {
            [JsonProperty("text")] public string? Text { get; set; }
        }

        private AgentsService? Service => _services.GetService(typeof(AgentsService)) as AgentsService;

        private IActionResult Unavailable() => StatusCode(503, new ApiErrorResponse
        {
            Error = "Esta API está corriendo sin base de datos configurada: los agentes que corren solos no están disponibles.",
            Code = "database_not_configured",
        });

        private static object Dto(AgentRunView r) => new
        {
            id = r.Id, agent_key = r.AgentKey, origin = r.Origin, status = r.Status, summary = r.Summary,
            reason_code = r.ReasonCode, trigger_id = r.TriggerId, session_url = r.SessionUrl, session_id = r.SessionId,
            requested_at = r.RequestedAt, fired_at = r.FiredAt, finished_at = r.FinishedAt, created_at = r.CreatedAt,
        };

        private static object Dto(FireTokenStatus t) => new
        {
            exists = t.Exists, trigger_id = t.TriggerId, token_hint = t.TokenHint, updated_at = t.UpdatedAt, last_fired_at = t.LastFiredAt,
        };

        private IActionResult Failure<T>(AgentResult<T> r) => r.Outcome switch
        {
            AgentOutcome.NotFound => NotFound(new ApiErrorResponse { Error = r.Error ?? "No existe.", Code = "agent_not_found" }),
            AgentOutcome.Invalid => BadRequest(new ApiErrorResponse { Error = r.Error ?? "Pedido inválido.", Code = "invalid_request" }),
            AgentOutcome.NoToken => Conflict(new ApiErrorResponse { Error = r.Error ?? "", Code = "no_fire_token" }),
            AgentOutcome.RateLimited => RateLimited(r),
            AgentOutcome.RoutinePaused => Conflict(new ApiErrorResponse { Error = r.Error ?? "", Code = "routine_paused" }),
            AgentOutcome.TokenRejected => StatusCode(502, new ApiErrorResponse { Error = r.Error ?? "", Code = "fire_token_rejected" }),
            _ => StatusCode(502, new ApiErrorResponse { Error = r.Error ?? "", Code = "fire_failed" }),
        };

        private IActionResult RateLimited<T>(AgentResult<T> r)
        {
            if (r.RetryAfterSeconds != null) Response.Headers["Retry-After"] = r.RetryAfterSeconds.Value.ToString();
            return StatusCode(429, new ApiErrorResponse { Error = r.Error ?? "", Code = "rate_limited" });
        }

        // ── Clave de agentes (login del usuario) ───────────────────────────────────────────────────────────────

        /// <summary>Estado de tu clave de agentes: si existe, últimos 4 y fecha. Nunca la clave.</summary>
        [Authorize]
        [HttpGet("GaleCore/AgentKey")]
        public async Task<IActionResult> KeyStatus(CancellationToken ct)
        {
            var uid = _currentUser.UserId;
            if (uid == null) return Unauthorized();
            var svc = Service;
            if (svc == null) return Unavailable();
            var s = await svc.KeyStatusAsync(uid.Value, ct);
            return Ok(new { exists = s.Exists, hint = s.Hint, created_at = s.CreatedAt });
        }

        /// <summary>Genera o regenera tu clave de agentes (la anterior deja de servir). La devuelve en claro UNA vez.</summary>
        [Authorize]
        [HttpPost("GaleCore/AgentKey")]
        public async Task<IActionResult> GenerateKey(CancellationToken ct)
        {
            var uid = _currentUser.UserId;
            if (uid == null) return Unauthorized();
            var svc = Service;
            if (svc == null) return Unavailable();
            await _users.EnsureUserAsync(uid.Value, _currentUser.Email, ct);
            var k = await svc.GenerateKeyAsync(uid.Value, ct);
            Response.Headers["Cache-Control"] = "no-store";
            return Ok(new { key = k.Key, hint = k.Hint, created_at = k.CreatedAt });
        }

        /// <summary>Revoca tu clave de agentes.</summary>
        [Authorize]
        [HttpDelete("GaleCore/AgentKey")]
        public async Task<IActionResult> RevokeKey(CancellationToken ct)
        {
            var uid = _currentUser.UserId;
            if (uid == null) return Unauthorized();
            var svc = Service;
            if (svc == null) return Unavailable();
            await svc.RevokeKeyAsync(uid.Value, ct);
            return NoContent();
        }

        // ── Reporte de una corrida (clave de agentes, sin login) ───────────────────────────────────────────────

        /// <summary>
        /// Una rutina reporta cómo le fue. Se autentica con el header <c>X-GaleCore-Agent-Key</c> (además de la API key
        /// global de la API). El dueño sale de la clave y <c>{key}</c> debe ser un agente suyo.
        /// </summary>
        [HttpPost("GaleCore/Agents/{key}/Runs")]
        public async Task<IActionResult> Report(string key, [FromBody] ReportRequest? body, CancellationToken ct)
        {
            var svc = Service;
            if (svc == null) return Unavailable();
            var owner = await svc.ResolveKeyAsync(Request.Headers[AgentKeyHeader].ToString(), ct);
            if (owner == null)
                return Unauthorized(new ApiErrorResponse { Error = "Clave de agentes inválida.", Code = "invalid_agent_key" });
            if (body == null) return BadRequest(new ApiErrorResponse { Error = "Falta el cuerpo.", Code = "invalid_request" });

            var r = await svc.ReportAsync(owner.Value, key, new ReportInput(body.Status, body.Summary, body.ReasonCode, body.TriggerId, body.FiredAt, body.FinishedAt), ct);
            return r.Outcome == AgentOutcome.Ok ? Ok(Dto(r.Value!)) : Failure(r);
        }

        /// <summary>
        /// Una rutina baja una skill del espacio para correrla (<c>skill run</c>): la suya o una compartida por otro. Misma
        /// autenticación que el reporte; esta clave no lee ningún otro kind ni escribe nada.
        /// </summary>
        [HttpGet("GaleCore/Agents/Skills/{key}")]
        public async Task<IActionResult> GetSkill(string key, CancellationToken ct)
        {
            var svc = Service;
            if (svc == null) return Unavailable();
            var owner = await svc.ResolveKeyAsync(Request.Headers[AgentKeyHeader].ToString(), ct);
            if (owner == null)
                return Unauthorized(new ApiErrorResponse { Error = "Clave de agentes inválida.", Code = "invalid_agent_key" });
            var r = await svc.GetSkillAsync(owner.Value, key, ct);
            if (r.Outcome != AgentOutcome.Ok) return Failure(r);
            var s = r.Value!;
            return Ok(new { kind = s.Kind, key = s.Key, title = s.Title, content = s.Content, format = s.Format,
                            visibility = s.Visibility, version = s.Version, updatedAt = s.UpdatedAt, owner = s.Owner });
        }

        // ── Corridas, token de disparo y ejecución (login del usuario) ─────────────────────────────────────────

        /// <summary>Corridas de uno de tus agentes, más recientes primero (últimas 50).</summary>
        [Authorize]
        [HttpGet("GaleCore/Agents/{key}/Runs")]
        public async Task<IActionResult> ListRuns(string key, CancellationToken ct)
        {
            var uid = _currentUser.UserId;
            if (uid == null) return Unauthorized();
            var svc = Service;
            if (svc == null) return Unavailable();
            var r = await svc.ListRunsAsync(uid.Value, key, ct);
            return r.Outcome == AgentOutcome.Ok ? Ok(new { runs = r.Value!.Select(Dto) }) : Failure(r);
        }

        /// <summary>Estado del token de disparo: trigger_id y últimos 4. El token no vuelve nunca.</summary>
        [Authorize]
        [HttpGet("GaleCore/Agents/{key}/FireToken")]
        public async Task<IActionResult> GetFireToken(string key, CancellationToken ct)
        {
            var uid = _currentUser.UserId;
            if (uid == null) return Unauthorized();
            var svc = Service;
            if (svc == null) return Unavailable();
            var r = await svc.GetFireTokenAsync(uid.Value, key, ct);
            return r.Outcome == AgentOutcome.Ok ? Ok(Dto(r.Value!)) : Failure(r);
        }

        /// <summary>Guarda el trigger_id y el token de disparo (cifrado) de uno de tus agentes.</summary>
        [Authorize]
        [HttpPut("GaleCore/Agents/{key}/FireToken")]
        public async Task<IActionResult> SetFireToken(string key, [FromBody] FireTokenRequest? body, CancellationToken ct)
        {
            var uid = _currentUser.UserId;
            if (uid == null) return Unauthorized();
            var svc = Service;
            if (svc == null) return Unavailable();
            var r = await svc.SetFireTokenAsync(uid.Value, key, body?.TriggerId, body?.Token, ct);
            return r.Outcome == AgentOutcome.Ok ? Ok(Dto(r.Value!)) : Failure(r);
        }

        /// <summary>Borra el token de disparo de uno de tus agentes.</summary>
        [Authorize]
        [HttpDelete("GaleCore/Agents/{key}/FireToken")]
        public async Task<IActionResult> DeleteFireToken(string key, CancellationToken ct)
        {
            var uid = _currentUser.UserId;
            if (uid == null) return Unauthorized();
            var svc = Service;
            if (svc == null) return Unavailable();
            var r = await svc.DeleteFireTokenAsync(uid.Value, key, ct);
            return r.Outcome == AgentOutcome.Ok ? NoContent() : Failure(r);
        }

        /// <summary>Ejecuta el agente sin tu PC: dispara su rutina y deja una corrida <c>manual</c> en <c>requested</c>.</summary>
        [Authorize]
        [HttpPost("GaleCore/Agents/{key}/Run")]
        public async Task<IActionResult> Run(string key, [FromBody] RunRequest? body, CancellationToken ct)
        {
            var uid = _currentUser.UserId;
            if (uid == null) return Unauthorized();
            var svc = Service;
            if (svc == null) return Unavailable();
            var r = await svc.RunAsync(uid.Value, key, body?.Text, ct);
            return r.Outcome == AgentOutcome.Ok ? Ok(Dto(r.Value!)) : Failure(r);
        }
    }
}
