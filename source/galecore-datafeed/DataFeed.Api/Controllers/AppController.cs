using MediatR;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using System.IO;
using System.Threading.Tasks;
using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.Gex;
using DataFeed.Application.App.ImpliedVolatility;
using DataFeed.Application.App.IVRank;
using DataFeed.Application.App.PutSkew;
using DataFeed.Api.Controllers.Dtos;
using Microsoft.EntityFrameworkCore;

namespace DataFeed.Controllers
{
    [ApiController]
    [Route("[controller]")]
    public class AppController : DataFeedControllerBase
    {
        private readonly IWebHostEnvironment _env;
        private readonly DataFeed.Api.Infrastructure.RpfStrategySwitch _rpfSwitch;
        private readonly DataFeed.Api.Infrastructure.GexStrategySwitch _gexSwitch;
        private readonly DataFeed.Application.App.Rpf.RpfStateStore _rpfStore;
        private readonly DataFeed.Infrastructure.Providers.Tastytrade.IMarketDataBroadcaster _broadcaster;
        private readonly DataFeed.Api.Infrastructure.UserStore _users;
        private readonly DataFeed.Api.Infrastructure.PlatformServiceSwitch _serviceSwitch;
        private readonly DataFeed.Infrastructure.Providers.Tastytrade.ICurrentUser _currentUser;
        private readonly DataFeed.Application.App.Runtime.ShadowRuntimeStore _runtimeStore;
        private readonly DataFeed.Api.Infrastructure.RuntimeStrategySwitch _runtimeSwitch;
        private readonly DataFeed.Api.Infrastructure.ShadowRuntimePersistenceStatus _runtimePersistence;
        private readonly ILogger<AppController> _logger;

        public AppController(IMediator mediator, IWebHostEnvironment env,
            DataFeed.Api.Infrastructure.RpfStrategySwitch rpfSwitch,
            DataFeed.Api.Infrastructure.GexStrategySwitch gexSwitch,
            DataFeed.Application.App.Rpf.RpfStateStore rpfStore,
            DataFeed.Infrastructure.Providers.Tastytrade.IMarketDataBroadcaster broadcaster,
            DataFeed.Api.Infrastructure.UserStore users,
            DataFeed.Api.Infrastructure.PlatformServiceSwitch serviceSwitch,
            DataFeed.Infrastructure.Providers.Tastytrade.ICurrentUser currentUser,
            DataFeed.Application.App.Runtime.ShadowRuntimeStore runtimeStore,
            DataFeed.Api.Infrastructure.RuntimeStrategySwitch runtimeSwitch,
            DataFeed.Api.Infrastructure.ShadowRuntimePersistenceStatus runtimePersistence,
            ILogger<AppController> logger)
            : base(mediator)
        {
            _serviceSwitch = serviceSwitch;
            _env = env;
            _rpfSwitch = rpfSwitch;
            _gexSwitch = gexSwitch;
            _rpfStore = rpfStore;
            _broadcaster = broadcaster;
            _users = users;
            _currentUser = currentUser;
            _runtimeStore = runtimeStore;
            _runtimeSwitch = runtimeSwitch;
            _runtimePersistence = runtimePersistence;
            _logger = logger;
        }

        #region Analytics

