using System.Linq;
using DataFeed.Api.Controllers.Dtos;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using Xunit;

namespace DataFeed.Tests;

/// <summary>
/// Congela el cuerpo del 409, que es contrato con el tablero: `api/account.ts` matchea
/// `broker_account_not_linked` y `useGexStore` matchea `option_chain_not_found`, los dos contra el
/// campo `code` y no contra el texto del mensaje.
///
/// Nada de eso rompe el build si se cae: el front no compila contra C#, asi que renombrar una
/// propiedad de ApiErrorResponse deja una API que responde 200/409 igual que siempre y un tablero
/// que, en vez de decir "vincula tu cuenta" o "este simbolo no tiene cadena", muestra el error
/// crudo. Es la misma clase de falla silenciosa que cubren los tests de los JSON de reglas.
///
/// Se serializa con las DOS configuraciones posibles del pipeline —la camelCase que arma
/// AddNewtonsoftJson y el resolver pelado— y el resultado tiene que ser identico: si dependiera de
/// cual esta activo, el contrato viviria en un default del framework en vez de en los
/// [JsonProperty] del DTO.
///
/// El DTO entra linkeado al proyecto de tests (ver el .csproj) para no arrastrar el grafo de
/// paquetes de DataFeed.Api a la suite.
/// </summary>
public class ApiErrorContractTests
{
    /// <summary>Lo que arma AddNewtonsoftJson en Program.cs.</summary>
    private static readonly JsonSerializerSettings AspNetCore = new()
    {
        ContractResolver = new CamelCasePropertyNamesContractResolver(),
        ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
    };

    /// <summary>Resolver pelado, por si una version del framework deja de camelCasear sola.</summary>
    private static readonly JsonSerializerSettings Pelado = new()
    {
        ContractResolver = new DefaultContractResolver(),
    };

    private static JObject[] SerializarConAmbos(ApiErrorResponse error) => new[]
    {
        JObject.Parse(JsonConvert.SerializeObject(error, AspNetCore)),
        JObject.Parse(JsonConvert.SerializeObject(error, Pelado)),
    };

    /// <summary>
    /// El 409 de un simbolo que no se puede barrer: tres campos, en minuscula, con el `symbol`
    /// aparte para que el front lo nombre sin parsear el mensaje.
    /// </summary>
    [Fact]
    public void ErrorDeSimbolo_LlevaErrorCodeYSymbol()
    {
        var error = new ApiErrorResponse
        {
            Error = "IOSX no lista opciones.",
            Code = "option_chain_not_found",
            Symbol = "IOSX",
        };

        foreach (var body in SerializarConAmbos(error))
        {
            Assert.Equal(
                new[] { "code", "error", "symbol" },
                body.Properties().Select(p => p.Name).OrderBy(n => n).ToArray());

            Assert.Equal("IOSX no lista opciones.", (string?)body["error"]);
            Assert.Equal("option_chain_not_found", (string?)body["code"]);
            Assert.Equal("IOSX", (string?)body["symbol"]);
        }
    }

    /// <summary>
    /// El 409 de la cuenta sin vincular NO manda `symbol`, ni siquiera en null: ese cuerpo nunca
    /// tuvo la clave, y agregarsela al tipar el error habria sido cambiar el contrato de un endpoint
    /// que no tiene nada que ver con el simbolo.
    /// </summary>
    [Fact]
    public void ErrorSinSimbolo_NoMandaLaClaveSymbol()
    {
        var error = new ApiErrorResponse
        {
            Error = "El usuario autenticado no tiene una cuenta de broker vinculada.",
            Code = "broker_account_not_linked",
        };

        foreach (var body in SerializarConAmbos(error))
        {
            Assert.Equal(
                new[] { "code", "error" },
                body.Properties().Select(p => p.Name).OrderBy(n => n).ToArray());

            Assert.False(body.ContainsKey("symbol"), "El 409 de la cuenta no lleva symbol.");
        }
    }

    /// <summary>
    /// El 409 de la credencial rechazada tiene el MISMO cuerpo que el de la cuenta sin vincular: dos
    /// campos y sin `symbol`. Son dos estados distintos del mismo endpoint y lo unico que los separa
    /// es el `code` — que es justamente el punto de que exista el campo.
    ///
    /// Lo que Tastytrade contesto (`Client secret mismatch`) NO esta en el cuerpo, ni deberia: es
    /// vocabulario del proveedor y vive en el log. Si alguien lo agrega al DTO, este test lo frena.
    /// </summary>
    [Fact]
    public void ErrorDeCredencialRechazada_TieneElMismoCuerpoQueElDeLaCuentaSinVincular()
    {
        var error = new ApiErrorResponse
        {
            Error = "La cuenta de broker vinculada tiene un refresh token que Tastytrade rechaza.",
            Code = "broker_credential_invalid",
        };

        foreach (var body in SerializarConAmbos(error))
        {
            Assert.Equal(
                new[] { "code", "error" },
                body.Properties().Select(p => p.Name).OrderBy(n => n).ToArray());

            Assert.Equal("broker_credential_invalid", (string?)body["code"]);
            Assert.False(body.ContainsKey("symbol"), "El 409 de la credencial no lleva symbol.");
        }
    }

    /// <summary>
    /// Los `code` son los que el front tiene escritos. Van tomados de las constantes de las
    /// excepciones, que es de donde salen en runtime: si alguien las renombra, esto falla acá y no
    /// en el tablero de alguien.
    /// </summary>
    [Fact]
    public void LosCodes_SonLosQueElFrontMatchea()
    {
        Assert.Equal("broker_account_not_linked",
            DataFeed.Infrastructure.Providers.Tastytrade.BrokerAccountNotLinkedException.Code);
        Assert.Equal("broker_credential_invalid",
            DataFeed.Infrastructure.Providers.Tastytrade.BrokerCredentialInvalidException.Code);
        Assert.Equal("option_chain_not_found",
            DataFeed.Infrastructure.Providers.Tastytrade.OptionChainNotFoundException.Code);
    }

    /// <summary>
    /// Los dos estados de la cuenta son DISTINTOS. Parece una perogrullada escrita asi, pero el
    /// front decide con esto entre "vincula tu cuenta" y "re-vincula tu cuenta": si alguien
    /// unificara los codes para simplificar, el operador que ya cargo sus credenciales volveria a
    /// leer un cartel que le pide hacer lo que ya hizo.
    /// </summary>
    [Fact]
    public void LosDosEstadosDeLaCuenta_NoCompartenCode()
    {
        Assert.NotEqual(
            DataFeed.Infrastructure.Providers.Tastytrade.BrokerAccountNotLinkedException.Code,
            DataFeed.Infrastructure.Providers.Tastytrade.BrokerCredentialInvalidException.Code);
    }
}
