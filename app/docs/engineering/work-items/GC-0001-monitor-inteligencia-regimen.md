---
id: GC-0001
title: Monitor — sección Inteligencia, pestaña Régimen (consulta y review de registros)
status: CLOSED
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: false
review_result: APPROVED
approval_result: APPROVED
---

# GC-0001 — Monitor: sección "Inteligencia", pestaña "Régimen"

Primer work item de GaleCore con el formato del workspace (`ENGINEERING.md`). Autorizado por el
owner el 2026-09-21: integrar consulta y review de régimen en el monitor existente. Rama local
`feature/GC-0001` (desde `master` `102b447`), worktree `.worktrees/galecore/GC-0001`. **Sin push ni
PR** (GaleCore es producción, solo local). Mitad GaleCore-AI: `GC-AI-0004` (adapter). La rama
`feature/pcs-spy-shadow-runtime` y su árbol sucio (SHADOW) no se tocan.

## Objetivo

Desde `source/galecore-monitor` el operador consulta los análisis reales de régimen, compara sus
outcomes y guarda su review humano, con el mismo diseño y navegación del tablero.

## Non-goals

- No generar análisis ni capturar outcomes desde la UI (siguen llegando desde el host).
- No macro, no SHADOW, no desarrollo de estrategias, no pestañas futuras vacías.
- No modificar la API .NET ni ningún endpoint de GaleCore; la pestaña habla solo con el adapter
  local de GaleCore-AI (otro proceso, loopback).
- No calcular nada en el front: estados, comparaciones y claims vienen del adapter.
- No presentar la comparación con el outcome como calificación automática de acierto.

## Alcance

- `src/components/layout/TabNav.tsx`: pestaña **Inteligencia** (ícono Brain) después de RPF.
- `src/App.tsx`: monta `Inteligencia` al entrar.
- `src/pages/Inteligencia.tsx`: encabezado `SectionTitle` + sub-pestañas (solo "Régimen").
- `src/components/inteligencia/`: `RegimeTab` (orquestación), `RegimeToday`, `RegimeHistory`,
  `RegimeDetail` (+ `RegimeFailedDetail`), `ReviewForm`, `ui.tsx` (piezas con el tema del tablero).
- `src/api/regime.ts` (cliente axios propio, sin el interceptor de auth de la API), `src/types/regime.ts`.
- `.env.development`: `REACT_APP_REGIME_ADAPTER_URL=http://127.0.0.1:8765`.
- `src/components/inteligencia/RegimeTab.test.tsx` (14 tests, adapter mockeado).
- `docs/engineering/evidence/gc-0001-monitor/`: procedimiento Playwright reproducible + corrida guardada.

## Criterios de aceptación

- [ ] **AC-01 — Navegación y diseño:** pestaña "Inteligencia" en la barra, sub-pestaña "Régimen",
  encabezado y componentes con las variables/estilos del tablero (`SectionTitle`, `NoticePanel`,
  `.btn`, `.card-interactive`).
- [ ] **AC-02 — Hoy:** tarjeta con "Sin análisis de hoy" o "Análisis disponible" + outcome pendiente /
  review pendiente, según `/api/today` (fecha de la convención, no del navegador).
- [ ] **AC-03 — Historial:** por fecha y símbolo, una fila por `run_id`, estados y anotación
  histórica visibles; días rechazados por `query` marcados y sin contenido.
- [ ] **AC-04 — Detalle:** interpretación, observaciones/implicancias/limitaciones, claims vs facts,
  evidencia, facts, timestamps por fuente, guardrails, host declarado, activos, hashes.
- [ ] **AC-05 — Outcome:** tabla al aceptar / observado / Δ con la leyenda "comparación de datos, no
  calificación de acierto"; "outcome pendiente" cuando no hay.
- [ ] **AC-06 — Review:** formulario agree/partial/disagree + comentario obligatorio + token, sobre
  el `run_id` seleccionado; envía `POST /api/reviews`; la pantalla muestra el día **releído** por
  `query`; errores del adapter (401/403/…) visibles; deshabilitado si el adapter corre `--no-reviews`.
