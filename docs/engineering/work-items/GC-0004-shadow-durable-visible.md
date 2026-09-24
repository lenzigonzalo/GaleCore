---
id: GC-0004
title: SHADOW durable y visible — persistencia, recuperación tras reinicio y pantalla en el monitor (I3)
status: IMPLEMENTING
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: false
review_result: PENDING
approval_result: PENDING
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
- Heredadas: datos siempre reales (W-1, 24/09); apagar el switch pausa entradas y sigue monitoreando
  lo abierto (24/09); no se cambian gates para forzar una operación.

## Non-goals

- I4 (investigación → estrategia), estrategias nuevas, elegir estrategia, PAPER/LIVE.
- El PR del GEX (`fix/gex-oi-lookback`). Ampliar o cerrar GC-0001 (pestaña Inteligencia).
- Afirmar calidad económica: las métricas describen lo que pasó, no si la spec gana plata.
- Ejecutar el paso a producción (migración, configuración, despliegue): sólo se planifica.
- Cambiar gates, umbrales o la spec de prueba.

## Acceptance criteria

- [ ] **AC-01 — Entorno de desarrollo aislado:** proyecto Supabase GaleCore Dev (Postgres + Auth),
  separado de producción; la cadena completa de migraciones EF se aplica ahí con los mismos dos roles
  que producción; nada del entorno apunta a producción. Script para configurarlo, migrar, preparar el
  usuario de prueba y arrancar API y monitor contra él.
- [ ] **AC-02 — Persistencia write-through:** spec (por hash, con su JSON), deployment, instancia,
  evaluaciones, eventos y posiciones se guardan en Postgres **antes** de quedar en memoria. Si la
  base falla, no se abre la posición ni se registra en memoria algo que no quedó guardado.
- [ ] **AC-03 — Persistencia sólo donde se prende:** el runtime persiste sólo si el entorno lo prende
  explícitamente (`Runtime:Persistence:Enabled`, apagado en la config versionada). Apagado o sin base,
  no se puede desplegar una instancia (503 con el motivo) y la pantalla lo dice. Producción no lo
  prende hasta la aprobación del owner.
- [ ] **AC-04 — Recuperación tras reinicio:** al arrancar se recargan instancias, posiciones y la
  historia reciente de evaluaciones y eventos. Cada instancia sigue con **su** spec por hash (si el
  archivo cambió, se reconstruye del JSON guardado y se verifica el hash; si no se puede, la
  instancia no evalúa y lo dice). Las posiciones abiertas se siguen valuando. No se duplica nada:
  identidades estables, deploy idempotente y una sola instancia RUNNING (garantizada por la base).
- [ ] **AC-05 — Métricas por versión de spec**, calculadas en la API desde la base: evaluaciones,
  evaluaciones que pasaron, descartes por motivo, operaciones abiertas y cerradas, P&L realizado y
  no realizado, tasa de acierto, drawdown máximo del P&L realizado. Sin operaciones, los valores
  que no existen son `null` y se dice que no hay operaciones; nada se inventa.
- [ ] **AC-06 — Pantalla SHADOW en el monitor:** estado de la instancia, del switch y de la
  persistencia; métricas por versión; evaluaciones recientes con el valor de cada gate; descartes con
  su motivo; posiciones abiertas y cerradas; estado vacío explícito. El front no calcula métricas.
- [ ] **AC-07 — Login real en desarrollo:** username → API → Supabase Auth de GaleCore Dev → JWT
  validado por JWKS, con un usuario de prueba y su fila en `users`. Sin datos ni credenciales de
  producción.
- [ ] **AC-08 — Demostración:** (1) monitor con login real; (2) evaluaciones, motivos de descarte y
  las operaciones/métricas que existan; (3) reiniciar la API y comprobar que los registros siguen;
  (4) recuperar y continuar el seguimiento de posiciones si existen, sin duplicar. Datos de mercado
  reales. Evidencia que separa lo probado en tests de lo observado en vivo.
- [ ] **AC-09 — Repositorio:** `dotnet test` pasa (base 401) con tests nuevos para AC-02..AC-05;
  tests del monitor para AC-06.
- [ ] **AC-10 — Review:** una revisión completa (interna + Codex) y rechecks acotados a las
  correcciones necesarias (`ENGINEERING.md` §3).

## Requirement-to-evidence matrix

