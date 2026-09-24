---
id: GC-0002
title: SHADOW con datos reales — el runtime sin ningún camino ficticio (I2)
status: IN_PROGRESS
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-0002 — SHADOW con datos reales (I2 del plan)

Incremento I2 de [`roadmap/README.md`](../../../../roadmap/README.md), decidido por el owner el
2026-09-24 ("Opción A"). Base: checkpoint `5fa6615` (runtime tal como estaba, con caminos
ficticios) en `feature/pcs-spy-shadow-runtime`; trabajo en `feature/GC-0002-shadow-datos-reales`.
Inventario y gaps de partida: WS-0001 `SHADOW-VALIDATION-DRAFT.md` (G-1, G-2, G-3).

## Objective

Que el runtime SHADOW de GaleCore evalúe, descarte, abra y valúe posiciones **sólo con datos
reales**: si un dato falta, la evaluación se bloquea y queda registrado por qué; nunca se inventa
una métrica, un candidato ni un precio. SHADOW simula la *orden* (no hay broker), nunca el *dato*.

## Decisiones que aplica

- **W-1** (owner, 20/09) y **regla general del 24/09:** datos siempre reales, en todo el ecosistema.
- **W-2** (owner, 20/09): se valida en memoria; reinicio y persistencia son no-goals.
- **Switch OFF** (owner, 24/09): pausa entradas nuevas y sigue monitoreando lo abierto; no borra.
- La spec actual es **de prueba**, no una estrategia (owner, 24/09): se renombra.

## Non-goals

- Persistencia y reinicio (W-2; es I3). Front (I3). Backtest y calidad económica. PAPER/LIVE.
- Estrategias nuevas o elegir una estrategia para SHADOW (I4). Cambiar gates o umbrales de la spec.
- Check de riesgo por % de net liq (necesita datos de cuenta; queda declarado).
- GaleCore-AI: nada del runtime depende de él.

## Acceptance criteria

- [ ] **AC-01 — Sin métricas inventadas:** si el resolver de métricas falla o no devuelve valor, la
  métrica es `NO_DATA`, el gate aplica su `on_no_data` (`BLOCK` en la spec) y no se construye
  candidato. Se elimina `BuildStubMetrics`.
- [ ] **AC-02 — Sin candidato inventado:** si el constructor no produce un candidato real, no hay
  posición y queda un evento de descarte con la razón. Se elimina `BuildStubCandidate`.
- [ ] **AC-03 — Valuación real de posiciones:** el monitor valúa cada posición con el mid real de
  sus patas y el DTE real de su vencimiento; si falta un precio, no evalúa salidas y registra
  `NO_DATA`. Se elimina el decaimiento lineal.
- [ ] **AC-04 — Apagar pausa, no borra:** con el switch OFF no se abren posiciones, las abiertas
  siguen monitoreándose y todo el estado sigue consultable. Se elimina el borrado al apagar.
- [ ] **AC-05 — Trazabilidad:** cada evaluación queda consultable (serie acotada en memoria, no sólo
  la última), con valores por gate; hay eventos para gates que no pasan, `NO_DATA`, candidato no
  viable (con razón) y salida no evaluada por falta de precio.
- [ ] **AC-06 — Spec de prueba con nombre honesto:** la spec se renombra para decir que es una spec
  de prueba del runtime, no una estrategia; su hash cambia y queda registrado.
- [ ] **AC-07 — Sin IA y sin órdenes:** un test impide que el runtime referencie GaleCore-AI o un
  cliente de órdenes del broker.
- [ ] **AC-08 — Demostración en un día hábil real:** con la API local y datos reales: evaluaciones
  con métricas reales, al menos un descarte o entrada explicados, un caso `NO_DATA` forzado que no
  abre posición, valuación real si hay posición, switch OFF que conserva el estado. Evidencia
  sanitizada.
- [ ] **AC-09 — Repositorio:** `dotnet test` pasa (base: 331); tests nuevos para AC-01..AC-05 y AC-07.
- [ ] **AC-10 — Review:** reviewer interno y Codex sobre el diff contra `5fa6615`.