- [ ] **AC-07 — Estados:** sin adapter (cartel con el comando), sin símbolos, sin registros en el
  rango, integridad fallida / lectura inconsistente, anotación F-7 separada del registro.
- [ ] **AC-08 — Validación:** `tsc --noEmit` limpio; tests del front en verde; recorrido en navegador
  dentro del monitor con registros de prueba aislados, incluida escritura y relectura del review.
- [ ] **AC-09 — Review independiente:** `reviewer` interno y Codex sobre el diff.

## Matriz requisito → evidencia

| Criterio | Implementación | Verificación automática | Artefacto reproducible | Estado |
|---|---|---|---|---|
| AC-01 | `TabNav.tsx` (+`'inteligencia'`), `App.tsx`, `pages/Inteligencia.tsx`, `inteligencia/ui.tsx` | `tsc --noEmit`; `e2e_regime_monitor.py` paso `tabs` | `evidence/gc-0001-monitor/run-2026-09-23/run.json` + `01-regimen.png` | IMPLEMENTADO (AC-09 APPROVED) |
| AC-02 | `RegimeToday.tsx` ← `/api/today` | `RegimeTab.test.tsx`: "hoy sin análisis…"; e2e paso `hoy` | GC-AI-0004 `today-QQQ-no-record.json` (NO_RECORD) y `real-dir-readonly-check.json` (`/api/today` real: 21/09 OK, outcome y review presentes); `run.json` paso `hoy` | IMPLEMENTADO (AC-09 APPROVED) |
| AC-03 | `RegimeHistory.tsx` ← `/api/records` (200/409/422 aceptados); `RegimeTab.load` con número de generación (una respuesta tardía de otra consulta se descarta; símbolo y resultados se comprometen juntos) | tests "estados del registro…", "una respuesta tardía de un símbolo anterior no pisa al símbolo actual" | `run-2026-09-23/run.json` pasos `synthetic_days`, `historial` (3 filas) | IMPLEMENTADO (AC-09 APPROVED) |
| AC-04 | `RegimeDetail.tsx` | test "estados del registro…" asegura claims (`igual`), evidencia (`facts.net_gex`), guardrails (`snapshot_integrity`), timestamps por fuente y del snapshot, capability y `entry_hash` | `02-detalle-pendiente.png`; lectura real: `real-dir-readonly-check.json` | IMPLEMENTADO (AC-09 APPROVED) |
| AC-05 | `RegimeDetail.tsx` (tabla Δ + leyenda) | test "estados…": `+2.47`, leyenda; e2e paso `outcome` (leyenda + tabla) | `run.json`, `04-outcome.png` | IMPLEMENTADO (AC-09 APPROVED) |
| AC-06 | `ReviewForm.tsx`, `RegimeTab.submitReview` (token recordado solo tras un 201; "guardado" solo si la relectura trae el review; `reread_error` → "quedó guardado, no reenviar"; la relectura solo reemplaza el registro si la pantalla sigue en ese símbolo), `api/regime.postRegimeReview` | tests "el review se manda…", "un 401…", "un 201 con reread_error…", "un 201 cuya relectura no trae el review…", "la relectura de un review llegada tras cambiar de símbolo…", "reviews deshabilitados…" | `run-2026-09-23/run.json` pasos `review_wrong_token` (401), `review_ok` (201), `review_after_reload`, `cli_reads_review_back`; `03-review-guardado.png` | IMPLEMENTADO (AC-09 APPROVED) |
| AC-07 | `RegimeTab.tsx` (`NoticePanel`, título según `classifyRegimeError`; adapter sin `/api/today` avisado), `RegimeFailedDetail`, anotación en `RegimeDetail` | tests "sin adapter…", "un adapter sin /api/today…", "un error del adapter (500)…", "la anotación F-7…"; e2e paso `integrity_failed` (tarjeta, contenido oculto) | `run.json`, `05-integridad-fallida.png`; anotación F-7 real vista en sesión sobre el dir real (no versionada) | IMPLEMENTADO (AC-09 APPROVED) |
| AC-08 | — | `npx tsc --noEmit` exit 0; `react-scripts test`: 14 passed; `e2e_regime_monitor.py` → `ok: true` (incluye que el CLI relea el comentario exacto y salga 3), sin `pageerror` | `evidence/gc-0001-monitor/run-2026-09-23/` (procedimiento + `run.json` + capturas) | IMPLEMENTADO |
| AC-09 | — | — | review interno R1 → corregido; Codex C1 (`reviews/GC-0001-20260922T001238Z.md`): CHANGES_REQUESTED → corregido; Codex recheck C2 (`reviews/GC-0001-20260923T000849Z.md`): **APPROVE** (5 hallazgos RESOLVED, 3 MINORs nuevos → corregidos, abajo) | IMPLEMENTADO (APPROVE es insumo; el cierre lo pone el owner) |

