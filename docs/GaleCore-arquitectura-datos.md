# GaleCore — Arquitectura de datos para N estrategias

**Estado: PROPUESTA. Nada de esto está implementado.** Escrito el **2026-08-11** con las mediciones
de ese día (mercado abierto), y **revisado el mismo día** tras definirse que la base entra por
multi-usuario y no por estado (§5, §10).

Responde una pregunta: **¿la arquitectura actual sostiene que convivan varias estrategias, cada una
con sus procesos de fondo, evaluando incluso los mismos símbolos?** La respuesta corta es que la
forma es correcta pero el sentido del flujo de datos no escala.

**Lo que este documento NO dice** (lo decía en su primera versión y era falso): que la base de datos
sea necesaria para arreglar eso. La inversión del flujo se resuelve en memoria. La base entra por
otra puerta —usuarios, auth, cuentas de bróker— y las dos cosas son casi independientes: ver §5.4
para el único punto donde se tocan.

---

## 1. Cómo está hoy

Lo que está bien resuelto y **no hay que tocar**:

* **Una sola conexión a DXLink** para toda la plataforma (`DxLinkStreamingService`, singleton), con
  handshake propio, keepalive y reconexión controlada.
* **Reference counting por `(símbolo, eventType)`**: dos estrategias mirando SPY comparten el feed del
  subyacente. El instinto de deduplicar es correcto.
* **Aislamiento por estrategia**: prefijo en la ruta, JSON propio, carpeta propia, switch propio,
  pestaña propia. Es de lo mejor que tiene el proyecto.

Lo que impone el techo:

* **Un presupuesto global de suscripción de ~100 items/s.** Todo `add` y todo `remove` pasa por
  `SendSubscriptionChunkedAsync` (50 items cada 500 ms, serializado por `_subSendLock`). Ese throttle
  existe por una buena razón — sin él DXLink responde `BAD_ACTION 'subscription rate is too high'` y,
  como el canal 3 es compartido, el rechazo se lleva puesto también Trade/Quote de los subyacentes.
* **El barrido de la cadena consume ese presupuesto entero durante ~2 minutos por símbolo.**
* **`_scanGate`**, un semáforo estático que serializa TODOS los barridos, de todos los símbolos y de
  todas las estrategias.
* **Cinco caches privados** que no se conocen entre sí: `_cache` (`GexAnalysisHandler`),
  `_chainCache` y `_oiCache` (`GammaExposureHandler`), `_tierACache` (`RpfTickHandler`) y
  `RpfStateStore`. Cada uno con su TTL y su clave.

## 2. Las mediciones (2026-08-11, mercado abierto)

### 2.1 El barrido ES el throttle

Cadena de SPY ≤50 DTE: 6.476 símbolos suscritos y después desuscritos = 12.952 items ÷ 100/s ≈
**129 s**. Medido: **126,7 s**. El tiempo del barrido no lo explican los timeouts ni el tamaño de
lote — lo explica el throttle, casi al segundo.

Corolario contraintuitivo, verificado: **lotes más chicos son más rápidos**. El delay se saltea al
cerrar cada lote, así que 33 lotes chicos se saltean 33 esperas y 11 lotes grandes solo 11.

| `greeks_batch_size` | Corridas | Media |
|---|---|---|
| 200 | 127,5 s · 126,3 s · 126,2 s | **126,7 s** |
| 600 | 132,8 s · 132,7 s | 132,8 s |

Que el modelo prediga un resultado que nadie esperaba es la razón para tratarlo como mecanismo y no
como correlación. **`greeks_batch_size` se queda en 200.**

### 2.2 Ya se usa el ~78 % de la capacidad, con 2 estrategias y 4 símbolos

El universo entero tarda **471 s** y el cache dura **600 s**. Un quinto símbolo, o una tercera
estrategia que barra cadenas, y el sistema queda saturado de forma permanente: los barridos no
terminan antes de que expire el cache y el `_scanGate` encola a todos. **No falla con un error —
degrada mostrando datos viejos**, que es peor. Ya se observó: una petición esperó 110 s en el
semáforo detrás del barrido que había disparado el front.

### 2.3 El presupuesto es POR SESIÓN, no por cuenta

Una segunda sesión DXLink simultánea es aceptada. Y con **las dos sesiones bajo carga pesada a la
vez** (sesión 2 suscribiendo 7.114 símbolos de Quote, sesión 1 corriendo el barrido completo):

