---
id: GC-0004
title: SHADOW durable y visible — persistencia, recuperación tras reinicio y pantalla en el monitor (I3)
status: CLOSED
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: false
review_result: APPROVED
approval_result: APPROVED
---

# GC-0004 — SHADOW durable y visible (I3 del plan)

Incremento I3 de [`roadmap/README.md`](../../../../roadmap/README.md), decidido por el owner el
2026-09-24. Base: `gc-0002-closed` (`203553b`, I2 cerrado). Rama local
`feature/GC-0004-shadow-durable`. Sin push ni PR.

## Objective

Que lo que hace el runtime SHADOW **quede guardado y se pueda ver**: posiciones, evaluaciones,
eventos y métricas por versión de spec persisten en PostgreSQL con EF Core, sobreviven un reinicio
de la API (las posiciones abiertas se siguen valuando sin duplicarse ni perder estado) y se ven en
una pestaña del monitor con login real.

## Decisiones que aplica

- **I3 como incremento activo** (owner, 24/09). El PR del GEX queda pendiente, sin push ni PR.
- **Persistencia (owner, 24/09):** PostgreSQL + EF Core + Supabase y las migraciones existentes, con
  la **misma implementación que después va a producción** (nada temporal que haya que reescribir).
  Se prueba en el proyecto Supabase **GaleCore Dev**, creado por el owner en una organización propia
  (plan Free), separada de la organización de producción; los datos de prueba no se mezclan. Todo
  costo se consulta antes. (Supabase local con Docker se evaluó primero y se descartó: ver abajo.)
- **Paso a producción (owner, 24/09):** se documenta cómo se hará cuando el owner lo apruebe; no se
  ejecuta ahora. Mientras tanto la persistencia queda apagada por defecto (`Runtime:Persistence:Enabled`).
- **Login (owner, 24/09):** el mismo flujo de autenticación en desarrollo, con un usuario de prueba y
  su fila en `users`. La persistencia de SHADOW nunca se conecta a producción; no se copian datos
  personales ni credenciales productivas. Los datos de mercado de SHADOW siguen siendo reales.
- **Spec de prueba v2 y parar instancias (owner, 25/09):** para ver al runtime operar, una versión nueva
  `shadow_runtime_test_v2` igual a v1 salvo el gate de GEX, ampliado de `>= 0` a `>= -150` (el GEX de SPY estaba
  en torno a -85 y v1 no entraba). v1 no se modifica. Para desplegar v2 se agrega
  `POST /App/Runtime/Instances/{id}/Stop` (misma implementación que va a producción); las posiciones abiertas de
  una instancia parada se siguen valuando hasta su salida.
- Heredadas: datos siempre reales (W-1, 24/09); apagar el switch pausa entradas y sigue monitoreando
  lo abierto (24/09); no se cambian gates para forzar una operación.

## Non-goals

- I4 (investigación → estrategia), estrategias nuevas, elegir estrategia, PAPER/LIVE.
- El PR del GEX (`fix/gex-oi-lookback`). Ampliar o cerrar GC-0001 (pestaña Inteligencia).
- Afirmar calidad económica: las métricas describen lo que pasó, no si la spec gana plata.
- Ejecutar el paso a producción (migración, configuración, despliegue): sólo se planifica.
- Cambiar gates, umbrales o la spec de prueba, salvo la v2 que pidió el owner el 25/09 (v1 queda igual).

## Acceptance criteria

- [x] **AC-01 — Entorno de desarrollo aislado:** proyecto Supabase GaleCore Dev (Postgres + Auth),
  separado de producción; la cadena completa de migraciones EF se aplica ahí con los mismos dos roles
  que producción; nada del entorno apunta a producción. Script para configurarlo, migrar, preparar el
  usuario de prueba y arrancar API y monitor contra él.
- [x] **AC-02 — Persistencia write-through:** spec (por hash, con su JSON), deployment, instancia,
  evaluaciones, eventos y posiciones se guardan en Postgres **antes** de quedar en memoria. Si la
  base falla, no se abre la posición ni se registra en memoria algo que no quedó guardado.