"Tests" = tests automáticos; "Postgres" = tests contra la base real de GaleCore Dev (`galecore_test`);
"En vivo" = API corriendo contra GaleCore Dev con su rol real (`galecore_api`) y datos de mercado reales.

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 | `dev/galecore_dev.py` (sólo corre contra `ecymbgpimqbtcvqyjtaq`; producción rechazada); proyecto GaleCore Dev (org propia, plan Free, Postgres 17); roles `galecore_ddl`/`galecore_api`; cadena completa de migraciones | — | `env1.json` (migraciones aplicadas, árbol limpio `23233b1`); `env1-roles-grants.json` (**declarado por el host**, consulta MCP) | En vivo: sí (ver artefactos) |
| AC-02 | `ShadowRuntimeStore`, `EfShadowRuntimeRepository` (posición + evento en una transacción; specs antes de registrarse; `seq` para el orden) | `ShadowRuntimePersistenceTests`; Postgres: `OpenedPosition_AndItsEvent_…`, `SavingTwice_…` | `env1-dotnet-test.txt` | Tests y Postgres: sí |
| AC-03 | Interruptor `Runtime:Persistence:Enabled` (apagado en `appsettings.json`), 503 en Deploy/Metrics | `ShadowMetricsTests` (PersistenceOff_…, PersistenceIsOffByDefault_…) | `env1.json` (Status con el interruptor prendido) | Tests: sí. En vivo: el caso prendido; el apagado sólo en tests |
| AC-04 | Recuperación, `SpecFor` por hash, `DeployOrGetRunning`, índice `ix_strategy_instances_single_running` | Tests con repositorio falso; Postgres: `SavedRecords_ComeBackAfterRestart…`, `TwoProcesses_…` | `run0b-fuera-de-sesion.json` (árbol limpio `f29355b`) | Postgres: sí. En vivo: la instancia sobrevive el reinicio sin perder ni duplicar; **INCOMPLETE** (fuera de sesión: sin evaluaciones ni posiciones) |
| AC-05 | `ShadowMetrics`, `LoadMetricsInputs`, `GET Runtime/Metrics` | `ShadowMetricsTests`; Postgres: `MetricsInputs_…` | `env1.json` (Metrics sin operaciones: valores `null`, `noTrades`) | Tests y Postgres: sí. En vivo con evaluaciones: pendiente (sesión) |
| AC-06 | `pages/Shadow.tsx`, `api/shadow.ts`, `types/shadow.ts` | `Shadow.test.tsx` 6/6; `tsc --noEmit` | — | Tests: sí. En el navegador: pendiente |
| AC-07 | Mismo flujo que producción contra Auth de GaleCore Dev (ES256 por JWKS, igual que producción); usuario `demo` (admin) con su fila en `users` | — | `env1.json` (`api_smoke`) | En vivo: login 200, `/Me` = demo/admin, sin token 401. Login en el navegador: pendiente (recorrido del owner) |
| AC-08 | `restart_demo.py` + recorrido del owner en el monitor | — | `run0b-fuera-de-sesion.json` (INCOMPLETE) | Pendiente: corrida en sesión y recorrido del owner |
| AC-09 | — | `dotnet test` **432/432, 0 skipped** con `GALECORE_TEST_DB` (base 401); jest 6/6 | `env1-dotnet-test.txt` | Sí |
| AC-10 | — | Interno R1, Codex C1 y recheck C2 CHANGES_REQUESTED → corregidos | `GC-0004-20260924T215421Z.md`, `GC-0004-20260924T225600Z.md` | Recheck C3 de Codex pendiente |

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
5. **Configuración:** `Runtime__Persistence__Enabled=true` en App Settings de la API de producción.
   El switch del runtime sigue en OFF (config versionada) hasta que el owner lo prenda. **La cadena
   `ConnectionStrings:GaleCore` de producción (pooler en modo transacción, 6543) tiene que incluir
   `No Reset On Close=true;Max Auto Prepare=0`**: comprobado en GaleCore Dev el 24/09 que sin eso un
   `INSERT` se confirma pero el cliente se cuelga leyendo la respuesta (la API de producción hoy casi
   no escribe, por eso no se vio). Verificarlo antes de prender la persistencia.
6. **Despliegue** de la API y del monitor (pestaña SHADOW).
7. **Verificación:** `GET /App/Runtime/Status` → persistencia disponible y recuperación vacía; deploy
   de la spec que el owner elija; una evaluación en sesión queda en `evaluation_logs`.
8. **Vuelta atrás:** `Runtime__Persistence__Enabled=false` detiene persistencia y despliegues sin
   tocar datos; las tablas se pueden quitar con el `Down` de la migración si el owner lo decide.

## Decisiones del owner pendientes

- Ninguna de diseño. Pendiente de ejecución: la demostración en sesión.

## Limitaciones declaradas

- Un solo runtime SHADOW a la vez (una instancia RUNNING); cambiar de versión requiere parar la
  instancia, y no hay endpoint para eso (no lo pide I3).
- Las contraseñas de los roles de desarrollo y del usuario `demo` las genera el script y quedan en
  `dev/.local/env.json` (fuera de git); son de un proyecto con datos de prueba. El usuario `demo` se
  creó por SQL en `auth.users`/`auth.identities` de GaleCore Dev (el MCP no tiene alta de usuarios).
- La instancia desplegada en las corridas fuera de sesión quedó RUNNING en GaleCore Dev (switch OFF): la próxima corrida la retoma.

## Implementer handoff

**State:** IMPLEMENTING — código completo; interno R1 y Codex C1 corregidos; GaleCore Dev configurado
(migraciones, roles, usuario de prueba, login real verificado, 432/432). Falta el recheck de Codex, la
corrida en sesión y el recorrido del owner en el monitor.
