using DataFeed.Api.Controllers.Dtos;
using DataFeed.Application.App.Brokers;
using DataFeed.Infrastructure.Providers;
using DataFeed.Infrastructure.Providers.Iol;
using DataFeed.Infrastructure.Providers.Tastytrade;
using Microsoft.AspNetCore.Mvc;

namespace DataFeed.Controllers
{
    /// <summary>
    /// Brokers del usuario (WS-0108): Configuración › Conexiones › Brokers (estado, credencial de IOL, interruptor
    /// «incluir», prueba) y la cartera de IOL. Todo es del usuario actual: sin usuario, 401. Ninguna respuesta ni log
    /// lleva contraseñas ni tokens.
    /// </summary>
    [ApiController]
    public class BrokersController : ControllerBase
    {
        private readonly BrokersService _service;
        private readonly ICurrentUser _currentUser;

        public BrokersController(BrokersService service, ICurrentUser currentUser)
        {
            _service = service;
            _currentUser = currentUser;
        }

        public sealed class IolCredentialsRequest
        {
            public string? Username { get; set; }
            public string? Password { get; set; }
        }

        public sealed class IncludeRequest
        {
            public bool? Include { get; set; }
        }

        [HttpGet("/App/GaleCore/Brokers")]
        public async Task<IActionResult> List(CancellationToken ct)
        {
            if (_currentUser.UserId is not { } userId) return Unauthorized();
            return Ok(await _service.ListAsync(userId, ct));
        }

        [HttpPut("/App/GaleCore/Brokers/iol/Credentials")]
        public async Task<IActionResult> SetIolCredentials([FromBody] IolCredentialsRequest? body, CancellationToken ct)
        {
            if (_currentUser.UserId is not { } userId) return Unauthorized();
            try
            {
                var (outcome, message) = await _service.SetIolCredentialsAsync(userId, body?.Username, body?.Password, ct);
                return outcome == BrokerWriteOutcome.Ok ? Ok(await _service.GetAsync(userId, BrokersService.Iol, ct)) : Failure(outcome, message);
            }
            catch (UpstreamSourceException ex) { return Upstream(ex); }
        }

        [HttpDelete("/App/GaleCore/Brokers/iol/Credentials")]
        public async Task<IActionResult> DeleteIolCredentials(CancellationToken ct)
        {
            if (_currentUser.UserId is not { } userId) return Unauthorized();
            var outcome = await _service.DeleteIolCredentialsAsync(userId, ct);
            return outcome == BrokerWriteOutcome.Ok ? Ok(await _service.GetAsync(userId, BrokersService.Iol, ct)) : Failure(outcome, null);
        }

        [HttpPut("/App/GaleCore/Brokers/{id}/Include")]
        public async Task<IActionResult> SetInclude(string id, [FromBody] IncludeRequest? body, CancellationToken ct)
        {
            if (_currentUser.UserId is not { } userId) return Unauthorized();
            if (body?.Include == null) return BadRequest(new { error = "Falta el campo include (true o false)." });
            var outcome = await _service.SetIncludeAsync(userId, id, body.Include.Value, ct);
            return outcome == BrokerWriteOutcome.Ok ? Ok(await _service.GetAsync(userId, id.ToLowerInvariant(), ct)) : Failure(outcome, null);
        }

        [HttpPost("/App/GaleCore/Brokers/{id}/Test")]
        public async Task<IActionResult> Test(string id, CancellationToken ct)
        {
            if (_currentUser.UserId is not { } userId) return Unauthorized();
            var result = await _service.TestAsync(userId, id, ct);
            if (result == null) return NotFound(new { error = $"No existe el broker {id}." });
            return Ok(new { ok = result.Ok, status = result.Status, message = result.Message, at = result.At });
        }

        // 409 como la cuenta de Tastytrade: el `code` es lo que le deja al tablero decir «cargá tu usuario» o «revisalo».
        // Una caída de IOL es 502 con su motivo, nunca una cartera vacía.
        [Tags("Data.Account")]
        [HttpGet("/Data/Iol/Account/Portfolio")]
        [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
        [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status502BadGateway)]
        public async Task<IActionResult> IolPortfolio(CancellationToken ct)
        {
            if (_currentUser.UserId is not { } userId) return Unauthorized();
            try
            {
                return Ok(await _service.GetIolPortfolioAsync(userId, ct));
            }
            catch (BrokerAccountNotLinkedException)
            {
                return Conflict(new ApiErrorResponse
                {
                    Error = "No cargaste tu usuario de IOL. Hacelo en Configuración › Conexiones › Brokers.",
                    Code = BrokerAccountNotLinkedException.Code,
                });
            }
            catch (IolCredentialInvalidException ex)
            {
                return Conflict(new ApiErrorResponse { Error = ex.Message, Code = IolCredentialInvalidException.Code });
            }
            catch (UpstreamSourceException ex)
            {
                return Upstream(ex);
            }
        }

        private ObjectResult Upstream(UpstreamSourceException ex) =>
            StatusCode(502, new ApiErrorResponse { Error = ex.Message, Code = UpstreamSourceException.Code });

        private IActionResult Failure(BrokerWriteOutcome outcome, string? message) => outcome switch
        {
            BrokerWriteOutcome.UnknownBroker => NotFound(new { error = "No existe ese broker." }),
            BrokerWriteOutcome.Invalid => BadRequest(new { error = message ?? "Datos inválidos." }),
            BrokerWriteOutcome.Rejected => BadRequest(new { error = message ?? "IOL rechazó las credenciales." }),
            _ => StatusCode(503, new { error = "No se pueden guardar datos de brokers en este servidor." }),
        };
    }
}