| | Barrido solo | Barrido con la otra sesión saturada |
|---|---|---|
| Tiempo | 126,2–127,5 s | **126,0 s** |
| Vencimientos | 17/17 | 17/17 |
| Cobertura | 100 % | 100 % |

Cero `BAD_ACTION`, cero `Lost`, en ninguna de las dos. El límite se aplica **por conexión**: abrir una
segunda sesión duplica el presupuesto real, sin interferencia medible.
*Alcance: se verificaron 2 sesiones concurrentes; no se buscó el techo (3, 4, N).*

### 2.4 Mantener la cadena viva es casi gratis con Greeks

Cadena de SPY ≤50 DTE = **7.114 símbolos streamer** (18 vencimientos; el barrido usa 17 tras filtrar
Regular/Weekly → 6.476). La lista sale por REST de `/Data/Tastytrade/OptionChains?Symbol=SPY` en
**3 s y sin tocar el feed**.

| Evento | Régimen permanente | Tráfico | Por rueda (6,5 h) |
|---|---|---|---|
| **Greeks** (toda la cadena) | 61 ev/s | **20 KB/s** | **0,5 GB** |
| **Quote** (toda la cadena) | ~1.900 ev/s | 411–485 KB/s | 9–11 GB |

Greeks casi no tiene tráfico continuo: la mayoría de las ventanas de 10 s vienen en **cero**, y cada
tanto llega una ráfaga de refresh. No es un feed tick a tick; dxFeed recalcula Greeks por lote.
Suscribir los 7.114 cuesta **72 s** (es el throttle) y devuelve un snapshot por símbolo.

### 2.5 La cadencia del refresh: cada símbolo se recalcula cada ~1,5-2 min

Medido con una ventana de **45 min (2.700 s), 51 ráfagas**. La cadena se refresca en **dos grupos
independientes que la particionan exacto**: 5.317 + 1.797 = 7.114.

| Grupo | Símbolos | Cadencia media | Mediana | Rango |
|---|---|---|---|---|
| A | 5.317 (75 %) | **97 s** | 93 s | 73–166 s |
| B | 1.797 (25 %) | **129 s** | 126 s | 86–230 s |

Contra el diseño actual, que refresca cada 600 s de cache y cuyo barrido tarda 127 s — así que el
dato puede llegar con hasta **~727 s** de antigüedad — la cadena viva es **~6× más fresca**.

En la ventana larga el tráfico se confirmó en **71 ev/s y 23 KB/s** (contra 61 ev/s y 20 KB/s de la
ventana de 120 s): el costo es estable, no fue un artefacto de medir poco.

**Qué separa a los dos grupos no se determinó.** La partición es estable a lo largo de los 45 min, así
que no es aleatoria. Si el ingestor va a apoyarse en esa cadencia, conviene entenderlo antes.

Quote es ~30× más pesado, pero **ninguna estrategia lo necesita sobre la cadena entera**: RPF quiere
quotes de sus 2 legs y el Monitor de los suyos. Se midió para acotar el espacio de diseño.

## 3. Diagnóstico

**El problema no es de prolijidad, es el sentido del flujo.** Hoy cada estrategia *tira* del feed
cuando necesita: suscribe, espera el snapshot, desuscribe. Se está usando un feed de streaming como
si fuera un servicio de request/response — 12.952 operaciones de suscripción para contestar una
pregunta sobre SPY, y el resultado se tira a los 600 s.

Con una estrategia eso es un costo. Con N es una colisión de N×N contra un recurso serializado que no
crece. **El aislamiento por estrategia no existe en la única capa donde importa, que es el feed.**

Puesto en una línea: se pagan **126 s de presupuesto cada 600 s** para re-derivar por barrido lo que
una suscripción permanente daría por **23 KB/s — y con ~6× más frescura**.

Los tres supuestos que sostenían el diseño actual se cayeron con las mediciones: el volumen de la
cadena viva no es prohibitivo (§2.4), su frescura es mejor y no peor que la del barrido (§2.5), y el
presupuesto no es único (§2.3).

## 4. La propuesta: un escritor, muchos lectores

**No es una reescritura.** Es un componente nuevo y estrategias que dejan de llamar a un handler para
leer de un store.

Un **ingestor** es el único dueño del presupuesto de DXLink. Mantiene vivo el conjunto de
suscripciones que la plataforma necesita y publica a un store. Las estrategias **no tocan DXLink**:
leen el store.

