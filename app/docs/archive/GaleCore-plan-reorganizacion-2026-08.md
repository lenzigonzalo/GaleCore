> **Archivado el 21/10/2026 (WS-0048).** Registro histórico, no se sigue. Forma de trabajo vigente: `ENGINEERING.md` del workspace.

# Plan de reorganización — switch global, administración y login por usuario

**Estado:** etapas 1 y 2 **COMPLETAS y verificadas en vivo** (2026-08-12) · etapa 3 **escrita entera
el 2026-08-13 (3a ABM + 3b login), SIN VERIFICAR EN VIVO todavía**
**Decidido:** 2026-08-12

Reorganiza tres cosas que quedaron a medio camino tras la incorporación de la base de datos
(2026-08-11) y el switch de tres niveles (2026-08-12): dónde vive el catálogo de estrategias, quién
puede apagar una estrategia, y con qué se entra a la plataforma.

---

## 0. El problema que resuelve

Al mudar el catálogo de estrategias a la base quedaron **dos catálogos**: `strategies[]` de
`galecore_rules_core.json` —que es el que la aplicación realmente consume— y la tabla `strategies`,
que **no la lee nadie**. El `DbSet<Strategy>` existe pero no hay una sola consulta contra él: su
único uso real es ser el lado "uno" de la FK de `user_strategies`.

La duplicación además tiene guardián de un solo lado: `RulesJsonTests` valida el JSON contra las
rutas compiladas y la carpeta de archivos; nada valida las filas de la base. Y el beneficio que
justificaba la mudanza —editar nombre y descripción sin tocar código— tampoco se cobra: el rol
`galecore_api` sólo tiene `SELECT` sobre `strategies` y el catálogo se siembra por migración.

**Decisión: el JSON vuelve a ser la única fuente de verdad del catálogo.** La base se queda con lo
que sí es dominio: usuarios y cuentas de bróker.

---

## Etapa 1 — Switch global + JSON como única fuente de verdad

**Objetivo:** el switch pasa de tres niveles a dos (reglas + plataforma), desaparecen las dos tablas
de estrategias, y el loop de RPF deja de tocar la base.

### Qué se gana

* **Un solo modelo de switch en toda la plataforma.** Hoy las estrategias tienen tres niveles y los
  `services[]` tienen dos. Con esto, todo tiene dos.
* **El loop de RPF deja de depender de la base.** Se va `AnyUserEnabledAsync` con su cache de 30 s,
  su round-trip por tick y su rama "permisivo si falla": un modo de falla menos en el camino caliente.
* **Refuerza una propiedad deliberada:** la API levanta y sirve el feed sin base (`Program.cs`).
  Ahora el switch tampoco la necesita nunca, ni siquiera para el caso degradado.

### Qué se pierde, dicho de frente

Un operador ya no puede silenciar una estrategia en su tablero sin cortársela al otro. Con dos
operadores es aceptable, y es la decisión — no un efecto colateral. El switch **sigue siendo de
admin**: el gate `users.is_admin` que se agregó el 2026-08-12 no se toca, porque el agujero que tapó
(un segundo operador apagándole la estrategia al resto) sigue existiendo igual.

### Cambios

**Lógica pura**

* `App/Shared/StrategyEnablement.cs` — `Resolve(bool rules, bool? platform)`: se va el tercer
  parámetro y la constante `SourceUser`.
* `StrategyEnablementTests.cs` — reescrito sobre la tabla de dos niveles.

**Backend**

* `UserStrategySwitchStore` → **`UserStore`**. No se borra: se reduce. Sobreviven
  `DatabaseConfigured` e `IsAdminAsync`; mueren `ReadUserOverrideAsync`, `SetUserAsync`,
  `AnyUserEnabledAsync` y el cache.
* `AppController` `#region Switch` — el `POST <switch_endpoint>` **es** el de plataforma y exige
  admin. Los `POST <switch_endpoint>/Platform` se eliminan: dos rutas para lo mismo ya no tienen
  sentido. El `GET` pierde el nodo `user` de diagnóstico.