- [x] **AC-03 — Persistencia sólo donde se prende:** el runtime persiste sólo si el entorno lo prende
  explícitamente (`Runtime:Persistence:Enabled`, apagado en la config versionada). Apagado o sin base,
  no se puede desplegar una instancia (503 con el motivo) y la pantalla lo dice. Producción no lo
  prende hasta la aprobación del owner.
- [x] **AC-04 — Recuperación tras reinicio:** al arrancar se recargan instancias, posiciones y la
  historia reciente de evaluaciones y eventos. Cada instancia sigue con **su** spec por hash (si el
  archivo cambió, se reconstruye del JSON guardado y se verifica el hash; si no se puede, la
  instancia no evalúa y lo dice). Las posiciones abiertas se siguen valuando. No se duplica nada:
  identidades estables, deploy idempotente y una sola instancia RUNNING (garantizada por la base).
- [x] **AC-05 — Métricas por versión de spec**, calculadas en la API desde la base: evaluaciones,
  evaluaciones que pasaron, descartes por motivo, operaciones abiertas y cerradas, P&L realizado y
  no realizado, tasa de acierto, drawdown máximo del P&L realizado. Sin operaciones, los valores
  que no existen son `null` y se dice que no hay operaciones; nada se inventa.
- [x] **AC-06 — Pantalla SHADOW en el monitor:** estado de la instancia, del switch y de la
  persistencia; métricas por versión; evaluaciones recientes con el valor de cada gate; descartes con
  su motivo; posiciones abiertas y cerradas; estado vacío explícito. El front no calcula métricas.
- [x] **AC-07 — Login real en desarrollo:** username → API → Supabase Auth de GaleCore Dev → JWT
  validado por JWKS, con un usuario de prueba y su fila en `users`. Sin datos ni credenciales de
  producción.
- [x] **AC-08 — Demostración:** (1) monitor con login real; (2) evaluaciones, motivos de descarte y
  las operaciones/métricas que existan; (3) reiniciar la API y comprobar que los registros siguen;
  (4) recuperar y continuar el seguimiento de posiciones si existen, sin duplicar. Datos de mercado
  reales. Evidencia que separa lo probado en tests de lo observado en vivo.
- [x] **AC-09 — Repositorio:** `dotnet test` pasa (base 401) con tests nuevos para AC-02..AC-05;
  tests del monitor para AC-06.
- [x] **AC-10 — Review:** una revisión completa (interna + Codex) y rechecks acotados a las
  correcciones necesarias (`ENGINEERING.md` §3).

## Requirement-to-evidence matrix