**Ese store es en memoria, no una base de datos.** Todo corre en un solo proceso, así que publicar
es escribir en una estructura compartida — más rápido y más simple que meter una base en el camino
caliente. Esta aclaración no es un detalle: la primera versión de este documento decía que la base
era "la capa de desacople que hace posible §4", y era falso. **La inversión del flujo no necesita
base de datos.** Ver §5.

Lo que cambia:

* Agregar una estrategia cuyos símbolos ya están cubiertos cuesta **cero** presupuesto de feed.
* Dos estrategias sobre SPY leen la misma fila; no barren dos veces.
* La cadena deja de re-suscribirse cada 600 s: se suscribe una vez (72 s) y los updates llegan solos.
  El costo pasa de **recurrente** a **inicial**.
* El `_scanGate` deja de ser el cuello de botella de la plataforma, porque deja de haber barridos que
  serializar.

Lo que **no** cambia: las tres capas, MediatR, la convención de prefijo por estrategia, el contrato
uniforme del switch, y sobre todo la regla de que **el JSON de reglas es fuente de verdad**.

## 5. La base de datos: entra por usuarios, no por estado

**Corrección de la primera versión de este documento.** Decía que había que migrar el estado
(switches, estado de RPF, skew history) a una base. Es innecesario: **el estado completo de la
plataforma son ~3 KB en 4 archivos**, los archivos ya sobreviven a un reinicio, y en el caso del
switch una base **empeora** las cosas — le agrega el modo de falla "¿y si no responde?" justo a la
pieza cuyo trabajo es apagar cosas. Hoy, si el override no se puede leer, manda el JSON y la
estrategia queda **en ON**; con una base caída eso convertiría un kill switch apagado a propósito en
uno que se prende solo.

El problema que se había diagnosticado era de **propiedad del dato** (el switch tiene tres copias en
el front, hay cinco caches privados en el backend). Eso se arregla teniendo **un solo dueño**, no
cambiando el medio donde se guardan los bytes.

### 5.1 Tres caminos que no hay que mezclar

| Camino | Qué es | Dónde vive |
|---|---|---|
| **Caliente** | El feed → publicación → estrategias leyendo en cada tick | **Memoria.** Sin base |
| **Frío** | Archivo histórico de lo que el ingestor vio | Base, más adelante, opcional |
| **Dominio** | Usuarios, auth, cuentas de bróker, estrategias, research | **Base** |

Publicación y archivo son trabajos distintos: uno es camino caliente y se lee en cada tick, el otro
se escribe una vez y se lee en meses. Meterlos en la misma pieza es cómo se termina con un sistema
lento.

### 5.2 Qué justifica la base

**El dominio.** GaleCore pasa a ser multi-usuario: cada operador se loguea y ve **su** cuenta de
Tastytrade. Eso sí necesita base — usuarios, credenciales de bróker por usuario, estado de las
estrategias por usuario. Es la decisión que ordena todo el resto.

**El archivo histórico**, más adelante, es el único dato de mercado que la merece: es grande, es
**imposible de recuperar después** (no se puede volver a pedir el GEX de ayer) y es lo que desbloquea
**backtestear contra datos propios** — hoy toda la calibración de RPF salió de backtests externos y
quedó como una interpolación sin validar (~8 tr/año, ver `rpf/galecore-rpf-reconciliacion.md`).

### 5.3 La frontera que sí se sostiene

**Declaración en git, estado donde corresponda.** Lo que define *qué es* una estrategia —sus reglas,
sus umbrales, su universo— viaja versionado junto al código que lo implementa: si se agrega una
estrategia, el código y su declaración entran en el mismo commit.

* **Se quedan en git:** `galecore_rules_<prefijo>.json` y `pop_calibration.json`. Este último se había
  listado como candidato a la base y estaba **mal clasificado**: es un artefacto congelado de BT-10,
  de solo lectura en runtime. Eso es reglas.
* **Se quedan como archivos:** los `*_switch_state.json` y `skew25_history.json`. No ganan nada
  mudándose.
* **Van a la base:** usuarios, cuentas de bróker, y el estado por usuario de cada estrategia.

### 5.4 Mercado compartido, cuenta por usuario

Con multi-usuario aparece una división que hay que respetar en todo el sistema:

| Qué | Credencial | Ejemplos |
|---|---|---|
| Datos de **mercado** | Una credencial **de sistema** | precios, cadenas, Greeks, GEX, el ingestor |
| Datos de **cuenta** | La **del usuario** que pide | posiciones, balances, el Monitor |

