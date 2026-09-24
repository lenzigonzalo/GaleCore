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

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 | | | | Pendiente |
| AC-02 | | | | Pendiente |
| AC-03 | | | | Pendiente |
| AC-04 | | | | Pendiente |
| AC-05 | | | | Pendiente |
| AC-06 | | | | Pendiente |
| AC-07 | | | | Pendiente |
| AC-08 | | | | Pendiente |
| AC-09 | | | | Pendiente |
| AC-10 | | | | Pendiente |

## Evaluación de Supabase local (24/09)

Requisitos: Docker (Docker Desktop sobre WSL2) y la CLI de Supabase (se usa por `npx`, sin
instalar nada global). Equipo: Windows 11, i7-1065G7 (8 hilos), 11,8 GB de RAM (1,9 GB libres al
medir), 87 GB libres en disco, hipervisor presente; **sin WSL2 ni Docker instalados**. Viable
levantando sólo lo que el flujo usa (Postgres, Auth y el gateway) y excluyendo Studio, Storage,
Realtime, Edge Functions, logs y analytics. Intervención del owner: instalar WSL2 y Docker Desktop
(requieren administrador y un reinicio).

## Implementer handoff

**State:** IMPLEMENTING.