"Tests" = tests automáticos; "Postgres" = tests contra la base real de GaleCore Dev (`galecore_test`);
"En vivo" = API corriendo contra GaleCore Dev con su rol real (`galecore_api`) y datos de mercado reales.

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 | `dev/galecore_dev.py` (sólo corre contra `ecymbgpimqbtcvqyjtaq`; producción rechazada); proyecto GaleCore Dev (org propia, plan Free, Postgres 17); roles `galecore_ddl`/`galecore_api`; cadena completa de migraciones | — | `env1.json` (migraciones aplicadas, árbol limpio `23233b1`); `env1-roles-grants.json` (**declarado por el host**, consulta MCP) | En vivo: sí (ver artefactos) |
| AC-02 | `ShadowRuntimeStore`, `EfShadowRuntimeRepository` (posición + evento en una transacción; specs antes de registrarse; `seq` para el orden); `Stop` guarda antes de recordar | `ShadowRuntimePersistenceTests`; Postgres: `OpenedPosition_AndItsEvent_…`, `SavingTwice_…` | `env1-dotnet-test.txt` | Tests y Postgres: sí |
| AC-03 | Interruptor `Runtime:Persistence:Enabled` (apagado en `appsettings.json`), 503 en Deploy/Metrics | `ShadowMetricsTests` (PersistenceOff_…, PersistenceIsOffByDefault_…) | `env1.json` (Status con el interruptor prendido) | Tests: sí. En vivo: el caso prendido; el apagado sólo en tests |
| AC-04 | Recuperación, `SpecFor` por hash, `DeployOrGetRunning`, índice `ix_strategy_instances_single_running` | Tests con repositorio falso; Postgres: `SavedRecords_ComeBackAfterRestart…`, `TwoProcesses_…` | `run1-en-sesion.json` (en sesión, árbol limpio `ec77468`); `run0b-fuera-de-sesion.json` | Postgres: sí. En vivo (run1): la misma instancia, 12 evaluaciones y 26 eventos recuperados sin pérdidas ni duplicados; el switch sigue ON y continúa evaluando (12 → 18). En vivo con posición (run2, v2, `b0bbf22` limpio): la posición abierta, las 2 instancias, 4 evaluaciones y 11 eventos sobreviven el reinicio sin duplicados, y la posición se sigue valuando (P&L no realizado -1 → -2); **PASS**. Instancia parada: tests y Postgres (`StoppedInstance_…`) |
| AC-05 | `ShadowMetrics`, `LoadMetricsInputs`, `GET Runtime/Metrics` | `ShadowMetricsTests`; Postgres: `MetricsInputs_…` | `env1.json`; `run1-en-sesion.json` (sin operaciones: `null`, `noTrades`); `run2-en-sesion-v2.json` (v2: 1 abierta, P&L no realizado -2, realizado/acierto/drawdown `null` sin cierres) | Tests, Postgres y en vivo: sí, con y sin operaciones |
| AC-06 | `pages/Shadow.tsx`, `api/shadow.ts`, `types/shadow.ts` | `Shadow.test.tsx` 6/6; `tsc --noEmit` | `monitor_walk.py` → `walk1/` (captura, texto, llamadas) | Tests: sí. En el navegador (headless, Chromium): sí — persistencia, switch ON, instancia RUNNING, métricas de la API con `—` sin operaciones, descartes con su motivo y evaluaciones con el valor de cada gate; todas las llamadas del runtime 200 |
| AC-07 | Mismo flujo que producción contra Auth de GaleCore Dev (ES256 por JWKS, igual que producción); usuario `demo` (admin) con su fila en `users` | — | `env1.json` (`api_smoke`) | En vivo: login 200, `/Me` = demo/admin, sin token 401. Login en el navegador: sí (headless, `walk1/`) |
| AC-08 | `restart_demo.py` + recorrido del owner en el monitor | — | `run1-en-sesion.json` (INCOMPLETE, v1 sin entrada); `run2-en-sesion-v2.json` (**PASS**) | (1) monitor con login real: sí (`walk1/`, headless); recorrido del owner en su navegador: **confirmado por el owner el 25/09** ("lo vi, requiere mejoras visuales pero anda"; mejoras → backlog `BL-016`); (2), (3), (4) en vivo: sí (run2) |
| AC-09 | — | `dotnet test` **441/441, 0 skipped** con `GALECORE_TEST_DB` (base 401; incluye Stop y la spec v2); jest 6/6 | `env2.json` + `env2-dotnet-test.txt` (árbol limpio `e26fea1`); antes `env1-dotnet-test.txt` (432 al `23233b1`) | Sí |
| AC-10 | — | Interno R1 y R2 APPROVE; Codex C1–C2 corregidos, C3 APPROVE; C4 y C5 CHANGES_REQUESTED sobre la evidencia → corregidos; **C6 APPROVE** | `GC-0004-20260925T154157Z.md` (C3), `…164536Z.md` (C4), `…165412Z.md` (C5), `GC-0004-20260925T165744Z.md` (C6) | Sí |

## Hallazgos de probar contra la base real (24/09)

- **Pooler en modo transacción (6543):** sin `No Reset On Close=true;Max Auto Prepare=0`, un `INSERT`
  se confirma en la base pero Npgsql se cuelga leyendo la respuesta (reproducido dos veces; con las
  opciones, funciona). El script de desarrollo las agrega; el plan de producción lo incluye (paso 5).
- **Orden de eventos tras reiniciar:** los eventos de un mismo tick comparten la hora y volvían en
  otro orden. Ahora `evaluation_logs` y `operational_events` tienen `seq` (identity de la base) y la
  recarga ordena por hora y `seq`, con orden estable en memoria. Lo detectó el test de Postgres.

## Supabase local, evaluado y descartado (24/09)

Requería Docker Desktop sobre WSL2 (no instalados; instalación con administrador y reinicio) y el
equipo tiene 11,8 GB de RAM. El owner prefirió un proyecto Supabase de desarrollo en una
organización propia, que prueba lo mismo sin instalar nada. La config de Supabase local se quitó.