SPY es SPY para todos; las posiciones no. Hoy `ITastytradeOAuth` es un singleton con un solo juego de
tokens, y los procesos de fondo (`RpfLoopService`, `SkewSnapshotService`, `FlowBroadcastService`)
corren sin request y sin usuario: por eso el mercado necesita una credencial de sistema, o no tienen
con qué hablar.

**Esta decisión es upstream del ingestor y hay que tomarla antes de escribirlo** — es el único punto
de acople entre el trabajo de la base y el de §4. Si el ingestor se construye asumiendo el OAuth
singleton de hoy y después el OAuth se vuelve por usuario, hay que rehacerlo.

El hub también queda involucrado: hoy `/hubs` está **exento del middleware de API key**
(`ApiKeyMiddleware.cs:17`), o sea sin autenticación de ningún tipo. Los precios se pueden seguir
compartiendo, pero lo de cuenta necesita grupos por usuario.

## 6. Plan

0. **Palanca de corto plazo, sin rediseñar nada:** darle al barrido de GEX **su propia sesión DXLink**.
   §2.3 dice que el presupuesto es por sesión, así que el barrido deja de bloquear al resto hoy mismo.
   **Se justifica solo si el rediseño se va a más de un par de meses**, o si la saturación ya duele:
   al 78 % con 4 símbolos todavía no duele. Si el ingestor llega en semanas, **saltear este paso** —
   obliga a tocar dos veces `DxLinkStreamingService`, que es la pieza más delicada del código (811
   líneas de handshake, keepalive, refcount y reconexión, con dos bugs caros pagados en agosto 2026),
   y la segunda vez se tira lo de la primera.
1. **Base + usuarios + auth** (§5.2). Va primero, no porque la inversión dependa de ella, sino porque
   **compra seguridad hoy**: hoy la API key viaja en claro en la URL del front y el hub no autentica
   nada. Y porque la inversión no es urgente — al 78 % se ve venir el techo, pero nada está roto.
   Antes de escribir el ingestor hay que dejar decidida la división de §5.4.
2. **Diseñar el ingestor** — qué eventos se mantienen vivos y para qué símbolos. Con la división de
   credenciales ya tomada, se puede construir sin que el OAuth por usuario lo obligue a rehacerse.
3. **Mover GEX a leer del store.** Es el cambio grande y el que libera el ~78 %.
4. **Consolidar `CascadeCore`**, el follow-up que quedó pendiente cuando RPF se independizó del motor
   de Main: hoy la orquestación macro/strike/micro/sizing está triplicada (VL, PB, RPF) reusando los
   primitivos puros. Cae de maduro en el mismo movimiento.
5. **Archivo histórico**, si se decide guardar historia de mercado. No antes: el esquema sale de qué
   publica el ingestor, y llenar una tabla con la forma equivocada durante meses es peor que no
   tenerla.

## 7. Riesgos y lo que NO está medido

* ~~La cadencia del refresh de Greeks no quedó determinada.~~ **CERRADO** el mismo día con una
  ventana de 45 min: cada símbolo se recalcula cada ~1,5-2 min, o sea ~6× más fresco que el barrido
  (§2.5). Era el riesgo que podía invertir la recomendación y cayó a favor. **Queda abierto** qué
  separa a los dos grupos de refresh.
* **Solo se verificaron 2 sesiones DXLink concurrentes**, y con una sola de ellas realmente saturada
  de forma sostenida.
* **La cadena viva no se probó a lo largo de una rueda entera.** Hay 45 min continuos de sesión
  secundaria persistente con cero `Lost`, cero reconexiones y cero errores — evidencia parcial de que
  una sesión de larga vida se sostiene, pero 45 min no son 6,5 h: reconexiones, expiración de tokens y
  el rollover del 0DTE son escenarios que el barrido resuelve por reinicio y el modelo persistente no.
* Las mediciones son de **un solo día y un solo símbolo** (SPY). QQQ y AAPL tienen cadenas más chicas;
  ninguna se midió en vivo.
* **El costo de multi-usuario no está en la base, está en el OAuth.** `ITastytradeOAuth` es un
  singleton con un solo juego de tokens y de él dependen todos los providers; volverlo por usuario es
  el trabajo caro del paso 1, no crear las tablas. Y guardar refresh tokens de cuentas de bróker
  ajenas obliga a cifrado en reposo y vuelve a la plataforma responsable de material sensible de
  terceros.

## 8. Deuda conocida que este trabajo destapó

* **`GexAnalysisHandler` cachea la misma instancia del response** y los lectores concurrentes la
  mutan (`cached.Response.FromCache = true`). Una respuesta puede viajar con `fromCache: true` siendo
  un barrido propio recién hecho. Afecta solo a los flags de observabilidad, no a los datos de GEX.
