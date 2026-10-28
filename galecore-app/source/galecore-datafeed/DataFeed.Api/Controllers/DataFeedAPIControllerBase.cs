using DataFeed.Api.Controllers.Dtos;
using DataFeed.Infrastructure.Providers.Tastytrade;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
//using Strateps.Application.Autenticacion;
//using Strateps.Domain.Enums;
using System;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;

namespace DataFeed.Controllers
{
    public class DataFeedControllerBase : ControllerBase
    {
        private IMediator mediator;
        // private CurrentUser currentUser;

        public DataFeedControllerBase(IMediator mediator)
        {
            this.mediator = mediator;
        }

        public async Task<IActionResult> Handle<TResponse>(IRequest<TResponse> request)
        {
            TResponse response;

            try
            {
                response = await this.mediator.Send(request);
            }
            catch (BrokerAccountNotLinkedException ex)
            {
                // 409 y no 500: que el operador todavía no haya vinculado su cuenta es un estado
                // esperado, no una falla del servidor. El `code` es lo que le permite al tablero
                // decir "vinculá tu cuenta" en vez de mostrar el error crudo.
                return this.Conflict(new ApiErrorResponse
                {
                    Error = ex.Message,
                    Code = BrokerAccountNotLinkedException.Code,
                });
            }
            catch (BrokerCredentialInvalidException ex)
            {
                // 409 por lo mismo que la de arriba, un escalón más adelante: la cuenta está
                // vinculada pero Tastytrade rechaza su refresh token. Tampoco es una falla del
                // servidor —de hecho todo lo que GaleCore controla funcionó— y el operador puede
                // arreglarlo solo, así que necesita su propio `code` para que el tablero le diga
                // "re-vinculá" en vez de "vinculá", que lo manda a un formulario que ya llenó.
                //
                // El detalle que contestó Tastytrade NO viaja: ya se logueó en TastytradeOAuth, es
                // vocabulario del proveedor y al operador no le dice nada.
                return this.Conflict(new ApiErrorResponse
                {
                    Error = ex.Message,
                    Code = BrokerCredentialInvalidException.Code,
                });
            }
            catch (DataFeed.Infrastructure.Providers.UpstreamSourceException ex)
            {
                // 502: la fuente externa (FRED, la Fed…) no respondió o cambió de forma. Se mapea acá y no sólo en el
                // middleware porque en Development la página de errores lo atrapa antes (GC-0006).
                return this.StatusCode(502, new ApiErrorResponse { Error = ex.Message, Code = DataFeed.Infrastructure.Providers.UpstreamSourceException.Code });
            }
            catch (OptionChainNotFoundException ex)
            {
                // 409 por lo mismo: el símbolo que eligió el operador no se puede analizar, y eso es
                // una respuesta, no una caída. El `symbol` viaja aparte para que el front lo nombre
                // sin tener que parsear el mensaje.
                return this.Conflict(new ApiErrorResponse
                {
                    Error = ex.Message,
                    Code = OptionChainNotFoundException.Code,
                    Symbol = ex.Symbol,
                });
            }

            if (HttpMethods.IsGet(this.Request.Method))
            {
                if (response != null)
                {
                    return this.Ok(response);
                }

                return this.NotFound();
            }
            else if (HttpMethods.IsDelete(this.Request.Method) || HttpMethods.IsPut(this.Request.Method) || HttpMethods.IsPatch(this.Request.Method))
            {
                return this.NoContent();
            }
            else if (HttpMethods.IsPost(this.Request.Method))
            {
                return this.Created(this.Request.Path.ToUriComponent(), response);
            }
            else
            {
                return this.StatusCode(501); // NotImplemented
            }
        }

        //protected CurrentUser CurrentUser
        //{
        //    get
        //    {
        //        if (currentUser == null)
        //        {
        //            var Identity = HttpContext.User.Identity as ClaimsIdentity;
        //            currentUser = new CurrentUser()
        //            {
        //                Id = new Guid(Identity.Claims.Where(c => c.Type == ClaimTypes.NameIdentifier).Select(c => c.Value).SingleOrDefault()),
        //                UserName = Identity.Claims.Where(c => c.Type == ClaimTypes.Name).Select(c => c.Value).SingleOrDefault(),
        //                Rol = (RolEnum)Enum.Parse(typeof(RolEnum), Identity.Claims.Where(c => c.Type == ClaimTypes.Role).Select(c => c.Value).SingleOrDefault()),
        //                NumeroSucursal = Identity.Claims.Where(c => c.Type == ClaimTypes.UserData).Select(c => c.Value).SingleOrDefault(),
        //                NumeroPuesto = Identity.Claims.Where(c => c.Type == ClaimTypes.Surname).Select(c => c.Value).SingleOrDefault()
        //            };
        //        }

        //        return currentUser;
        //    }
        //}
    }
}