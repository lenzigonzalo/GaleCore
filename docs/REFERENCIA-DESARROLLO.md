# GaleCore — referencia de desarrollo

> Detalle que antes estaba en `CLAUDE.md` (movido el 05/10/2026, F0-1 de la propuesta única, D6). El mapa corto
> está en `CLAUDE.md`; esta página se lee por sección cuando la tarea la necesita.

## Resumen del proyecto
GaleCore es una **plataforma** tecnológica para automatización y análisis de estrategias con opciones
financieras. **GaleCore no es una estrategia**: es el contexto sobre el que se implementan proyectos de
estrategias — cada uno con su prefijo, su JSON de reglas, sus endpoints y su pestaña.

La plataforma provee:
  * **Backend api** (`galecore-datafeed`) — datos de mercado y de cuenta, analytics compartidos, hub de tiempo real
  * **Frontend monitor** (`galecore-monitor`) — tablero: Main (índice de estrategias), Monitor (posiciones), una pestaña por estrategia
  * **Config de aplicación** — `galecore_rules_core.json`, que declara qué estrategias existen

Las estrategias son ciudadanos de primera, no parte del núcleo. Hoy hay dos: **RPF** (operativa) y
**GEX** (informativa). Cuáles son: ver "Estrategias". Cómo se agrega una: ver "Estrategias — convención".

## Estrategias

  Registro de las estrategias implementadas en GaleCore. **Cada estrategia tiene su documentación
  completa en `docs/<prefijo>/`**, y el archivo de definición que se linkea acá es su fuente de verdad
  conceptual — este nodo es solo el índice.

| Prefijo | Tipo | Nombre | Descripción | Definición |
|---|---|---|---|---|
| `Rpf` | Operativa | Disparo por prima real | Venta de prima con riesgo definido decidida por dos ejes ortogonales: la **seguridad arma** el entorno y la **prima dispara** la operación (VRP + edge, en AND no-compensable). Máquina de 7 estados por símbolo sobre un loop backend; sugiere por SignalR y **nunca ejecuta**. | [`docs/rpf/galecore-estrategia-rpf.md`](docs/rpf/galecore-estrategia-rpf.md) · [índice](docs/rpf/README.md) |
| `Gex` | Informativa | Gamma Exposure | GEX global de toda la cadena dentro de `max_dte` (60), incluido 0DTE y weeklies. **Sin trades**: no propone estructura, no calcula strikes ni sizing, no emite señales — su único producto es información para decidir. | [`docs/gex/galecore-estrategia-gex.md`](docs/gex/galecore-estrategia-gex.md) · [índice](docs/gex/README.md) |

  Los tres lugares donde vive una estrategia y que **tienen que coincidir**:
  * **Este nodo** — el índice narrativo, con el link a su doc.
  * **`strategies[]` de `galecore_rules_core.json`** — lo que Main renderiza (`prefix`, `kind`, `name`,
    `description`, `rules_endpoint`, `switch_endpoint`). Es lo que lee la app; este nodo es lo que
    leemos nosotros.
  * **`docs/<prefijo>/`** — la carpeta con toda su documentación.

  **Case del prefijo:** capitalizado en ruta HTTP (`/App/Rpf`), carpeta de archivos (`Files/Rpf/`) y tag
  de Swagger (`App.Rpf`); **minúscula** en `docs/<prefijo>/`, en el `id` y en el `tab` del config.

## Stack

### Estructura
/docs (archivos de información del proyecto)
/source (carpeta donde se guarda el código fuente del proyecto)
  /galecore-datafeed (carpeta del código backend api)
  /galecore-monitor (carpeta del código frontend monitor)


### Config de la aplicación — `galecore_rules_core.json`

  Es la configuración de la **plataforma**, no de una estrategia. Vive en `DataFeed.Api/Files/` y se
  sirve tal cual por `GET /App/GaleCore/Rules/Core`. **Nada de trading vive ahí** — ni gates, ni
  strikes, ni sizing. Contrato:

  * `strategies[]` — las estrategias implementadas. Cada entrada: `id`, `prefix`, `tab`, `label`,
    `name`, `kind` (`operativa` / `informativa`), `description`, `rules_endpoint`, `switch_endpoint`.
    Es lo que **Main** renderiza como cards. Una estrategia que no figura acá existe en la API pero
    es invisible en el tablero.
  * `services[]` — los procesos de plataforma que corren solos y no son de ninguna estrategia
    (hoy solo `SkewSnapshotService`). Cada entrada: `id`, `label`, `name`,
    `description`, `enabled` (el nivel de reglas de su switch), `switch_endpoint`. Es lo que **Main**
    renderiza en la sección Plataforma. Ver "switch por estrategia".
  * `monitor` — config de la pestaña Monitor, que es transversal (monitorea las posiciones de la
    cuenta sin importar quién las abrió): `monitor.trade_management` (take_profit, defensive_roll,
    time_exit, hard_defense, daily_kill_switch) y `monitor.risk_limits` (max_concurrent_positions,
    portfolio_heat_max_pct, risk_per_trade_pct).

  Lo consume `useAppConfigStore` en el front. Congelado por `DataFeed.Tests/RulesJsonTests.cs`:
  el front lee todo con optional chaining y defaults hardcodeados, así que un nodo renombrado no
  rompe el build — muestra umbrales que nadie configuró.

  **Historia:** hasta v1.4.0 este archivo (con sus overlays `live` / `paper`) era el JSON de reglas
  de la estrategia `gale_core_gamma_premium` (PCS-only, 4 capas en cascada). Esa estrategia se
  eliminó el 2026-08-06 — su evaluación en vivo ya se había mudado a RPF. Definición conceptual
  archivada en `docs/archive/`.

### Estrategias — convención

  Toda estrategia es un proyecto propio dentro de la plataforma, identificado por un `<Prefijo>`
  (`Rpf`, `Gex`, …) que manda en TODOS lados: ruta HTTP, carpeta de archivos, tag de Swagger.

  **Checklist para agregar una estrategia nueva:**
  1. Elegir `<Prefijo>`.
  2. `DataFeed.Api/Files/<Prefijo>/galecore_rules_<prefijo>.json` — su fuente de verdad.
     Revisar que el `.csproj` copie la subcarpeta (ver "archivos por estrategia").
  3. Endpoints bajo `/App/<Prefijo>/*` en `AppController.cs`, con su `#region` y su tag de Swagger
     `App.<Prefijo>`. Mínimo: `GET /App/<Prefijo>/Rules` sirviendo el JSON tal cual.
  4. **Entrada en `strategies[]` de `galecore_rules_core.json`.** Sin esto no aparece en Main.
  5. Pestaña propia en `TabNav.tsx`, con el mismo id que declara `tab` en el config.
  6. Switch ON/OFF de la estrategia (ver "switch por estrategia"), con su
     `<prefijo>_switch_state.json` en su carpeta — gitignoreado.
  7. Test que congele los invariantes de su JSON, al estilo `GexRulesJsonTests.cs`.
  8. **Carpeta `docs/<prefijo>/`** (minúscula) con su definición canónica
     `galecore-estrategia-<prefijo>.md` y un `README.md` que indexe la carpeta. Ahí va TODA su
     documentación: definición, research, decisiones. **Fila nueva en el nodo "Estrategias"** de este
     archivo, linkeando esa definición.

  **Lo que las estrategias comparten:** los primitivos de cálculo de `App/Shared/CascadeUtils.cs` y
  los contratos de `App/Shared/Dtos/CascadeContracts.cs`. Cada una le pasa SU propio JSON — los
  primitivos no saben de qué estrategia son.

  **Prohibido terminantemente en cualquier estrategia:** naked shorts de cualquier tipo, ratio
  spreads, y cualquier posición long direccional. Solo estructuras de riesgo definido.


### Backend DataFeed

- Fuente de verdad — JSON de reglas
  **Cada estrategia tiene su propio JSON** en `Files/<Prefijo>/`, y ese archivo es su fuente de verdad:
  ahí viven su lógica de validación, sus umbrales, su universo y sus parámetros de riesgo.
  `galecore_rules_core.json` **no** es de ninguna estrategia — es la config de la aplicación (ver arriba).
  **Regla de trabajo:** ante cualquier cambio de lógica o parámetro, primero se actualiza el JSON y luego se ajustan
  los endpoints o handlers del backend para reflejar ese cambio. Nunca al revés.
  El backend expone los JSON tal cual — no los interpreta ni los transforma. La ruta es fija por
  estrategia, no el nombre del archivo: `GET /App/<Prefijo>/Rules` sirve
  `Files/<Prefijo>/galecore_rules_<prefijo>.json` (`/App/Rpf/Rules`, `/App/Gex/Rules`), y
  `GET /App/GaleCore/Rules/Core` sirve la config de la app.
  Ya no hay overlays ni `DeepMerge`: se fueron con la estrategia v1.4.0.

