using System.Reflection;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using MediatR;
using DataFeed.Infrastructure;
using DataFeed.Infrastructure.Providers.Tastytrade;
using DataFeed.Api.Hubs;
using DataFeed.Api.Infrastructure;
using DataFeed.Repositories;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.AspNetCore;

namespace DataFeed
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);

            // Controllers + Newtonsoft
            builder.Services.AddControllers()
                .AddNewtonsoftJson(options =>
                {
                    options.SerializerSettings.ReferenceLoopHandling = ReferenceLoopHandling.Ignore;
                });

            // Swagger
            builder.Services.AddEndpointsApiExplorer();
            builder.Services.AddSwaggerGen();

            // MediatR
            builder.Services.AddMediatR(cfg => cfg.RegisterServicesFromAssemblies(Assembly.Load("DataFeed.Application")));

            // AutoMapper
            builder.Services.AddAutoMapper(cfg => { }, Assembly.Load("DataFeed.Application"));

            // CORS
            builder.Services.AddCors(options =>
            {
                options.AddPolicy("ReactAppPolicy", policy =>
                {
                    policy.WithOrigins("http://localhost:3039", "https://localhost:3039",
                                       "http://localhost:5173", "https://localhost:5173",
                                       "https://galecore-monitor.vercel.app",
                                       "https://gale-core-monitor.vercel.app",
                                       "https://galecore.vercel.app")
                          .AllowAnyHeader()
                          .AllowAnyMethod()
                          .AllowCredentials();
                });
            });

            // HttpClient + OAuth
            builder.Services.AddHttpClient();
            // Credenciales de Tastytrade: sistema para mercado, usuario para cuenta (§5.4 del doc de
            // arquitectura). Mientras no haya filas en `accounts`, el store cae a appsettings y la
            // plataforma se comporta igual que antes de existir la base.
            builder.Services.AddHttpContextAccessor();
            builder.Services.AddScoped<ICurrentUser, HttpContextCurrentUser>();
            builder.Services.AddSingleton<ITokenProtector, DataFeed.Infrastructure.Security.AesGcmTokenProtector>();
            builder.Services.AddSingleton<ITastytradeCredentialStore, TastytradeCredentialStore>();
            builder.Services.AddSingleton<ITastytradeOAuth, TastytradeOAuth>();

            // Base de datos de dominio: usuarios, cuentas de bróker, catálogo de estrategias.
            // (PostgreSQL en Supabase. Ver docs/GaleCore-arquitectura-datos.md §5.)
            //
            // OPCIONAL A PROPÓSITO: si no hay cadena configurada, la API arranca igual y sin base.
            // Registrarla siempre haría que un entorno sin el secreto configurado no levante — y
            // TODO lo que la API hace hoy (mercado, GEX, RPF, el hub) es independiente de la base.
            // Que la falta de un secreto tire abajo el feed sería un acoplamiento inventado.
            //
            // La cadena NUNCA va en appsettings: user-secrets en local, variable de entorno en Azure.
            // Y va contra el pooler (puerto 6543), no contra el puerto directo: App Service abre y
            // cierra conexiones, y por el 5432 se agota el límite del proyecto.
            var galeCoreDb = builder.Configuration.GetConnectionString("GaleCore");
            var dbConfigured = !string.IsNullOrWhiteSpace(galeCoreDb);
            if (dbConfigured)
            {
                builder.Services.AddDbContext<GaleCoreDbContext>(o => o
                    .UseNpgsql(galeCoreDb)
                    .UseSnakeCaseNamingConvention());
            }

            // ── Autenticación con Supabase Auth (JWT) ──────────────────────────────────────────
            //
            // El proyecto firma los tokens de forma ASIMÉTRICA (ES256) y publica sus claves en
            // /auth/v1/.well-known/jwks.json, así que NO hay ningún secreto que guardar: la API baja
            // las claves públicas del emisor y las refresca sola cuando Supabase las rota. El
            // Authority alcanza porque Supabase expone el documento de descubrimiento OIDC.
            //
            // AGREGA una forma de autenticar; todavía no OBLIGA a ninguna. ApiKeyMiddleware sigue
            // igual y el front sigue entrando con X-API-KEY: si acá se exigiera JWT de una, el
            // tablero dejaría de funcionar en el mismo commit que agrega el login. La migración de
            // endpoint por endpoint viene después, y recién ahí se decide qué pasa con la API key.
            //
            // El issuer NO es un secreto (el JWKS es público), por eso vive en appsettings.
            var supabaseIssuer = builder.Configuration["Supabase:Issuer"];
            if (!string.IsNullOrWhiteSpace(supabaseIssuer))
            {
                builder.Services
                    .AddAuthentication(Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerDefaults.AuthenticationScheme)
                    .AddJwtBearer(options =>
                    {
                        options.Authority = supabaseIssuer;

                        // Los claims conservan el nombre que les puso Supabase. Por defecto ASP.NET
                        // los renombra a URIs XML heredadas de WS-Federation (sub -> nameidentifier,
                        // email -> .../claims/emailaddress), así que buscar "sub" o "email" devuelve
                        // null aunque el token los traiga. Se verificó en vivo: el token llegaba con
                        // el mail y /Me lo reportaba vacío.
                        options.MapInboundClaims = false;

                        options.TokenValidationParameters = new Microsoft.IdentityModel.Tokens.TokenValidationParameters
                        {
                            ValidateIssuer = true,
                            ValidIssuer = supabaseIssuer,
                            ValidateAudience = true,
                            // Supabase emite aud="authenticated" para cualquier usuario logueado.
                            ValidAudience = builder.Configuration["Supabase:Audience"] ?? "authenticated",
                            ValidateLifetime = true,
                            ValidateIssuerSigningKey = true,
                            // Sin tolerancia: los access tokens de Supabase duran una hora y el front
                            // los renueva solo. Los 5 minutos por defecto son una ventana regalada.
                            ClockSkew = TimeSpan.Zero,

                            // Con el renombrado apagado hay que decirle explícitamente de qué claim
                            // sale la identidad y de cuál el rol, o User.Identity.Name queda vacío y
                            // [Authorize(Roles=...)] no encontraría nada.
                            NameClaimType = "sub",
                            RoleClaimType = "role",
                        };

                        // Un 401 sin motivo es indepurable: el cliente solo ve "invalid_token" y el
                        // servidor no deja rastro. Acá queda la excepción real (IDX…), que distingue
                        // firma inválida de metadata inalcanzable, de audiencia equivocada.
                        options.Events = new Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerEvents
                        {
                            // SignalR sobre WebSocket no puede mandar headers propios: el navegador
                            // no lo permite en el upgrade. Por eso la convención es el token en la
                            // query string, que es lo que pone accessTokenFactory del cliente.
                            // Se acepta SOLO para /hubs — en el resto de la API el token va donde
                            // corresponde, en el header, y no queriendo quedar en logs de acceso.
                            OnMessageReceived = ctx =>
                            {
                                var token = ctx.Request.Query["access_token"];
                                if (!string.IsNullOrEmpty(token) &&
                                    ctx.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                                {
                                    ctx.Token = token;
                                }
                                return Task.CompletedTask;
                            },

                            OnAuthenticationFailed = ctx =>
                            {
                                ctx.HttpContext.RequestServices
                                    .GetRequiredService<ILogger<Program>>()
                                    .LogWarning(ctx.Exception, "JWT rechazado: {Message}", ctx.Exception.Message);
                                return Task.CompletedTask;
                            },
                        };
                    });
            }

            // La política del hub se arma UNA vez al arrancar, desde configuración. Se registra
            // siempre —incluso sin Supabase configurado— porque el atributo [Authorize(Policy=...)]
            // del hub tiene que poder resolverse igual; si no hay autenticación armada, la política
            // deja pasar y el hub se comporta como hasta hoy.
            //
            // Se hace con política y no con Context.Abort() adentro del hub porque abortar actúa
            // DESPUÉS del handshake: el cliente conecta, lo cortan, y con withAutomaticReconnect
            // entra en un ciclo de reconexión. Con política, el negotiate devuelve 401 y el cliente
            // sabe desde el principio que no tiene permiso.
            var requireAuthOnHub = !string.IsNullOrWhiteSpace(supabaseIssuer)
                                   && builder.Configuration.GetValue<bool>("Supabase:RequireAuthOnHub");

            builder.Services.AddAuthorization(options =>
            {
                options.AddPolicy("HubAccess", policy =>
                {
                    if (requireAuthOnHub) policy.RequireAuthenticatedUser();
                    else policy.RequireAssertion(_ => true);
                });
            });

            // SignalR
            //
            // El provider de identidad es propio porque el switch de estrategia tiene un nivel por
            // usuario: al apagarla, el aviso va a los tableros de ESE usuario y no al grupo entero.
            // El de fábrica busca ClaimTypes.NameIdentifier, que acá no existe (MapInboundClaims
            // está en false y el uuid llega en `sub`). Ver SubUserIdProvider.
            builder.Services.AddSingleton<Microsoft.AspNetCore.SignalR.IUserIdProvider, SubUserIdProvider>();

            builder.Services.AddSignalR()
                .AddNewtonsoftJsonProtocol(options =>
                {
                    options.PayloadSerializerSettings.ReferenceLoopHandling = ReferenceLoopHandling.Ignore;
                    options.PayloadSerializerSettings.ContractResolver = new CamelCasePropertyNamesContractResolver();
                });

            // Streaming: DxLink persistente + broadcaster SignalR
            builder.Services.AddSingleton<IMarketDataBroadcaster, MarketDataBroadcaster>();
            builder.Services.AddSingleton<DxLinkStreamingService>();
            builder.Services.AddSingleton<IDxLinkStreamingService>(sp => sp.GetRequiredService<DxLinkStreamingService>());
            builder.Services.AddHostedService(sp => sp.GetRequiredService<DxLinkStreamingService>());
            builder.Services.AddHostedService<SkewSnapshotService>();
            builder.Services.AddHostedService<GexWarmService>();

            // Orquestación RPF (Fase 6a) — store in-memory + loop. El loop arranca INERTE:
            // no corre la cascada ni emite hasta state_machine.enabled=true en galecore_rules_rpf.json.
            builder.Services.AddSingleton<DataFeed.Application.App.Rpf.RpfStateStore>();
            // Switch de estrategia: el operador puede cortar el loop desde el front sin reiniciar.
            builder.Services.AddSingleton<RpfStrategySwitch>();
            builder.Services.AddHostedService<RpfLoopService>();

            // GEX no tiene BackgroundService: su switch corta el barrido de la cadena, que es lo
            // único que esa estrategia corre por su cuenta (y lo que compite por el feed DXLink).
            builder.Services.AddSingleton<GexStrategySwitch>();

            // Trading Runtime SHADOW (Phase 1) — store in-memory + loops. Arranca INERTE (switch OFF).
            // Namespace separado (App.Runtime), switches independientes, sin FK a users/accounts.
            builder.Services.AddSingleton<DataFeed.Application.App.Runtime.ShadowRuntimeStore>();
            builder.Services.AddSingleton<RuntimeStrategySwitch>();
            builder.Services.AddSingleton<ShadowRuntimePersistenceStatus>();
            builder.Services.AddHostedService<ShadowEntryLoopService>();
            builder.Services.AddHostedService<ShadowPositionMonitorService>();

            // Quién es quién (tabla `users`): hoy resuelve si quien llama es admin, que es el
            // permiso para tocar los kill switch. Se registra siempre, incluso sin base: adentro
            // resuelve el DbContext por scope y, si no está registrado, no hay permisos que
            // consultar y la API se comporta como antes de que la base existiera.
            builder.Services.AddSingleton<UserStore>();

            // ABM de operadores desde Administrator: crea, edita y borra usuarios en Supabase Auth.
            // Se registra siempre; adentro comprueba si tiene la service_role key y, si no, los
            // endpoints contestan 503 con el motivo. Que falte un secreto no puede tumbar el feed.
            builder.Services.AddSingleton<DataFeed.Api.Infrastructure.SupabaseAdminClient>();

            // Login por username: resuelve username → mail contra `users` y autentica ese mail
            // contra Supabase con la ANON key (la service_role hace falta para crear usuarios, no
            // para loguearlos).
            builder.Services.AddSingleton<DataFeed.Api.Infrastructure.SupabaseAuthClient>();

            // Rate limit del login, que es el ÚNICO endpoint sin JWT. Sin esto, la única defensa
            // contra probar contraseñas en bucle sería la de Supabase, que no conoce nuestros
            // usernames — y cada intento nuestro le cuesta a la base una consulta antes de llegar
            // hasta allá.
            //
            // Ventana fija por IP: 10 intentos cada 5 minutos, sin cola (el 11 se rechaza en el
            // acto en vez de esperar turno, que para un login es lo correcto: quien se equivocó
            // quiere saber ya). Es holgado para alguien que tipea mal su contraseña y ridículo para
            // una fuerza bruta.
            builder.Services.AddRateLimiter(options =>
            {
                options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

                options.AddPolicy("login", http =>
                    System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
                        // Detrás de un proxy la IP remota es la del proxy: X-Forwarded-For es lo que
                        // distingue a los clientes de verdad. Sin ninguna de las dos, todos caen en
                        // la misma partición, que es el lado seguro (limita de más, no de menos).
                        partitionKey: http.Request.Headers["X-Forwarded-For"].FirstOrDefault()
                                      ?? http.Connection.RemoteIpAddress?.ToString()
                                      ?? "sin-ip",
                        factory: _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions
                        {
                            PermitLimit = 10,
                            Window = TimeSpan.FromMinutes(5),
                            QueueLimit = 0,
                        }));
            });

            // Switch de los servicios de plataforma (services[] de galecore_rules_core.json): los
            // procesos que corren solos y no son de ninguna estrategia. Va ANTES de los
            // AddHostedService de arriba en el orden de lectura, pero el contenedor no depende del
            // orden de registro: los servicios lo reciben por constructor igual.
            builder.Services.AddSingleton<PlatformServiceSwitch>();

            // MCP Server
            builder.Services
                .AddMcpServer()
                .WithHttpTransport()
                .WithToolsFromAssembly();

            builder.Host.UseDefaultServiceProvider(options =>
                options.ValidateScopes = false);

            var app = builder.Build();

            // Se loguea el estado de la base al arrancar: sin esto, "la base no está configurada"
            // y "la base está configurada pero no responde" se ven igual desde afuera.
            app.Services.GetRequiredService<ILogger<Program>>().LogInformation(
                dbConfigured
                    ? "GaleCore DB: configurada (ConnectionStrings:GaleCore)."
                    : "GaleCore DB: NO configurada — la API corre sin base. Configurar " +
                      "ConnectionStrings:GaleCore en user-secrets (local) o variable de entorno (Azure).");

            app.Services.GetRequiredService<ILogger<Program>>().LogInformation(
                string.IsNullOrWhiteSpace(supabaseIssuer)
                    ? "Supabase Auth: NO configurada — no se validan JWT. Configurar Supabase:Issuer."
                    : "Supabase Auth: validando JWT contra {Issuer}", supabaseIssuer);


            // Pipeline (orden corregido)
            app.UseMiddleware<ExceptionHandlerMiddleware>();

            if (app.Environment.IsDevelopment())
            {
                app.UseDeveloperExceptionPage();
                // Swagger sólo en Development (WS-0048): en otros entornos no se publica el mapa de la API.
                app.UseSwagger();
                app.UseSwaggerUI(c =>
                {
                    c.SwaggerEndpoint("/swagger/v1/swagger.json", "DataFeed v1");
                });
            }

            app.UseStaticFiles();
            app.UseCors("ReactAppPolicy");

            // ANTES de la API key: así ApiKeyMiddleware puede ver si el request ya viene
            // autenticado con un JWT válido y dejarlo pasar sin exigir además la clave. Sin esto,
            // el tablero tendría que seguir cargando una API key en el bundle —o sea pública— solo
            // para satisfacer una capa que el login ya reemplaza.
            if (!string.IsNullOrWhiteSpace(supabaseIssuer))
            {
                app.UseAuthentication();
            }

            app.UseMiddleware<ApiKeyMiddleware>();

            // La política del hub se evalúa aunque no haya autenticación configurada (en ese caso
            // deja pasar, ver arriba).
            app.UseAuthorization();

            // Después de la autorización: solo tiene efecto sobre las rutas que declaran una
            // política ([EnableRateLimiting]), o sea hoy el login y nada más.
            app.UseRateLimiter();

            // Trading Runtime: cargar specs de Files/Runtime/ al arrancar.
            {
                var runtimeStore = app.Services.GetRequiredService<DataFeed.Application.App.Runtime.ShadowRuntimeStore>();
                var runtimeDir = Path.Combine(builder.Environment.ContentRootPath, "Files", "Runtime");
                var specResults = DataFeed.Application.App.Runtime.StrategySpecLoader.LoadAll(runtimeDir);
                foreach (var (name, result) in specResults)
                {
                    if (result.Success && result.Spec != null)
                    {
                        // Se registra más abajo: con persistencia, recién después de guardarla (GC-0004).
                        app.Services.GetRequiredService<ILogger<Program>>().LogInformation(
                            "Runtime: spec '{Name}' cargado (hash={Hash})", name, result.ContentHash);
                    }
                    else
                    {
                        app.Services.GetRequiredService<ILogger<Program>>().LogWarning(
                            "Runtime: spec '{Name}' falló validación: {Errors}", name, string.Join("; ", result.Errors));
                    }
                }

                // GC-0004: persistencia y recuperación, sólo donde el entorno la prende explícitamente
                // (Runtime:Persistence:Enabled). Si no, el runtime no despliega nada y la API sigue
                // sirviendo todo lo demás.
                var persistence = app.Services.GetRequiredService<ShadowRuntimePersistenceStatus>();
                var runtimeLog = app.Services.GetRequiredService<ILogger<Program>>();
                var rejected = DataFeed.Application.App.Runtime.ShadowPersistenceGuard.RejectReason(
                    builder.Configuration.GetValue<bool>(DataFeed.Application.App.Runtime.ShadowPersistenceGuard.EnabledKey), galeCoreDb);
                if (rejected != null)
                {
                    persistence.MarkUnavailable(rejected);
                    // Sin persistencia las specs se muestran (sólo lectura); no se puede desplegar ninguna.
                    foreach (var (name, result) in specResults)
                        if (result.Success && result.Spec != null) runtimeStore.RegisterSpec(name, result.Spec);
                    runtimeLog.LogWarning("Runtime SHADOW sin persistencia: {Reason}. No se puede desplegar.", rejected);
                }
                else
                {
                    try
                    {
                        var dbOptions = new DbContextOptionsBuilder<GaleCoreDbContext>()
                            .UseNpgsql(galeCoreDb).UseSnakeCaseNamingConvention().Options;
                        var repository = new DataFeed.Application.App.Runtime.EfShadowRuntimeRepository(
                            () => new GaleCoreDbContext(dbOptions));
                        var report = DataFeed.Application.App.Runtime.ShadowRuntimeRecovery.Recover(runtimeStore, repository, specResults);
                        persistence.MarkAvailable(report, repository);
                        runtimeLog.LogInformation(
                            "Runtime SHADOW persistente: recuperadas {Instances} instancias, {Open} posiciones abiertas, " +
                            "{Closed} cerradas, {Evaluations} evaluaciones, {Events} eventos; specs reconstruidas: {Rebuilt}; problemas: {Problems}",
                            report.Instances, report.OpenPositions, report.ClosedPositions, report.Evaluations, report.Events,
                            report.SpecsRebuilt.Count, string.Join("; ", report.Problems));
                    }
                    catch (Exception ex)
                    {
                        persistence.MarkUnavailable($"no se pudo recuperar el estado guardado: {ex.GetBaseException().Message}");
                        runtimeLog.LogError(ex, "Runtime SHADOW sin persistencia: falló la recuperación. No se puede desplegar.");
                    }
                }
            }

            //app.MapGet("/health", () => "DataFeed OK");
            app.MapControllers();
            app.MapHub<MarketDataHub>("/hubs/marketdata");
            app.MapMcp("/mcp");

            // El calendario del monitor (FRED y Fed) se lee una vez por día: se precalienta al arrancar para que
            // la primera apertura no espere a las fuentes (WS-0038). Si falla, el primer pedido vuelve a intentar.
            app.Lifetime.ApplicationStarted.Register(() => _ = Task.Run(async () =>
            {
                using var scope = app.Services.CreateScope();
                var sender = scope.ServiceProvider.GetRequiredService<IMediator>();
                var today = DataFeed.Application.Shared.DailyCache.Today.ToDateTime(TimeOnly.MinValue);
                await Task.WhenAll(
                    sender.Send(new DataFeed.Application.Data.Fred.ReleaseDates.FredReleaseDatesRequest { From = today, To = today.AddDays(45), ReleaseIds = DataFeed.Application.App.Shared.EventCatalog.FredReleaseIdsCsv }),
                    sender.Send(new DataFeed.Application.Data.Fed.FomcMeetings.FomcMeetingsRequest()));
            }).ContinueWith(t => app.Logger.LogWarning(t.Exception?.GetBaseException(), "Calendario: no se pudo precalentar"), TaskContinuationOptions.OnlyOnFaulted));

            app.Run();
        }
    }
}
