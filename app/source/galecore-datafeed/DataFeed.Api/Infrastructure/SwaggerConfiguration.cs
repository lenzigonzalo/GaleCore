using Microsoft.Extensions.DependencyInjection;
using Microsoft.OpenApi.Models;
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;

namespace DataFeed.Infrastructure
{
    public static class SwaggerConfiguration
    {
        public static IServiceCollection AddSwaggerGen(this IServiceCollection services)
        {
            services.AddSwaggerGen(c =>
            {
                c.AddSecurityDefinition("ApiKey", new OpenApiSecurityScheme
                {
                    Description = "API Key header. Sample: `X-API-KEY: {clave}`",
                    Name = "X-API-KEY",
                    In = ParameterLocation.Header,
                    Type = SecuritySchemeType.ApiKey,
                    Scheme = "ApiKey"
                });

                c.AddSecurityRequirement(new OpenApiSecurityRequirement
                {
                    {
                        new OpenApiSecurityScheme
                        {
                            Reference = new OpenApiReference
                            {
                                Type = ReferenceType.SecurityScheme,
                                Id = "ApiKey"
                            },
                            In = ParameterLocation.Header
                        },
                        Array.Empty<string>()
                    }
                });
            });

            return services;
        }
    }
}