## Revisión interna R1 (agente `reviewer`, 24/09, `gc-0002-closed..cd41711`) — CHANGES_REQUESTED

Reprodujo `dotnet test` 428/3 skipped, jest 6/6, `tsc`, `git diff --check`.

| # | Sev. | Hallazgo | Resolución |
|---|---|---|---|
| M1 | MAJOR | Deploy no atómico: dos POST simultáneos crean dos instancias | `DeployOrGetRunning` bajo lock; test concurrente (16 deploys → 1 instancia) |
| M2 | MAJOR | La migración `AddShadowRuntime` está en la cadena que, sin `GALECORE_DB`, apunta a producción | **Resuelto por decisión del owner (24/09):** es la misma implementación que va a producción, por la cadena normal, cuando él la apruebe (plan abajo). El script de desarrollo siempre pasa `GALECORE_DB` |
| M3 | MAJOR | `ActiveInstance` no determinística; con dos versiones RUNNING podía evaluar cualquiera | Una sola instancia RUNNING: deploy de otra versión → 409 con la que corre; `ActiveInstance` = la más vieja |
| m1 | MINOR | La recuperación perdía eventos de ciclo de vida viejos (tope 20000) | Se recargan todos los de ciclo de vida + los últimos N del resto |
| m2 | MINOR | Escrituras de varias filas no transaccionales; comentario de `Deploy` equivocado | Comentario corregido: puede quedar una instancia sin su evento, nunca memoria sin base. Métricas no dependen de eventos |
| m3 | MINOR | Comentario del test apuntaba a un script inexistente | Corregido; además el test de Postgres sólo corre contra una base `*_test` (vacía tablas) |
| m4 | MINOR | `UpdatedAt` cambiaba en memoria sin guardarse | Si el estado no cambia, no se toca nada |
| n1–n3 | NIT | SQL con f-strings en el script (valores generados, no explotable); puerto de Supabase local; microsegundos | Aceptados; lo de Supabase local ya no aplica |

## Revisión independiente Codex C1 (`GC-0004-20260924T215421Z.md`, base `203553b..392934b`) — CHANGES_REQUESTED

Reprodujo 430/3 skipped (vstest; NuGet bloqueado en su sandbox), jest 6/6, tsc, ruff, `diff --check`.

| # | Sev. | Hallazgo | Resolución |
|---|---|---|---|
| C1-M1 | MAJOR | Specs de archivo registradas en memoria antes de guardarse | La recuperación las guarda y recién después las registra; si falla, no se registra nada (test `SpecCannotBeSaved_…`) |
| C1-M2 | MAJOR | Posición y su evento de apertura/cierre en escrituras separadas | Una transacción (`SavePosition(posición, evento)`); memoria después. Tests `DatabaseDownAtTheFill_…`, `ClosingAPosition_…`, `OpenedPosition_AndItsEvent_…` (Postgres) |
| C1-M3 | MAJOR | "Una instancia RUNNING" sólo con lock en memoria | Índice único parcial en la base (`ix_strategy_instances_single_running`, como la cuenta de sistema); el conflicto entre procesos devuelve 409. Test `TwoProcesses_…` (Postgres) |
| C1-M4 | MAJOR | Migración en la cadena de producción | Decisión del owner: es la cadena que va a producción, cuando él apruebe (igual que R1-M2) |
| C1-M5 | MAJOR | El runner podía dar PASS sin haber visto nada | PASS sólo con todo HTTP 200, persistencia disponible, nada perdido ni duplicado en el reinicio **y** en la continuación, evaluaciones antes y después, y posiciones revaluadas; si el mercado no lo permite, INCOMPLETE con lo que faltó |
| C1-m1 | MINOR | Drawdown dependía del orden con salidas simultáneas | Las salidas del mismo instante son un paso (test `SimultaneousExits_…`) |
| C1-m2 | MINOR | Roadmap con referencias viejas a `pcs_spy_shadow_v1` | Corregido |

## Recheck Codex C2 (`GC-0004-20260924T225600Z.md`, `392934b..c81d6cb`) — CHANGES_REQUESTED