* **El estado del switch está duplicado en 3 lugares del front** (`StrategyCard` local,
  `useGexStore`, `useRpfStore`), así que prenderla desde su pestaña no actualiza la card de Main. El
  dueño real del dato es el backend; las tres copias son caches que se desincronizan. **No lo arregla
  la base**: se arregla con un store compartido en el front indexado por `switch_endpoint`, que es
  media hora y no necesita nada nuevo.

## 9. Cómo reproducir las mediciones

Costó descubrirlo, así que queda escrito:

* **No hace falta reiniciar la API** para cambiar `greeks_batch_size`: el JSON se relee por request y
  el `rulesHash` invalida el cache. Reiniciar es **contraproducente** — el front se reconecta y
  dispara su propio barrido, que contamina la medición.
* Usar `GET /App/Gex/Analysis?Symbol=SPY&Refresh=true` y leer el **`elapsedMs` de la respuesta**, no
  el reloj de pared: si otro barrido tiene el semáforo, el wall-clock incluye la espera (se vio un
  236 s de wall contra 126 s reales).
* Verificar que el front no esté barriendo en paralelo:
  `Get-NetTCPConnection -State Established -RemotePort 7001` muestra las conexiones de Chrome.
  Cualquier edición del front dispara HMR, que remonta la pestaña GEX y arranca un barrido del universo.
* El volumen del feed se midió con un script descartable de Node que abre su **propia** sesión DXLink
  replicando el handshake y el throttle de `DxLinkStreamingService`. No está en el repo; si se decide
  incorporarlo como herramienta de diagnóstico, es una decisión aparte.

## 10. Decisiones

### Tomadas (2026-08-11)

* **Motor y hosting:** PostgreSQL en Supabase, base `GaleCore`. Acceso con **EF Core** (las
  migraciones valen más que su ceremonia con un esquema que va a evolucionar). Proyecto propio en la
  solución. *Nota de nombre:* `DataFeed.Repositories` nombra un patrón, no una responsabilidad —
  mismo criterio por el que "Workers" se renombró a switch en 2026-08-10. `DataFeed.Persistence`
  dice para qué es.
* **Multi-usuario:** son dos operadores, y **cada uno ve su propia cuenta de Tastytrade**. Las
  credenciales por usuario (`accountNumber`, `refreshToken`, …) van a una tabla `Accounts`
  relacionada con `Users`. Auth con **OAuth de Supabase**.
* **Tabla `Strategies`:** nombre, descripción, prefijo y versión salen del JSON y pasan a la tabla.
  **Condición que hay que cumplir:** el `prefix` está *compilado* (`[Route("App/Rpf")]`, `Files/Rpf/`,
  el tag de Swagger, el id de pestaña en `TabNav.tsx`), y hoy ese invariante lo cuida
  `RulesJsonTests.cs`. Si `strategies[]` sale del JSON, ese test muere y **hay que reemplazarlo por
  uno que valide las filas de la base contra las rutas compiladas** — si no, queda la misma
  duplicación con un guardián menos.
* **El estado NO se migra** (§5). Los `*_switch_state.json` y `skew25_history.json` se quedan como
  archivos.

### Tomadas (2026-08-12) — dos roles de base, no uno

La API **nunca migra en runtime** (no hay `Migrate()` en ningún lado: las migraciones se aplican a
mano con `dotnet ef database update`). Eso es lo que permite separar quién crea el esquema de quién
lo usa, y por eso los privilegios quedaron así:

| Rol | Para qué | Qué tiene |
|---|---|---|
| `galecore_ddl` | migraciones, nada más | dueño de las tablas y `CREATE` sobre `public` |
| `galecore_api` | el runtime de la API | `USAGE` en `public`; `SELECT/INSERT/UPDATE/DELETE` en `users` y `accounts` |

*(Al 2026-08-11 eran 5 tablas y el rol tenía además permisos sobre `user_strategies` y `strategies`;
esas dos se eliminaron el 2026-08-12 — ver la decisión al final de esta sección. Los permisos se
fueron con las tablas, no hubo que revocarlos.)*

**El problema que resuelve:** hasta hoy `galecore_api` era **dueña** de las tablas, así que la
credencial que va a App Settings de Azure podía `DROP TABLE` el esquema entero. Ahora no puede crear,
borrar, truncar ni alterar nada — solo leer y escribir filas. Tampoco tiene ningún permiso sobre
`__EFMigrationsHistory`.