        [Tags("App.Analytics")]
        [HttpGet("/App.Analytics/GammaExposure")]
        // 409 = el símbolo no tiene cadena analizable (`option_chain_not_found`). Sin declararlo,
        // Swagger lo muestra como "Undocumented" y el que integra no sabe que existe ese estado.
        [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
        public async Task<IActionResult> GammaExposureAsync([FromQuery] GammaExposureRequest request) => await Handle(request);

        [Tags("App.Analytics")]
        [HttpGet("/App.Analytics/IVRank")]
        public async Task<IActionResult> IVRankAsync([FromQuery] IVRankRequest request) => await Handle(request);

        [Tags("App.Analytics")]
        [HttpGet("/App.Analytics/ImpliedVolatility")]
        public async Task<IActionResult> ImpliedVolatilityAsync([FromQuery] ImpliedVolatilityRequest request) => await Handle(request);

        [Tags("App.Analytics")]
        [HttpGet("/App.Analytics/PutSkew")]
        public async Task<IActionResult> PutSkewAsync([FromQuery] PutSkewRequest request) => await Handle(request);

        #endregion

        #region GaleCore

        // Config de la APLICACION, no de una estrategia: universo de streaming, lista de estrategias
        // implementadas y config de la pestaña Monitor. Cada estrategia sirve sus reglas por su
        // propio prefijo (/App/Rpf/Rules, /App/Gex/Rules).

        /// <summary>
        /// Configuración de la aplicación (`Files/galecore_rules_core.json`, servido tal cual).
        /// De acá salen el universo que el front streamea, las cards de estrategias de Main y los
        /// umbrales de gestión de la pestaña Monitor.
        /// </summary>
        [Tags("App.GaleCore")]
        [HttpGet("GaleCore/Rules/Core")]
        public async Task<IActionResult> RulesCoreAsync()
            => await ServeRulesFileAsync("galecore_rules_core.json");

        /// <summary>
        /// Estado del switch de un servicio de plataforma (`services[]` de la config de la app).
        /// Dos niveles, no tres: estos procesos no trabajan para nadie en particular, así que no
        /// tienen preferencia por usuario. `source` vale "platform" o "rules".
        /// </summary>
        [Tags("App.GaleCore")]
        [HttpGet("GaleCore/Services/{serviceId}/Switch")]
        public IActionResult ServiceSwitchGet(string serviceId)
        {
            var resolved = _serviceSwitch.Resolve(serviceId);
            if (resolved == null)
                return NotFound(new { error = $"El servicio '{serviceId}' no está declarado en services[] de la config." });

            return Ok(new { enabled = resolved.Value.Enabled, source = resolved.Value.Source });
        }

        /// <summary>
        /// Prende o apaga un servicio de plataforma. Es kill switch para todos —no hay otro nivel—
        /// así que lo tocan solo los admin (users.is_admin).
        ///
        /// El servicio lo relee en su próximo tick: el corte de `skew` tarda hasta 6h en notarse
        /// porque esa es su cadencia, y el de `flow` hasta 30s.
        /// </summary>
        [Tags("App.GaleCore")]
        [HttpPost("GaleCore/Services/{serviceId}/Switch")]
        public async Task<IActionResult> ServiceSwitchSetAsync(
            string serviceId, [FromBody] ServiceSwitchRequest body, CancellationToken ct)
        {
            if (!_serviceSwitch.IsDeclared(serviceId))
                return NotFound(new { error = $"El servicio '{serviceId}' no está declarado en services[] de la config." });

            var denied = await DenyIfNotPlatformAdminAsync($"el servicio {serviceId}", ct);
            if (denied != null) return denied;

            // El switch del runtime SHADOW se cambia bajo el mismo lock con el que se registra una
            // posición: apagarlo no deja que una entrada en curso se registre después (GC-0002).
            if (serviceId == RuntimeStrategyId)
                _runtimeStore.UnderCommitGate(() => _serviceSwitch.Set(serviceId, body.Enabled));
            else
                _serviceSwitch.Set(serviceId, body.Enabled);

            var resolved = _serviceSwitch.Resolve(serviceId)!.Value;
            return Ok(new { enabled = resolved.Enabled, source = resolved.Source, scope = "platform" });
        }

        public class ServiceSwitchRequest
        {
            public bool Enabled { get; set; }
        }

        /// <summary>
        /// Quién es el portador del token. Endpoint de diagnóstico de la autenticación con Supabase:
        /// es la única forma de comprobar de punta a punta que la API valida los JWT del proyecto
        /// (firma ES256 contra el JWKS público, emisor y audiencia).
        ///
        /// Sin token devuelve 401; con uno válido, el uuid del usuario — que es la clave con la que
        /// se lo busca en la tabla `users`, porque users.id ES el auth.users.id de Supabase.
        ///
        /// Ojo: hoy exige TAMBIÉN la API key, porque ApiKeyMiddleware corre antes y sigue aplicando
        /// a todo /App. Las dos capas conviven mientras dure la migración al login.
        ///
        /// El front lo consume además para saber qué puede mostrar habilitado: `canManagePlatform`
        /// es lo que decide si el switch de una estrategia se puede tocar. Es la MISMA regla que
        /// aplica el 403 del POST (<see cref="CanManagePlatformAsync"/>), no una copia — si fueran
        /// dos, la UI y el backend se contradecirían y el operador vería un botón que no funciona.
        /// </summary>
        [Microsoft.AspNetCore.Authorization.Authorize]
        [Tags("App.GaleCore")]
        [HttpGet("GaleCore/Me")]
        public async Task<IActionResult> MeAsync(CancellationToken ct)
        {
            // "sub" es el uuid del usuario en Supabase. ASP.NET lo mapea a NameIdentifier salvo que
            // se desactive el mapeo de claims, así que se buscan los dos nombres.
            var sub = User.FindFirst("sub")?.Value
                   ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;

            var userId = _currentUser.UserId;

            // Primer request autenticado del tablero: es acá donde nace la fila de `users`. Ver
            // UserStore.EnsureUserAsync — sin esto, un usuario recién creado en Supabase no aparece
            // en la pantalla de administración y nadie le puede dar permisos.
            if (userId.HasValue)
                await _users.EnsureUserAsync(userId.Value, _currentUser.Email, ct);

            // El username y el permiso salen de la MISMA consulta: los dos viven en la fila que se
            // acaba de asegurar arriba.
            var (username, isAdmin) = userId.HasValue
                ? await _users.ReadProfileAsync(userId.Value, ct)
                : (null, false);

            return Ok(new
            {
                userId = sub,
                email = User.FindFirst("email")?.Value,
                role = User.FindFirst("role")?.Value,
                issuer = User.Claims.FirstOrDefault(c => c.Type == "iss")?.Value,

                // Con lo que entró: vive en `users`, no en el token — Supabase Auth no lo conoce.
                username,

                // La verdad cruda de la tabla: false sin base, sin fila o si la consulta falla.
                isAdmin,

                // El permiso EFECTIVO, que no es lo mismo: sin base no hay permisos que consultar
                // y la API se comporta como antes de que la base existiera.
                canManagePlatform = await CanManagePlatformAsync(ct),
                databaseConfigured = _users.DatabaseConfigured,

                claims = User.Claims.Select(c => new { type = c.Type, value = c.Value }),
            });
        }

        /// <summary>
        /// Respuesta para los endpoints que necesitan la base cuando la API está corriendo sin ella.
        ///
        /// La base es OPCIONAL a propósito (`Program.cs`): sin cadena configurada la API igual
        /// levanta y sirve mercado, GEX, RPF y el hub, porque nada de eso depende de la base. El
        /// costo era que estos endpoints estallaban con un 500 y un stack trace de DI —el cliente
        /// leía "error del servidor" cuando en realidad falta un secreto de configuración—. 503 dice
        /// la verdad: la función no está disponible en este entorno, y el mensaje dice por qué.
        ///
        /// Se resuelve el DbContext por IServiceProvider y no con [FromServices] porque el binder
        /// pide el servicio como requerido: si no está registrado, tira antes de entrar al método y
        /// no hay forma de contestar nada.
        /// </summary>
        private IActionResult DatabaseNotConfigured()
        {
            _logger.LogWarning(
                "Se pidió un endpoint que necesita la base, pero la API está corriendo sin ella " +
                "(falta ConnectionStrings:GaleCore).");

            return StatusCode(503, new
            {
                error = "Esta API está corriendo sin base de datos configurada, así que no puede " +
                        "resolver cuentas de bróker por usuario. Falta ConnectionStrings:GaleCore " +
                        "(user-secrets en local, App Settings en el hosting).",
            });
        }

        /// <summary>
        /// La cuenta de bróker vinculada al usuario autenticado. Nunca devuelve el refresh token:
        /// entra a la base cifrado y no vuelve a salir por HTTP.
        /// </summary>
        [Microsoft.AspNetCore.Authorization.Authorize]
        [Tags("App.GaleCore")]
        [HttpGet("GaleCore/Account")]
        public async Task<IActionResult> GetBrokerAccountAsync(
            [FromServices] IServiceProvider services,
            [FromServices] DataFeed.Infrastructure.Providers.Tastytrade.ICurrentUser currentUser,
            CancellationToken ct)
        {
            var userId = currentUser.UserId;
            if (userId == null) return Unauthorized();

            var db = services.GetService<DataFeed.Repositories.GaleCoreDbContext>();
            if (db == null) return DatabaseNotConfigured();

            var account = await db.Accounts.AsNoTracking()
                .FirstOrDefaultAsync(a => a.UserId == userId.Value, ct);

            if (account == null) return Ok(new { linked = false });

            return Ok(new
            {
                linked = true,
                broker = account.Broker,
                accountNumber = account.AccountNumber,
                isSystem = account.IsSystem,

                // SI hay uno propio, no CUÁL es. El valor entra cifrado y no vuelve a salir, igual
                // que el refresh token; esto es solo para que la pantalla pueda decir por qué
                // aplicación OAuth entra esta cuenta, que es lo primero que uno quiere saber cuando
                // Tastytrade la rechaza.
                hasOwnClientSecret = account.ClientSecretEncrypted != null,

                updatedAt = account.UpdatedAt,
            });
        }

        /// <summary>
        /// Vincula (o actualiza) la cuenta de bróker del usuario autenticado. El refresh token —y el
        /// client_secret propio, si el operador registró su propia aplicación OAuth— se cifran con
        /// AES-GCM antes de guardarse.
        ///
        /// Crea la fila de `users` si no existe: la identidad la maneja Supabase Auth y esta tabla
        /// solo le cuelga las FK, así que la primera vez que alguien válido aparece hay que
        /// materializarlo. El uuid y el mail salen del token, NO del body — si vinieran del body,
        /// cualquiera podría vincular una cuenta al usuario de otro.
        /// </summary>
        [Microsoft.AspNetCore.Authorization.Authorize]
        [Tags("App.GaleCore")]
        [HttpPost("GaleCore/Account")]
        public async Task<IActionResult> LinkBrokerAccountAsync(
            [FromBody] DataFeed.Api.Controllers.Dtos.LinkBrokerAccountRequest body,
            [FromServices] IServiceProvider services,
            [FromServices] DataFeed.Infrastructure.Providers.Tastytrade.ICurrentUser currentUser,
            [FromServices] DataFeed.Infrastructure.Providers.Tastytrade.ITokenProtector protector,
            CancellationToken ct)
        {
            var userId = currentUser.UserId;
            if (userId == null) return Unauthorized();

            var db = services.GetService<DataFeed.Repositories.GaleCoreDbContext>();
            if (db == null) return DatabaseNotConfigured();

            if (string.IsNullOrWhiteSpace(body.AccountNumber) || string.IsNullOrWhiteSpace(body.RefreshToken))
                return BadRequest(new { error = "accountNumber y refreshToken son requeridos." });

            // Normalmente la fila ya existe (la crea /Me al entrar al tablero). Se reintenta acá
            // para el caso de una llamada que no pasó por /Me — una integración con el token, por
            // ejemplo: sin la fila de `users`, el INSERT en `accounts` viola la FK.
            await _users.EnsureUserAsync(userId.Value, currentUser.Email, ct);

            var account = await db.Accounts
                .FirstOrDefaultAsync(a => a.UserId == userId.Value && a.Broker == "tastytrade", ct);

            if (account == null)
            {
                account = new DataFeed.Repositories.Entities.Account
                {
                    Id = Guid.NewGuid(),
                    UserId = userId.Value,
                    Broker = "tastytrade",
                    CreatedAt = DateTime.UtcNow,
                };
                db.Accounts.Add(account);
            }

            account.AccountNumber = body.AccountNumber.Trim();
            account.RefreshTokenEncrypted = protector.Protect(body.RefreshToken.Trim());

            // Las dos mitades se escriben JUNTAS, y el vacío borra en vez de conservar. Si esto
            // fuera un "solo pisalo si vino", un operador que re-vincula tras rotar su refresh token
            // se quedaría con el client_secret de la vinculación anterior: dos mitades de
            // aplicaciones OAuth distintas, que es justo lo que Tastytrade rechaza.
            var propio = body.ClientSecret?.Trim();
            account.ClientSecretEncrypted = string.IsNullOrWhiteSpace(propio)
                ? null
                : protector.Protect(propio);

            account.UpdatedAt = DateTime.UtcNow;

            await db.SaveChangesAsync(ct);

            _logger.LogInformation(
                "Cuenta de bróker vinculada para el usuario {UserId} (aplicación OAuth: {App})",
                userId.Value,
                account.ClientSecretEncrypted == null ? "la de la plataforma" : "propia del operador");

            return Ok(new
            {
                linked = true,
                accountNumber = account.AccountNumber,
                hasOwnClientSecret = account.ClientSecretEncrypted != null,
            });
        }

        /// <summary>
        /// Desvincula la cuenta de bróker del usuario autenticado. Borra la fila, o sea también el
        /// refresh token cifrado: no hay "desvincular pero guardar por las dudas", porque una
        /// credencial que nadie sabe que sigue ahí es exactamente lo que no queremos.
        ///
        /// Solo la PROPIA: el uuid sale del token. Un admin no desvincula la cuenta de otro — puede
        /// administrar usuarios, no sus credenciales de bróker.
        ///
        /// OJO CON LA CUENTA DE SISTEMA: si la que se borra es la `is_system`, los procesos de fondo
        /// se quedan sin credencial para pedir datos de mercado. Se avisa en la respuesta y se
        /// loguea como warning; no se bloquea, porque a veces desvincular es justo lo que se quiere
        /// (una credencial comprometida, por ejemplo).
        /// </summary>
        [Microsoft.AspNetCore.Authorization.Authorize]
        [Tags("App.GaleCore")]
        [HttpDelete("GaleCore/Account")]
        public async Task<IActionResult> UnlinkBrokerAccountAsync(
            [FromServices] IServiceProvider services,
            [FromServices] DataFeed.Infrastructure.Providers.Tastytrade.ICurrentUser currentUser,
            CancellationToken ct)
        {
            var userId = currentUser.UserId;
            if (userId == null) return Unauthorized();

            var db = services.GetService<DataFeed.Repositories.GaleCoreDbContext>();
            if (db == null) return DatabaseNotConfigured();

            var account = await db.Accounts
                .FirstOrDefaultAsync(a => a.UserId == userId.Value && a.Broker == "tastytrade", ct);

            if (account == null) return Ok(new { linked = false, alreadyUnlinked = true });

            var eraSistema = account.IsSystem;

            db.Accounts.Remove(account);
            await db.SaveChangesAsync(ct);

            if (eraSistema)
                _logger.LogWarning(
                    "Se desvinculó la cuenta de SISTEMA (usuario {UserId}). Los procesos de fondo se " +
                    "quedan sin credencial para datos de mercado hasta que se marque otra.", userId.Value);
            else
                _logger.LogInformation("Cuenta de bróker desvinculada del usuario {UserId}", userId.Value);

            return Ok(new { linked = false, wasSystem = eraSistema });
        }

        #endregion

        #region Espacio del trader

        // GC-0007: lo que GaleCore-AI necesita saber de cada trader (perfil, objetivos, convenciones, memoria, skills,
        // agentes, datos), suyo y por usuario. Lo propio se lee y se edita; lo compartido por otros sólo se lee.

        /// <summary>Lo tuyo más lo que otros compartieron. `kind` filtra por tipo.</summary>
        [Microsoft.AspNetCore.Authorization.Authorize]
        [Tags("App.GaleCore")]
        [HttpGet("GaleCore/Space")]
        public async Task<IActionResult> GetTraderSpaceAsync(
            [FromQuery] string? kind,
            [FromServices] IServiceProvider services,
            [FromServices] DataFeed.Infrastructure.Providers.Tastytrade.ICurrentUser currentUser,
            CancellationToken ct)
        {
            var userId = currentUser.UserId;
            if (userId == null) return Unauthorized();
            var db = services.GetService<DataFeed.Repositories.GaleCoreDbContext>();
            if (db == null) return DatabaseNotConfigured();
            if (kind != null && !DataFeed.Repositories.Entities.TraderSpaceItem.Kinds.Contains(kind))
                return BadRequest(new { error = $"kind es uno de: {string.Join(", ", DataFeed.Repositories.Entities.TraderSpaceItem.Kinds)}" });

            var rows = await db.TraderSpaceItems.AsNoTracking()
                .Where(i => (i.OwnerId == userId.Value || i.Visibility == "shared") && (kind == null || i.Kind == kind))
                .OrderBy(i => i.Kind).ThenBy(i => i.Key)
                .Select(i => new
                {
                    i.Kind, i.Key, i.Title, i.Content, i.Format, i.Visibility, i.Version, i.UpdatedAt,
                    owner = i.Owner.Username,
                    isOwn = i.OwnerId == userId.Value,
                })
                .ToListAsync(ct);
            return Ok(new { items = rows.Where(r => r.isOwn), shared = rows.Where(r => !r.isOwn) });
        }

        /// <summary>
        /// Crea o reemplaza una pieza TUYA. La versión sube cuando cambia el título o el contenido; cambiar sólo la
        /// visibilidad no la sube. El dueño sale del token, nunca del body.
        /// </summary>
        [Microsoft.AspNetCore.Authorization.Authorize]
        [Tags("App.GaleCore")]
        [HttpPut("GaleCore/Space/{kind}/{key}")]
        public async Task<IActionResult> PutTraderSpaceItemAsync(
            string kind, string key,
            [FromBody] DataFeed.Api.Controllers.Dtos.TraderSpaceItemRequest body,
            [FromServices] IServiceProvider services,
            [FromServices] DataFeed.Infrastructure.Providers.Tastytrade.ICurrentUser currentUser,
            CancellationToken ct)
        {
            var userId = currentUser.UserId;
            if (userId == null) return Unauthorized();
            var db = services.GetService<DataFeed.Repositories.GaleCoreDbContext>();
            if (db == null) return DatabaseNotConfigured();

            var format = body.Format ?? "markdown";
            var visibility = body.Visibility ?? "private";
            var problem = DataFeed.Repositories.Entities.TraderSpaceItem.Validate(kind, key, body.Title ?? "", body.Content ?? "", format, visibility);
            if (problem != null) return BadRequest(new { error = problem });

            await _users.EnsureUserAsync(userId.Value, currentUser.Email, ct);
            var item = await db.TraderSpaceItems.FirstOrDefaultAsync(i => i.OwnerId == userId.Value && i.Kind == kind && i.Key == key, ct);
            var now = DateTime.UtcNow;
            if (item == null)
            {
                item = new DataFeed.Repositories.Entities.TraderSpaceItem
                {
                    OwnerId = userId.Value, Kind = kind, Key = key, Title = body.Title!, Content = body.Content!,
                    Format = format, Visibility = visibility, Version = 1, CreatedAt = now, UpdatedAt = now,
                };
                db.TraderSpaceItems.Add(item);
            }
            else
            {
                if (item.Title != body.Title || item.Content != body.Content || item.Format != format)
                    item.Version += 1;
                item.Title = body.Title!;
                item.Content = body.Content!;
                item.Format = format;
                item.Visibility = visibility;
                item.UpdatedAt = now;
            }
            await db.SaveChangesAsync(ct);
            return Ok(new { item.Kind, item.Key, item.Title, item.Format, item.Visibility, item.Version, item.UpdatedAt });
        }

        /// <summary>Borra una pieza TUYA. Lo compartido por otro no se puede borrar desde acá.</summary>
        [Microsoft.AspNetCore.Authorization.Authorize]
        [Tags("App.GaleCore")]
        [HttpDelete("GaleCore/Space/{kind}/{key}")]
        public async Task<IActionResult> DeleteTraderSpaceItemAsync(
            string kind, string key,
            [FromServices] IServiceProvider services,
            [FromServices] DataFeed.Infrastructure.Providers.Tastytrade.ICurrentUser currentUser,
            CancellationToken ct)
        {
            var userId = currentUser.UserId;
            if (userId == null) return Unauthorized();
            var db = services.GetService<DataFeed.Repositories.GaleCoreDbContext>();
            if (db == null) return DatabaseNotConfigured();
            var item = await db.TraderSpaceItems.FirstOrDefaultAsync(i => i.OwnerId == userId.Value && i.Kind == kind && i.Key == key, ct);
            if (item == null) return NotFound();
            db.TraderSpaceItems.Remove(item);
            await db.SaveChangesAsync(ct);
            return NoContent();
        }

        #endregion

        #region Autenticación

        /// <summary>
        /// Entrada a la plataforma con USUARIO y contraseña. Es el único endpoint sin JWT.
        ///
        /// Hace dos cosas: resuelve `username → email` contra la tabla `users` y autentica ese mail
        /// contra Supabase con la anon key. **El mail no sale del servidor**: la alternativa —un
        /// endpoint que traduzca username a mail y que el navegador le pegue a Supabase directo—
        /// sería una ruta pública que devuelve direcciones de correo a quien adivine un usuario.
        ///
        /// TRES REGLAS DURAS, y las tres son por ser la puerta sin autenticar:
        ///   * **Rate limit** (política "login" en Program.cs). Sin él, la única defensa contra
        ///     probar contraseñas en bucle sería la de Supabase, que no conoce nuestros usernames.
        ///   * **Error genérico**: usuario inexistente y contraseña equivocada contestan lo MISMO.
        ///     Si se distinguieran, el formulario sería un detector de qué usuarios existen.
        ///   * **No se loguea el body** — trae la contraseña. Se loguea el username y nada más.
        ///
        /// Devuelve solo los dos tokens, que es lo que `supabase.auth.setSession` necesita: de ahí
        /// en más la sesión la administra supabase-js en el navegador y la renueva sola, igual que
        /// cuando el login era por mail. Por eso el resto del front no cambió.
        ///
        /// Queda un canal lateral conocido y aceptado: un usuario que no existe contesta sin salir
        /// a la red y uno que sí, después del round-trip a Supabase, así que los tiempos difieren.
        /// Explotarlo exige medir muchos intentos contra el rate limit, y taparlo obligaría a
        /// autenticar contra Supabase con un mail inventado en cada intento fallido.
        /// </summary>
        [Microsoft.AspNetCore.Authorization.AllowAnonymous]
        [Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("login")]
        [Tags("App.GaleCore")]
        [HttpPost("GaleCore/Auth/Login")]
        public async Task<IActionResult> LoginAsync(
            [FromBody] LoginRequest body,
            [FromServices] IServiceProvider services,
            [FromServices] DataFeed.Api.Infrastructure.SupabaseAuthClient auth,
            CancellationToken ct)
        {
            if (!auth.Configured)
                return StatusCode(503, new
                {
                    error = "Falta la configuración de Supabase (Supabase:Issuer y Supabase:AnonKey), " +
                            "así que la API no puede autenticar.",
                });

            var db = services.GetService<DataFeed.Repositories.GaleCoreDbContext>();
            if (db == null)
                return StatusCode(503, new
                {
                    error = "Esta API está corriendo sin base de datos configurada, así que no puede " +
                            "resolver el usuario. Falta ConnectionStrings:GaleCore.",
                });

            var username = DataFeed.Application.App.Shared.Usernames.Normalize(body.Username);
            if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(body.Password))
                return Unauthorized(new { error = CredencialesInvalidas });

            var email = await db.Users.AsNoTracking()
                .Where(u => u.Username == username)
                .Select(u => u.Email)
                .FirstOrDefaultAsync(ct);

            // Mismo 401 que una contraseña mala, a propósito.
            if (email == null)
            {
                _logger.LogInformation("Login fallido: no existe el usuario {Username}.", username);
                return Unauthorized(new { error = CredencialesInvalidas });
            }

            var session = await auth.SignInAsync(email, body.Password, ct);
            if (session == null)
            {
                _logger.LogInformation("Login fallido del usuario {Username}.", username);
                return Unauthorized(new { error = CredencialesInvalidas });
            }

            _logger.LogInformation("Entró el usuario {Username}.", username);

            return Ok(new
            {
                accessToken = session.AccessToken,
                refreshToken = session.RefreshToken,
            });
        }