## Validación requerida

```powershell
cd source\galecore-monitor
npx tsc --noEmit -p tsconfig.json
# en el checkout principal: npm test -- --watchAll=false
# en un worktree bajo .worktrees (directorio con punto, que los globs de jest ignoran):
$env:CI = "true"; npx react-scripts test --watchAll=false --testMatch '**/src/**/*.test.tsx' --testPathIgnorePatterns node_modules App.test
```

## Handoff del implementer — incremento 1 (2026-09-21/22)

**Estado:** READY_FOR_REVIEW (AC-01..AC-08 implementados y verificados en local; AC-09 pendiente).

### Decisiones (rutinarias, dentro del alcance)

- Cliente axios separado (`api/regime.ts`) para que ni el JWT de Supabase ni la API key de GaleCore
  viajen al adapter; el único header extra es `X-Review-Token` en el POST.
- 409/422 de `/api/records` se aceptan como respuesta (traen la lista completa con los días
  marcados), igual que el `exit 3` del CLI trae el JSON.
- El token se pide una vez por pestaña del navegador (`sessionStorage`), nunca se persiste ni va
  en el bundle. Lo imprime el adapter al arrancar (o `REGIME_REVIEW_TOKEN`).
- `since` = `today − N días` se calcula en el front solo como parámetro de filtro; ningún dato
  mostrado se calcula acá.
- Tras guardar, la pantalla muestra el registro que devolvió el adapter (releído por `query`), no
  lo que el formulario mandó.
- Una sola sub-pestaña: no se dibujan pestañas futuras vacías (fuera de alcance).

### Archivos cambiados

- `source/galecore-monitor/src/components/layout/TabNav.tsx` (+pestaña), `src/App.tsx` (+montaje).
- Nuevos: `src/pages/Inteligencia.tsx`, `src/components/inteligencia/{RegimeTab,RegimeToday,RegimeHistory,RegimeDetail,ReviewForm,ui}.tsx`,
  `src/components/inteligencia/RegimeTab.test.tsx`, `src/api/regime.ts`, `src/types/regime.ts`.
- `source/galecore-monitor/.env.development` (+`REACT_APP_REGIME_ADAPTER_URL`).
- Este work item (nuevo directorio `docs/engineering/work-items/` en GaleCore).
- No se tocó: API .NET, otras pestañas, `package.json`/`package-lock.json` (instalación con
  `npm install --no-save` porque el lock está desincronizado con `yaml@2.9.1`, preexistente).

### Comandos y resultados exactos (2026-09-21 ~23:40 UTC, worktree)

```
npx tsc --noEmit -p tsconfig.json                                → exit 0
CI=true npx react-scripts test --watchAll=false --testMatch '**/src/**/*.test.tsx' --testPathIgnorePatterns node_modules App.test
                                                                → Tests: 14 passed, 14 total
python -B docs/engineering/evidence/gc-0001-monitor/e2e_regime_monitor.py <GaleCore-AI GC-AI-0004> → ok = True (run-2026-09-23)
PORT=3039 REACT_APP_REGIME_ADAPTER_URL=http://127.0.0.1:8767 react-scripts start → Compiled successfully!
```