Tres cosas que hay que saber para no tropezar:

* **Aplicar migraciones exige la credencial de DDL**: `GALECORE_DB` con `galecore_ddl` antes de
  `dotnet ef database update`. `GaleCoreDbContextFactory` ya lee esa variable primero, así que no hay
  que tocar el user-secret de la API. Sin eso, la migración falla con `permission denied`.
  *(Sigue siendo cierto, pero ya no es el camino principal: ver la decisión del 2026-09-01 más abajo.)*
* **`ALTER DEFAULT PRIVILEGES` no es decorativo.** Sin él, la tabla que cree la próxima migración nace
  sin permisos para la API y el fallo aparece en runtime, lejos del cambio que lo causó.
* **`strategies` quedó de solo lectura** porque la app solo la lee: el catálogo se siembra por
  migración. Si algún día se edita desde la aplicación, hay que sumarle `UPDATE`.

*Nota de ejecución:* transferir la propiedad y otorgar los permisos son dos pasos, y **entre uno y
otro la API se queda sin acceso**. Se hizo con la API corriendo y se vio en los logs: el loop de RPF
siguió (su consulta es permisiva ante fallas) pero `TastytradeCredentialStore` no pudo resolver la
credencial de sistema. Duró lo que tardó el segundo paso. En Azure conviene hacerlo con la app
detenida, o en una sola transacción.

### Tomadas (2026-08-12) — el switch, precisado

Esta decisión y la de §5.3 ("van a la base … el estado por usuario de cada estrategia") parecían
contradecirse. No se contradicen: **son dos cosas distintas con el mismo nombre**, y separarlas fue
el trabajo del switch de dos niveles.

* **El kill switch se queda en el archivo.** Es el de plataforma: corta feed y emisión para todos,
  y por eso no puede depender de que la base responda (§5). Se toca por
  `POST <switch_endpoint>/Platform` y **solo lo pueden tocar los admin** (`users.is_admin`) — hasta
  hoy cualquier usuario autenticado apagaba la estrategia de todos, que era el agujero real.
* **La preferencia por usuario va a la base** (`user_strategies`), que es lo que §5.3 quería decir:
  eso es dominio —quién es quién—, no estado de runtime. Es lo que escribe el `POST` del tablero.
* **El efectivo se resuelve con `StrategyEnablement.Resolve`** (función pura, con test): la
  plataforma gana cuando apaga; el nivel ausente hereda del de arriba.
* **Un proceso compartido corre si le sirve a alguien.** El loop de RPF es uno solo, así que tickea
  mientras la plataforma esté en ON y quede al menos un usuario que no la haya apagado.
* **Sin base, el nivel de usuario no existe** y el `POST` escribe el de plataforma: la API sigue
  levantando y sirviendo el feed sin base, que es una propiedad deliberada de `Program.cs`.

### Tomadas (2026-08-12, más tarde) — se revierte la tabla `Strategies` y el nivel por usuario

Revierte la decisión de arriba ("Tabla `Strategies`") y la de "el switch, precisado", el mismo día
que se implementaron. **El motivo no es que estuvieran mal razonadas: es que al implementarlas se
vio lo que en el papel no se veía.**

* **La tabla `strategies` nunca tuvo un lector.** No hubo una sola consulta contra `db.Strategies`
  en todo el backend: el catálogo que la aplicación consume siguió siendo `strategies[]` del JSON.
  Su único uso real terminó siendo el lado "uno" de la FK de `user_strategies`.
* **La condición que la decisión original se puso a sí misma no se cumplió.** Decía: si
  `strategies[]` sale del JSON, hay que reemplazar `RulesJsonTests` por uno que valide las filas de
  la base contra las rutas compiladas. `strategies[]` nunca salió del JSON, así que quedó el
  catálogo duplicado en dos lugares con guardián de un solo lado.
* **El beneficio que la justificaba tampoco llegó.** "Editar nombre y descripción sin tocar código"
  es imposible con `galecore_api` en `SELECT` y el seed por migración: editar sigue costando una
  migración, igual que editar el JSON cuesta un commit — pero el JSON además se revisa en un PR.
* **El costo sí era real**: `RpfLoopService` consultaba la base en cada tick (30 s) para preguntar
  "¿le sirve a alguien?", con cache, TTL y una rama permisiva ante fallas. Todo eso desapareció.

**Lo que queda:** el switch tiene dos niveles (reglas + plataforma), es **global**, y sigue siendo
admin-only — el agujero que el gate de `is_admin` tapó (un operador apagándole la estrategia al
resto) existe igual con el switch global, así que ese chequeo no se toca. `users` y `accounts` se
quedan: son dominio de verdad y ahora tienen UI planificada.