        /// <summary>
        /// El MISMO mensaje para "no existe" y para "contraseña equivocada". Si fueran distintos,
        /// probar usuarios en el formulario diría cuáles existen.
        /// </summary>
        private const string CredencialesInvalidas = "Usuario o contraseña incorrectos.";

        public class LoginRequest
        {
            public string? Username { get; set; }
            public string? Password { get; set; }
        }

        #endregion

        #region Administración de usuarios

        // ABM completo de los operadores de la plataforma. Solo admins.
        //
        // CADA ALTA Y CADA BAJA ESCRIBEN EN DOS SISTEMAS: la identidad vive en Supabase Auth
        // (mail y contraseña) y lo que la plataforma deja hacer, en la tabla `users` (`is_admin`,
        // `username`). Ninguno de los dos alcanza solo — sin fila local el usuario es invisible
        // para el admin y no tiene con qué entrar; sin usuario en auth no hay contra qué
        // autenticarse. Por eso las dos escrituras se COMPENSAN: si la segunda falla, se deshace la
        // primera, o queda un usuario huérfano en auth que nadie ve ni puede borrar desde la app.
        //
        // La fila local también puede nacer sola, en el primer request autenticado de quien haya
        // sido creado directo en el panel de Supabase (UserStore.EnsureUserAsync): el ABM de acá es
        // el camino normal, no el único.
        //
        // LO QUE UN ADMIN *NO* PUEDE: ver las cuentas de bróker ajenas. Administra usuarios, no sus
        // credenciales — por eso la lista dice si tienen cuenta vinculada, pero no cuál. Las
        // posiciones y balances siguen saliendo de la cuenta de cada uno.

        /// <summary>
        /// Los usuarios de la plataforma. Solo admins.
        /// </summary>
        [Microsoft.AspNetCore.Authorization.Authorize]
        [Tags("App.GaleCore")]
        [HttpGet("GaleCore/Admin/Users")]
        public async Task<IActionResult> AdminListUsersAsync(
            [FromServices] IServiceProvider services, CancellationToken ct)
        {
            var denied = await DenyIfNotAdminAsync("la lista de usuarios", ct);
            if (denied != null) return denied;

            var db = services.GetService<DataFeed.Repositories.GaleCoreDbContext>();
            if (db == null) return DatabaseNotConfigured();

            var users = await db.Users.AsNoTracking()
                .OrderBy(u => u.Email)
                .Select(u => new
                {
                    id = u.Id,
                    email = u.Email,
                    username = u.Username,
                    displayName = u.DisplayName,
                    isAdmin = u.IsAdmin,
                    createdAt = u.CreatedAt,
                    // Metadato administrativo, no la cuenta: si tiene bróker vinculado y si es la
                    // de sistema. Nunca el número de cuenta ni, por supuesto, el token.
                    hasBrokerAccount = u.Accounts.Any(),
                    hasSystemAccount = u.Accounts.Any(a => a.IsSystem),
                })
                .ToListAsync(ct);

            return Ok(new { users, currentUserId = _currentUser.UserId });
        }