* `GET /App/GaleCore/Me` — suma `isAdmin` y `canManagePlatform`. Sin él el front no sabe si mostrar
  el switch habilitado, y un no-admin vería un botón que siempre responde 403.
* `RpfLoopService` — pierde la dependencia entera. `activo = cfg.Enabled`.
* `IMarketDataBroadcaster.BroadcastRpfSwitchAsync(bool enabled)` — se le cae el parámetro `userId`:
  ahora el aviso siempre vale para todos.

**Base**

* Migración `DropStrategyTables`: `DROP TABLE user_strategies` + `DROP TABLE strategies`.
* Se borran `Entities/Strategy.cs`, `Entities/UserStrategy.cs`, los dos `DbSet` y la navegación
  `User.Strategies`. Los grants se van con las tablas.

**Frontend**

* `api/strategies.ts` y `useStrategySwitchStore` — `source: 'platform' | 'rules'`.
* `StrategySwitch` — deshabilitado con tooltip si el usuario no puede administrar la plataforma.
* `store/useCurrentUserStore.ts` — nuevo, cachea la respuesta de `/App/GaleCore/Me`.

**Docs**

* `CLAUDE.md`, nodo "switch por estrategia": la tabla de tres niveles pasa a dos.
* `GaleCore-arquitectura-datos.md` §10: decisión nueva que revierte la del 2026-08-11.

### ⚠️ Antes de desplegar

**Verificar que haya al menos un usuario con `is_admin = true`.** El `POST` del switch exige admin;
sin ningún admin en la base, el switch no se puede tocar desde ningún tablero y hay que arreglarlo
con SQL a mano. (Sin base configurada no aplica: ahí no hay permisos que consultar y la API se
comporta como antes de que existiera la base.)

### Verificación — hecha el 2026-08-12

1. ✅ `dotnet test` 143/143, `tsc --noEmit` limpio.
2. ✅ Migración aplicada con la credencial `galecore_ddl`. Con `galecore_api` falla en
   `permission denied for table __EFMigrationsHistory` **antes** de tocar nada — la separación de
   roles funciona.
3. ✅ Swagger confirma el build desplegado: los `/Switch/Platform` ya no existen y `/App/GaleCore/Me`
   sí.
4. ✅ Un click apaga el switch en Main **y** en la pestaña a la vez, en los dos sentidos.
5. ✅ Con RPF en OFF la pantalla se reduce a encabezado + References + switch + cartel; al volver a
   ON el loop repuebla el tablero en el siguiente tick (~30 s).
6. ✅ El loop tickea con las tablas borradas — ya no las consulta.
7. ✅ Cero errores en consola del navegador.

**Defecto encontrado y corregido durante la verificación:** los carteles de OFF de RPF y GEX seguían
diciendo *"apagada para vos"* y *"el loop sigue corriendo si otro operador la tiene prendida"* —
copy del switch por usuario, que con el switch global pasó a ser falso. Es la misma clase de bug que
arregló `ff705a1`. **Al cambiar el alcance de un switch hay que revisar los textos que lo explican,
no solo la lógica**: el compilador no ve una promesa rota en un string.

---

## Etapa 2 — Mi cuenta + Administrator — HECHA el 2026-08-12

**Objetivo:** las tablas que quedan (`users`, `accounts`) tienen por fin una UI.

### Cómo terminó, y en qué se apartó del plan

**Las altas de usuario NO se hacen desde la app.** Se evaluaron las dos opciones y ganó la barata:
el admin crea el usuario en el panel de Supabase y la pantalla Administrator solo administra. El
motivo es que el alta desde la app exige la **service_role key** —la llave maestra del proyecto—
dentro de la aplicación, más manejar el caso de que la fila local falle y el usuario quede huérfano
en auth, todo para una operación que con dos operadores pasa una vez cada tanto.