Navegador (Chromium/Playwright, sesión local simulada en `localStorage` porque la API .NET y
Supabase no estaban levantadas; el resto del tablero muestra "Network Error", esperado):
pestañas `MAIN, MONITOR, GEX, RPF, INTELIGENCIA, MI CUENTA`; Régimen con adapter sintético
(`TEST`): hoy sin análisis; historial 3 días; detalle pendiente; review con token malo → alerta
`missing or wrong X-Review-Token (HTTP 401)`; con token correcto → `Review partial guardado en
…/TEST/2026-09-19.md`, tarjeta "Review humano" muestra el comentario; `cli query` lo relee. Con el
directorio real y `--no-reviews`: hoy 2026-09-21 "Análisis disponible · 1 outcome · Review: agree";
2026-09-17 con anotación F-7. Sin `pageerror`. Registros reales byte-idénticos antes/después.

### Gaps y riesgos conocidos

- `App.test.tsx` preexistente en el checkout principal (`learn react`) falla desde antes de este
  item (importa `lightweight-charts` ESM y busca texto que no existe); no está en `master` y no se
  tocó.
- Login real no probado en esta sesión (sin API .NET/Supabase): la pestaña se validó con una
  sesión simulada; el tablero en sí no cambió.
- El adapter y el monitor son dos procesos: si el adapter no corre, la pestaña lo dice y cómo
  arrancarlo; no hay arranque automático.
- Reviews de registros reales: los ingresa el owner (no se escribió ninguno en esta sesión).
- Utilidad no medida todavía frente a la alternativa concreta (correr `query` y `record review` en
  la terminal y leer YAML): se declara como pendiente de comparar en uso real.

## Review interno R1 (agente `reviewer`, Opus, 2026-09-22 ~00:05 UTC) — APPROVE con MINORs → corregidos

Verificado por el reviewer: diseño y navegación del tablero respetados; nada calculado en el front
(estados, Δ y claims vienen del adapter); leyenda "no es calificación de acierto"; review sobre el
`run_id` elegido; registro releído reemplaza la pantalla; sin secretos en el bundle; tipos
consistentes con los modelos Python; `tsc` limpio; 7 tests en verde.

| # | Sev | Hallazgo | Resolución |
|---|---|---|---|
| R1-m1 | MINOR | Con un adapter sin `today` la pestaña quedaba vacía | aviso "Adapter de registros desactualizado"; test |
| R1-m2 | MINOR | Todo error se titulaba "no disponible", incluso un 500 del adapter | `classifyRegimeError`: "respondió con error" vs "no disponible"; test |
| R1-m3 | MINOR | "Guardado" aunque la relectura no trajera el review | éxito solo si la relectura `OK` contiene el review del `run_id`; si no, alerta; test |
| R1-m4 | MINOR | Token guardado antes del POST (un 401 lo dejaba recordado) | se guarda tras el 201 y se borra en 401; test |

## Review independiente 1 (Codex, `--commit 0bb228b`, esfuerzo alto, 2026-09-22T00:12Z) — `docs/engineering/reviews/GC-0001-20260922T001238Z.md`

**Veredicto:** CHANGES_REQUESTED. Codex no pudo ejecutar `node` en su sandbox (`EPERM lstat C:\Users\<user>`,
ambiental): `tsc` y Jest quedaron sin reproducir por él; sí revisó los 14 archivos del commit. El
implementer los volvió a correr tras las correcciones (abajo).