        /// <summary>
        /// Da de alta un operador: lo crea en Supabase Auth y le arma su fila en `users`. Solo admins.
        ///
        /// DOS ESCRITURAS, CON COMPENSACIÓN. Primero la identidad (Supabase devuelve el uuid) y
        /// después la fila local, que necesita ese uuid como clave. Si la segunda falla, se BORRA el
        /// usuario recién creado en auth: sin fila local no aparece en esta lista, no tiene username
        /// con qué entrar y nadie lo puede borrar desde la app — un huérfano que solo se limpia
        /// entrando al panel de Supabase.
        ///
        /// La contraseña es INICIAL: el operador la cambia después desde su propia pantalla
        /// (supabase.auth.updateUser, que no necesita la service_role). El admin no vuelve a tocarla.
        /// </summary>
        [Microsoft.AspNetCore.Authorization.Authorize]
        [Tags("App.GaleCore")]
        [HttpPost("GaleCore/Admin/Users")]
        public async Task<IActionResult> AdminCreateUserAsync(
            [FromBody] AdminCreateUserRequest body,
            [FromServices] IServiceProvider services,
            [FromServices] DataFeed.Api.Infrastructure.SupabaseAdminClient supabase,
            CancellationToken ct)
        {
            var denied = await DenyIfNotAdminAsync("el alta de un usuario", ct);
            if (denied != null) return denied;

            var db = services.GetService<DataFeed.Repositories.GaleCoreDbContext>();
            if (db == null) return DatabaseNotConfigured();

            if (!supabase.Configured)
                return StatusCode(503, new { error = SupabaseNoConfigurado });

            var username = DataFeed.Application.App.Shared.Usernames.Normalize(body.Username);
            var email = (body.Email ?? string.Empty).Trim();
            var password = body.Password ?? string.Empty;

            var invalido = ValidarUsername(username) ?? ValidarEmail(email);
            if (invalido != null) return BadRequest(new { error = invalido });

            if (string.IsNullOrWhiteSpace(password))
                return BadRequest(new { error = "Hay que darle una contraseña inicial; el operador la cambia después." });

            // Se chequea contra la tabla ANTES de crear la identidad: los índices únicos rechazarían
            // igual, pero recién después de haber creado el usuario en auth — o sea que un username
            // repetido costaría un alta y su compensación en vez de un mensaje.
            if (await db.Users.AnyAsync(u => u.Username == username, ct))
                return BadRequest(new { error = $"El usuario '{username}' ya está tomado." });
            if (await db.Users.AnyAsync(u => u.Email == email, ct))
                return BadRequest(new { error = $"Ya hay un operador con el mail {email}." });

            var creado = await supabase.CreateUserAsync(email, password, ct);
            if (!creado.Ok || creado.UserId == null)
                return BadRequest(new { error = creado.Message ?? "Supabase Auth rechazó el alta." });

            var userId = creado.UserId.Value;

            try
            {
                db.Users.Add(new DataFeed.Repositories.Entities.User
                {
                    Id = userId,
                    Email = email,
                    Username = username,
                    DisplayName = string.IsNullOrWhiteSpace(body.DisplayName) ? null : body.DisplayName!.Trim(),
                    IsAdmin = body.IsAdmin,
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow,
                });

                await db.SaveChangesAsync(ct);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Falló la fila de `users` del alta de {Username}: se revierte el usuario {UserId} en Supabase Auth.",
                    username, userId);

                var revertido = await supabase.DeleteUserAsync(userId, ct);

                return StatusCode(500, new
                {
                    error = revertido.Ok
                        ? "No se pudo guardar el usuario en la base, así que se deshizo el alta. Probá de nuevo."
                        : $"No se pudo guardar el usuario en la base Y TAMPOCO deshacer el alta en " +
                          $"Supabase: quedó el usuario {email} (uuid {userId}) creado en auth pero sin " +
                          $"fila en la plataforma. Hay que borrarlo desde el panel de Supabase.",
                });
            }

            _logger.LogInformation("Alta del operador {Username} ({UserId}), la hizo {ActorId}.",
                username, userId, _currentUser.UserId);

            return Ok(new { id = userId, username, email, isAdmin = body.IsAdmin });
        }

        /// <summary>
        /// Edita un usuario: su permiso de admin, su username, su nombre visible, su mail o su
        /// contraseña. Solo admins. Los campos que vienen en null no se tocan.
        ///
        /// NO SE PUEDE DEJAR LA PLATAFORMA SIN NINGÚN ADMIN. Sin admins, el kill switch de las
        /// estrategias y de los servicios no se puede tocar desde ningún tablero y hay que arreglarlo
        /// con SQL a mano contra Postgres. El chequeo va en el servidor y no en la UI porque es un
        /// invariante, no una comodidad.
        ///
        /// EL ORDEN IMPORTA: primero la fila local y después la identidad. Si el UPDATE local falla
        /// —un username tomado, por ejemplo— no se tocó nada de auth todavía; y si es el cambio en
        /// auth el que falla, se revierte el mail local, porque los dos tienen que decir lo mismo:
        /// el login resuelve username → mail contra esta tabla y después autentica con ESE mail
        /// contra Supabase. Desincronizados, el usuario no entra más.
        /// </summary>
        [Microsoft.AspNetCore.Authorization.Authorize]
        [Tags("App.GaleCore")]
        [HttpPatch("GaleCore/Admin/Users/{id:guid}")]
        public async Task<IActionResult> AdminUpdateUserAsync(
            Guid id, [FromBody] AdminUpdateUserRequest body,
            [FromServices] IServiceProvider services,
            [FromServices] DataFeed.Api.Infrastructure.SupabaseAdminClient supabase,
            CancellationToken ct)
        {
            var denied = await DenyIfNotAdminAsync($"la edición del usuario {id}", ct);
            if (denied != null) return denied;

            var db = services.GetService<DataFeed.Repositories.GaleCoreDbContext>();
            if (db == null) return DatabaseNotConfigured();

            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct);
            if (user == null) return NotFound(new { error = "No existe ese usuario." });

            var mailAnterior = user.Email;

            if (body.IsAdmin.HasValue && user.IsAdmin && !body.IsAdmin.Value)
            {
                var otrosAdmins = await db.Users.CountAsync(u => u.IsAdmin && u.Id != id, ct);
                if (otrosAdmins == 0)
                    return BadRequest(new
                    {
                        error = "Es el único admin que queda. Si se le saca el permiso, nadie puede " +
                                "prender ni apagar estrategias desde el tablero y hay que arreglarlo " +
                                "con SQL. Dale admin a otro usuario primero.",
                    });
            }

            if (body.Username != null)
            {
                var username = DataFeed.Application.App.Shared.Usernames.Normalize(body.Username);
                var invalido = ValidarUsername(username);
                if (invalido != null) return BadRequest(new { error = invalido });

                if (username != user.Username
                    && await db.Users.AnyAsync(u => u.Username == username && u.Id != id, ct))
                    return BadRequest(new { error = $"El usuario '{username}' ya está tomado." });

                user.Username = username;
            }

            if (body.Email != null)
            {
                var email = body.Email.Trim();
                var invalido = ValidarEmail(email);
                if (invalido != null) return BadRequest(new { error = invalido });

                if (email != user.Email && await db.Users.AnyAsync(u => u.Email == email && u.Id != id, ct))
                    return BadRequest(new { error = $"Ya hay un operador con el mail {email}." });

                user.Email = email;
            }

            if (body.DisplayName != null)
                user.DisplayName = string.IsNullOrWhiteSpace(body.DisplayName) ? null : body.DisplayName.Trim();

            if (body.IsAdmin.HasValue) user.IsAdmin = body.IsAdmin.Value;

