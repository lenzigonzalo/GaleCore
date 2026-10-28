using System;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using DataFeed.Infrastructure.Providers.Tastytrade;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace DataFeed.Tests;

/// <summary>
/// El canje de refresh token por access token, por sus dos lados: QUE manda y COMO clasifica lo que
/// le contestan. Los dos son contrato con cosas que estan lejos —una aplicacion OAuth de Tastytrade
/// y el cuerpo de un 409— y ninguno se prueba solo.
/// </summary>
public class TastytradeOAuthTests
{
    private const string SecretoDeLaPlataforma = "secreto-de-la-app-de-galecore";

    /// <summary>Contesta siempre lo mismo y guarda el ultimo cuerpo que le mandaron.</summary>
    private sealed class RespuestaFija : HttpMessageHandler
    {
        private readonly HttpStatusCode _status;
        private readonly string _body;

        public string? UltimoPedido { get; private set; }

        public RespuestaFija(HttpStatusCode status, string body)
        {
            _status = status;
            _body = body;
        }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            if (request.Content != null)
                UltimoPedido = await request.Content.ReadAsStringAsync(ct);

            return new HttpResponseMessage(_status) { Content = new StringContent(_body) };
        }
    }

    private sealed class FabricaDeUnCliente : IHttpClientFactory
    {
        private readonly HttpMessageHandler _handler;
        public FabricaDeUnCliente(HttpMessageHandler handler) => _handler = handler;
        public HttpClient CreateClient(string name) => new(_handler);
    }

    /// <summary>Nunca se la consulta: el test siempre pasa la credencial a mano.</summary>
    private sealed class SinCredenciales : ITastytradeCredentialStore
    {
        public Task<TastytradeCredential> GetSystemAsync(CancellationToken ct = default)
            => throw new InvalidOperationException("El test no deberia pedir la credencial de sistema.");

        public Task<TastytradeCredential?> GetForUserAsync(Guid userId, CancellationToken ct = default)
            => Task.FromResult<TastytradeCredential?>(null);
    }

    private static TastytradeOAuth Auth(RespuestaFija handler)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Tastytrade:BaseUrl"] = "https://api.tastyworks.com",
                ["Tastytrade:OAuth:grant_type"] = "refresh_token",
                ["Tastytrade:OAuth:client_secret"] = SecretoDeLaPlataforma,
            })
            .Build();

        return new TastytradeOAuth(
            config,
            new FabricaDeUnCliente(handler),
            new SinCredenciales(),
            NullLogger<TastytradeOAuth>.Instance);
    }

    private static RespuestaFija Rechaza(HttpStatusCode status, string body) => new(status, body);

    private static RespuestaFija Acepta() => new(HttpStatusCode.OK,
        """{"access_token":"un-access-token","token_type":"Bearer","expires_in":900,"id_token":"x"}""");

    private static TastytradeCredential DeUnUsuario(string? clientSecret = null) =>
        new(Id: Guid.NewGuid().ToString(), RefreshToken: "el-token", AccountNumber: "5WZ00000",
            Source: "db", ClientSecret: clientSecret);

    private static readonly TastytradeCredential DeSistema =
        new(Id: "la-fila-is-system", RefreshToken: "el-token", AccountNumber: "5WZ99999",
            Source: "db", IsSystem: true);

    // ---- Que manda: las dos mitades tienen que ser de la misma aplicacion OAuth ----

    /// <summary>
    /// El operador que registro SU aplicacion OAuth manda SU client_secret, no el de la plataforma.
    ///
    /// Es el punto entero de que el client_secret viva por cuenta: mezclar el refresh token de una
    /// aplicacion con el secreto de otra es lo que Tastytrade contesta como "Client secret
    /// mismatch". Si alguien "simplifica" el canje volviendo a leer siempre el de configuracion,
    /// esto lo frena.
    /// </summary>
    [Fact]
    public async Task ConAplicacionPropia_MandaSuClientSecret()
    {
        var handler = Acepta();
        await Auth(handler).CreateOAuthApiRequestAsync("/x", DeUnUsuario("secreto-del-operador"));

        Assert.Contains("secreto-del-operador", handler.UltimoPedido);
        Assert.DoesNotContain(SecretoDeLaPlataforma, handler.UltimoPedido);
    }

    /// <summary>
    /// Sin aplicacion propia se usa la de la plataforma. null es "la de siempre", no "no hay": es lo
    /// que mantiene andando a las cuentas que ya existian y a la de sistema.
    /// </summary>
    [Fact]
    public async Task SinAplicacionPropia_CaeAlClientSecretDeConfiguracion()
    {
        var handler = Acepta();
        await Auth(handler).CreateOAuthApiRequestAsync("/x", DeUnUsuario(clientSecret: null));

        Assert.Contains(SecretoDeLaPlataforma, handler.UltimoPedido);
    }

    /// <summary>El refresh token viaja siempre, con secreto propio o sin el.</summary>
    [Fact]
    public async Task ElRefreshToken_ViajaEnElCanje()
    {
        var handler = Acepta();
        await Auth(handler).CreateOAuthApiRequestAsync("/x", DeUnUsuario("secreto-del-operador"));

        Assert.Contains("el-token", handler.UltimoPedido);
        Assert.Contains("refresh_token", handler.UltimoPedido);
    }

    // ---- Como clasifica el rechazo: de quien es el problema ----
    //
    // Importa porque las dos ramas terminan en respuestas HTTP opuestas: 400/401 de la credencial de
    // un usuario sale como 409 con `broker_credential_invalid` ("revisa tu credencial") y cualquier
    // otra cosa sale como 500 ("la plataforma tiene un problema").

    /// <summary>
    /// El cuerpo real que devolvio Tastytrade el 2026-09-01 ante un refresh token emitido por otra
    /// aplicacion OAuth. Es EL caso que motivo todo esto, asi que va literal.
    /// </summary>
    [Fact]
    public async Task ClientSecretMismatch_EsCredencialInvalida()
    {
        var auth = Auth(Rechaza(HttpStatusCode.BadRequest,
            """{"error_code":"invalid_grant","error_description":"Client secret mismatch"}"""));

        var ex = await Assert.ThrowsAsync<BrokerCredentialInvalidException>(
            () => auth.CreateOAuthApiRequestAsync("/accounts/5WZ00000/balances", DeUnUsuario()));

        // Lo que contesto el proveedor queda a mano para el log, y NO en el mensaje que ve el
        // operador: el mensaje le dice que revise sus dos mitades, no que lea el vocabulario de
        // Tastytrade.
        Assert.Contains("Client secret mismatch", ex.Detail);
        Assert.DoesNotContain("Client secret mismatch", ex.Message);
    }

    [Fact]
    public async Task TokenRevocado_TambienEsCredencialInvalida()
    {
        var auth = Auth(Rechaza(HttpStatusCode.Unauthorized, """{"error_code":"invalid_grant"}"""));

        await Assert.ThrowsAsync<BrokerCredentialInvalidException>(
            () => auth.CreateOAuthApiRequestAsync("/x", DeUnUsuario()));
    }

    /// <summary>
    /// El MISMO 400 que para un usuario es un 409, para la credencial de sistema es un 500.
    ///
    /// No es una sutileza: la de sistema es la que usan los endpoints de MERCADO, que consulta
    /// cualquiera —incluso alguien sin cuenta vinculada— y no tiene dueño a quien mandar a revisar
    /// nada. Como `DataFeedControllerBase` mapea esta excepcion a 409 para TODOS los endpoints,
    /// dejarla escapar acá haria que un precio que no se puede leer le pidiera al operador que
    /// arreglara una credencial que no es suya.
    /// </summary>
    [Fact]
    public async Task CredencialDeSistemaRechazada_NoEsCosaDelOperador()
    {
        var auth = Auth(Rechaza(HttpStatusCode.BadRequest,
            """{"error_code":"invalid_grant","error_description":"Client secret mismatch"}"""));

        var ex = await Assert.ThrowsAnyAsync<Exception>(
            () => auth.CreateOAuthApiRequestAsync("/x", DeSistema));

        Assert.IsNotType<BrokerCredentialInvalidException>(ex);
    }

    /// <summary>
    /// Tastytrade caido NO es una credencial invalida. Si esto se rompe, el tablero le va a pedir a
    /// todo el mundo que revise su credencial cada vez que el proveedor tenga un mal rato.
    /// </summary>
    [Theory]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    public async Task ProveedorCaido_NoEsCredencialInvalida(HttpStatusCode status)
    {
        var auth = Auth(Rechaza(status, "upstream se cayo"));

        var ex = await Assert.ThrowsAnyAsync<Exception>(
            () => auth.CreateOAuthApiRequestAsync("/x", DeUnUsuario()));

        Assert.IsNotType<BrokerCredentialInvalidException>(ex);
    }
}
