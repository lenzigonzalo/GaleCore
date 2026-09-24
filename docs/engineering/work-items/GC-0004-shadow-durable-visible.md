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
- **Persistencia (owner, 24/09):** PostgreSQL + EF Core + Supabase, como en producción, en un
  entorno de desarrollo **aislado y reutilizable**. Primero Supabase local; si no es viable, se
  explica un proyecto Supabase de desarrollo separado y su costo **antes** de crearlo. Nada de
  SQLite ni JSON como persistencia temporal. Se mantienen las migraciones EF existentes.
- **Login (owner, 24/09):** el mismo flujo de autenticación en desarrollo, con un usuario de prueba y
  su fila en `users`. La persistencia de SHADOW nunca se conecta a producción; no se copian datos
  personales ni credenciales productivas. Los datos de mercado de SHADOW siguen siendo reales.
- Heredadas: datos siempre reales (W-1, 24/09); apagar el switch pausa entradas y sigue monitoreando
  lo abierto (24/09); no se cambian gates para forzar una operación.

## Non-goals

- I4 (investigación → estrategia), estrategias nuevas, elegir estrategia, PAPER/LIVE.
- El PR del GEX (`fix/gex-oi-lookback`). Ampliar o cerrar GC-0001 (pestaña Inteligencia).
- Afirmar calidad económica: las métricas describen lo que pasó, no si la spec gana plata.
- Llevar las tablas de SHADOW a la base de producción (es otra decisión del owner).
- Cambiar gates, umbrales o la spec de prueba.

## Acceptance criteria

- [ ] **AC-01 — Entorno de desarrollo aislado:** Supabase local (Postgres + Auth) reproducible desde
  config versionada; las migraciones EF existentes y la nueva se aplican ahí; nada del entorno
  apunta a producción. Scripts para levantarlo, preparar el usuario de prueba y arrancar API y
  monitor contra él.
- [ ] **AC-02 — Persistencia write-through:** spec (por hash, con su JSON), deployment, instancia,
  evaluaciones, eventos y posiciones se guardan en Postgres **antes** de quedar en memoria. Si la
  base falla, no se abre la posición ni se registra en memoria algo que no quedó guardado.
- [ ] **AC-03 — Nunca en producción:** el runtime persiste sólo en una base local (loopback). Sin
  base, o con una base que no es local, no se puede desplegar una instancia (503 con el motivo) y la
  pantalla lo dice.
- [ ] **AC-04 — Recuperación tras reinicio:** al arrancar se recargan instancias, posiciones y la
  historia reciente de evaluaciones y eventos. Cada instancia sigue con **su** spec por hash (si el
  archivo cambió, se reconstruye del JSON guardado y se verifica el hash; si no se puede, la
  instancia no evalúa y lo dice). Las posiciones abiertas se siguen valuando. No se duplica nada:
  identidades estables y deploy idempotente por versión.
- [ ] **AC-05 — Métricas por versión de spec**, calculadas en la API desde la base: evaluaciones,
  evaluaciones que pasaron, descartes por motivo, operaciones abiertas y cerradas, P&L realizado y
  no realizado, tasa de acierto, drawdown máximo del P&L realizado. Sin operaciones, los valores
  que no existen son `null` y se dice que no hay operaciones; nada se inventa.
- [ ] **AC-06 — Pantalla SHADOW en el monitor:** estado de la instancia, del switch y de la
  persistencia; métricas por versión; evaluaciones recientes con el valor de cada gate; descartes con
  su motivo; posiciones abiertas y cerradas; estado vacío explícito. El front no calcula métricas.
- [ ] **AC-07 — Login real en desarrollo:** username → API → Supabase Auth local → JWT validado por
  JWKS, con un usuario de prueba y su fila en `users`. Sin datos ni credenciales de producción.
- [ ] **AC-08 — Demostración:** (1) monitor con login real; (2) evaluaciones, motivos de descarte y
  las operaciones/métricas que existan; (3) reiniciar la API y comprobar que los registros siguen;
  (4) recuperar y continuar el seguimiento de posiciones si existen, sin duplicar. Datos de mercado
  reales. Evidencia que separa lo probado en tests de lo observado en vivo.
- [ ] **AC-09 — Repositorio:** `dotnet test` pasa (base 401) con tests nuevos para AC-02..AC-05;
  tests del monitor para AC-06.
- [ ] **AC-10 — Review:** una revisión completa (interna + Codex) y rechecks acotados a las
  correcciones necesarias (`ENGINEERING.md` §3).

## Requirement-to-evidence matrix