Plan completo y etapas siguientes: [`archive/GaleCore-plan-reorganizacion-2026-08.md`](archive/GaleCore-plan-reorganizacion-2026-08.md) (histórico).

### Tomadas (2026-08-14) — la división de §5.4 también rige en el cliente

§5.4 reparte las credenciales en el servidor: mercado con la de sistema, cuenta con la del usuario.
Con el segundo operador se vio que ese reparto tiene una mitad en el navegador que nadie había
escrito, y costó dos bugs el mismo día.

* **Los stores de Zustand son de módulo y sobreviven al logout**, que solo desmonta el tablero.
  Entrando con otra cuenta sin recargar la página, el segundo operador se quedaba con el usuario,
  los permisos, el número de cuenta y las posiciones del primero. **No es una falla de permisos** —
  la API rechazaba correctamente cada pedido; es que la pantalla mostraba como propio lo que se
  había traído con el token del anterior, que para operar es igual de malo.
* **Un error no puede dejar el dato viejo a la vista.** `Balances` fallaba y el cartel rojo se
  pintaba al lado de los números, no encima. Es la misma regla que ya estaba escrita para una
  estrategia en OFF, aplicada a otro caso.
* **Limpiar no alcanza: hay que volver a pedir.** La sesión de Supabase es por origen, así que
  entrar con otra cuenta en otra ventana pisa la de la primera; limpiar ahí sin refrescar dejó la
  pestaña sin `canManagePlatform` para siempre, con los switches deshabilitados y sin decir por qué.
  El id del usuario de la sesión pasó a ser la `key` del tablero: si cambia la persona, se remonta.

**Lo que queda:** `resetUserScopedStores()` es el único lugar que declara qué es de la persona
(usuario + cuenta) y qué es de la plataforma (precios, config, switches). Y "el operador no vinculó
su cuenta" dejó de ser una excepción con 500: es `409` con `code: "broker_account_not_linked"`, que
es lo que le permite al tablero mandarlo a vincularla en vez de mostrarle un error de servidor.

### Tomadas (2026-09-01) — la credencial de DDL deja de perderse

**El problema no era de permisos, era de custodia.** `galecore_ddl` es dueño de las tres tablas, o
sea que puede hacer cualquier DDL sin que nadie le conceda nada; lo que no existía era una copia
guardada de su contraseña. Cada migración empezaba igual: resetear la contraseña, exportarla en
`GALECORE_DB`, aplicar, y perderla de nuevo. Tres migraciones después, seguía siendo un
descubrimiento.

Lo que se hizo:

* La contraseña de `galecore_ddl` se fijó y **se guarda en el gestor de contraseñas del operador**.
* La cadena de DDL vive en `ConnectionStrings:GaleCoreDdl`, en el **user-secret store de
  `DataFeed.Repositories`** — store propio, no el de `DataFeed.Api`. Una credencial que puede `ALTER`
  y `DROP` no tiene por qué estar al alcance de la configuración de la API, que solo necesita filas.
* `GaleCoreDbContextFactory` la busca en segundo lugar, después de `GALECORE_DB` y antes de la
  cadena de la API. Con eso, `dotnet ef database update` funciona sin variables de entorno y sin
  pegar la contraseña en la consola.

Cargarla, una sola vez por máquina:

```
dotnet user-secrets set "ConnectionStrings:GaleCoreDdl" "<cadena con galecore_ddl>" --project DataFeed.Repositories
```

**El usuario del pooler lleva el sufijo del proyecto** (`galecore_ddl.<project-ref>`, igual que
`galecore_api.<project-ref>`), y el puerto es el **5432** (sesión). En el 6543 (transacción) las
cosas de sesión no se comportan.

**Y `ALTER DEFAULT PRIVILEGES` se aplicó recién hoy.** La decisión del 2026-08-12 ya advertía que no
era decorativo, pero nunca se había corrido: `pg_default_acl` no tenía ninguna entrada para
`galecore_ddl`, y las tablas existentes tenían sus permisos puestos a mano una por una. O sea que la
advertencia estaba escrita y viva al mismo tiempo — la próxima migración que creara una tabla habría
fallado en runtime con `permission denied`. Hoy quedó:

```
galecore_ddl -> tablas:     galecore_api = arwd   (select, insert, update, delete)
galecore_ddl -> secuencias: galecore_api = rU
```