C1-M1, M2, M3, M5, m1 y m2: resueltos; C1-M4: decisión del owner. Hallazgos nuevos:

| # | Sev. | Hallazgo | Resolución |
|---|---|---|---|
| C2-B1 | BLOCKER | `galecore_dev.py init` aceptaba cualquier URL: por error se podía migrar o persistir SHADOW en producción | El script sólo corre contra `ecymbgpimqbtcvqyjtaq` (GaleCore Dev); el ref de producción se rechaza explícitamente; se revalida en cada comando (probado: producción y otro proyecto → exit 1) |
| C2-M1 | MAJOR | La matriz afirmaba verificaciones en vivo (roles, permisos, `/Me`, 401) sin artefacto | `dev_env_evidence.py` → `env1.json` + `env1-dotnet-test.txt` desde árbol limpio; roles y permisos en `env1-roles-grants.json`, marcados como declarados por el host |
| C2-M2 | MAJOR | `run0` corrido con árbol sucio y etiquetado "Supabase local en Docker" | Retirado; `run0b` desde árbol limpio con el entorno correcto (proyecto, auth, rol) |

## Spec v2, Stop y corrida run2 (25/09, pedido del owner)

v1 parada por `POST …/Stop` (200; el segundo Stop, `alreadyStopped`), v2 desplegada; deploy de v1 → 409.
El primer tick de v2 sin dato de GEX (arranque); el siguiente pasó gates, armó el candidato (SELL 731 P / BUY 726 P
2026-11-06, 42 DTE, delta -0,16, crédito 0,44) y abrió la posición `640b16f2…`; después, `ENTRY_SKIPPED` por el
máximo 1/1. **run2** (`--spec shadow_runtime_test_v2 --minutes 3 --after 3`, `b0bbf22` limpio): **PASS**.

**Revisión interna R2 (agente `reviewer`, `c6774bb..b0bbf22`) — APPROVE**, sin BLOCKER/MAJOR:

| # | Sev. | Hallazgo | Resolución |
|---|---|---|---|
| R2-m1 | MINOR | Las posiciones abiertas de una instancia parada se valúan pero no se listan en la pestaña (sólo en métricas) | Limitación declarada (v1 nunca abrió) |
| R2-m2 | MINOR | Si el evento INSTANCE_STOPPED no se guarda, un reintento no lo repone | Aceptado: mismo patrón que el deploy; memoria nunca sin base |
| R2-m3 | MINOR | Deploy y Stop no exigen admin (el switch sí) | Decidido por el owner (25/09): exigen admin, antes de producción → `D-0003` |
| R2-m4 | MINOR | Sin tests del contrato HTTP de Stop | Registrado (Deploy tampoco los tiene); la lógica está cubierta en el store |
| R2-m5 | MINOR | Sin test de v2 fuera de Postgres | `TestSpecV2_LoadsAndItsParentIsTheUnchangedV1`, `TestSpecV2_DiffersFromV1OnlyInTheGexGate` |
| R2-m6 | MINOR | Matriz sin Stop/v2 | Actualizada |
| n1–n5 | NIT | Conteo de abiertas fuera del lock; mismo outcome para switch/parada; instancia nula deja pasar; guard bloquea PENDING→RUNNING; Stop de FAILED dice alreadyStopped | Aceptados |

## Recorrido del monitor walk1 (25/09, ~15:50 UTC, headless) — a pedido del owner

API y monitor de `dev/galecore_dev.py` contra GaleCore Dev; `monitor_walk.py` (Playwright/Chromium) entra con
`demo` por el login real y abre SHADOW. La pantalla muestra lo de run1 más las evaluaciones nuevas (20), con
fechas en hora local del navegador (el reloj del encabezado está en ET). Las únicas respuestas no-200 son 409 de
`/Data/Tastytrade/Account/*`: `demo` no tiene cuenta de bróker (lo dice la barra lateral); no es de SHADOW.
El script se agregó después de C3 (sólo evidencia, sin cambios de código de la API ni del monitor).

## Recheck Codex C3 (`GC-0004-20260925T154157Z.md`, `c81d6cb..8381797`) — APPROVE