- Resumen del proyecto
  Solución .NET Core Web API API DataFeed (ASP.NET Core/.NET 8) que provee acceso a datos del mercado y cuenta de trading vía Tastytrade/DXLink.
  Esta api desarrolla el código necesario para el funcionamiento de cada estrategia. 
  
- Arquitectura
  This is a .NET 8 ASP.NET Core Web API that serves as a **financial market data feed and processes**, 
  primarily consuming the Tastytrade API and DXLink WebSocket feed for options and equity data.

  Three-Layer Clean Architecture:
  * DataFeed.Api - (Presentación) ASP.NET Core host, controllers, middleware. References both Application and Infrastructure.
  * DataFeed.Application - (Negocio) Business logic using MediatR CQRS handlers. References Infrastructure. Contains Black-Scholes pricing functions and Tastytrade symbol helpers.
  * DataFeed.Infrastructure - (Externo) External API providers (Tastytrade REST + WebSocket, FRED

  Tecnología: 
  * .NET 8
  * ASP.NET Core Web API
  * WebSockets
  * Tastytrade API
  * dxFeed

- Migraciones — dos roles, y la credencial que se perdía
  La API **nunca migra en runtime**: no hay `Migrate()` en ningún lado. Las tablas son de
  `galecore_ddl` y la API entra con `galecore_api`, que **no puede hacer DDL** — esa es la razón de
  que existan dos roles: la credencial que corre en el VPS no puede alterar el esquema.

  Aplicar una migración va con la credencial de DDL, que vive en `ConnectionStrings:GaleCoreDdl`
  en el user-secret store **de `DataFeed.Repositories`** (store propio, para que una credencial con
  `DROP` no entre en la configuración de la API). `GaleCoreDbContextFactory` la busca sola.

  **El camino es `migrate-db.ps1`, en la raíz del repo, y no `dotnet ef` a mano:**

      .\migrate-db.ps1 -DryRun    # qué hay pendiente y qué SQL correría, sin tocar la base
      .\migrate-db.ps1            # muestra el SQL, pide confirmación y aplica

  Abajo corre el mismo `dotnet ef database update --project DataFeed.Repositories
  --startup-project DataFeed.Repositories`, pero antes resuelve **con qué credencial va a entrar y
  lo dice**: la cadena de la API también "anda" hasta que falla con `permission denied`, y el 6543
  (pooler de transacción) no avisa que el problema es el puerto. Muestra el SQL idempotente antes
  de aplicarlo —una migración no tiene rollback— y **clasifica el cambio, porque el orden contra el
  deploy depende de eso**: lo aditivo va ANTES de `deploy-api.ps1`, lo destructivo DESPUÉS, con el
  binario que ya no usa esa columna arriba y respondiendo.

  El procedimiento completo, el sufijo del pooler y por qué `ALTER DEFAULT PRIVILEGES` no es
  opcional, en [`docs/GaleCore-arquitectura-datos.md`](docs/GaleCore-arquitectura-datos.md) §10.

- Testing y CI
  * `DataFeed.Tests` (xUnit, net8.0). Un archivo de test por JSON, que congela su contrato:
    `RulesJsonTests.cs` (config de app: `strategies[]` completo, prefijo ↔ rutas ↔ carpeta,
    nodo `monitor`, y que no vuelvan a entrar nodos de estrategia), `RpfRulesJsonTests.cs` y
    `GexRulesJsonTests.cs`. Correr: `dotnet test DataFeed.Tests/DataFeed.Tests.csproj`.
  * CI: `.github/workflows/ci.yml` corre restore + build (Release) + test en cada push/PR a master.

- Origen de datos
  El principal origen de datos actualmente es la api de Tastytrade, cuya documentación esta disponible en https://developer.tastytrade.com/

  The API runs on local http://localhost:7001 (IIS Express) and opens Swagger UI at /swagger.
  The API runs on production: https://vps-6285555-x.dattaweb.com/swagger/index.html

- Producción — VPS Linux, no PaaS
  Desde el 2026-08-19 la API corre en un **VPS de Donweb** (Ubuntu 24.04, x64): la app en
  `/srv/galecore/app` bajo el usuario de servicio `galecore`, Kestrel escuchando solo en
  `127.0.0.1:5001`, y Nginx adelante terminando TLS con certificado de Let's Encrypt. Antes estaba
  en Azure App Service, cuyo host dejó de resolver por DNS.

  **Los secretos van en `/etc/galecore/datafeed.env`** (modo 600, `EnvironmentFile` de la unidad de
  systemd), nunca en `appsettings.*.json`: las variables de entorno le ganan a cualquier JSON, y el
  archivo no viaja adentro del paquete desplegado. El `:` de la jerarquía se escribe `__`.

  Dos cosas del entorno que no se deducen del código:
  * **`Tastytrade__OAuth__refresh_token` no se configura.** Sale de la fila marcada `is_system` en
    `accounts` y se descifra con `Security__TokenProtectionKey`; el de configuración es solo el
    fallback para cuando esa fila no existe. O sea que esa clave no es "para las cuentas
    vinculadas": sin ella no hay feed de mercado en absoluto.
  * **Un valor con espacios va entre comillas dobles.** En un `EnvironmentFile` el valor termina en
    el primer espacio y lo que sigue systemd lo toma como otra variable. La cadena de conexión lleva
    `SSL Mode=Require`, así que sin comillas llega mutilada.

  El hostname de hoy es el que asigna el proveedor, no un dominio propio.

  **El deploy es `deploy-api.ps1`, en la raíz del repo:** publish, empaquetado, transferencia,
  stop/extract/start y verificación contra el `swagger.json`. No cuelga de un target de MSBuild a
  propósito —un target atado a `Publish` dispararía en todo publish, incluido el de un CI— y
  **excluye los archivos de estado de runtime** (`Files/**/*_switch_state.json`,
  `Files/skew25_history.json`): extraerlos encima pisaría los switches del operador con los de la
  máquina que deploya, y una estrategia amanecería apagada sin que nadie la tocara. Empaqueta **el
  working tree**, no lo que está en master. Pide la contraseña de sudo dos veces (`ssh -t` abre
  TTY), así que no es desatendible sin una regla de sudoers acotada que nadie decidió, y **no tiene
  rollback**: `tar -xzf` extrae encima, sin backup y sin borrar lo que ya no va. Volver atrás es
  hacer checkout del commit anterior y deployar de nuevo.

- Configuración por entorno — qué archivo se lee dónde
  `appsettings.json` es la base y siempre se lee; encima se aplica `appsettings.{Environment}.json`.
  Local es **Development** (lo fija `launchSettings.json` en los dos perfiles) y el VPS es
  **Production**, declarado en `ASPNETCORE_ENVIRONMENT` dentro de `/etc/galecore/datafeed.env` y
  verificado el 2026-09-03 en el entorno del proceso vivo, no solo en el archivo. ASP.NET Core asume
  `Production` cuando la variable no está, así que antes funcionaba igual — pero por omisión, y una
  omisión no se puede leer.

  * **`appsettings.Production.json` está trackeado** (desde 2026-09-03). Es el que viaja adentro del
    paquete del deploy, y mientras estuvo gitignoreado el que llegaba al servidor era el que tuviera
    en disco la máquina de quien deployaba — invisible en un PR y ausente en una clone nueva.
  * **`appsettings.Development.json` NO está trackeado**: es por máquina (lleva el número de cuenta
    del operador) y no viaja a ningún lado — `deploy-api.ps1` lo borra del paquete antes de subirlo.
  * **En ninguno de los dos va un secreto.** En local van a user-secrets; en producción a
    `/etc/galecore/datafeed.env`, y las variables de entorno le ganan a cualquier JSON. Por eso el de
    Production puede estar trackeado.
  * En el archivo de entorno va **solo lo que difiere** de la base — hoy, el nivel de log: `Debug` en
    local, `Information` con el framework en `Warning` en producción. Repetir una clave con el mismo
    valor es una copia que algún día se desincroniza, y repetirla vacía es peor: pisa con `""` lo que
    la base traiga mañana.

- Taxonomía de la API — controllers y tags de Swagger
  Dos controllers, cada uno con su prefijo de ruta; dentro, los endpoints se agrupan por tag de Swagger.

  `AppController` → `/App`
  * `App.Analytics` — cálculos matemáticos compartidos por varias estrategias: `GammaExposure`,
    `IVRank`, `ImpliedVolatility`, `PutSkew`. Ojo: son rutas **absolutas**, la URL real es
    `/App.Analytics/<X>` (con punto), no `/App/Analytics/<X>`.
  * `App.GaleCore` — endpoints de la aplicación en general. Hoy solo `Rules/Core` (config de app).
  * `App.<Prefijo>` — un prefijo por estrategia. Hoy: `App.Rpf` → `/App/Rpf/*` y
    `App.Gex` → `/App/Gex/*`. Ver "Convención de rutas HTTP por estrategia" más abajo.

  `DataController` → `/Data`
  * `Data.Api` — datos REST de mercado: `Tastytrade/MarketData/ByType`, `Tastytrade/OptionChains`,
    `Tastytrade/Market-metrics/VolatilityData`, `Tastytrade/Symbols/Search`. El último busca
    símbolos por texto contra el catálogo de Tastytrade, con un filtro opcional por tipo de
    instrumento (`InstrumentTypes`). **El filtro es un parámetro, no una política:** qué tipos
    sirven lo decide quien pregunta —GEX lo declara en su
    `universe.ad_hoc_search.allowed_instrument_types`—, porque el endpoint es de plataforma y lo
    consume cualquier pantalla. Hoy lo usa el buscador de símbolos de la pestaña GEX.
  * `Data.Stream` — datos vía socket/streaming: `Tastytrade/MarketData/{Candle,Trade,Quote,Greeks,TradeQuoteGreeks}`.
  * `Data.Account` — cuenta: `Tastytrade/Account/{Balances,Positions,Spreads}` (`Spreads`: las posiciones armadas
    como spreads con pérdida máxima, POP y griegas netas calculadas en la API; el Monitor sólo las muestra). Van con la credencial DEL
    usuario que pregunta (ver `docs/GaleCore-arquitectura-datos.md` §5.4), así que tienen un estado
    que los de mercado no: **el operador todavía no vinculó su cuenta**. Eso es
    `409 Conflict` con `{ error, code: "broker_account_not_linked" }` —
    `BrokerAccountNotLinkedException`, mapeada en `DataFeedControllerBase.Handle` — y **no** un 500:
    es el estado normal de alguien recién dado de alta, y el tablero lo distingue por el `code` para
    decirle que vincule su cuenta en vez de mostrarle un error de servidor. El `code` es contrato:
    renombrarlo rompe el mensaje del front.

  **El mismo endpoint tiene un segundo estado esperado, un escalón más adelante:**
  `broker_credential_invalid` (`BrokerCredentialInvalidException`, también 409), cuando la cuenta
  SÍ está vinculada pero Tastytrade rechaza su refresh token. Quien decide la frontera es
  `TastytradeOAuth.Rechazo`: un `400`/`401` del canje es la credencial (no sirve, y solo la arregla
  su dueño); cualquier otro status es Tastytrade con problemas y sigue saliendo 500, porque decirle
  al operador que re-vincule mientras el proveedor está caído lo manda a romper lo que funciona.
  Los dos `code` no se unifican: el tablero elige entre "vinculá tu cuenta" y "re-vinculá tu
  cuenta", y el segundo cartel le evita a alguien que ya cargó sus credenciales volver a mirar un
  formulario lleno sin saber qué cambiar. **Y solo aplica a la credencial DEL USUARIO** — si la
  rechazada es la de sistema, el operador no tiene nada que re-vincular y vuelve a ser un 500.
  El caso que lo hizo nacer (2026-09-01) fue un refresh token emitido desde la aplicación OAuth
  propia del operador cuando había un solo `client_secret` para toda la plataforma: se guardaba y se
  descifraba bien, pero el canje contestaba `400 invalid_grant / Client secret mismatch`. Ese caso
  puntual dejó de ser un error el mismo día (ver "aplicación OAuth por operador"); lo que sigue
  llegando acá es la credencial que de verdad no sirve. El detalle que contesta Tastytrade va al
  **log** y no al cuerpo del 409: es vocabulario del proveedor.

  **Hay un tercer `code` con el mismo contrato, ya de otro dominio:** `option_chain_not_found`
  (`OptionChainNotFoundException`, también 409), que tira el `GammaExposureHandler` compartido
  cuando el símbolo pedido no tiene cadena analizable — no lista opciones, todas las expiraciones
  vencidas, o ninguna dentro del `MaxDTE`. Misma regla de categoría: un pedido legítimo cuyo
  resultado no existe no es una falla del servidor. Aplica a `/App/Gex/Analysis` y a
  `/App.Analytics/GammaExposure`, que comparten handler, y dejó de ser un caso de laboratorio con el
  buscador de símbolos: el operador puede elegir cualquier cosa que Tastytrade conozca.
  * `Data.Sources` — fuentes externas públicas (GC-0006, WS-0014), sólo `GET`. Responden `SourcedResponse`
    (`source`, `upstreamUrl` sin clave, `retrievedAt`, `fromCache`, `asOf`, `sha256`, `notes`, `data`); una fuente caída
    o que cambió de forma es `502` con `code: UPSTREAM_SOURCE_UNAVAILABLE`, nunca una lista vacía. Proveedor en
    `Infrastructure/Providers/<Fuente>`, handler en `Application/Data/<Fuente>`, tests con respuestas grabadas.

    | Ruta | Fuente | Configuración |
    |---|---|---|
    | `Fred/ReleaseDates?From&To&ReleaseIds` · `Fred/Series?SeriesId&From&To` | FRED: calendario de publicaciones; serie con metadatos y vintage | `FredApi:Key` |
    | `Fed/FomcMeetings?Years` | página del calendario del FOMC | — |
    | `Cboe/IndexHistory?Index&From&To` | CSV diarios de VIX, VVIX, SKEW (caché 6 h) | — |
    | `Treasury/YieldCurve?From&To` · `Treasury/Auctions/Upcoming` | curva par diaria (CSV por año) y subastas (Fiscal Data) | — |
    | `Sec/Company?Ticker` · `Sec/Filings?Ticker\|Cik&Forms&Since` · `Sec/Facts?Ticker\|Cik&Taxonomy&Tag&Since` | SEC EDGAR | `SecEdgar:UserAgent` (nombre y correo, lo exige la SEC) |
    | `Bls/Series?Ids&StartYear&EndYear` | BLS API v2 (caché 6 h por el cupo diario) | `Bls:Key` opcional |

    Sumar una fuente: ver si es gratis y qué cubre → probar el acceso → proveedor + handler + ruta con este contrato y
    sus tests (respuesta grabada, forma cambiada, fuente caída) → declararla en GaleCore-AI (receta completa en
    `../docs/engineering/HANDOFF-GALECORE-FUENTES.md` §10).
  Hoy el proveedor (`Tastytrade`) vive en la **ruta**, no en el tag: los tags son planos (`Data.Api`),
  no `Data.Api.<Cuenta>`. El sub-prefijo por cuenta recién hace falta cuando se sume un segundo bróker.

- Endpoints GaleCore
  * `GET /App/GaleCore/Rules/Core` — config de la aplicación (`Files/galecore_rules_core.json`, tal cual).
    Es el único endpoint de `/App/GaleCore/*`: `MacroRegime`, `ValidationLayer`, `PositionBuilder` y
    `Rules/{Live,Paper}` se eliminaron con la estrategia v1.4.0 (2026-08-06). Lo que hacía
    `ValidationLayer` en vivo hoy lo hace el loop de RPF; los `structureInputs` los expone `/App/Gex/Analysis`.
  * WebSocket `/hubs/marketdata`:
    - `Subscribe(symbol, includeGreeks)` → `ReceiveTrade`, `ReceiveQuote` (precio); con `includeGreeks=true` también `ReceiveGreeks` (delta/gamma/theta/vega/IV por opción). Los legs del Monitor se suscriben con `includeGreeks=true`.
    **Se eliminó `SubscribeFlow`/`ReceiveFlow` el 2026-08-12** junto con todo el pipeline de flow
    agresivo (`FlowAggregatorService`, `FlowBroadcastService`, `useFlowStore`). Nunca lo consumió
    ninguna pantalla: el hub tenía métodos que nadie llamaba y `DxLinkStreamingService` clasificaba
    cada trade de opción para un agregador que nadie leía. Si vuelve a hacer falta, se rehace
    contra lo que la pantalla necesite, no antes.

- `GammaExposureHandler` — dos modos, y el global es opt-in
  Handler **compartido**: lo consumen `PutSkew`, RPF, `SkewSnapshotService`, el
  `/App.Analytics/GammaExposure` del Monitor y `GexAnalysisHandler`.
  * **Por defecto calcula el GEX de UN vencimiento.** Con los defaults el handler se comporta igual que
    siempre, así que tocar el modo global no cambia a ningún consumidor existente.
  * **Modo global** — opt-in vía `AllExpirations` / `IncludeByExpiry` / `ExpirationTypes` /
    `IncludeZeroDte` / `GreeksBatchSize` en `GammaExposureRequest`. Hoy lo usa solo la estrategia GEX.
    En el agregado, GEX y OI **se suman** por strike; delta/gamma/IV se toman de la expiración más
    cercana (sumarlos no significaría nada).
  * **Los dos números no se comparan.** El GEX global es mayor en magnitud que el de un vencimiento, así
    que los umbrales por símbolo de una estrategia no son trasladables a la otra
    (ver [`docs/gex/galecore-estrategia-gex.md`](docs/gex/galecore-estrategia-gex.md)).

- Convención de rutas HTTP por estrategia
  Cada estrategia expone sus endpoints bajo su propio prefijo de primer nivel: `/App/<Estrategia>/*`.
  * RPF → `/App/Rpf/*`. Hoy: `GET /App/Rpf/Rules` sirve `galecore_rules_rpf.json` tal cual.
  * GEX → `/App/Gex/*`. `GET /App/Gex/Rules` (JSON tal cual) y
    `GET /App/Gex/Analysis?Symbol=` (GEX global + desglose por vencimiento + contexto).
  `/App/GaleCore/*` queda reservado para la plataforma (hoy solo `Rules/Core`); ninguna estrategia
  cuelga de ahí. En `AppController.cs` cada estrategia tiene su `#region` y su tag
  de Swagger (`App.Rpf`), para que la separación se vea tanto en el código como en la UI de Swagger.
  **Aplica solo a HTTP.** La orquestación de RPF viaja por SignalR sobre el hub compartido
  `/hubs/marketdata` (`SubscribeRpf` / `AcceptSuggestion` / `DismissSuggestion` → `ReceiveRpfState`,
  `ReceiveTradeSuggestion`); son métodos de hub, no rutas, y la convención de path no les aplica.

- Regla — archivos por estrategia en `Files/<Prefix>/`
  Los archivos propios de una estrategia (JSON de reglas, estado de runtime, etc.) van en una
  subcarpeta `DataFeed.Api/Files/<Prefix>/`, con el **mismo `<Prefix>` que su ruta HTTP** (`/App/Rpf`
  → `Files/Rpf/`). Así se ve de un vistazo qué archivo pertenece a qué estrategia.
  * RPF → `Files/Rpf/galecore_rules_rpf.json`, `Files/Rpf/rpf_switch_state.json`.
  * GEX → `Files/Gex/galecore_rules_gex.json`, `Files/Gex/gex_switch_state.json`.

  **En la raíz de `Files/` quedan la config de app y lo que no es de ninguna estrategia:**
  `galecore_rules_core.json` (config de la aplicación), `pop_calibration.json` (tabla POP del gate
  `edge`), `skew25_history.json` (serie para el RoC de `tail_score`) y
  `platform_services_switch_state.json` (switch de los servicios de plataforma). Los dos del medio
  hoy los lee solo RPF, pero quien **escribe** `skew25_history.json` es `SkewSnapshotService`, que
  no es de ninguna estrategia — por eso no se mudan a `Files/Rpf/`.

  **Al agregar una subcarpeta hay que revisar el `.csproj`.** `DataFeed.Api.csproj` copia los JSON al
  output con `<Content Update="Files\**\*.json">` — el `**` es lo que hace que las subcarpetas se
  copien. Con el glob de un solo nivel (`Files\*.json`) el archivo compila pero desaparece del
  output, y el fallo aparece recién en runtime como "archivo no encontrado".

- Regla — switch por estrategia
  Toda estrategia **debe** exponer en el frontend un switch **ON/OFF** que permita prenderla y
  apagarla, sin reiniciar la API ni editar archivos a mano.
  Motivo: son procesos que corren solos y emiten sin que nadie los pida; el operador tiene que poder
  cortarlos en el acto.

  **Se llamaba "Workers" hasta 2026-08-10.** El nombre describía la implementación —un
  `BackgroundService`, que en GEX ni siquiera existe— y no lo que el operador hace con él. La
  etiqueta del botón es solo **ON/OFF**: qué se apaga lo dice el contexto donde vive el switch.

  **Y ON/OFF es vocabulario reservado.** Un control que prende y apaga algo para quien lo mira —el
  encuadre del gráfico de GEX, por ejemplo— no se dibuja como este switch: acá ON/OFF significa kill
  switch global y de admin, y usar la misma forma para una preferencia de pantalla hace que dos
  cosas de peso muy distinto se lean igual. Ver "el eje de precio es uno solo".

  **El switch apaga TODA la actividad de su estrategia**, no solo sus procesos de fondo: loops,
  suscripciones al hub, timers de refresh y las llamadas REST que dispara su pantalla. Una estrategia
  en OFF no puede seguir ocupando el feed ni pidiendo datos.
  Procesos de fondo actuales: `RpfLoopService`, `SkewSnapshotService`
  (todos en `DataFeed.Api/Infrastructure`).

  **El estado de los switches se ve también en Main**, que renderiza una card por estrategia leyendo
  `strategies[]` del config de la app; cada card monta el mismo `StrategySwitch` apuntando al
  `switch_endpoint` que la estrategia declara. Por eso el contrato tiene que ser uniforme:
  `GET <switch_endpoint>` → `{ enabled, source }` y `POST <switch_endpoint>` con `{ enabled }`.
  El `GET` agrega `rules` y `platform` para diagnóstico (qué dice cada nivel, sin entrar al disco);
  el front consume solo `enabled` y `source`.

  **En el front el estado del switch tiene un solo dueño: `useStrategySwitchStore`,** indexado por
  `switch_endpoint`. La card de Main, la pantalla de la estrategia y el evento `ReceiveRpfSwitch`
  del hub leen y escriben ahí, así que apagar desde cualquier lado se ve en todos lados en el acto.
  Ninguna estrategia guarda su switch en su propio store. Hasta 2026-08-11 había tres copias que no
  se avisaban entre sí (el `useState` de `StrategyCard` + `switchEnabled` en `useGexStore` y en
  `useRpfStore`) y, como Main nunca se desmonta, su card mostraba el estado del arranque de la app
  hasta recargar la página. El endpoint lo resuelve `useSwitchEndpoint(id, fallback)` desde
  `strategies[]`: si la pantalla lo hardcodeara podría apuntar a otro endpoint que su card, que es
  la misma duplicación otra vez.

  **El switch tiene DOS niveles.** Cada uno pisa al de arriba, y el nivel ausente hereda — nunca
  prende por su cuenta:

  | Nivel | Dónde vive | Quién lo toca | `source` |
  |---|---|---|---|
  | reglas | `galecore_rules_<prefijo>.json` (en git) | se edita y se commitea | `"rules"` |
  | plataforma | `Files/<Prefijo>/<prefijo>_switch_state.json` | `POST <switch_endpoint>`, solo admin | `"platform"` |

  **El switch es GLOBAL: apagar una estrategia la apaga para todos.** Es el kill switch — corta el
  consumo de feed y la emisión—, y por eso el `POST` está restringido a los admin
  (`users.is_admin`): un segundo operador logueado no puede apagarle la estrategia al resto. La
  tabla de verdad es `App/Shared/StrategyEnablement.Resolve(rules, platform)` — función pura,
  congelada por `StrategyEnablementTests.cs`. Quién puede escribirlo lo resuelve
  `AppController.CanManagePlatformAsync`, que es la **única** autoridad de esa regla: la consumen el
  403 del `POST` y el `canManagePlatform` de `GET /App/GaleCore/Me`, que es lo que el front usa para
  mostrar el switch habilitado o no. Si fueran dos copias, la UI y la API se contradirían.

  **Por qué cada nivel está donde está.** El JSON de reglas es fuente de verdad y se edita
  deliberadamente, no en runtime. El kill switch se queda en un **archivo** y no en la base
  (`docs/GaleCore-arquitectura-datos.md` §5): persiste a disco a propósito —uno que vuelve solo a ON
  tras un restart es un agujero— y una base caída no puede volver a prender lo que se apagó a
  propósito. Los archivos están gitignoreados: un deploy pisaría el switch del operador.

  **Nada del switch consulta la base**, y eso importa en el camino caliente: `RpfLoopService`
  resuelve si tickea leyendo solo disco. **Hubo un tercer nivel por usuario** (tabla
  `user_strategies`, más `strategies` como catálogo) entre el 2026-08-11 y el 2026-08-12. Se
  eliminó: con dos operadores, poder silenciar una estrategia en el tablero propio no justificaba
  que el loop consultara la base en cada tick para preguntar si le servía a alguien, ni el catálogo
  duplicado entre el JSON y una tabla que nadie leía. Ver
  [`docs/GaleCore-plan-reorganizacion-2026-08.md`](docs/GaleCore-plan-reorganizacion-2026-08.md).

  **Sin base configurada no hay permisos que consultar**, y eso no es un error: la API arranca sin
  base a propósito (`Program.cs`). Ahí el `POST` no exige admin y todo se comporta como antes de que
  la base existiera.

  **En OFF, la estrategia no hace nada Y su pantalla se reduce al encabezado más un cartel.** No
  alcanza con frenar el proceso: hay que limpiar el estado publicado, o un tablero que se conecte
  después recibe un estado congelado como si fuera vigente. Y tampoco alcanza con marcar los datos
  como "congelados" dejándolos a la vista — un panel lleno de números se lee como vigente aunque diga
  que no lo está. Se muestran solo título, References, el switch y `StrategyOffPanel`.
  Cortar el árbol de React ahí apaga actividad real, no solo píxeles: los efectos que suscriben al
  hub viven dentro de los componentes que dejan de montarse.
  El semáforo de "online" del front sale del switch **más** la frescura del último dato, para que un
  proceso crasheado también se vea offline.

  **Ninguna pantalla transversal puede depender de una estrategia.** El Monitor suscribe sus propios
  subyacentes por eso: hasta 2026-08-10 el spot de una posición en un símbolo fuera de
  `universe.tickers` venía de que la pantalla de GEX lo suscribiera, así que apagar una estrategia
  informativa se llevaba puesto el precio de una posición abierta.

  Ambas estrategias lo tienen implementado; el cómo, en su doc:
  * **RPF** — kill switch de `RpfLoopService`. Ver
    [`docs/rpf/galecore-rpf-implementacion.md`](docs/rpf/galecore-rpf-implementacion.md).
  * **GEX** — no corre `BackgroundService`, pero el barrido de la cadena anda solo y compite por DXLink;
    el switch es un kill switch de ese barrido. Ver
    [`docs/gex/galecore-estrategia-gex.md`](docs/gex/galecore-estrategia-gex.md).

  **Los servicios de plataforma también tienen switch** (desde 2026-08-12). Hoy el único es
  `SkewSnapshotService`: corre solo y no es de ninguna estrategia, así que va por su propio carril y
  no por el de arriba:
  * se declaran en **`services[]` de `galecore_rules_core.json`** (`id`, `label`, `name`,
    `description`, `enabled`, `switch_endpoint`), que es su nivel de reglas;
  * el estado comparte **un** archivo en la raíz de `Files/`
    (`platform_services_switch_state.json`), no una carpeta por servicio: `Files/<Prefijo>/` es
    convención de estrategias;
  * los endpoints son `GET`/`POST /App/GaleCore/Services/{id}/Switch`, con el mismo contrato
    `{ enabled, source }`;
  * **el modelo del switch es el mismo que el de una estrategia**: dos niveles (reglas +
    plataforma), global, y tocarlo es cosa de admin. Desde el 2026-08-12 no hay diferencia entre
    los dos carriles — antes las estrategias tenían un tercer nivel por usuario que un servicio
    nunca tuvo, porque un servicio no trabaja para nadie en particular;
  * Main los renderiza en la sección **Plataforma** con `ServiceCard`, que monta el mismo
    `StrategySwitch`.

  **Apagar `skew` no es gratis:** es el que escribe `skew25_history.json`, de donde sale el RoC 5d
  del gate `tail_score` de RPF. Cada tick apagado es un hueco en la serie.

- Lógica compartida — `App/Shared/`
  Lo que comparten los motores de decisión de las estrategias. Separado en dos: **lógica** en
  `App/Shared/CascadeUtils.cs` y **contratos** en `App/Shared/Dtos/CascadeContracts.cs`.

  Los contratos NO van al `Dtos/` de la raíz: esa carpeta es de la capa `Data/` (`BaseResponse`,
  `PriceQuoteDTO`, que consumen los handlers de `Data/Tastytrade/*`), y en `App/` cada contrato vive
  con su dominio (`App/Gex/GexAnalysisResponse.cs`).

  `CascadeUtils` — funciones puras, sin I/O ni estado. Cada estrategia le pasa **su** JSON:
  * `EvaluateLayer1(rules, symbol, gex, ivr, iv)` — los 6 checks de régimen macro. La usan RPF (como gate) y GEX (como lectura)
  * `ComputeGexSkew(callGex, putGex)` — `callGEX / (callGEX + |putGEX|)` → `"call_dominant"` / `"put_dominant"` / `"symmetric"`
  * `ComputePriceZScore(candles, ivAtm)` — normaliza retorno en unidades de vol diaria
  * `ComputeTrend(candles)` — EMA 20 vs EMA 50, señal `"up"` / `"down"` / `"neutral"`
  * `ComputeRealizedVol(candles)` — RV 10d/30d en base anualizada
  * `ClassifyRegime(regimeClassification, vix)` — banda de régimen (`low_vol` / `normal` / `elevated` / `caution`)
  * `ResolveStructure` / `EvaluateStructureRules` / `EvaluateCondition` — motor multi-factor declarado en el JSON
  * `BuildOccSymbol`, `SnapToNearestStrike`, `BuildBidAskChecks`, `BuildCreditCheck` y los helpers de JSON

  `CascadeContracts.cs` — `MacroRegimeResult` + sus 6 checks, `StrikeEngineResult` + `LegSymbols`/`LegMeta`,
  `MicrostructureResult` + sus checks, `RiskAndSizingResult`, `StructureInputs` + sus factores.

- gex_skew (reemplaza gex_sign)
  Cuando una estrategia exige GEX positivo en su `macro_regime.gex_total`, `gex_sign: "negative"` es
  inalcanzable — el signo no informa nada. Se reemplazó por `gex_skew`, que mide la asimetría de muros:
  `gex_skew = callGEX / (callGEX + |putGEX|)` → `call_dominant` (>0.6), `put_dominant` (<0.4), `symmetric` (0.4-0.6)
  El umbral de GEX lo declara cada estrategia en `definitions.gex_threshold_by_symbol.values`
  (RPF: 0 para SPY). No hay un umbral global de plataforma.

- Símbolos de opción — DXLink streamer vs OCC
  Los dos formatos conviven y **no son intercambiables**: el OCC (21 chars, ver abajo) es el de
  Tastytrade REST, y **DXLink no lo interpreta**. Para suscribir un leg al feed hace falta el símbolo
  *streamer* (ej: `.SPY260717P695`), que sale de
  `GammaExposureStrike.CallStreamerSymbol / PutStreamerSymbol`, poblados en `GammaExposureHandler.cs`
  desde el `strikeMap` de la cadena de opciones. Cualquier estrategia que arme legs para el feed pasa
  por ahí (RPF los publica en `strikeEngine.legSymbols`).

- Seguridad
  * API Key Middleware:
    Valida header X-API-KEY en cada request
    Bypass para: /swagger, /mcp, /favicon.ico
    Configurado en ApiKey del appsettings

  * OAuth2 (Tastytrade):
    Refresh token -> access token (REST API)
    Refresh token -> WebSocket token (DXLink)
    Cache thread-safe con lock
    Singleton registrado como ITastytradeOAuth

- Regla — aplicación OAuth por operador
  **La credencial de bróker son DOS mitades y viajan juntas:** el refresh token y el `client_secret`
  de la aplicación OAuth que lo emitió. Tienen que ser de la misma aplicación o el canje contesta
  `400 invalid_grant / Client secret mismatch`.

  Desde el 2026-09-01 cada operador puede registrar **su propia** aplicación OAuth en su perfil de
  Tastytrade y guardar las dos mitades en su fila de `accounts`
  (`client_secret_encrypted`, cifrado con la misma clave que el token). **La columna es nullable y
  null significa "usá el de configuración"** — la aplicación de la plataforma. Los dos caminos son
  normales: quien trae la suya llena las dos mitades, quien entra por la de GaleCore llena una sola.
  La **cuenta de sistema** siempre hereda el de configuración: el feed de mercado es de la
  plataforma, no de nadie.

  Antes de eso había un solo `client_secret` para todos, en configuración, con este argumento: es de
  la aplicación registrada y no del usuario, así que duplicarlo por fila sería esparcir un secreto
  de aplicación. Valía mientras hubiera UNA aplicación; con dos, partir la credencial entre la fila
  y la configuración no evita la duplicación — garantiza que las mitades no coincidan.

  **El `POST /App/GaleCore/Account` REEMPLAZA la credencial entera, no parchea campos.** Mandar el
  `clientSecret` vacío no es "dejá el que estaba" sino "esta cuenta entra por la aplicación de la
  plataforma". Si conservara el anterior, actualizar solo el refresh token dejaría las dos mitades
  de aplicaciones distintas, que es el error que todo esto evita. La card lo avisa cuando la cuenta
  hoy tiene uno propio y el campo está vacío.

  El `GET` devuelve `hasOwnClientSecret` — **el hecho, no el valor**: ni el token ni el secreto
  vuelven a salir por HTTP.

- FLUJO DE REQUEST
  HTTP Request -> Controller -> mediator.Send(Request)
  -> MediatR Handler -> Infrastructure Provider (REST o WebSocket) 
  -> AutoMapper -> Response DTO -> JSON

- Potocolos de datos:
  * Tastytrade REST API:
    Market data por tipo y cadenas de opciones (rapido, ~200ms).
    Base URL configurada en Tastytrade:BaseUrl.

  * DXLink WebSocket:
    Handshake fijo: SETUP -> AUTH -> CHANNEL_REQUEST -> FEED_SETUP -> FEED_SUBSCRIPTION
    Espera FEED_DATA, deserializa, cierra conexion.
    Soporta multi-symbol subscription en un solo FEED_SUBSCRIPTION
    (usado para optimizar GammaExposure).
    Timeouts: 10s (trade/quote/greeks), 15s (multi-candle), 30s (candle historico).

- Formato de Simbolo OCC (21 chars):
  SSSSSSYYMMDDTPPPPPQQQ
  * 6 chars simbolo (padded con espacios)
  * 6 chars fecha (yyMMdd)
  * 1 char tipo (C = Call, P = Put)
  * 8 chars strike (5 enteros + 3 decimales)
  
  Ejemplo Formato OCC** (21 chars):
  SPY   260516P00520000 = SPY Put $520, expira 16-May-2026
  │     │      │ └─ Strike × 1000 (8 chars, zero-padded)
  │     │      └─── Tipo: C/P
  │     └────────── Fecha: yyMMdd
  └──────────────── Símbolo (6 chars, space-padded)


### Frontend Monitor

- Fuente de verdad — JSON
  Dos niveles, y no se mezclan:
  * **Config de app** (`/App/GaleCore/Rules/Core` → `useAppConfigStore`) — arma las pantallas
    transversales: `strategies[]` son las cards de **Main**, `monitor` son los umbrales de **Monitor**,
    `universe.tickers` es lo que se suscribe al hub.
  * **JSON de cada estrategia** (`/App/<Prefijo>/Rules`) — arma su pestaña y su modal de References.
    GEX lee su universo, sus checks y su `display_config` de `/App/Gex/Rules`; el panel de Definiciones
    de RPF lee `/App/Rpf/Rules`.

  **Regla de trabajo:** ante cualquier cambio de lógica, labels o estructura de validación, primero se
  actualiza el JSON y luego se ajusta el frontend para reflejar ese cambio. El frontend debe renderizar
  lo que el JSON declara, sin hardcodear lógica de negocio.

- Resumen del proyecto:
  Dashboard de trading en **React + TypeScript + Create React App** para la plataforma GaleCore.
  Pestañas: **Main** (índice de estrategias implementadas + estado de sus switches), **Monitor**
  (posiciones abiertas de la cuenta, transversal a estrategias) y una pestaña por estrategia
  (**GEX**, **RPF**). References dejó de ser pestaña: cada estrategia tiene un botón **References** en
  la cabecera de su pantalla, que abre un modal con dos solapas — **Definiciones** (el panel de la
  estrategia) y **Json** (su `galecore_rules_<prefijo>.json` tal cual lo sirve la API). El componente
  `ReferencesModal` es transversal; cada estrategia le pasa su panel y su `fetchJson`.

  A la **derecha** de la barra van las dos cosas que no son de mercado: **Admin** (ABM de usuarios;
  solo la ve quien tiene `isAdmin`) y el menú **Mi Cuenta**, que es de cada operador sin importar su
  rol — *Cuenta de bróker* (abre la pestaña `cuenta`, sin botón propio en la barra), *Mi contraseña*
  (modal) y *Salir*. La cuenta de bróker y la contraseña vivían dentro de Admin hasta 2026-08-14, y
  eran lo único que obligaba a mostrarle esa pestaña a cualquiera: un no-admin tiene que poder
  vincular la suya o se queda sin balances ni posiciones. Con eso mudado, Admin quedó con lo que
  administra a OTROS.

- Tecnología:
  | Elemento          | Tecnología                                            |
  |-------------------|-------------------------------------------------------|
  | Framework         | React 18 + TypeScript + Create React App              |
  | Estilos           | Tailwind CSS (dark theme fijo, bloomberg-style)       |
  | Charting          | `lightweight-charts` (TradingView)                    |
  | Real-time         | `@microsoft/signalr` (hub `/hubs/marketdata`)         |
  | HTTP              | `axios` con interceptor de API Key                    |
  | Estado global     | Zustand                                               |
  | Íconos            | `lucide-react`                                        |

- Fuente de datos:
  El origen de datos primario del monitor es la api datafeed. 
    
  | Fuente   | Descripción                                          | Protocolo        |
  |----------|------------------------------------------------------|------------------|
  | `socket` | Precios y Greeks en tiempo real via SignalR          | WebSocket        |
  | `data`   | Analytics: GEX, IV Rank, Account, posiciones         | REST HTTP GET    |
  | `rules`  | Config de la app y reglas de cada estrategia         | REST HTTP GET (json files)   |

  Consultar definición de endpoints de la api en ../swagger/index.html
  
- Variables de entorno:
  * env local
  PORT=3039
  REACT_APP_API_BASE_URL=http://localhost:7001
  REACT_APP_SIGNALR_HUB_URL=http://localhost:7001/hubs/marketdata

  * env production
  REACT_APP_API_BASE_URL=https://vps-6285555-x.dattaweb.com
  REACT_APP_SIGNALR_HUB_URL=https://vps-6285555-x.dattaweb.com/hubs/marketdata

  El tablero se despliega en Vercel (`galecore.vercel.app`), conectado al repo: el push a master
  dispara el build solo. **Vercel compila con `CI=true`, que convierte los warnings de ESLint en
  errores**, así que un import muerto que `npm start` ignora tumba el deploy — y el fallo es
  silencioso desde afuera, porque Vercel sigue sirviendo el último build que sí pasó: el síntoma no
  es un error, es que los cambios no aparecen. Correr `CI=true npm run build` antes de pushear.

- Estructura de archivos:
  src/
  ├── api/
  │   ├── client.ts           # axios instance con X-API-KEY interceptor
  │   ├── rules.ts            # fetchAppConfig() (/App/GaleCore/Rules/Core) + fetchRpfRulesRaw()
  │   ├── strategies.ts       # fetchStrategySwitch(endpoint) / setStrategySwitch(endpoint, enabled) — genéricos por endpoint
  │   ├── analytics.ts        # /App.Analytics/* (GammaExposure, IVRank, ImpliedVolatility)
  │   ├── gex.ts              # /App/Gex/{Rules,Analysis} + GEX_SWITCH_ENDPOINT
  │   ├── rpf.ts              # RPF_SWITCH_ENDPOINT (el switch se llama por `strategies.ts`, no acá)
  │   ├── marketdata.ts       # /Data/Tastytrade/MarketData/* + searchSymbols() (/Data/Tastytrade/Symbols/Search)
  │   └── account.ts          # /Data/Account/*
  ├── socket/
  │   └── useMarketSocket.ts  # Hook SignalR: connect, subscribe/unsubscribe (subscribeLeg usa includeGreeks=true), handlers ReceiveTrade/Quote/Greeks + los de RPF
  ├── store/
  │   ├── useMarketStore.ts   # Estado en tiempo real (Zustand): precio/bid/ask + Greeks por símbolo (updateGreeks: delta/gamma/theta/vega/iv) + ivRank
  │   ├── useAccountStore.ts  # Balances y posiciones. ES DE LA PERSONA: un error PISA los datos (`brokerAccountMissing` marca el caso esperado)
  │   ├── useCurrentUserStore.ts # Quién está logueado y qué puede (/App/GaleCore/Me): username, isAdmin, canManagePlatform
  │   ├── resetUserScoped.ts  # Limpia lo que es de la persona (usuario + cuenta). Único lugar que sabe qué es de quién
  │   ├── useAppConfigStore.ts # Config de la app: universe.tickers, strategies[], monitor. Fuente: /App/GaleCore/Rules/Core
  │   ├── useGexStore.ts      # Estrategia GEX: reglas propias (/App/Gex/Rules) + cache de /App/Gex/Analysis por símbolo + vencimiento seleccionado + símbolos ad-hoc del buscador (NO son universo: mueren con la sesión)
  │   ├── useRpfStore.ts      # Estrategia RPF: estados por símbolo + sugerencias (SignalR)
  │   ├── useStrategySwitchStore.ts # Dueño ÚNICO del estado de los switches, indexado por switch_endpoint
  ├── components/
  │   ├── layout/
  │   │   ├── Sidebar.tsx         # Barra lateral con AccountSummary
  │   │   ├── StatusBar.tsx       # Barra superior: estado sistema, estado mercado, hora
  │   │   ├── TabNav.tsx          # Tabs: Main / Monitor / Estrategias ▾ (GEX, RPF, SHADOW) / Inteligencia / Agentes · a la derecha Admin (solo isAdmin) + AccountMenu
  │   │   └── AccountMenu.tsx     # Menú Mi Cuenta: cuenta de bróker (pestaña), contraseña (modal), separador, salir. Para todos
  │   ├── common/
  │   │   ├── StrategySwitch.tsx   # Switch ON/OFF reusable: recibe fetchState/setState, no conoce la estrategia
  │   │   ├── ReferencesModal.tsx # Modal de References por estrategia: solapas Definiciones + Json. Transversal: recibe el panel y fetchJson
  │   │   ├── Modal.tsx           # Modal genérico (overlay + header + Escape). El hermano chico de ReferencesModal, que tiene sus solapas cableadas
  │   │   ├── NoticePanel.tsx     # El cartel que reemplaza a una pantalla sin nada válido que mostrar. Formato compartido, no mensaje
  │   │   └── StrategyOffPanel.tsx # NoticePanel en rojo con el texto de estrategia apagada
  │   ├── strategies/             # Tab Main
  │   │   ├── StrategyCard.tsx    # Card por estrategia: identidad + StrategySwitch a su switch_endpoint + "Abrir"
  │   │   └── ServiceCard.tsx     # Card por servicio de plataforma (services[]): no navega ni tiene References — solo su switch
  │   ├── ticker/
  │   │   ├── TickerCard.tsx      # Card por ticker: precio, variación, bid/ask/vol. `onRemove` opcional (solo la traen los que no son del universo)
  │   │   ├── SymbolSearchCard.tsx # Última card de la grilla: buscar un símbolo fuera del universo. No sabe de GEX — recibe sus parámetros y avisa qué eligieron
  │   │   └── TickerGrid.tsx      # Grid de TickerCards. `symbols` es obligatorio: lo pasa la estrategia dueña de la pantalla. `trailing` es la card extra del final
  │   ├── chart/
  │   │   ├── GexChart.tsx        # Gráfico LW-Charts: velas + muros + bandas + std dev. Dueño del eje
  │   │   │                       #   de precio y de su encuadre (botón de la mira, prop `alineado`)
  │   │   └── GexBarsPanel.tsx    # Barras de gamma por strike. SIN escala propia: traduce con el
  │   │                           #   priceToCoordinate del gráfico, así que comparten eje
  │   ├── account/
  │   │   ├── AccountSummary.tsx  # Net Liq, Buying Power, Cash
  │   │   ├── BrokerAccountCard.tsx # Vincular/desvincular la cuenta de bróker propia y rotar el refresh token
  │   │   └── MyPasswordCard.tsx  # Cambio de la contraseña propia (le pega directo a Supabase). `embedded` le saca el chrome para el modal
  │   ├── positions/
  │   │   └── PositionMonitor.tsx # Tab Monitor: posiciones abiertas de la cuenta (transversal a estrategias)
  │   ├── rpf/                    # Tab RPF
  │   │   ├── RpfStateBadge.tsx    # Badge del estado de la máquina
  │   │   └── RpfSuggestionCard.tsx # Sugerencia de trade con accept/dismiss
  │   ├── gex/                    # Tab GEX
  │   │   ├── DetailsPanel.tsx     # Cuadro Details: los 11 indicadores de contexto agrupados por la PREGUNTA que contestan (mercado / volatilidad / gamma / precio), sin semáforo. Reemplazó a ValidationLayers + MarketDiagnostics
  │   │   ├── OptionsChainList.tsx # Lista de vencimientos (0DTE primero); elegir uno acota Expiry Engine + gráfico
  │   │   ├── ExpiryEngine.tsx     # Strike Engine sin las filas de estructura: ZGL, muros, EM, Net GEX del vencimiento
  │   │   └── GexReference.tsx     # Panel de Definiciones de GEX (solapa del modal References): universo, checks, config del barrido, umbral por símbolo
  │   ├── monitor/                # Tab Monitor (UI en inglés, bloomberg-style)
  │   │   ├── PortfolioRiskBar.tsx # Barra superior: Net Liq / Buying Power / Daily P&L / Portfolio Heat / Positions
  │   │   ├── PositionCard.tsx     # Card por spread: header (strikes/exp/DTE), StrikeLadder, métricas (Credit/P&L/Max), strip de stats (Net Delta/Theta/Vega/Gamma agregados de Greeks live + POP/Prob.+50%/IV Rank), management triggers c/ acción concreta ligada (el más imminente = "NEXT" con la ejecución: cerrar a costo X, rollear a strikes Y/Z por delta de la cadena GEX), legs con entry/valor/variación
  │   │   └── StrikeLadder.tsx     # Barra de zonas MAX LOSS / RISK / PROFIT AT EXP con spot, strikes y muros GEX
  │   └── strategy/
  │       ├── ReferencePrimitives.tsx # Primitivas visuales compartidas por los paneles de References (Card, CollapsibleCard, Stat, TH/TD)
  │       └── StrategyReference.tsx # Panel de Definiciones de RPF (solapa del modal References): reglas, umbrales, protocolo (lee /App/Rpf/Rules). `embedded` le saca el chrome de página
  ├── pages/
  │   ├── Home.tsx            # Tab Main: índice de estrategias implementadas (cards desde strategies[]) + estado de los switches
  │   ├── Monitor.tsx         # Tab Monitor: wrapper de PositionMonitor. Sin cuenta vinculada se reduce al encabezado + NoticePanel
  │   ├── MyAccount.tsx       # Pestaña `cuenta`: la cuenta de bróker propia. Se llega solo desde el menú Mi Cuenta
  │   ├── Admin.tsx           # Tab Admin: ABM de usuarios y permisos. Solo admin — lo propio del operador se fue a Mi Cuenta
  │   ├── Agentes.tsx         # Tab Agentes (GC-0009): agentes del trader desde su espacio (piezas `agent` que publica GaleCore-AI); prender/apagar = pedido en la pieza, lo aplica la PC
  │   ├── Rpf.tsx             # Tab RPF: tablero de orquestación (motor→ejes→estados→candidato→sugerencia) por SignalR
  │   └── Gex.tsx             # Tab GEX: universo + Details (checks + diagnóstico, GEX global) +
  │                           #   Graph (Options Chain + Expiry Engine + velas 1h×100 + barras del vencimiento).
  │                           #   Se monta recién al entrar a la pestaña (el barrido es caro).
  ├── types/
  │   ├── api.ts              # AppConfig/StrategyEntry/ServiceEntry, ValidationLayerApiResponse, StructureInputs
  │   ├── market.ts           # TickerState: precio, quote, Greeks e IV por símbolo. Nada más —
  │   │                       #   `LayerStatus`/`SignalType`/`MarketStatus` eran de la cascada v1.4.0
  │   ├── position.ts         # Tipos de posiciones y P&L
  │   ├── gex.ts              # Tipos de /App/Gex/*
  │   └── rpf.ts              # Tipos de la orquestación RPF
  ├── utils/
  │   ├── formatters.ts       # Formateo de números, fechas y P&L, agrupado de posiciones, tint()
  │   ├── spreadBuilder.ts    # Arma spreads live desde las posiciones de la cuenta
  │   └── streamerSymbol.ts   # Símbolos DXLink y crédito neto actual
  └── App.tsx

- Regla — el estado de la persona se limpia Y se vuelve a pedir al cambiar de sesión
  Los stores de Zustand son **de módulo**: sobreviven al logout, que solo desmonta el tablero. Lo
  que es de la persona (`useCurrentUserStore`, `useAccountStore`) tiene que morir con su sesión, y
  lo que es de la plataforma (precios, config, switches) no — es igual para todos.

  El 2026-08-14 esto costó dos bugs seguidos, y las dos mitades de la regla salen de ahí:
  * **Limpiar.** Un `load()` idempotente veía `loaded` en true y no volvía a preguntar quién era el
    nuevo, así que un no-admin entrando después de un admin veía la pestaña Admin y los switches
    habilitados. Peor: `useAccountStore` mostraba el número de cuenta y las posiciones del anterior,
    porque `Balances` fallaba y el error se pintaba **al lado** de los datos viejos en vez de
    pisarlos. Era fuga de estado en el cliente, no de permisos — la API rechazaba bien.
  * **Volver a pedir.** Limpiar sin refrescar dejó la pestaña muerta: la sesión de Supabase es **por
    origen**, entrar con otra cuenta en otra ventana pisa la de la primera, y ahí el tablero se
    quedaba sin `canManagePlatform` para siempre — los switches deshabilitados y sin decir por qué.

  Cómo queda: `resetUserScopedStores()` es el único lugar que sabe qué es de quién, y el id del
  usuario de la sesión es la **`key` del `Dashboard`** — si cambia la persona, el tablero se remonta
  y vuelve a preguntar todo. Cuando aparezca otro store con datos de la persona, se agrega ahí.

  Corolario: **un error nunca deja el dato viejo a la vista.** Es la misma regla que la de una
  estrategia en OFF — números plausibles que nadie confronta se leen como vigentes.

- Regla — un panel se agrupa por la pregunta que contesta, no por el origen del dato
  Los paneles de contexto agrupan sus métricas por lo que el operador quiere saber. **Agruparlas por
  el objeto de la respuesta que las trae es un orden que a nadie le sirve:** el cuadro Details de GEX
  tenía sus diez indicadores repartidos en dos columnas, `macroRegime.checks` a la izquierda y
  `structureInputs` a la derecha, así que RV quedaba lejos de IV Rank —juntas son la lectura de VRP—
  y la historia del gamma (tamaño, asimetría, spot vs ZGL) estaba partida entre las dos mitades.
  Los grupos, sus etiquetas y qué métrica va en cada uno los declara el JSON de la estrategia
  (`display_config...details_panel.groups`); el front solo sabe dibujar cada id.

  Dos corolarios que salieron de ahí (2026-08-18):
  * **Lo que no depende del símbolo no va bajo el encabezado del símbolo.** VIX y VIX9D son índices
    CBOE que el backend pide como símbolos fijos: valen lo mismo en SPY, QQQ o AAPL. Mezclados en la
    grilla de `SPY · Details`, cambiar de ticker y ver que esos dos no se mueven es indistinguible de
    un dato que quedó colgado del barrido anterior. Van primeros y con su propio rótulo, en la misma
    grilla que los demás y separados por la línea vertical que separa a todos los grupos — hasta
    2026-08-19 iban en una franja aparte arriba, con fondo y tipografía propias, que era una
    segunda gramática visual para la misma clase de dato. El
    `scope` de cada grupo (`market` / `symbol`) es lo que lo declara, y lo congela
    `GexRulesJsonTests.DetailsPanel_AgrupaPorPreguntaYSeparaLoQueEsDelMercado`.
  * **El ✓/✗ es vocabulario de decisión: no va en una pantalla informativa.** GEX no tiene gates
    (sus checks son `on_fail: inform_only`), y el ✓/✗ heredado de la cascada de Main hacía que un
    GEX global de −$921B —que es lo normal en SPY— se leyera como una avería. `semaphore: false` es
    eso: sin checkmarks y **sin veredicto de panel**. Cada celda muestra su referencia en texto.

    El color va por celda, y son **cuatro ejes distintos con los mismos dos colores del tema**, así
    que el que lee se apoya en la etiqueta: skew de muros usa la identidad del lado de la cadena
    (call verde / put rojo), trend usa dirección de precio, **el GEX global usa el signo del gamma**
    (verde positivo, rojo negativo) y **VIX e IV Rank se pintan contra su referencia** (verde
    adentro, rojo afuera) — los dos últimos desde 2026-08-19. Este cuarto eje sí es aprobado
    /reprobado, pero de una celda y no del panel: un VIX en rojo dice "fuera de la banda", no "no
    operar". Quién lo lleva lo declara el JSON (`metrics[].color: "vs_ref"`, congelado por
    `GexRulesJsonTests`) y no el front, para que se vea desde las reglas qué celdas tienen esa
    lectura; los otros tres ejes viven en el front porque salen del significado del valor y no de un
    umbral. Ojo con el del GEX: en SPY el global es negativo casi siempre, o sea que esa celda va a
    estar roja casi siempre. Una sola gramática visual por panel: dos (tiles de un lado, filas del
    otro) se leen como dos tipos de dato distintos.