Los privilegios por defecto se aplican **según quién crea** el objeto, así que solo sirven si las
migraciones corren con la identidad de `galecore_ddl`. Una migración aplicada como `postgres` sin
`SET ROLE` crea tablas que esta regla no alcanza.

### Tomadas (2026-09-03) — el procedimiento deja de ser prosa

Todo lo de arriba estaba escrito y era correcto, y aun así cada migración se aplicaba a mano
releyendo esta sección. **Lo que estaba documentado pero no ejecutable pasó a `migrate-db.ps1`**, en
la raíz del repo, hermano de `deploy-api.ps1`:

* **Resuelve la cadena replicando el orden de `GaleCoreDbContextFactory` y la nombra antes de
  conectar.** Captura el valor del user-secret pero imprime solo host, puerto, base y usuario: la
  contraseña no sale por pantalla. Si no hay credencial de DDL corta ahí con el
  `dotnet user-secrets set` exacto, en vez de dejar que el tooling caiga a la cadena de la API y el
  `permission denied` aparezca después del viaje.
* **Corta si el puerto es el 6543** y avisa si el usuario no es `galecore_ddl` o si el host es de
  pooler y el usuario no trae el sufijo del proyecto.
* **Muestra el SQL idempotente entre lo aplicado y el destino, entero, antes de pedir confirmación**
  (hay que escribir `aplicar`; `-DryRun` termina antes de tocar nada). Una migración no tiene
  rollback: no hay backup de la base en este flujo.
* **Clasifica el cambio en aditivo o destructivo**, porque el orden contra el deploy depende de eso:
  lo aditivo va antes de `deploy-api.ps1`, lo destructivo después, con el binario que ya no usa esa
  columna arriba y respondiendo. Expand / contract. Esa decisión no estaba escrita en ningún lado, y
  es la que rompe producción si se toma al revés.
* **Si la migración crea una tabla, imprime las dos consultas de verificación de permisos** — la de
  `information_schema.role_table_grants` y la de `pg_default_acl` — que son exactamente lo que la
  decisión del 2026-09-01 descubrió que nunca se había corrido.

**Lo que el script NO hace, a propósito:** ejecutar esas consultas. Necesita `psql`, que no está en
la máquina del operador, y Npgsql es un ensamblado net8.0 que no carga en PowerShell 5.1. Un script
de operaciones que depende de que ninguna de esas dos cosas cambie es peor que uno que imprime la
consulta y dice por qué. Automatizarlo es una decisión aparte.

El orden entre migrar y deployar no lo decide ningún script: lo aditivo va antes de
`deploy-api.ps1`, lo destructivo después. `migrate-db.ps1` lo dice en cada corrida, pero la decisión
es del operador.

### Pendientes

1. ¿Se adopta la inversión del flujo (§4)? El plan la pone después de la base, porque no es urgente.
2. **Cuál es la credencial de sistema** para los datos de mercado (§5.4). Es upstream del ingestor:
   hay que decidirla antes de escribirlo, aunque se implemente después.
3. ~~Si `client_secret` es de la **aplicación registrada** o de cada usuario.~~ **RESUELTO
   2026-09-01: las dos cosas.** `accounts.client_secret_encrypted` es nullable y null significa
   "usá el de configuración". El que trae su propia aplicación OAuth guarda su secreto con su
   refresh token; el que entra por la de la plataforma no guarda nada y la fila hereda el de
   configuración, que es también el de la cuenta de sistema.

   El argumento viejo —"si es de la app no va en `Accounts`, duplicarlo por fila sería esparcir un
   secreto de aplicación"— valía mientras hubiera UNA aplicación para todos. Con cada operador
   registrando la suya, el par (refresh token, client_secret) es **una sola credencial**, y
   partirla entre la fila y la configuración no evita la duplicación: garantiza que las dos mitades
   no coincidan. Eso es literalmente lo que Tastytrade contesta como
   `invalid_grant / Client secret mismatch`, y fue lo que pasó el 2026-09-01 con un operador que
   había generado su token desde su propia app.
4. Cómo se cifran en reposo los refresh tokens de bróker (`pgcrypto` en Postgres, o cifrado en la
   aplicación con la clave en Key Vault).
5. Qué símbolos y qué eventos mantiene vivos el ingestor.
6. La tabla de **research** queda **postergada a propósito**: hasta que exista una consulta concreta
   que contestar, el esquema no se puede diseñar y una tabla sin consumidor es un cajón de sastre.
   Con EF, agregarla después cuesta una migración.