C2-B1, C2-M1 y C2-M2: resueltos; C1-M4: decisión del owner. Sin hallazgos nuevos. Reprodujo 427 + 5
Postgres skipped (sin `GALECORE_TEST_DB` en su sandbox; la corrida contra GaleCore Dev es `env1-dotnet-test.txt`),
jest 6/6, tsc, ruff, `diff --check`, rechazo de producción en `init`. Los artefactos en vivo los verificó por
procedencia y consistencia, sin re-ejecutarlos. El APPROVE no cambia estado: cierra el owner.

## Recheck Codex C4 (`GC-0004-20260925T164536Z.md`, `8381797..b1edb9b`) — CHANGES_REQUESTED

Sin hallazgos de código. Reprodujo 435 + 6 Postgres skipped, jest 6/6, tsc, ruff.

| # | Sev. | Hallazgo | Resolución |
|---|---|---|---|
| C4-M1 | MAJOR | AC-08 afirmaba el recorrido del owner en su navegador sin artefacto | Headless con artefacto (`walk1/`); el del owner, pendiente de su confirmación al cierre (C5) |
| C4-M2 | MAJOR | 441/441 con Postgres sin artefacto | `env2.json` + `env2-dotnet-test.txt` desde árbol limpio `e26fea1` (migraciones, 441/441, API) |
| C4-m1 | MINOR | `walk-shadow.txt` con espacios finales: `git diff --check` fallaba | Limpio; `monitor_walk.py` ya no los genera |
| C4-m2 | MINOR | Deploy/Stop sin admin | Decisión del owner antes de producción (= R2-m3) |

## Recheck Codex C5 (`GC-0004-20260925T165412Z.md`, `b1edb9b..e7284bb`) — CHANGES_REQUESTED

C4-M2 y C4-m1 resueltos. Abiertos: C4-M1 (el chat no es evidencia: el recorrido del owner queda pendiente de su
confirmación) y C5-m1 (AC-10 figuraba "Sí" con C4 en CHANGES_REQUESTED → pendiente). Ambos corregidos en la matriz.

## Recheck Codex C6 (`GC-0004-20260925T165744Z.md`, `e7284bb..f3bdbe3`) — APPROVE

C4-M1 y C5-m1 resueltos; sin hallazgos nuevos. Quedan como decisiones del owner: la migración en la cadena de
producción (C1-M4) y si Deploy/Stop exigen admin (R2-m3). El APPROVE no cambia estado: cierra el owner.

## Paso a producción (plan; no se ejecuta sin aprobación del owner)

Es la misma implementación: nada se reescribe, sólo se aplica y se configura.

1. **Aprobación del owner** del incremento (GC-0004 cerrado) y del paso a producción.
2. **Reunificación:** la rama local va a `master` por PR, que el owner pide explícitamente
   (`ENGINEERING.md` §4: lo nuevo no se pushea sin su pedido). Incluye la migración `AddShadowRuntime`.
3. **Migración revisable:** `dotnet ef migrations script 20260901151007_AddAccountClientSecret
   AddShadowRuntime --idempotent` genera el SQL exacto (6 tablas + índices); se revisa antes.
4. **Aplicación** con el rol `galecore_ddl` de producción (su credencial la tiene el owner; nunca
   pasa por el chat). Se verifica que `galecore_api` tenga SELECT/INSERT/UPDATE/DELETE en las tablas
   nuevas (privilegios por defecto o `GRANT` explícito).
5. **Permisos ([`D-0003`](../../../decisiones/D-0003-shadow-deploy-stop-solo-admin.md)):** Deploy y Stop exigen admin
   con `CanManagePlatformAsync`; verificado con admin (200) y no-admin (403) antes de seguir.
6. **Configuración:** `Runtime__Persistence__Enabled=true` en App Settings de la API de producción.
   El switch del runtime sigue en OFF (config versionada) hasta que el owner lo prenda. **La cadena
   `ConnectionStrings:GaleCore` de producción (pooler en modo transacción, 6543) tiene que incluir
   `No Reset On Close=true;Max Auto Prepare=0`**: comprobado en GaleCore Dev el 24/09 que sin eso un
   `INSERT` se confirma pero el cliente se cuelga leyendo la respuesta (la API de producción hoy casi
   no escribe, por eso no se vio). Verificarlo antes de prender la persistencia.