- Regla — el color del lado de la cadena vive en un solo archivo
  **CALL es verde y PUT es rojo**, en el gráfico, en las barras de gamma y en el skew del Details.
  El valor lo declara `utils/optionSideColors.ts` (`CALL_COLOR` / `PUT_COLOR`) y nadie más escribe
  ese hex: con el literal repetido en cada componente, la convención no vive en ningún lado.

  Y no vivía: hasta el 2026-08-18 el panel de barras pintaba las calls de verde y las puts de rojo,
  mientras las líneas de muro de **ese mismo panel** —y las de `GexChart`— pintaban el Call Wall de
  rojo y el Put Wall de verde. El rojo significaba "put" a diez píxeles de donde significaba "call".

  **Este verde/rojo NO es el de bien/mal**, y tampoco el de dirección de precio de las velas: es la
  identidad de un lado de la cadena. Un Call Wall verde no dice que algo esté bien — dice que ese
  muro es de calls. Por eso el `StrikeLadder` del Monitor **queda afuera a propósito**: ahí el color
  codifica el rol en la posición (rojo = leg long, ámbar = leg short, rojo de fondo = MAX LOSS) y
  los dos muros van en un índigo neutro. Meter la convención de lado ahí haría que el rojo
  significara tres cosas distintas en la misma franja.

