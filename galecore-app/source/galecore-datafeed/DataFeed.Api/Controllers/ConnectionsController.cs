using DataFeed.Api.Infrastructure;
using DataFeed.Application.App.Connections;
using DataFeed.Infrastructure.Providers.Tastytrade;
using Microsoft.AspNetCore.Mvc;

namespace DataFeed.Controllers
{
    /// <summary>
    /// Configuración › Conexiones (WS-0080): lista de lo conectable con su estado, carga/borrado de las claves de la
    /// plataforma (sólo admin) y prueba de conexión. Ninguna respuesta ni log lleva el valor de una clave.
    /// </summary>
    [ApiController]
    [Route("App")] // mismo prefijo que AppController: /App/GaleCore/Connections
    public class ConnectionsController : ControllerBase
    {
        private readonly PlatformConnectionsService _service;
        private readonly UserStore _users;
        private readonly ICurrentUser _currentUser;
        private readonly ILogger<ConnectionsController> _logger;

        public ConnectionsController(PlatformConnectionsService service, UserStore users, ICurrentUser currentUser,
            ILogger<ConnectionsController> logger)
        {
            _service = service;
            _users = users;
            _currentUser = currentUser;
            _logger = logger;
        }

        public sealed class SetKeyRequest
        {
            public string? Value { get; set; }
        }

        [HttpGet("GaleCore/Connections")]
        public async Task<IActionResult> List(CancellationToken ct)
        {
            var canEdit = await ConnectionAccess.CanEditAsync(_users.DatabaseConfigured, _currentUser.UserId, id => _users.IsAdminAsync(id, ct));
            return Ok(await _service.ListAsync(_currentUser.UserId, canEdit, ct));
        }

        [HttpPut("GaleCore/Connections/{id}/Key")]
        public async Task<IActionResult> SetKey(string id, [FromBody] SetKeyRequest? body, CancellationToken ct)
        {
            var denied = await DenyIfNotAdminAsync(id, ct);
            if (denied != null) return denied;

            var outcome = await _service.SetKeyAsync(id, body?.Value, _currentUser.UserId, ct);
            if (outcome != SetKeyOutcome.Ok) return Failure(outcome);
            return Ok(await _service.GetAsync(id.ToLowerInvariant(), _currentUser.UserId, true, ct));
        }

        [HttpDelete("GaleCore/Connections/{id}/Key")]
        public async Task<IActionResult> DeleteKey(string id, CancellationToken ct)
        {
            var denied = await DenyIfNotAdminAsync(id, ct);
            if (denied != null) return denied;

            var outcome = await _service.DeleteKeyAsync(id, _currentUser.UserId, ct);
            if (outcome != SetKeyOutcome.Ok) return Failure(outcome);
            return Ok(await _service.GetAsync(id.ToLowerInvariant(), _currentUser.UserId, true, ct));
        }

        [HttpPost("GaleCore/Connections/{id}/Test")]
        public async Task<IActionResult> Test(string id, CancellationToken ct)
        {
            var result = await _service.TestAsync(id, ct);
            if (result == null) return NotFound(new { error = $"No existe la conexión {id}." });
            return Ok(new { ok = result.Ok, message = result.Message, at = result.At });
        }

        private IActionResult Failure(SetKeyOutcome outcome) => outcome switch
        {
            SetKeyOutcome.UnknownConnection => NotFound(new { error = "No existe esa conexión." }),
            SetKeyOutcome.NotEditable => BadRequest(new { error = "Esa conexión no tiene una clave que se cargue desde la plataforma." }),
            SetKeyOutcome.Invalid => BadRequest(new { error = $"El valor es obligatorio y de hasta {PlatformConnectionsService.MaxValueLength} caracteres." }),
            _ => StatusCode(503, new { error = _service.Storage().Message ?? "No se pueden guardar claves en este servidor." }),
        };

        /// <summary>Regla estricta, como administrar usuarios: sin usuario 401, no admin 403.</summary>
        private async Task<IActionResult?> DenyIfNotAdminAsync(string subject, CancellationToken ct)
        {
            var access = await ConnectionAccess.CheckWriteAsync(_currentUser.UserId, uid => _users.IsAdminAsync(uid, ct));
            if (access == WriteAccess.Allowed) return null;
            if (access == WriteAccess.Unauthorized) return Unauthorized();

            _logger.LogWarning("El usuario {UserId} intentó cambiar la clave de {Subject} sin ser admin.", _currentUser.UserId, subject);
            return StatusCode(403, new { error = "Solo los admin de la plataforma pueden cambiar las claves de conexión." });
        }
    }
}