7. **Despliegue** de la API y del monitor (pestaña SHADOW).
8. **Verificación:** `GET /App/Runtime/Status` → persistencia disponible y recuperación vacía; deploy
   de la spec que el owner elija; una evaluación en sesión queda en `evaluation_logs`.
9. **Vuelta atrás:** `Runtime__Persistence__Enabled=false` detiene persistencia y despliegues sin
   tocar datos; las tablas se pueden quitar con el `Down` de la migración si el owner lo decide.

## Decisiones del owner pendientes

- Ninguna. GC-0004 cerrado por el owner el 25/09.

## Cierre (owner, 25/09)

**CLOSED.** El owner confirmó el cierre con la evidencia y las revisiones aprobadas (interna R2, Codex C6).
Quedan fuera y registrados: las mejoras visuales en `BL-016` y los permisos admin de Deploy/Stop como
requisito antes de producción (`D-0003`). SHADOW no está en producción; el paso a producción sigue el plan de
abajo cuando el owner lo apruebe. Siguiente trabajo activo: piloto de I4 (GC-AI-0006).

## Decisiones del owner del 25/09 (tras C6)

- Recorrido visual: lo hizo; anda y requiere mejoras visuales → `BL-016` (backlog), fuera de I3.
- Deploy y Stop exigen admin → [`D-0003`](../../../decisiones/D-0003-shadow-deploy-stop-solo-admin.md), paso 5 del
  plan de producción; no amplía I3.
- No se amplía el runtime (multiinstancia, multi-ticker, acciones); se sigue con la v2. Multiinstancia, multi-ticker y acciones quedan **postergados, no descartados** → addendum
  en `BL-007`, se retoma al comparar dos propuestas concretas. Sin incremento previo a I4.
- 403 de Tastytrade en `RpfLoopService` → `BL-015`, sin corregirlo en I3.
- API y monitor quedan corriendo contra GaleCore Dev para el owner; switch e instancia sin cambios.

## Corrida en sesión run1 (25/09, 15:17–15:41 UTC, `ec77468` limpio) — INCOMPLETE

Switch ON, 15 min, reinicio, 8 min. 12 evaluaciones y 26 eventos antes; los mismos después del reinicio,
sin duplicados, la misma instancia `95e58d15…`; luego 18 evaluaciones y 38 eventos. 0 pasaron gates
(`GATES_NOT_PASSED` 18, 1 bloque sin datos), 0 posiciones: métricas de P&L en `null` con `noTrades`.
Único faltante: posiciones abiertas para ver su recuperación en vivo. Observado aparte (fuera de SHADOW):
`RpfLoopService` recibe 403 de Tastytrade en `AccountPositions`/`AccountBalances` en sesión.

## Limitaciones declaradas

- Un solo runtime SHADOW a la vez (una instancia RUNNING); para cambiar de versión se para la que corre
  (`POST /App/Runtime/Instances/{id}/Stop`, sin botón en el monitor). Las posiciones abiertas de una instancia
  parada se siguen valuando y cuentan en las métricas de su versión, pero la pestaña lista las de la instancia
  que corre.
- Las contraseñas de los roles de desarrollo y del usuario `demo` las genera el script y quedan en
  `dev/.local/env.json` (fuera de git); son de un proyecto con datos de prueba. El usuario `demo` se
  creó por SQL en `auth.users`/`auth.identities` de GaleCore Dev (el MCP no tiene alta de usuarios).
- La instancia desplegada en las corridas fuera de sesión quedó RUNNING en GaleCore Dev (switch OFF): la próxima corrida la retoma.

## Implementer handoff

**State:** CLOSED (owner, 25/09) — código completo; interno R1 y Codex C1 corregidos; GaleCore Dev configurado
(migraciones, roles, usuario de prueba, login real verificado, 432/432); corrida en sesión run1 INCOMPLETE
sólo por falta de entrada del mercado; Codex C3 APPROVE; recorrido del monitor hecho. Por pedido del owner, spec v2 + Stop: run2 **PASS** con posición real; interna R2 APPROVE. Codex C6 APPROVE; recorrido del owner confirmado. Falta sólo su confirmación explícita de cierre.