## Requirement-to-evidence matrix

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 | PENDING | PENDING | PENDING | PENDING |
| AC-02 | PENDING | PENDING | PENDING | PENDING |
| AC-03 | PENDING | PENDING | PENDING | PENDING |
| AC-04 | PENDING | PENDING | PENDING | PENDING |
| AC-05 | PENDING | PENDING | PENDING | PENDING |
| AC-06 | PENDING | PENDING | PENDING | PENDING |
| AC-07 | PENDING | PENDING | PENDING | PENDING |
| AC-08 | PENDING | PENDING | PENDING | PENDING |
| AC-09 | PENDING | PENDING | PENDING | PENDING |
| AC-10 | PENDING | PENDING | PENDING | PENDING |

## Implementer handoff

**State:** IMPLEMENTING — primera versión en `be3206a` (357 tests); R1 corregido (ver "Correcciones de R1"),
`dotnet test` 382/382, build de `DataFeed.Api` a directorio temporal sin errores. Siguiente: recheck interno,
después AC-08 en día hábil y Codex.

**Hash de la spec (AC-06, R1-m8)**, `StrategySpecHasher` sobre el archivo:
- antes `pcs_spy_shadow_v1.json` (`5fa6615`): `sha256:09ad790a3d885d13ac13a6ecb1bde402345b7d9333741e4b5741a67764b1139b`
- ahora `shadow_runtime_test_v1.json`: `sha256:91f3fd0a240363f6d77b3f0046e51d3b4e45fe058323b8d13fb81b18622c6ba3`

**Limitaciones declaradas:**
- Sin calendario de feriados: un feriado de NYSE en día hábil cuenta como sesión abierta
  (`ShadowSession`). Cubre noche y fin de semana.
- Si DXLink no informa la hora de la cotización (`EventTime` = 0), la edad no se puede medir y el
  chequeo de frescura no aplica (`OldestQuoteAt` = null, visible en `CANDIDATE_CREATED` como
  "desconocida"). La protección en ese caso es no simular fills ni cierres fuera de sesión.

## Internal review R1 (agente `reviewer`, 2026-09-24 ~02:00 UTC, rango `5fa6615..be3206a`) — CHANGES_REQUESTED, corregido (abajo)

Reprodujo `dotnet test` 357/357 y build de `DataFeed.Api` a directorio temporal (0 errores).

| # | Sev. | Hallazgo | A hacer |
|---|---|---|---|
| R1-B1 | BLOCKER | `MetricResolver.ResolveNetGex` (≈l.106-118): sin griegas u OI, `Strikes` queda vacío y `NetGEX` = 0 inventado, que **pasa** el gate `GEX >= 0` | Devolver null si no hay strikes, sin símbolos con griegas o sin OI > 0; regla en función pura con test |
| R1-B2 | BLOCKER | `PcsCandidateBuilder` (≈l.73-96, 161-201): elige vencimiento/DTE de la cadena (incluye weeklies) pero pide GEX sin `ExpirationTypes` → el handler toma sólo mensuales; strikes, deltas, streamer y quotes pueden ser de **otro** vencimiento que el que se registra (ej. 24/09: weekly 11-03 vs mensual 11-20) | Pasar `ExpirationTypes = {Regular, Weekly}`; rechazar si `gexResponse.Expiration != expirationDate`; DTE desde `gexResponse.DTE` (ET); test del builder con mediator falso |
| R1-M1 | MAJOR | `Snapshot.AsOf = DateTime.UtcNow` hace que el check de frescura del riesgo nunca falle; `LegQuote.AsOf` no se usa; `session_hours` ignorado (fills/cierres fuera de sesión con mids viejos) | Usar tiempos reales de cotización (o "edad desconocida"); no fills ni cierres fuera de sesión, valuación sí; o declararlo |
| R1-M2 | MAJOR | AC-04 sin test de comportamiento (sólo reflexión sobre `Clear`); la lógica del switch vive en `DataFeed.Api`, sin tests | Mover la decisión de tick a Application y testear con switch OFF, o scan de fuente |
| R1-m1 | MINOR | Defaults de parámetros de la spec en el builder (`?? -0.16`, etc.) | Fallar cerrado si la spec no declara el parámetro |
| R1-m2 | MINOR | `ValuePositionAsync`: lado de pata desconocido se valúa como BUY | Reportarlo como problema |
| R1-m3 | MINOR | Comentario "~8 días hábiles" falso (≈2 días a 1/min); el tope de eventos puede desalojar `POSITION_OPENED` de una posición abierta | Corregir número; no desalojar eventos de ciclo de vida |
| R1-m4 | MINOR | `AllEvaluations()` sin uso; monitor salta posición sin spec sólo con log; la pausa no se ve en la instancia | Limpiar / evento / exponer pausa |
| R1-m5 | MINOR | Scan de AC-07 no ve `GaleCoreAI`/`GaleCore.AI` ni `new()` tipado | Ampliar patrones |
| R1-m6 | MINOR | `IRuntimeMarketData.BuildCandidateAsync` es media abstracción: deja el builder sin test | Replantear al corregir R1-B2 |
| R1-m7 | MINOR | Dos relojes (`EvaluatedAt = UtcNow` en el evaluador vs `nowUtc` del motor) | Pasar el reloj |
| R1-m8 | MINOR | AC-06: el cambio de hash no quedó registrado | Registrar hash viejo/nuevo en este item |
| — | riesgo AC-08 | El gate de VIX usa el mid de la cotización; si DXLink no da bid/ask para índices, todo tick será NO_DATA | Verificar en vivo antes de la demo |