- Regla — el eje de precio es uno solo, y el encuadre es del operador
  El gráfico de velas y el panel de barras de GEX **comparten el eje de precio**: `GexBarsPanel` no
  tiene escala propia — posiciona cada strike, muro y banda traduciendo precio a píxel con el
  `priceToCoordinate` de la serie de velas. Por eso todo lo que mueva la escala tiene que redibujar
  el panel, y ahí hay una trampa: lightweight-charts **no publica ningún evento de cambio de rango
  de precio**. `subscribeVisibleLogicalRangeChange` es del eje de TIEMPO, así que arrastrar la
  escala vertical no disparaba nada y las barras se quedaban con las coordenadas anteriores hasta el
  siguiente render por otra causa. `GexChart` escucha los gestos que la cambian y **compara el
  mapeo** antes de redibujar —así un pan horizontal no redibuja el SVG entero—, mirando una ventana
  corta de frames porque el rango nuevo puede aplicarse uno o dos frames después.

  **El botón de la mira** —encabezado del cuadro Graph, a la izquierda del spot— encuadra el eje en
  la zona gamma: arriba el mayor entre 1er EM, Call Wall y borde de la banda call; abajo el menor
  entre −1er EM, Put Wall y borde de la banda put; más `padding_pct` del alto a cada lado. Qué
  anclas y cuánto aire lo declara `display_config.gex_tab.chart_scale` del JSON de GEX —el front
  solo sabe resolver cada id— y lo congela `GexRulesJsonTests`.
  * **El aire va en proporción del marco, no en strikes.** Dos strikes son el 17% del alto en un
    0DTE y el 3% a 42 días: la misma regla se ve enorme de un lado y no se ve del otro. Y con el
    encuadre puesto el eje pone en cero su propio `scaleMargins` del 8%, para que el número del JSON
    sea el aire que se ve y no la mitad.
  * **El marco NO se centra en el spot.** Va pegado a las anclas, y el spot queda al medio solo
    cuando el EM es el que manda de los dos lados — es la única ancla simétrica.
  * **El 1er EM sale del backend**, que lo calcula con la IV ATM de ese vencimiento. La cuenta local
    (`IV 30d × √(DTE/365)`) es el fallback y tiene un agujero: con `DTE = 0` da CERO, así que en el
    0DTE el EM desaparecía como ancla y las líneas ±1σ ni se dibujaban.

  **Es un toggle con estado a la vista, no una acción.** Prendido reencuadra con cada barrido y cada
  cambio de vencimiento; **mover la escala a mano lo apaga solo** y no toca el eje — el encuadre pasa
  a ser del operador hasta que vuelva a apretarlo, y un botón encendido sobre un encuadre que ya no
  es el suyo miente. Su estado vive en la **pantalla** (`Gex.tsx`) y no en el gráfico, que se remonta
  por símbolo (`key={active}`) y lo perdería al cambiar de ticker.

  **No se dibuja como el switch ON/OFF del proyecto**: ese vocabulario ya significa otra cosa —el
  kill switch de una estrategia, global y de admin (ver "switch por estrategia")— y esto es una
  preferencia de quien mira un gráfico. Va como botón de barra con estado apretado.

  **Encuadrar es prender el autoscale y soltarlo**, en dos frames. El proveedor de autoescala es la
  única forma de fijar un rango en lightweight-charts y solo se consulta con el autoscale prendido,
  pero dejarlo prendido **clava el gráfico**: el eje vuelve al encuadre apenas lo movés. Se prende
  para que recalcule y se apaga en el frame siguiente. Y el rango **vive en la serie**, así que
  reemplazarla —que es lo que pasa cuando llegan las velas y la línea se convierte en velas— lo
  borra: hay que reponerlo ahí.

  **Corolario que costó un rato:** `chartData` se arma en `Gex.tsx` y tiene que ir memoizado. Sin
  eso se rehace en cada render de la pantalla —o sea con cada tick de precio—, el gráfico lo ve como
  datos nuevos y el encuadre se recalcula varias veces por segundo, encima del gesto del operador.