| # | Sev | Hallazgo | Resolución |
|---|---|---|---|
| C1-M1 | MAJOR | `load()` no distinguía consultas en vuelo: una respuesta lenta de SPY podía pisar un QQQ ya mostrado, con detalle y formulario etiquetados QQQ | **Corregido.** Número de generación por consulta; respuestas de consultas viejas se descartan; símbolo y resultados se comprometen juntos; la selección lleva símbolo. Test "una respuesta tardía de un símbolo anterior no pisa al símbolo actual" |
| C1-M2 | MAJOR | La relectura del review reemplazaba el registro solo por fecha: tras cambiar de símbolo, la relectura de SPY podía pisar QQQ de la misma fecha | **Corregido.** Reemplazo solo si `records.symbol === body.symbol` (ídem "Hoy"); mensaje de éxito nombra símbolo y fecha. Test "la relectura de un review llegada tras cambiar de símbolo no toca el símbolo actual" |
| C1-M3 | MAJOR | AC-08 sin evidencia de navegador retenida ni procedimiento reproducible | **Corregido.** `docs/engineering/evidence/gc-0001-monitor/e2e_regime_monitor.py` + `run-2026-09-22/` (`run.json` sanitizado y capturas); lectura del dir real con hashes en GC-AI-0004 `real-dir-readonly-check.json` |
| C1-m1 | MINOR | Artefacto `today-TEST-no-record.json` contenía `INTEGRITY_FAILED` | **Corregido en GC-AI-0004** (`today-QQQ-no-record.json` asertado + `today-TEST.json`); matriz actualizada |
| C1-m2 | MINOR | AC-04 citaba aserciones que el test no hacía | **Corregido.** El test asegura claims, evidencia, guardrails, timestamps, capability y hash |

## Review independiente 2 (Codex, `--recheck`, esfuerzo medio, 2026-09-23T00:08Z) — `docs/engineering/reviews/GC-0001-20260923T000849Z.md`

**Alcance:** `0bb228b..d05a87c` (14 archivos). **Veredicto: APPROVE** — C1-M1, C1-M2, C1-M3, C1-m1 y
C1-m2 RESOLVED. Codex volvió a no poder ejecutar `node` en su sandbox (`EPERM lstat` en el home), así
que `tsc` y Jest siguen sin reproducirse por él: los corrió el implementer (abajo). Corrió sin rebase
sobre `feature/gc-ai-0002` por decisión del owner del 2026-09-22 (solapamiento de archivos nulo entre
las ramas; rebasar hoy se rehace al cerrar la serie AC-08 e invalidaría el rango declarado del review).

Tres MINORs nuevos, corregidos en este incremento:

| # | Sev | Hallazgo | Resolución |
|---|---|---|---|
| C2-m1 | MINOR | El cartel de error del review era global: un fallo tardío de un símbolo podía aparecer en el formulario de otro | `reviewError` guarda símbolo, fecha y `run_id` de origen; el formulario solo lo muestra si coinciden con el run en pantalla. Test "un error de review llegado tras cambiar de símbolo no aparece en el formulario del otro run" |
| C2-m2 | MINOR | El `ok` agregado del e2e ignoraba el contenido y el exit code del CLI | El paso `cli_reads_review_back` exige el comentario exacto en su día (`comment_found`) y `exit_code == 3` (hay un día sintético manipulado); ambos entran en el `ok`. Corrida `run-2026-09-23` |
| C2-m3 | MINOR | El enlace relativo al artefacto de lectura real no resolvía (cruza worktrees) | Reemplazado por la referencia textual al repo e item (GaleCore-AI, GC-AI-0004) |

### Verificación tras las correcciones

- `npx tsc --noEmit` exit 0 · `react-scripts test` 14 passed · `e2e_regime_monitor.py` → `ok: true`
  (`run-2026-09-23`, sin `pageerror`, CLI con el comentario exacto y exit 3).

### Decisión del product owner

- PENDIENTE. `status`, `closure_blocked` y `approval_result` sin cambios; `review_result: APPROVED`
  solo transcribe el veredicto del reviewer. Pendiente de esta mitad: login real con la API .NET
  levantada (validado con sesión simulada) y la medición de utilidad frente a la alternativa de
  terminal.

## Cierre

CLOSED por el owner el 2026-10-04 («cerrá el lote»), integrado en `local/integracion`. Sin push.