### Correcciones de R1

| # | Qué se hizo | Test |
|---|---|---|
| R1-B1 | `MetricResolver.UsableNetGex`: null sin strikes, sin símbolos con griegas o sin OI > 0 (o NaN) | `MetricResolverNetGexTests` |
| R1-B2 | El builder pide griegas con `ExpirationTypes = {Regular, Weekly}`, `TargetDte` = DTE elegido y `MaxDTE` = max de la spec; rechaza si `gexResponse.Expiration` ≠ el elegido; DTE desde la respuesta. DTE de la cadena recalculado en fecha ET (el del proveedor no es confiable) | `PcsCandidateBuilderTests` (mismo vencimiento en todo, request, vencimiento ajeno → sin candidato) |
| R1-M1 | Frescura con `Snapshot.OldestQuoteAt` (hora del proveedor, la más vieja de las patas) contra el reloj del runtime; `AsOf` queda como hora de recepción. `ShadowSession` (session_hours + zona de la spec, lunes a viernes; falla cerrado): fuera de sesión no se evalúan entradas (instancia `OUTSIDE_SESSION`) y el monitor valúa pero no cierra. Feriados y hora desconocida: declarados arriba | `ShadowRiskValidatorTests` (vieja/fresca/desconocida), `ShadowRuntimeTickTests` (sesión, entrada fuera de sesión, monitor fuera de sesión) |
| R1-M2 | La decisión de tick pasó a Application (`ShadowRuntimeTick`); los BackgroundService sólo la llaman. Switch OFF: no evalúa ni abre, instancia en `PAUSED`, nada se borra, el monitor sigue valuando y cerrando | `SwitchOff_PausesEntries_KeepsState_MonitorKeepsValuing` |
| R1-m1 | Sin defaults: si la spec no declara target_delta, delta_tolerance, width, min/max_dte o min_credit, no hay candidato y la razón los nombra | `SpecWithoutParameter_NoCandidate_NoDefault` |
| R1-m2 | Lado de pata desconocido es un problema de valuación (NO_DATA), no una compra | `Valuation_UnknownLegSide_IsAProblem_NotABuy` |
| R1-m3 | Comentario corregido (~7 sesiones con un símbolo); al llegar al tope de eventos nunca se descartan `INSTANCE_CREATED`, `POSITION_OPENED`, `POSITION_CLOSED` | `Store_EventCap_NeverEvictsLifecycleEvents` |
| R1-m4 | Quitados `AllEvaluations`/`GetLastEvaluation`; posición sin spec queda registrada (`VALUATION_NO_DATA` + `ValuationProblems` en la posición); la pausa se ve en `SchedulerState`. `VALUATION_NO_DATA` se registra cuando el problema aparece o cambia, no cada 30 s | `MonitorTick_PositionWithoutSpec_IsRecorded_Once`, `Valuation_NoDataEvent_OnlyWhenTheProblemChanges` |
| R1-m5 | Scan de AC-07: cualquier mención a `*Request` (no sólo `new X`), y `galecore[\s_.-]?ai` | `ShadowRuntimeBoundaryTests` |
| R1-m6 | El builder depende de `IPcsMarketSource` (vencimientos, griegas, cotización), sin MediatR ni logger | `PcsCandidateBuilderTests` |
| R1-m7 | Un reloj: el motor pasa `nowUtc` al evaluador de gates, al builder y al validador de riesgo | `Evaluation_UsesTheRuntimeClock` |
| R1-m8 | Hashes registrados arriba | — |