> **⚠️ REVERTIDO el 2026-08-13, al arrancar la etapa 3.** El ABM completo (alta, edición y baja)
> se hace desde Administrator. Lo que forzó la vuelta atrás no fue el costo sino un callejón sin
> salida: con el login por username, el username vive en `users`, y esa fila nace recién en el
> primer request autenticado — o sea que un usuario creado en el panel de Supabase **no tendría con
> qué entrar para que su fila naciera**. El alta desde la app es lo que rompe el círculo, porque
> crea la identidad y la fila juntas. Los dos riesgos que este párrafo señalaba siguen siendo
> reales y se manejan explícitamente: la service_role vive solo del lado servidor
> (`Supabase:ServiceRoleKey`, user-secrets o App Settings) y el alta **compensa** — si la fila local
> falla, borra el usuario recién creado en auth. La materialización perezosa se queda igual, como
> red para quien haya sido creado en el panel de Supabase: le deriva el username del mail.

**Consecuencia que invierte una decisión del plan original:** la materialización perezosa de la fila
de `users` **se queda**, y encima se movió a `/Me`. El plan decía borrarla cuando existiera el alta
desde la app; como el alta se hace en Supabase, esa fila no la crea nadie más — sacarla habría dejado
a todo usuario nuevo fuera de la tabla. Y va en `/Me` (el primer request del tablero) y no en
`LinkBrokerAccount` para que un usuario recién creado **aparezca en la lista del admin antes de
vincular una cuenta**: si no, sería invisible y no habría forma de darle permisos.

**No se hizo una pantalla "Mi cuenta" separada.** `BrokerAccountCard` ya cumplía esa función en la
sección Plataforma de Main, la ve cualquier usuario y anda; se le agregó lo que le faltaba
(desvincular, con confirmación y aviso explícito si es la cuenta de sistema). Partirla en una
pestaña propia era churn visual sin ganancia.