            user.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);

            // Lo que vive en Supabase Auth: el mail (solo si cambió) y la contraseña.
            var cambiaMail = user.Email != mailAnterior;
            var cambiaPassword = !string.IsNullOrWhiteSpace(body.Password);

            if (cambiaMail || cambiaPassword)
            {
                if (!supabase.Configured)
                {
                    // Se deshace el cambio local: dejarlo aplicado dejaría la tabla diciendo un mail
                    // que auth no conoce, y ese usuario no podría volver a entrar.
                    user.Email = mailAnterior;
                    await db.SaveChangesAsync(ct);
                    return StatusCode(503, new { error = SupabaseNoConfigurado });
                }

                var actualizado = await supabase.UpdateUserAsync(
                    id,
                    cambiaMail ? user.Email : null,
                    cambiaPassword ? body.Password : null,
                    ct);

                if (!actualizado.Ok)
                {
                    if (cambiaMail)
                    {
                        user.Email = mailAnterior;
                        await db.SaveChangesAsync(ct);
                    }

                    return BadRequest(new
                    {
                        error = actualizado.Message ?? "Supabase Auth rechazó el cambio.",
                    });
                }
            }

            _logger.LogInformation("Se editó el usuario {TargetId} (lo cambió {ActorId}). Admin: {EsAdmin}.",
                id, _currentUser.UserId, user.IsAdmin);

            return Ok(new
            {
                id,
                username = user.Username,
                email = user.Email,
                displayName = user.DisplayName,
                isAdmin = user.IsAdmin,
            });
        }

        /// <summary>
        /// Elimina un operador: lo borra de Supabase Auth y de la tabla `users`. Solo admins.
        ///
        /// IRREVERSIBLE, y se lleva puestas sus cuentas de bróker por la FK en cascada — o sea el
        /// refresh token cifrado que tenía guardado. Si esa cuenta era la de SISTEMA, los procesos
        /// de fondo se quedan sin credencial para pedir datos de mercado: se avisa en la respuesta y
        /// se loguea como warning, igual que al desvincular.
        ///
        /// DOS GUARDAS: no se puede borrar a sí mismo (el error clásico de quedarse afuera de la
        /// plataforma con un click) ni al último admin.
        ///
        /// EL ORDEN ES AL REVÉS QUE EN EL ALTA: primero auth y después la fila local. Lo que
        /// importa de una baja es que la persona deje de poder entrar, y eso lo da el borrado en
        /// auth; si después falla el borrado local, reintentar converge —el segundo intento se come
        /// un 404 de auth, que se toma como éxito, y termina el trabajo—. Al revés, un fallo dejaría
        /// una identidad viva sin fila local, que es justo el huérfano que el alta se cuida de no crear.
        /// </summary>
        [Microsoft.AspNetCore.Authorization.Authorize]
        [Tags("App.GaleCore")]
        [HttpDelete("GaleCore/Admin/Users/{id:guid}")]
        public async Task<IActionResult> AdminDeleteUserAsync(
            Guid id,
            [FromServices] IServiceProvider services,
            [FromServices] DataFeed.Api.Infrastructure.SupabaseAdminClient supabase,
            CancellationToken ct)
        {
            var denied = await DenyIfNotAdminAsync($"la baja del usuario {id}", ct);
            if (denied != null) return denied;

            var db = services.GetService<DataFeed.Repositories.GaleCoreDbContext>();
            if (db == null) return DatabaseNotConfigured();

            if (id == _currentUser.UserId)
                return BadRequest(new
                {
                    error = "No te podés borrar a vos mismo. Si querés irte de la plataforma, que " +
                            "otro admin te dé la baja.",
                });

            var user = await db.Users
                .Include(u => u.Accounts)
                .FirstOrDefaultAsync(u => u.Id == id, ct);

            if (user == null) return NotFound(new { error = "No existe ese usuario." });

            if (user.IsAdmin)
            {
                var otrosAdmins = await db.Users.CountAsync(u => u.IsAdmin && u.Id != id, ct);
                if (otrosAdmins == 0)
                    return BadRequest(new
                    {
                        error = "Es el único admin que queda. Si se lo borra, nadie puede prender ni " +
                                "apagar estrategias desde el tablero y hay que arreglarlo con SQL. " +
                                "Dale admin a otro usuario primero.",
                    });
            }

            if (!supabase.Configured)
                return StatusCode(503, new { error = SupabaseNoConfigurado });

            var teniaCuentaDeSistema = user.Accounts.Any(a => a.IsSystem);
            var username = user.Username;

            var borrado = await supabase.DeleteUserAsync(id, ct);
            if (!borrado.Ok)
                return BadRequest(new { error = borrado.Message ?? "Supabase Auth rechazó la baja." });

            db.Users.Remove(user);
            await db.SaveChangesAsync(ct);

            if (teniaCuentaDeSistema)
                _logger.LogWarning(
                    "Se borró al operador {Username} ({UserId}), que tenía la cuenta de SISTEMA. Los " +
                    "procesos de fondo se quedan sin credencial para datos de mercado hasta que se " +
                    "marque otra.", username, id);
            else
                _logger.LogInformation("Se borró al operador {Username} ({UserId}), lo hizo {ActorId}.",
                    username, id, _currentUser.UserId);

            return Ok(new { id, deleted = true, wasSystem = teniaCuentaDeSistema });
        }

        private const string SupabaseNoConfigurado =
            "Falta la service_role key de Supabase (Supabase:ServiceRoleKey), así que la aplicación " +
            "no puede administrar la identidad. Va en user-secrets (local) o en App Settings (Azure), " +
            "nunca en appsettings.json.";

        /// <summary>
        /// El mensaje de por qué un username no sirve, o null si sirve. Explica la regla en vez de
        /// devolver "inválido": el charset es angosto a propósito y quien lo tipea no lo sabe.
        /// </summary>
        private static string? ValidarUsername(string username)
            => DataFeed.Application.App.Shared.Usernames.IsValid(username)
                ? null
                : "El usuario va en minúscula, entre 3 y 32 caracteres, y solo admite letras, " +
                  "números, punto, guion y guion bajo.";

        /// <summary>
        /// Validación deliberadamente mínima: la de verdad la hace Supabase Auth, que es dueño de la
        /// identidad. Duplicar acá un criterio más estricto que el suyo solo rechazaría mails que
        /// después él aceptaría.
        /// </summary>
        private static string? ValidarEmail(string email)
        {
            if (string.IsNullOrWhiteSpace(email)) return "El mail es requerido.";
            if (email.Length > 320) return "El mail es demasiado largo.";

            var at = email.IndexOf('@');
            return at > 0 && at < email.Length - 1 && !email.Contains(' ')
                ? null
                : "Eso no parece un mail.";
        }

        public class AdminCreateUserRequest
        {
            public string? Username { get; set; }
            public string? Email { get; set; }
            /// <summary>Inicial: el operador la cambia después desde su propia pantalla.</summary>
            public string? Password { get; set; }
            public string? DisplayName { get; set; }
            public bool IsAdmin { get; set; }
        }

        /// <summary>
        /// Todo opcional: lo que viene en null no se toca. Es lo que permite que la pantalla mande
        /// solo el campo que cambió —`{ isAdmin }` desde el toggle, por ejemplo— sin tener que
        /// reenviar el usuario entero y arriesgarse a pisar con datos viejos lo que otro editó.
        /// </summary>
        public class AdminUpdateUserRequest
        {
            public bool? IsAdmin { get; set; }
            public string? Username { get; set; }
            public string? Email { get; set; }
            public string? DisplayName { get; set; }
            /// <summary>Contraseña nueva. Vacío o null = no se toca.</summary>
            public string? Password { get; set; }
        }

        /// <summary>
        /// Corta con 403 si quien llama no es admin. Es MÁS ESTRICTO que
        /// <see cref="DenyIfNotPlatformAdminAsync"/>: aquel deja pasar la llamada con API key sin
        /// usuario (la credencial de máquina del operador), porque el kill switch tiene que poder
        /// tocarse desde un script. Administrar usuarios no: sin usuario autenticado no hay a quién
        /// atribuirle el cambio de permisos de otro.
        /// </summary>
        private async Task<IActionResult?> DenyIfNotAdminAsync(string subject, CancellationToken ct)
        {
            var userId = _currentUser.UserId;
            if (userId == null) return Unauthorized();

            if (await _users.IsAdminAsync(userId.Value, ct)) return null;

            _logger.LogWarning("El usuario {UserId} intentó acceder a {Subject} sin ser admin.", userId.Value, subject);

            return StatusCode(403, new { error = "Solo los admin de la plataforma pueden administrar usuarios." });
        }

        #endregion

        #region Switch de estrategia (transversal)

        // Lo que comparten los switches de TODAS las estrategias. No es de ninguna: cada estrategia
        // pone su archivo de plataforma, su JSON de reglas y su id, y la mecánica de los dos
        // niveles vive acá una sola vez. La tabla de verdad es StrategyEnablement.Resolve.
        //
        // EL SWITCH ES GLOBAL: apagar una estrategia la apaga para todos, y por eso el POST es
        // admin-only. Hubo un tercer nivel por usuario (tabla `user_strategies`) que se eliminó el
        // 2026-08-12 — ver docs/GaleCore-plan-reorganizacion-2026-08.md, etapa 1.
        //
        // El id va en MINÚSCULA (convención de CLAUDE.md); sirve para los logs y para nombrar el
        // sujeto del 403. El capitalizado ("Rpf") es el prefijo de la ruta HTTP y de la carpeta de
        // archivos, y no se usa acá.
        private const string RpfStrategyId = "rpf";
        private const string GexStrategyId = "gex";

        /// <summary>
        /// Estado del switch, con el desglose de los dos niveles. El front consume `enabled` y
        /// `source`; `rules` y `platform` están para poder diagnosticar por qué una estrategia está
        /// apagada sin entrar al disco.
        ///
        /// No depende de quién pregunta: el switch es global.
        /// </summary>
        private IActionResult SwitchState(bool? platformOverride, bool rulesEnabled)
        {
            var (enabled, source) = DataFeed.Application.App.Shared.StrategyEnablement.Resolve(
                rulesEnabled, platformOverride);

            return Ok(new
            {
                enabled,
                source,
                // Lo que declara el JSON de reglas de la estrategia (el piso).
                rules = rulesEnabled,
                // null = nunca se tocó el switch, así que manda el JSON.
                platform = platformOverride,
            });
        }

        /// <summary>
        /// Escribe el kill switch de plataforma de una estrategia y devuelve el estado efectivo.
        ///
        /// Apaga (o prende) PARA TODOS: corta el consumo de feed y la emisión. Por eso lo tocan
        /// solo los admin — un segundo operador no puede apagarle la estrategia al resto.
        ///
        /// Devuelve el 403 en `Denied` en vez de tirar, para que quien llama pueda hacer su parte
        /// (limpiar estado, avisar por el hub) solo cuando la escritura ocurrió de verdad.
        /// </summary>
        private async Task<(IActionResult? Denied, bool Enabled, string Source)> ApplySwitchAsync(
            string strategyId, bool enabled, Action<bool> setPlatform,
            bool rulesEnabled, CancellationToken ct)
        {
            var denied = await DenyIfNotPlatformAdminAsync(strategyId, ct);
            if (denied != null) return (denied, false, string.Empty);

            setPlatform(enabled);

            var (eff, src) = DataFeed.Application.App.Shared.StrategyEnablement.Resolve(
                rulesEnabled, enabled);

            _logger.LogInformation("Switch de {StrategyId} → {State} para toda la plataforma.",
                strategyId, eff ? "ON" : "OFF");

            return (null, eff, src);
        }

        /// <summary>
        /// ¿Puede quien llama tocar el kill switch de plataforma?
        ///
        /// Deja pasar dos casos que no son un agujero: sin base configurada no hay usuarios ni
        /// permisos que consultar (la API se comporta como antes de la base), y una llamada sin
        /// usuario es la credencial de máquina —la API key, que ya no viaja en el bundle del
        /// tablero desde 7af126a y es del operador—. El caso que este chequeo existe para cortar es
        /// el otro: un segundo operador logueado apagándole la estrategia al resto.
        ///
        /// Es la ÚNICA autoridad de esta regla: la consumen el 403 de los POST y el
        /// `canManagePlatform` de /Me, para que la UI y el backend no puedan contradecirse.
        /// </summary>
        private async Task<bool> CanManagePlatformAsync(CancellationToken ct)
        {
            if (!_users.DatabaseConfigured) return true;

            var userId = _currentUser.UserId;
            if (userId == null) return true;

            return await _users.IsAdminAsync(userId.Value, ct);
        }

        /// <summary>
        /// Corta con 403 si quien llama no puede tocar el kill switch de plataforma. Devuelve null
        /// cuando sí puede. La regla vive en <see cref="CanManagePlatformAsync"/>.
        /// </summary>
        private async Task<IActionResult?> DenyIfNotPlatformAdminAsync(string subject, CancellationToken ct)
        {
            if (await CanManagePlatformAsync(ct)) return null;

            _logger.LogWarning(
                "El usuario {UserId} intentó tocar el kill switch de {Subject} sin ser admin.",
                _currentUser.UserId, subject);

            return StatusCode(403, new
            {
                error = "Prender o apagar una estrategia afecta a toda la plataforma, así que es " +
                        "solo para admins (users.is_admin).",
            });
        }

        #endregion

        #region Rpf

        // Convención: cada estrategia cuelga de su propio prefijo de primer nivel — RPF de /App/Rpf.
        // Los endpoints existentes bajo /App/GaleCore quedan como están hasta que se revisen.
        // RPF no usa overlays (live/paper) — su JSON se sirve tal cual, sin DeepMerge.

        [Tags("App.Rpf")]
        [HttpGet("Rpf/Rules")]
        public async Task<IActionResult> RpfRulesAsync()
            => await ServeRulesFileAsync("Rpf/galecore_rules_rpf.json");

        /// <summary>
        /// Estado del switch de la estrategia RPF. `source` dice qué nivel lo decidió: "platform"
        /// (el kill switch del operador) o "rules" (todavía manda state_machine.enabled del JSON).
        /// </summary>
        [Tags("App.Rpf")]
        [HttpGet("Rpf/Switch")]
        public async Task<IActionResult> RpfSwitchGetAsync()
            => SwitchState(_rpfSwitch.ReadOverride(), await ReadRpfRulesEnabledAsync());

        /// <summary>
        /// Prende o apaga la estrategia RPF PARA TODA LA PLATAFORMA: corta el loop, el consumo de
        /// feed y la emisión. Restringido a los admin (users.is_admin).
        ///
        /// Escribe Files/Rpf/rpf_switch_state.json, que `RpfLoopService` relee en cada tick. No
        /// toca galecore_rules_rpf.json, que es fuente de verdad y se edita deliberadamente.
        /// </summary>
        [Tags("App.Rpf")]
        [HttpPost("Rpf/Switch")]
        public async Task<IActionResult> RpfSwitchSetAsync([FromBody] RpfSwitchRequest body, CancellationToken ct)
        {
            var (denied, enabled, source) = await ApplySwitchAsync(
                RpfStrategyId, body.Enabled, _rpfSwitch.Set,
                await ReadRpfRulesEnabledAsync(), ct);

            if (denied != null) return denied;

            await AfterRpfSwitchAsync(enabled, ct);
            return Ok(new { enabled, source });
        }

        /// <summary>
        /// Lo que hay que hacer además de escribir el switch de RPF: limpiar el tablero si la
        /// estrategia queda inerte, y avisarle al front para que reaccione sin esperar su próximo GET.
        /// </summary>
        private async Task AfterRpfSwitchAsync(bool enabled, CancellationToken ct)
        {
            // El estado en memoria se descarta al apagar: con el loop inerte nadie lo actualiza, y
            // un tablero que se conecte después vería datos viejos como si fueran vigentes.
            if (!enabled) _rpfStore.Clear();

            // Aviso para que los tableros abiertos reaccionen en el acto.
            //
            // Acotado en el tiempo A PROPOSITO. El front fuerza transporte LongPolling, y un cliente
            // que desaparecio sin cerrar (pestaña vieja, browser dormido) sigue en el grupo hasta que
            // expira: ahi el SendAsync bloquea y se llevaba puesto al POST entero, dejando el switch
            // colgado. Un kill switch que se cuelga porque un tablero fantasma no lee es peor que
            // inutil — el estado ya quedo escrito y es lo unico que manda. Avisar es best-effort: el
            // tablero que no se entere lo va a ver en su proximo GET.
            try
            {
                await _broadcaster.BroadcastRpfSwitchAsync(enabled)
                    .WaitAsync(TimeSpan.FromSeconds(2), ct);
            }
            catch (TimeoutException)
            {
                _logger.LogWarning(
                    "RPF switch → {State}: el broadcast no completo en 2s (cliente colgado). " +
                    "El switch igual quedo aplicado.", enabled ? "ON" : "OFF");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "RPF switch → {State}: fallo el broadcast. " +
                    "El switch igual quedo aplicado.", enabled ? "ON" : "OFF");
            }
        }

        public class RpfSwitchRequest
        {
            public bool Enabled { get; set; }
        }

        private async Task<bool> ReadRpfRulesEnabledAsync()
        {
            var json = await LoadFileOrNullAsync("Rpf/galecore_rules_rpf.json");
            if (json == null) return false;
            var root = System.Text.Json.Nodes.JsonNode.Parse(json)?.AsObject();
            return (bool?)root?["state_machine"]?["enabled"] ?? false;
        }

        #endregion

        #region Gex

        // Estrategia GEX (informativa): gamma exposure global del símbolo, todos los vencimientos
        // de la cadena incluido 0DTE. No propone operaciones. JSON propio en Files/Gex/, sin
        // overlays live/paper → se sirve tal cual, sin DeepMerge.

        [Tags("App.Gex")]
        [HttpGet("Gex/Rules")]
        public async Task<IActionResult> GexRulesAsync()
            => await ServeRulesFileAsync("Gex/galecore_rules_gex.json");

        /// <summary>
        /// GEX global del símbolo (agregado de toda la cadena dentro de gex.max_dte, incluido 0DTE)
        /// + desglose por vencimiento + contexto de mercado. Es la fuente única de la pestaña GEX.
        /// La primera llamada del día barre la cadena entera y puede tardar; después responde del
        /// cache del handler (gex.cache_seconds).
        /// </summary>
        [Tags("App.Gex")]
        [HttpGet("Gex/Analysis")]
        // 409 = el símbolo no tiene cadena analizable (`option_chain_not_found`), que con el buscador
        // de símbolos es un estado que el operador alcanza solo.
        [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
        public async Task<IActionResult> GexAnalysisAsync([FromQuery] GexAnalysisRequest request)
        {
            request.RulesJson = await LoadFileOrNullAsync("Gex/galecore_rules_gex.json");
            if (request.RulesJson == null)
                return NotFound("Archivo no encontrado: Gex/galecore_rules_gex.json");

            // Kill switch: en OFF el handler no barre la cadena ni toca DXLink, devuelve lo último
            // cacheado marcado como congelado.
            request.AllowScan = await GexSwitchEnabledAsync();

            return await Handle(request);
        }

        /// <summary>
        /// Estado del switch de GEX. `source` dice qué nivel lo decidió: "platform" o "rules"
        /// (gex.enabled del JSON).
        /// </summary>
        [Tags("App.Gex")]
        [HttpGet("Gex/Switch")]
        public async Task<IActionResult> GexSwitchGetAsync()
            => SwitchState(_gexSwitch.ReadOverride(), await ReadGexRulesEnabledAsync());

        /// <summary>
        /// Prende o apaga el barrido de GEX PARA TODA LA PLATAFORMA: en OFF la estrategia deja de
        /// competir por el feed DXLink. Restringido a los admin (users.is_admin).
        /// </summary>
        [Tags("App.Gex")]
        [HttpPost("Gex/Switch")]
        public async Task<IActionResult> GexSwitchSetAsync([FromBody] GexSwitchRequest body, CancellationToken ct)
        {
            var (denied, enabled, source) = await ApplySwitchAsync(
                GexStrategyId, body.Enabled, _gexSwitch.Set,
                await ReadGexRulesEnabledAsync(), ct);

            if (denied != null) return denied;

            return Ok(new { enabled, source });
        }

        public class GexSwitchRequest
        {
            public bool Enabled { get; set; }
        }

        /// <summary>
        /// Estado efectivo de GEX. Es lo que decide si el barrido puede tocar DXLink: con la
        /// estrategia apagada, ninguna pantalla la puede seguir disparando.
        /// </summary>
        private async Task<bool> GexSwitchEnabledAsync()
        {
            var (enabled, _) = DataFeed.Application.App.Shared.StrategyEnablement.Resolve(
                await ReadGexRulesEnabledAsync(), _gexSwitch.ReadOverride());

            return enabled;
        }

        private async Task<bool> ReadGexRulesEnabledAsync()
        {
            var json = await LoadFileOrNullAsync("Gex/galecore_rules_gex.json");
            if (json == null) return false;
            var root = System.Text.Json.Nodes.JsonNode.Parse(json)?.AsObject();
            // Sin el nodo, la estrategia se considera prendida: es informativa y no ejecuta nada.
            return (bool?)root?["gex"]?["enabled"] ?? true;
        }

        #endregion

        #region Runtime

        // Trading Runtime SHADOW (Phase 1). Namespace propio, switch independiente, sin FK a
        // users/accounts. Arranca INERTE (switch OFF por defecto).
        private const string RuntimeStrategyId = "runtime";

        /// <summary>Specs cargados en el runtime.</summary>
        [Tags("App.Runtime")]
        [HttpGet("Runtime/Specs")]
        public IActionResult RuntimeSpecs()
        {
            var specs = _runtimeStore.AllSpecs().Select(s => new
            {
                s.Identity.Id,
                s.Identity.Name,
                s.Identity.DisplayName,
                s.Identity.Version,
                s.ContentHash,
                s.StrategySpecVersion,
                s.DeploymentConstraints.EligibleModes,
                symbols = s.Universe.Symbols,
                structure = s.Structure.DefaultStructure
            });
            return Ok(specs);
        }

        /// <summary>Spec completo por nombre, con hash.</summary>
        [Tags("App.Runtime")]
        [HttpGet("Runtime/Specs/{name}")]
        public IActionResult RuntimeSpec(string name)
        {
            var spec = _runtimeStore.GetSpec(name);
            if (spec == null) return NotFound($"Spec '{name}' not found");
            return Ok(spec);
        }

        /// <summary>
        /// PCS, CCS, iron condor y «esperar» con la cadena real (WS-0016): crédito, riesgo, griegas al entrar,
        /// gaps ±3/±5 %, salto de vol y probabilidad de tocar el strike vendido. El PCS es el candidato del
        /// runtime; sólo él se ejecuta hoy. Lee datos de mercado; no despliega ni guarda nada.
        /// </summary>
        [Tags("App.Runtime")]
        [HttpGet("Runtime/Structures")]
        public async Task<IActionResult> RuntimeStructures([FromServices] IMediator mediator,
            [FromQuery] double delta, [FromQuery] double width, [FromQuery] int minDte, [FromQuery] int maxDte,
            [FromQuery] string symbol = "SPY", [FromQuery] double deltaTolerance = 0.05, CancellationToken ct = default)
        {
            if (!(Math.Abs(delta) is > 0 and < 0.5) || !(width > 0) || minDte < 1 || maxDte < minDte || !(deltaTolerance > 0))
                return BadRequest("delta (0-0.5), width > 0, 1 <= minDte <= maxDte y deltaTolerance > 0 son obligatorios");
            var market = new DataFeed.Application.App.Runtime.MediatorRuntimeMarketData(mediator, _logger);
            return Ok(await new DataFeed.Application.App.Runtime.StructureComparer(market).CompareAsync(
                symbol.ToUpperInvariant(), delta, deltaTolerance, width, minDte, maxDte, DateTime.UtcNow, ct));
        }

        /// <summary>
        /// Deploy de un spec cargado en modo SHADOW → crea deployment + instance, guardados en la base.
        /// Sin persistencia no despliega (503 con el motivo, GC-0004). Varias instancias RUNNING a la vez, una
        /// por versión (P1-07): si ya corre esa misma versión la devuelve (existing = true) en vez de crear otra;
        /// dos de la misma versión evaluarían dos veces y no respetarían su máximo de posiciones. 409 sólo si
        /// otro proceso desplegó esa versión en el medio (lo impide la base).
        /// </summary>
        [Tags("App.Runtime")]
        [HttpPost("Runtime/Deploy")]
        public async Task<IActionResult> RuntimeDeploy([FromBody] RuntimeDeployRequest body, CancellationToken ct)
        {
            var spec = _runtimeStore.GetSpec(body.SpecName);
            if (spec == null) return NotFound($"Spec '{body.SpecName}' not found");

            if (!spec.DeploymentConstraints.EligibleModes.Contains("SHADOW"))
                return BadRequest("Spec is not eligible for SHADOW mode");

            if (!_runtimePersistence.Available || !_runtimeStore.IsDurable)
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    error = "SHADOW sin persistencia: no se despliega nada que se perdería al reiniciar.",
                    reason = _runtimePersistence.Reason,
                });

            var deploymentId = Guid.NewGuid().ToString();
            var instanceId = Guid.NewGuid().ToString();
            var now = DateTime.UtcNow;

            var instance = new DataFeed.Application.App.Runtime.Contracts.StrategyInstance
            {
                InstanceId = instanceId,
                DeploymentId = deploymentId,
                VersionHash = spec.ContentHash ?? "",
                LifecycleState = "RUNNING",
                SchedulerState = "IDLE",
                CreatedAt = now,
                UpdatedAt = now,
                SpecName = body.SpecName,
                Mode = "SHADOW"
            };

            var deployment = new DataFeed.Application.App.Runtime.Contracts.StrategyDeployment
            {
                DeploymentId = deploymentId,
                VersionHash = spec.ContentHash ?? "",
                Mode = "SHADOW",
                DeployedAt = now,
                DeployedBy = _currentUser.UserId?.ToString() ?? "SYSTEM",
                SpecName = body.SpecName,
                SpecVersion = spec.Identity.Version,
            };

            var result = _runtimeStore.DeployOrGetRunning(deployment, instance, new DataFeed.Application.App.Runtime.Contracts.OperationalEvent
            {
                EventId = Guid.NewGuid().ToString(),
                InstanceId = instanceId,
                EventType = "INSTANCE_CREATED",
                Payload = new Dictionary<string, object?>
                {
                    ["spec_name"] = body.SpecName,
                    ["deployment_id"] = deploymentId,
                    ["version_hash"] = spec.ContentHash
                },
                Timestamp = now
            });

            var shown = result.Instance!;

            if (result.Kind == DataFeed.Application.App.Runtime.DeployResult.KindCreated)
                _logger.LogInformation("Runtime: deployed {SpecName} → instance {InstanceId} (SHADOW)",
                    body.SpecName, instanceId);

            return Ok(new
            {
                deploymentId = shown.DeploymentId,
                instanceId = shown.InstanceId,
                specName = shown.SpecName,
                mode = shown.Mode,
                lifecycleState = shown.LifecycleState,
                versionHash = shown.VersionHash,
                existing = result.Kind == DataFeed.Application.App.Runtime.DeployResult.KindExisting,
            });
        }

        public class RuntimeDeployRequest
        {
            public string SpecName { get; set; } = "";
        }

        /// <summary>
        /// Para una instancia SHADOW (GC-0004): deja de evaluar entradas y libera el lugar para desplegar
        /// otra versión. Sus posiciones abiertas se siguen valuando hasta su salida. Idempotente: si ya
        /// estaba parada devuelve 200 con alreadyStopped = true. Sin persistencia, 503 (no se cambia en
        /// memoria algo que no se puede guardar).
        /// </summary>
        [Tags("App.Runtime")]
        [HttpPost("Runtime/Instances/{id}/Stop")]
        public IActionResult RuntimeStop(string id)
        {
            if (!_runtimePersistence.Available || !_runtimeStore.IsDurable)
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    error = "SHADOW sin persistencia: no se cambia una instancia sin poder guardarlo.",
                    reason = _runtimePersistence.Reason,
                });

            var now = DateTime.UtcNow;
            var result = _runtimeStore.Stop(id, new DataFeed.Application.App.Runtime.Contracts.OperationalEvent
            {
                EventId = Guid.NewGuid().ToString(),
                InstanceId = id,
                EventType = "INSTANCE_STOPPED",
                Payload = new Dictionary<string, object?>
                {
                    ["stopped_by"] = _currentUser.UserId?.ToString() ?? "SYSTEM",
                    ["open_positions"] = _runtimeStore.OpenPositionCount(id),
                },
                Timestamp = now
            });
            if (result.Kind == DataFeed.Application.App.Runtime.StopResult.KindNotFound) return NotFound();

            var shown = result.Instance!;
            if (result.Kind == DataFeed.Application.App.Runtime.StopResult.KindStopped)
                _logger.LogInformation("Runtime: stopped instance {InstanceId} ({SpecName})", id, shown.SpecName);
            return Ok(new
            {
                instanceId = shown.InstanceId,
                specName = shown.SpecName,
                lifecycleState = shown.LifecycleState,
                openPositions = _runtimeStore.OpenPositionCount(id),
                alreadyStopped = result.Kind == DataFeed.Application.App.Runtime.StopResult.KindAlreadyStopped,
            });
        }

        /// <summary>Instancias activas del runtime.</summary>
        [Tags("App.Runtime")]
        [HttpGet("Runtime/Instances")]
        public IActionResult RuntimeInstances()
            => Ok(_runtimeStore.AllInstances());

        /// <summary>Detalle de una instancia con sus posiciones.</summary>
        [Tags("App.Runtime")]
        [HttpGet("Runtime/Instances/{id}")]
        public IActionResult RuntimeInstance(string id)
        {
            var instance = _runtimeStore.GetInstance(id);
            if (instance == null) return NotFound();
            var positions = _runtimeStore.AllPositions()
                .Where(p => p.InstanceId == id).ToList();
            return Ok(new { instance, positions });
        }

        /// <summary>Posiciones SHADOW de una instancia.</summary>
        [Tags("App.Runtime")]
        [HttpGet("Runtime/Instances/{id}/Positions")]
        public IActionResult RuntimePositions(string id)
        {
            var positions = _runtimeStore.AllPositions()
                .Where(p => p.InstanceId == id).ToList();
            return Ok(positions);
        }

        /// <summary>
        /// Historial de evaluaciones de una instancia (más viejas primero; acotado en memoria, lo
        /// completo está en la base). <paramref name="limit"/> devuelve sólo las últimas N.
        /// </summary>
        [Tags("App.Runtime")]
        [HttpGet("Runtime/Instances/{id}/Evaluations")]
        public IActionResult RuntimeEvaluations(string id, [FromQuery] int? limit = null)
            => Ok(TakeLast(_runtimeStore.GetEvaluations(id), limit));

        /// <summary>
        /// Eventos operacionales de una instancia (más viejos primero). <paramref name="types"/> filtra
        /// por tipo (separados por coma) y <paramref name="limit"/> devuelve sólo los últimos N.
        /// </summary>
        [Tags("App.Runtime")]
        [HttpGet("Runtime/Instances/{id}/Events")]
        public IActionResult RuntimeEvents(string id, [FromQuery] string? types = null, [FromQuery] int? limit = null)
        {
            IEnumerable<DataFeed.Application.App.Runtime.Contracts.OperationalEvent> events = _runtimeStore.GetEvents(id);
            if (!string.IsNullOrWhiteSpace(types))
            {
                var wanted = types.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToHashSet();
                events = events.Where(e => wanted.Contains(e.EventType));
            }
            return Ok(TakeLast(events.ToList(), limit));
        }

        private static IReadOnlyCollection<T> TakeLast<T>(IReadOnlyCollection<T> items, int? limit)
            => limit is int n && n >= 0 && n < items.Count ? items.Skip(items.Count - n).ToList() : items;

        /// <summary>
        /// Estado del runtime para la pantalla SHADOW (GC-0004): persistencia (y qué se recuperó al
        /// arrancar), switch, instancias y las estructuras que el runtime ejecuta (WS-0023: el harness las lee de acá
        /// en vez de afirmarlas de memoria).
        /// </summary>
        [Tags("App.Runtime")]
        [HttpGet("Runtime/Status")]
        public IActionResult RuntimeStatus()
        {
            var (enabled, source) = _runtimeSwitch.Resolve();
            return Ok(new
            {
                persistence = new
                {
                    available = _runtimePersistence.Available && _runtimeStore.IsDurable,
                    reason = _runtimePersistence.Reason,
                    recoveredAt = _runtimePersistence.RecoveredAt,
                    recovery = _runtimePersistence.Recovery,
                },
                @switch = new { enabled, source },
                instances = _runtimeStore.AllInstances().OrderBy(i => i.CreatedAt),
                supportedStructures = DataFeed.Application.App.Runtime.RuntimeStructures.Supported,
                openPositionsManagement = OpenPositionsManagement(DateTime.UtcNow),
            });
        }

        /// <summary>
        /// BL-023: si cada instancia con posiciones abiertas sigue cuidándolas. El monitor valúa toda posición abierta
        /// y ejecuta sus salidas en sesión sin mirar el estado de la instancia ni el switch
        /// (ShadowPositionMonitorService); sólo no puede si no encuentra la spec de la instancia.
        /// </summary>
        private IEnumerable<object> OpenPositionsManagement(DateTime nowUtc)
        {
            foreach (var instance in _runtimeStore.AllInstances().OrderBy(i => i.CreatedAt))
            {
                var open = _runtimeStore.OpenPositions(instance.InstanceId).Count;
                if (open == 0) continue;
                var spec = _runtimeStore.SpecFor(instance);
                yield return new
                {
                    instanceId = instance.InstanceId,
                    specName = instance.SpecName,
                    lifecycleState = instance.LifecycleState,
                    openPositions = open,
                    exitsManaged = spec != null,
                    exitsEvaluatedNow = spec != null && DataFeed.Application.App.Runtime.ShadowSession.IsOpen(spec.Operational, nowUtc),
                    detail = spec == null
                        ? "sin la spec de la instancia: se valúan, pero no se ejecutan salidas"
                        : "stops y toma de ganancia se ejecutan en sesión aunque la estrategia esté detenida o el switch apagado; detener sólo frena entradas nuevas",
                };
            }
        }

        /// <summary>
        /// Métricas por versión de spec, calculadas desde la base (no desde la ventana en memoria).
        /// Lo que no existe es null: sin operaciones cerradas no hay P&amp;L realizado ni drawdown.
        /// </summary>
        [Tags("App.Runtime")]
        [HttpGet("Runtime/Metrics")]
        public IActionResult RuntimeMetrics()
        {
            var repository = _runtimePersistence.Repository;
            if (!_runtimePersistence.Available || repository == null)
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    error = "SHADOW sin persistencia: no hay métricas guardadas.",
                    reason = _runtimePersistence.Reason,
                });
            return Ok(repository.LoadMetricsInputs().Select(DataFeed.Application.App.Runtime.ShadowMetrics.Compute));
        }

        /// <summary>
        /// Performance SHADOW (P1-03): por estrategia, versión y regla de salida; la cartera contra el capital
        /// de referencia; y la revisión de cada operación cerrada contra lo que su regla planeaba.
        /// `spec` (repetible) limita a esas estrategias; `referenceCapital` en USD habilita los retornos en %;
        /// `from` (UTC) agrega la ventana (lo cerrado desde esa fecha) y recorta las operaciones.
        /// </summary>
        [Tags("App.Runtime")]
        [HttpGet("Runtime/Performance")]
        public IActionResult RuntimePerformance([FromQuery] string[]? spec, [FromQuery] double? referenceCapital,
            [FromQuery] DateTime? from)
        {
            var repository = _runtimePersistence.Repository;
            if (!_runtimePersistence.Available || repository == null)
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    error = "SHADOW sin persistencia: no hay operaciones guardadas.",
                    reason = _runtimePersistence.Reason,
                });
            var records = repository.LoadMetricsInputs()
                .Where(r => spec == null || spec.Length == 0 || spec.Contains(r.SpecName)).ToList();
            var exits = new Dictionary<string, DataFeed.Application.App.Runtime.Contracts.DeterministicExits>();
            foreach (var hash in records.Select(r => r.ContentHash).Distinct())
            {
                var json = repository.GetSpecJson(hash);
                var loaded = json == null ? null : DataFeed.Application.App.Runtime.StrategySpecLoader.LoadFromJson(json);
                if (loaded is { Success: true, Spec: not null }) exits[hash] = loaded.Spec.Exits.Deterministic;
            }
            return Ok(DataFeed.Application.App.Runtime.ShadowPerformance.Compute(records, exits, referenceCapital, DateTime.UtcNow,
                from == null ? null : DateTime.SpecifyKind(from.Value.ToUniversalTime(), DateTimeKind.Utc)));
        }

        /// <summary>
        /// Datos de una estrategia SHADOW (WS-0036): qué usa, de qué fuente, si es del momento o histórico, qué historia
        /// guarda GaleCore y qué valor vio en su última evaluación. Toma la instancia más reciente de la spec.
        /// </summary>
        [Tags("App.Runtime")]
        [HttpGet("Runtime/Performance/Data")]
        public IActionResult RuntimePerformanceData([FromQuery] string spec)
        {
            if (string.IsNullOrWhiteSpace(spec)) return BadRequest(new { error = "falta `spec` (nombre de la estrategia)" });
            var instances = _runtimeStore.AllInstances().Where(i => i.SpecName == spec).ToList();
            var latest = instances.OrderByDescending(i => i.CreatedAt).FirstOrDefault();
            var definition = latest == null ? null : _runtimeStore.SpecFor(latest);
            if (definition == null) return NotFound(new { error = $"no hay una instancia SHADOW con su definición para '{spec}'" });
            var lastEvaluation = instances.SelectMany(i => _runtimeStore.GetEvaluations(i.InstanceId))
                .OrderByDescending(e => e.EvaluatedAt).FirstOrDefault();
            return Ok(DataFeed.Application.App.Runtime.StrategyData.Build(definition, lastEvaluation, DateTime.UtcNow));
        }

        /// <summary>
        /// Lista de estrategias SHADOW (WS-0036): por spec, las cifras de su panel sin filtros (operaciones, acierto,
        /// realizado, abierto, esperanza, máxima caída, peor operación, días promedio y salidas por regla). Un solo pedido.
        /// </summary>
        [Tags("App.Runtime")]
        [HttpGet("Runtime/Performance/Summary")]
        public IActionResult RuntimePerformanceSummary()
        {
            var repository = _runtimePersistence.Repository;
            if (!_runtimePersistence.Available || repository == null)
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    error = "SHADOW sin persistencia: no hay operaciones guardadas.",
                    reason = _runtimePersistence.Reason,
                });
            var records = repository.LoadMetricsInputs();
            var exits = new Dictionary<string, DataFeed.Application.App.Runtime.Contracts.DeterministicExits>();
            foreach (var hash in records.Select(r => r.ContentHash).Distinct())
            {
                var json = repository.GetSpecJson(hash);
                var loaded = json == null ? null : DataFeed.Application.App.Runtime.StrategySpecLoader.LoadFromJson(json);
                if (loaded is { Success: true, Spec: not null }) exits[hash] = loaded.Spec.Exits.Deterministic;
            }
            return Ok(DataFeed.Application.App.Runtime.ShadowPanel.Summaries(records, exits, DateTime.UtcNow));
        }

        /// <summary>
        /// Panel de rendimiento de una estrategia SHADOW (WS-0033, P1-10): curva, riesgo, régimen, regla de salida,
        /// versión, comparación con referencias, hipótesis y calidad de ejecución. Sólo SHADOW.
        /// `spec` es obligatoria; `version`, `from` y `to` (UTC) filtran. Lo que llega del perfil o de otras fuentes
        /// (`referenceCapital`, `cashRatePct`, `bond10yPct`, `targetAnnualPct`, `hypothesisMinTrades`,
        /// `hypothesisMinDays` y los límites de /Runtime/Exposure) se pasa en el pedido; lo que falta vuelve null con su motivo.
        /// </summary>
        [Tags("App.Runtime")]
        [HttpGet("Runtime/Performance/Panel")]
        public IActionResult RuntimePerformancePanel([FromQuery] string spec, [FromQuery] string? version,
            [FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] double? referenceCapital,
            [FromQuery] double? cashRatePct, [FromQuery] double? bond10yPct, [FromQuery] double? targetAnnualPct,
            [FromQuery] int? hypothesisMinTrades, [FromQuery] int? hypothesisMinDays,
            [FromQuery] double? reservePct, [FromQuery] double? maxRiskPerTradePct, [FromQuery] double? maxOpenRiskPct,
            [FromQuery] double? maxBetPct)
        {
            if (string.IsNullOrWhiteSpace(spec)) return BadRequest(new { error = "falta `spec` (nombre de la estrategia)" });
            var repository = _runtimePersistence.Repository;
            if (!_runtimePersistence.Available || repository == null)
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    error = "SHADOW sin persistencia: no hay operaciones guardadas.",
                    reason = _runtimePersistence.Reason,
                });
            DataFeed.Application.App.Runtime.CapitalLimits? limits = null;
            if (referenceCapital != null && reservePct != null && maxRiskPerTradePct != null && maxOpenRiskPct != null && maxBetPct != null)
                limits = new DataFeed.Application.App.Runtime.CapitalLimits
                {
                    Capital = referenceCapital.Value, ReservePct = reservePct.Value, MaxRiskPerTradePct = maxRiskPerTradePct.Value,
                    MaxOpenRiskPct = maxOpenRiskPct.Value, MaxBetPct = maxBetPct.Value,
                };
            var records = repository.LoadMetricsInputs(spec).Where(r => r.SpecName == spec).ToList();
            if (records.Count == 0) return NotFound(new { error = $"no hay posiciones SHADOW de la estrategia '{spec}'" });
            var exits = new Dictionary<string, DataFeed.Application.App.Runtime.Contracts.DeterministicExits>();
            foreach (var hash in records.Select(r => r.ContentHash).Distinct())
            {
                var json = repository.GetSpecJson(hash);
                var loaded = json == null ? null : DataFeed.Application.App.Runtime.StrategySpecLoader.LoadFromJson(json);
                if (loaded is { Success: true, Spec: not null }) exits[hash] = loaded.Spec.Exits.Deterministic;
            }
            static DateTime? Utc(DateTime? d) => d == null ? null : DateTime.SpecifyKind(d.Value.ToUniversalTime(), DateTimeKind.Utc);
            return Ok(DataFeed.Application.App.Runtime.ShadowPanel.Compute(spec, records, exits,
                new DataFeed.Application.App.Runtime.PanelOptions
                {
                    Version = version, From = Utc(from), To = Utc(to), ReferenceCapital = referenceCapital,
                    CashRatePct = cashRatePct, Bond10yPct = bond10yPct, TargetAnnualPct = targetAnnualPct,
                    HypothesisMinTrades = hypothesisMinTrades, HypothesisMinDays = hypothesisMinDays, Limits = limits,
                }, DateTime.UtcNow));
        }

        /// <summary>
        /// Exposición SHADOW (P1-04): lo abierto sumado por apuesta (subyacente + dirección + semana de vencimiento),
        /// subyacente, estrategia y vencimiento, contra los límites como % de `capital`; cuánto riesgo nuevo entra hoy.
        /// </summary>
        [Tags("App.Runtime")]
        [HttpGet("Runtime/Exposure")]
        public IActionResult RuntimeExposure([FromQuery] double capital, [FromQuery] double reservePct,
            [FromQuery] double maxRiskPerTradePct, [FromQuery] double maxOpenRiskPct, [FromQuery] double maxBetPct)
        {
            var limits = new DataFeed.Application.App.Runtime.CapitalLimits
            {
                Capital = capital, ReservePct = reservePct, MaxRiskPerTradePct = maxRiskPerTradePct,
                MaxOpenRiskPct = maxOpenRiskPct, MaxBetPct = maxBetPct,
            };
            if (limits.Problem() is { } problem) return BadRequest(new { error = problem });
            var repository = _runtimePersistence.Repository;
            if (!_runtimePersistence.Available || repository == null)
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    error = "SHADOW sin persistencia: no hay posiciones guardadas.",
                    reason = _runtimePersistence.Reason,
                });
            return Ok(DataFeed.Application.App.Runtime.ShadowCapital.Exposure(repository.LoadMetricsInputs(), limits, DateTime.UtcNow));
        }

        /// <summary>
        /// Reparto de un capital (P1-04, «tengo X USD»): reserva, presupuesto de riesgo, contratos y posiciones por
        /// estrategia según su versión más reciente, tope por apuesta y escalera de entradas al ritmo de la spec.
        /// `spec` (repetible) elige las estrategias; sin `spec`, las que tienen instancias. Calcula, no ordena.
        /// </summary>
        [Tags("App.Runtime")]
        [HttpGet("Runtime/Allocation")]
        public IActionResult RuntimeAllocation([FromQuery] double capital, [FromQuery] double reservePct,
            [FromQuery] double maxRiskPerTradePct, [FromQuery] double maxOpenRiskPct, [FromQuery] double maxBetPct,
            [FromQuery] string[]? spec)
        {
            var limits = new DataFeed.Application.App.Runtime.CapitalLimits
            {
                Capital = capital, ReservePct = reservePct, MaxRiskPerTradePct = maxRiskPerTradePct,
                MaxOpenRiskPct = maxOpenRiskPct, MaxBetPct = maxBetPct,
            };
            if (limits.Problem() is { } problem) return BadRequest(new { error = problem });
            var repository = _runtimePersistence.Repository;
            if (!_runtimePersistence.Available || repository == null)
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    error = "SHADOW sin persistencia: no hay estrategias guardadas.",
                    reason = _runtimePersistence.Reason,
                });
            var records = repository.LoadMetricsInputs();
            var names = spec is { Length: > 0 } ? spec.Distinct().ToList()
                : records.Where(r => r.Instances > 0).Select(r => r.SpecName).Distinct().OrderBy(n => n).ToList();
            var terms = new List<DataFeed.Application.App.Runtime.StrategyTerms>();
            var missing = new List<string>();
            foreach (var name in names)
            {
                var ofStrategy = records.Where(r => r.SpecName == name).ToList();
                // La versión más reciente evaluada es la que opera.
                var latest = ofStrategy.OrderByDescending(r => r.LastEvaluationAt ?? DateTime.MinValue).FirstOrDefault();
                var json = latest == null ? null : repository.GetSpecJson(latest.ContentHash);
                var loaded = json == null ? null : DataFeed.Application.App.Runtime.StrategySpecLoader.LoadFromJson(json);
                if (loaded is { Success: true, Spec: not null })
                    terms.Add(DataFeed.Application.App.Runtime.ShadowCapital.Terms(loaded.Spec, ofStrategy));
                else missing.Add(name);
            }
            return Ok(DataFeed.Application.App.Runtime.ShadowCapital.Allocate(terms, limits, DateTime.UtcNow)
                with { StrategiesNotFound = missing });
        }

        // El switch del runtime usa el endpoint genérico de servicios de plataforma:
        // GET/POST /App/GaleCore/Services/runtime/Switch — ya existe en PlatformServiceSwitch.
        // No se duplica acá. El loop lee via RuntimeStrategySwitch que delega a PlatformServiceSwitch.

        #endregion

        private async Task<string?> LoadFileOrNullAsync(string fileName)
        {
            var path = Path.Combine(_env.ContentRootPath, "Files", fileName);
            return System.IO.File.Exists(path) ? await System.IO.File.ReadAllTextAsync(path) : null;
        }

        private async Task<IActionResult> ServeRulesFileAsync(string fileName)
        {
            var path = Path.Combine(_env.ContentRootPath, "Files", fileName);

            if (!System.IO.File.Exists(path))
                return NotFound($"Archivo no encontrado: {fileName}");

            var json = await System.IO.File.ReadAllTextAsync(path);
            return Content(json, "application/json");
        }
    }
}
