using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using DataFeed.Application.Shared;
using System;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using ValidationException = DataFeed.Application.Shared.ValidationException;

namespace DataFeed.Infrastructure
{
    public class ExceptionHandlerMiddleware
    {
        private readonly ILogger logger;
        private readonly RequestDelegate next;

        public ExceptionHandlerMiddleware(ILogger<ExceptionHandlerMiddleware> logger, RequestDelegate next)
        {
            this.logger = logger ?? throw new ArgumentNullException(nameof(logger));
            this.next = next ?? throw new ArgumentNullException(nameof(next));
        }

        public async Task Invoke(HttpContext context)
        {
            try
            {
                await this.next(context);
            }
            catch (ValidationException ex)
            {
                this.logger.LogError(ex, ex.Message);

                await HandleExceptionAsync(context, ex, HttpStatusCode.BadRequest);
            }
            catch (DataFeed.Infrastructure.Providers.UpstreamSourceException ex)
            {
                // Una fuente externa caída o que cambió de forma: 502 con el motivo, nunca un vacío (GC-0006).
                this.logger.LogWarning(ex.Message);

                context.Response.StatusCode = (int)HttpStatusCode.BadGateway;
                await WriteResponseAsync(context, new { error = ex.Message, code = DataFeed.Infrastructure.Providers.UpstreamSourceException.Code });
            }
            catch (ResourceNotFoundException ex)
            {
                this.logger.LogError(ex, ex.Message);

                await HandleExceptionAsync(context, ex, HttpStatusCode.NotFound);
            }
            catch (Exception ex)
            {
                this.logger.LogError(ex, ex.Message);

                await HandleExceptionAsync(context, ex, HttpStatusCode.InternalServerError);
            }

            // TODO: Acá se debe verificar el tipo de la excepción y devolver el HttpStatusCode correspondiente.
        }

        private static async Task HandleExceptionAsync(HttpContext context, Exception exception, HttpStatusCode statusCode)
        {
            context.Response.StatusCode = (int)statusCode;

            await WriteResponseAsync(context, new { error = exception.Message });
        }

        private static async Task WriteResponseAsync(HttpContext context, object value)
        {
            context.Response.ContentType = "application/json";

            await context.Response.WriteAsync(JsonSerializer.Serialize(value));
        }
    }
}