> **⚠️ REVERTIDO el 2026-08-14.** Existe el menú **Mi Cuenta**, en el lugar donde estaba el botón
> LOGOUT: *Cuenta de bróker* (pestaña propia, sin botón en la barra), *Mi contraseña* (modal) y
> *Salir*. La card no había quedado en Main sino dentro de **Admin**, junto con la contraseña
> propia, y eso obligaba a mostrarle la pestaña Admin a cualquiera — o sea, la tabla de abajo ("dos
> menús, no uno") se cumplía metiendo lo de todos adentro de la pantalla de los admin. Sacándolo,
> Admin volvió a ser lo que dice ser y **solo la ve `isAdmin`**. Lo que el párrafo original decía
> —que no valía la pena una pestaña— sigue siendo cierto para una pestaña *visible*: por eso
> `cuenta` no ocupa lugar en la barra y se llega solo desde el menú.

**El admin no ve las cuentas de bróker ajenas**, respetando el invariante que ya estaba escrito en
la entidad `User`. La lista dice si hay cuenta vinculada y si es la de sistema — nunca el número ni
el token.

### Verificación — hecha el 2026-08-12

1. ✅ Swagger confirma `/App/GaleCore/Admin/Users`, `/Admin/Users/{id}` y `/Account`.
2. ✅ La pestaña Admin aparece solo con `isAdmin`; con la API caída no aparece (falla hacia "no
   puede", que es lo correcto para un permiso).
3. ✅ La lista trae el usuario con "vos", su cuenta vinculada y el pill de sistema.
4. ✅ **El guard aguanta:** sacarse el admin siendo el único devuelve 400 con el motivo, el toggle no
   se mueve y la pestaña sigue.
5. ✅ La confirmación de desvincular avisa que es la cuenta de sistema. **No se ejecutó a propósito**:
   borrarla dejaba al feed sin credencial.
6. ✅ Sin errores de consola nuevos.

**Sin probar: el 403 al no-admin**, porque hay un solo usuario en la base. Es lo que queda para
cuando exista el segundo operador.

> **Al día 2026-08-14.** Ya hay un segundo operador (`operador`, sin admin) y se verificó en vivo lo
> que se veía desde su sesión: `/App/GaleCore/Me` devuelve `isAdmin:false` y `canManagePlatform:
> false`, la pestaña Admin no aparece, los cuatro switches se muestran deshabilitados con el
> tooltip de admin-only, y el menú Mi Cuenta está completo. **El 403 del `POST` sigue sin ejecutarse
> contra la API**: la UI no lo deja disparar, y forzarlo a mano habría sido apagarle una estrategia
> a la plataforma entera para probar un rechazo.

**Dos menús, no uno.** Es el error a evitar: si "cada usuario administra sus cuentas de bróker"
queda detrás de un `if (isAdmin)`, el operador no-admin no puede vincular su cuenta — y sin cuenta
vinculada no ve balances ni posiciones, con un tablero vacío y sin forma de arreglarlo.

| Pantalla | Quién entra | Qué hace |
|---|---|---|
| **Mi cuenta** | todos | vincular/desvincular *sus* cuentas de bróker |
| **Administrator** | `is_admin` | ABM de usuarios, rol admin, y la **cuenta de sistema** |

* `GET/POST /App/GaleCore/Account` ya existen; faltan `DELETE` y la pantalla.
* `GET/POST/PATCH/DELETE /App/GaleCore/Admin/Users`.
* El alta hace dos escrituras: crear el usuario en Supabase Auth **con la service_role key** y
  después la fila en `users`. Si la segunda falla, revertir la primera o el usuario queda huérfano
  en auth.
* La cuenta de sistema (`accounts.is_system`, con su índice único parcial de máximo una en toda la
  plataforma) se administra acá, no en "Mi cuenta".

**🔑 La service_role key sólo del lado servidor** — user-secret en local, App Settings en Azure. La
que está en el bundle es la anon key, y son cosas muy distintas.

**🔒 El gate va en el endpoint, no en el menú.** Ocultar la pantalla no es seguridad.

**Efecto colateral bueno:** con el alta explícita se puede borrar la materialización perezosa de
`users` en `LinkBrokerAccount` y su relleno `@sin-mail.local`.

---

## Etapa 3 — Login por username

**Objetivo:** entrar con usuario y contraseña. **`email` no se toca**: sigue real, único y requerido.

### 3a — ABM de usuarios desde Administrator — HECHA el 2026-08-13

Va **antes** que el login, y no es un rodeo: sin ella el login por username es un callejón sin
salida. El username vive en `users` y esa fila nace en el primer request autenticado, así que un
usuario creado en el panel de Supabase no tendría username con qué entrar para que su fila naciera.
El alta desde la app rompe el círculo creando la identidad y la fila juntas. Revierte la decisión
de la etapa 2 (ver el recuadro de arriba).

* **Base** — migración `AddUsername`, en los tres pasos que pedía el plan: `username` nullable →
  backfill derivado del mail → `NOT NULL` + único + `ck_users_username`. El `AddColumn` que genera
  EF por defecto (`nullable: false, defaultValue: ""`) no sirve: le pone la cadena vacía a las filas
  que ya existen y el check —que exige 3 caracteres— revienta en la misma transacción.
* **Lógica pura** — `App/Shared/Usernames.cs` (charset, derivación del mail, deduplicación),
  congelada por `UsernamesTests.cs`. Un test verifica que la regex de C# y la del check de Postgres
  aceptan lo mismo: si se separan, el alta falla con un 500 de constraint en vez de con un mensaje.
* **Backend** — `SupabaseAdminClient` contra la admin API de GoTrue (`{Issuer}/admin/users`), y
  `POST` / `PATCH` / `DELETE` de `/App/GaleCore/Admin/Users`. El `PATCH` pasó de `{ isAdmin }` a
  todo-opcional: lo que viene en null no se toca.
* **Frontend** — alta, edición y baja en Administrator, y `MyPasswordCard` para que cada uno cambie
  su contraseña.

**Las dos escrituras se compensan, y el orden es distinto en cada punta.** En el **alta** va primero
auth (devuelve el uuid, que la fila local necesita como clave) y si la fila falla se borra el usuario
recién creado: un usuario en auth sin fila local es invisible desde la app y solo se limpia entrando
al panel de Supabase. En la **baja** es al revés —primero auth— porque lo que importa de una baja es
que la persona deje de poder entrar; si después falla el borrado local, reintentar converge (el
segundo intento se come un 404 de auth, que se toma como éxito).

**La contraseña del alta es INICIAL y el operador la cambia desde su pantalla.** Se eligió sobre la
invitación por mail porque no depende de que el proyecto tenga un SMTP propio: con el servicio de
mail por defecto de Supabase (unos pocos envíos por hora) una invitación puede no llegar nunca, y el
alta quedaría a mitad de camino sin que el admin se entere. El cambio propio le pega directo a
Supabase con la sesión vigente —`supabase.auth.updateUser`—, que no necesita la service_role.

**🔑 `Supabase:ServiceRoleKey` solo del lado servidor**: user-secrets en local, App Settings en
Azure, nunca en `appsettings.json`. Sin ella la API arranca igual y todo anda; lo único que contesta
503, explicando qué falta, es el ABM.

Se descartó la variante con email sintético (`<username>@galecore.internal`) porque rompe el reset
de contraseña por mail, obliga a saltear la confirmación, y convierte el cambio de username en una
escritura en dos sistemas que se pueden desincronizar. Con el email real, nada de eso pasa: la
identidad de auth no se toca y el username vive en una sola tabla.

### 3b — El login — ESCRITA el 2026-08-13

Salió como estaba planeada, con dos precisiones que el plan no decía:

* **El login tiene que saltear `ApiKeyMiddleware`**, que corre antes de la autorización y bloquea
  todo lo que no traiga JWT ni API key. Sin la exención, entrar exigiría la credencial que el login
  vino a reemplazar — el tablero volvería a necesitar una API key en su bundle, o sea pública, solo
  para mostrar la pantalla de entrada. La exención es por comparación EXACTA de path: con
  `StartsWith`, cualquier ruta futura que empiece igual heredaría el permiso sin que nadie lo note.
* **`Supabase:AnonKey` va en `appsettings.json`**, y no contradice la nota de la service_role: la
  anon key es pública por diseño, ya viaja en el bundle y ya estaba commiteada en el `.env` del
  monitor. No autoriza nada por sí sola — lo que autoriza en el `grant_type=password` es la
  contraseña.

**Rate limit**: política `login` con ventana fija por IP, 10 intentos cada 5 minutos, sin cola.
Particiona por `X-Forwarded-For` y cae a la IP remota; sin ninguna de las dos, todos comparten
partición, que es el lado seguro (limita de más, no de menos). El front distingue el 429 del 401:
decirle "usuario o contraseña incorrectos" a quien chocó con el límite lo manda a dudar de una
contraseña que estaba bien.

**Canal lateral conocido y aceptado:** un usuario inexistente contesta sin salir a la red y uno que
existe, después del round-trip a Supabase, así que los tiempos difieren. Explotarlo exige muchos
intentos contra el rate limit; taparlo obligaría a autenticar con un mail inventado en cada fallo.

### Verificación — parcial, 2026-08-13

1. ✅ `dotnet test` 168/168 · `tsc --noEmit` limpio.
2. ✅ La migración está aplicada: el tablero carga (`/Me` consulta `username`) y el login contesta
   401 en vez de 500 al resolver `username → mail`.
3. ✅ `POST /App/GaleCore/Auth/Login` responde **sin API key y sin token**, con el error genérico y
   no con "API Key header is missing": la exención de `ApiKeyMiddleware` funciona.
4. ✅ Administrator renderiza el ABM (alta, editar, borrar), "Mi contraseña", y el botón de borrarse
   a uno mismo sale deshabilitado.
5. ✅ Cero errores de API en la consola del navegador; todas las llamadas 200.
6. ⬜ **Sin probar: entrar por el formulario con usuario y contraseña**, el alta de un segundo
   operador, el 429 del rate limit (gastarlo dejaría a la IP sin login por 5 minutos) y el 403 al
   no-admin, que sigue sin poder probarse con un solo usuario.

**Defecto encontrado y corregido durante la verificación — `rpad` en el backfill.** En Postgres
`rpad` no solo rellena: **también trunca** si la cadena ya es más larga que el largo pedido. El
`rpad(nombre, 3, 'u')` que escribí para cubrir la parte local de uno o dos caracteres le cortó el
username a TRES letras a todas las filas: `ericlenzi@gmail.com` quedó como `eri`. El `Up` ya está
corregido (el relleno va detrás de un `CASE WHEN length(nombre) < 3`), pero la migración **ya
corrió**, así que en la base viva el arreglo no se aplica solo: el username se corrige desde
Administrator.

**La lección es sobre dónde estaba el hueco, no sobre `rpad`.** La misma regla existe dos veces —en
C# y en SQL— y el test solo cubre la de C#: `Usernames.FromEmail` rellena con un `if` explícito y
está bien. `UsernamesTests` congela la equivalencia entre la regex de C# y la del check de Postgres
justamente porque es una regla duplicada, pero la derivación del mail quedó duplicada sin ese
guardián. Una regla escrita dos veces necesita un test que las compare, o la segunda copia se
desvía en silencio.

### Base

Migración en tres pasos: `username` nullable → backfill de las filas existentes → `NOT NULL` +
índice único + check de charset (`^[a-z0-9._-]{3,32}$`, normalizado a minúscula al escribir).

### Backend

`POST /App/GaleCore/Auth/Login` `{ username, password }`:

1. resuelve `username → email` en `users`,
2. llama al `grant_type=password` de Supabase (**alcanza la anon key**; la service_role sólo hace
   falta para *crear* usuarios),
3. devuelve la sesión.

**El email nunca sale del servidor.** La alternativa —un endpoint `username → email` y que el front
le pegue a Supabase directo— deja un endpoint público que devuelve direcciones de mail a quien
adivine un usuario.

Tres reglas duras: **rate limit** (es el único endpoint sin JWT), **error genérico** para usuario
inexistente y contraseña mala (si no, el formulario informa quién existe), y **no logear el body**
ni en debug.

### Frontend

* `auth/supabase.ts` — `signIn(email, password)` → `loginWithUsername(username, password)`, que le
  pega a la API y hace `supabase.auth.setSession(...)`.
* `LoginScreen.tsx` — el campo pasa a "Usuario", `type="text"`.
* **Nada más cambia**: `getAccessToken`, el interceptor de axios, el `accessTokenFactory` del hub y
  el `onAuthStateChange` de `App.tsx` siguen funcionando porque la sesión sigue siendo la de Supabase.

### En Administrator

Ya está hecho en 3a: el alta pide username + email real + **contraseña inicial**, y la persona la
cambia desde "Mi contraseña". Se descartó invitar por mail porque depende de un SMTP propio (ver
3a). El admin puede resetear la contraseña de otro desde el formulario de edición — es la única
forma de rescatar a quien perdió el acceso mientras no haya reset por mail.

---

## Orden y riesgo

| Etapa | Tamaño | Riesgo | Por qué en ese orden |
|---|---|---|---|
| 1 | mediana, casi todo borrado | bajo | No depende de nada. Es la que más simplifica. |
| 2 | la más grande (UI nueva) | medio | Necesita `/Me` de la etapa 1. Introduce la service_role. |
| 3 | chica y acotada | **el más alto** | Toca el login, que fue lo que más costó cerrar (2026-08-11). Va última y sola, para poder aislarla si algo falla. |

Los tres puntos de no retorno: el admin que tiene que existir **antes** de la etapa 1, la
service_role que nunca puede cruzar al bundle en la 2, y el rate limit del login en la 3.