- Manejo del tiempo real
  * Conexión SignalR
  ```typescript
  // socket/useMarketSocket.ts
  const connection = new HubConnectionBuilder()
    .withUrl(process.env.REACT_APP_SIGNALR_HUB_URL)
    .withAutomaticReconnect()
    .build();

  // Suscribir al universo de la plataforma (universe.tickers del config de app)
  tickers.forEach(symbol => connection.invoke('Subscribe', symbol, false));

  // Handlers
  connection.on('ReceiveTrade', (symbol, data) => updatePrice(symbol, data));
  connection.on('ReceiveQuote', (symbol, data) => updateQuote(symbol, data));
  ```
  **La conexión NO depende de tener universo.** El hub transporta mucho más que precios de
  subyacentes: la orquestación de RPF (`SubscribeRpf`) y los quotes/Greeks de los legs del Monitor.
  Un `if (!tickers.length) return` antes de conectar dejaba todo eso muerto cuando el config
  no declaraba universo. Se conecta siempre; `Subscribe` es lo único condicional.

  * Estado en Zustand
  ```typescript
  // store/useMarketStore.ts
  interface TickerState {
    symbol: string;
    price: number;
    open: number;
    bid: number;
    ask: number;
    lastUpdate: Date;
  }

  * Fallback REST
  Si el socket no está disponible (offline), obtener precio via
  `/Data/Tastytrade/MarketData/ByType` con polling cada 30 segundos.
  Marcar visualmente los datos como "sin stream" con un indicador en el TickerCard.