"Tests" = probado en tests automáticos; "En vivo" = observado corriendo contra el entorno local con
datos de mercado reales. Nada de lo "en vivo" pasó todavía: falta Docker (ver abajo).

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 | `dev/galecore_dev.py` (`check`, `up`, `seed-user`, `api`, `monitor`, `test`, `down`), `dev/supabase/config.toml`, roles `galecore_ddl`/`galecore_api`, migración `AddShadowRuntime` | `galecore_dev.py check` (detecta que falta Docker) | salida de `up` | Implementado; **no ejecutado** (sin Docker) |
| AC-02 | `ShadowRuntimeStore` (repositorio antes que memoria), `EfShadowRuntimeRepository` | `ShadowRuntimePersistenceTests` (OpenedPosition_IsSaved…, DatabaseDown_…, DatabaseDownAtTheFill_…, InstanceState_…); `EfShadowRuntimeRepositoryTests` contra Postgres | — | Tests con repositorio falso: sí. Contra Postgres: **skipped** hasta tener base local |
| AC-03 | `ShadowPersistenceGuard`, `ShadowRuntimePersistenceStatus`, 503 en Deploy/Metrics | `ShadowMetricsTests` (LocalDatabase_…, RemoteDatabase_…, MissingDatabase_…) | — | Tests: sí. En vivo: pendiente |
| AC-04 | `ShadowRuntimeRecovery`, `Hydrate`, `SpecFor` por hash, `DeployOrGetRunning` (una instancia RUNNING, bajo lock), `ActiveInstance` determinística | `AfterRestart_*`, `RecoveringTwice_*`, `RecoveryFails_*`, `Deploy_*` (incluye concurrente), `ActiveInstance_*`; `SavedRecords_ComeBackAfterRestart…` contra Postgres | `docs/evidence/gc-0004/restart_demo.py` | Tests con repositorio falso: sí. Postgres y en vivo: pendiente |
| AC-05 | `ShadowMetrics`, `EfShadowRuntimeRepository.LoadMetricsInputs`, `GET Runtime/Metrics` | `ShadowMetricsTests`; `MetricsInputs_…` contra Postgres | — | Cálculo: sí. Desde la base: pendiente |
| AC-06 | `pages/Shadow.tsx`, `api/shadow.ts`, `types/shadow.ts`, pestaña en `TabNav`/`App` | `Shadow.test.tsx` 6/6; `tsc --noEmit` | — | Tests: sí. En el navegador: pendiente |
| AC-07 | Mismo flujo de login contra Auth local; `RequireHttpsMetadata` sólo para issuer loopback | — | — | Implementado; **no ejecutado** |
| AC-08 | `restart_demo.py` + recorrido tuyo en el monitor | — | `docs/evidence/gc-0004/<run>.json` | Pendiente: Docker + día hábil en sesión |
| AC-09 | — | `dotnet test` 430 pass / 3 skipped (base 401); jest 6/6 | — | Parcial: faltan los 3 de Postgres |
| AC-10 | — | Interno R1 CHANGES_REQUESTED → corregido (abajo) | — | Codex pendiente |

## Evaluación de Supabase local (24/09)

Requisitos: Docker (Docker Desktop sobre WSL2) y la CLI de Supabase (se usa por `npx`, sin
instalar nada global). Equipo: Windows 11, i7-1065G7 (8 hilos), 11,8 GB de RAM (1,9 GB libres al
medir), 87 GB libres en disco, hipervisor presente; **sin WSL2 ni Docker instalados**. Viable
levantando sólo lo que el flujo usa (Postgres, Auth y el gateway) y excluyendo Studio, Storage,
Realtime, Edge Functions, logs y analytics. Intervención del owner: instalar WSL2 y Docker Desktop
(requieren administrador y un reinicio).

## Revisión interna R1 (agente `reviewer`, 24/09, `gc-0002-closed..cd41711`) — CHANGES_REQUESTED

Reprodujo `dotnet test` 428/3 skipped, jest 6/6, `tsc`, `git diff --check`.

| # | Sev. | Hallazgo | Resolución |
|---|---|---|---|
| M1 | MAJOR | Deploy no atómico: dos POST simultáneos crean dos instancias | `DeployOrGetRunning` bajo lock; test concurrente (16 deploys → 1 instancia) |
| M2 | MAJOR | La migración `AddShadowRuntime` está en la cadena que, sin `GALECORE_DB`, apunta a producción | **Decisión del owner** (abajo). Mitigación: el entorno dev siempre pasa `GALECORE_DB`; la rama no se reunifica sin esa decisión |
| M3 | MAJOR | `ActiveInstance` no determinística; con dos versiones RUNNING podía evaluar cualquiera | Una sola instancia RUNNING: deploy de otra versión → 409 con la que corre; `ActiveInstance` = la más vieja |
| m1 | MINOR | La recuperación perdía eventos de ciclo de vida viejos (tope 20000) | Se recargan todos los de ciclo de vida + los últimos N del resto |
| m2 | MINOR | Escrituras de varias filas no transaccionales; comentario de `Deploy` equivocado | Comentario corregido: puede quedar una instancia sin su evento, nunca memoria sin base. Métricas no dependen de eventos |
| m3 | MINOR | Comentario del test apuntaba a un script inexistente | Corregido; además el test de Postgres sólo corre contra una base `*_test` (vacía tablas) |
| m4 | MINOR | `UpdatedAt` cambiaba en memoria sin guardarse | Si el estado no cambia, no se toca nada |
| n1–n3 | NIT | SQL con f-strings en el script (valores generados, no explotable); puerto 54322 con contraseña por defecto; microsegundos | Aceptados; ver limitaciones |

## Decisiones del owner pendientes

1. **M2 — tablas de SHADOW y la cadena de migraciones de producción.** Hoy la migración vive sólo en
   esta rama local. Si algún día se reunifica con `master`, el próximo `database update` a producción
   crearía las 6 tablas (vacías; SHADOW no escribe ahí por el guard). Opciones: (a) no reunificar
   esta migración hasta decidir llevar SHADOW a producción (recomendado: no cuesta nada hoy);
   (b) contexto/historial de migraciones separado para el runtime. No bloquea I3.

## Limitaciones declaradas

- Un solo runtime SHADOW a la vez (una instancia RUNNING); cambiar de versión requiere parar la
  instancia, y no hay endpoint para eso (no lo pide I3).
- Sin Docker en este equipo: nada del entorno local ni los 3 tests de Postgres se ejecutaron aún.
- Supabase local publica Postgres en :54322 con la contraseña por defecto de la CLI; sólo tiene datos
  de prueba. Versión de Postgres local 17 (la de producción no se verificó).

## Implementer handoff

**State:** IMPLEMENTING — código completo y revisado internamente; falta Codex, el entorno local
(Docker) y la demostración en vivo.
