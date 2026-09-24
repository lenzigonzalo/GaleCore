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
| AC-01 | `ShadowRuntimeEngine.EvaluateEntryAsync` (métrica sin dato → NO_DATA → BLOCK); `MetricResolver.UsableNetGex` y `UsableQuotePrice`; `BuildStubMetrics` eliminado | `ShadowRuntimeEngineTests` (MetricsProviderDown_…, OneMetricMissing_…), `MetricResolverNetGexTests`, `MetricResolverQuoteTests` | `dotnet test` 385/385 | Verificado en tests |
| AC-02 | `PcsCandidateBuilder` → `CandidateBuildResult` con razón; evento `CANDIDATE_NOT_VIABLE`; `BuildStubCandidate` eliminado | `ShadowRuntimeEngineTests` (BuilderRejects_…, BuilderThrows_…, CandidateWithoutLegQuote_…), `PcsCandidateBuilderTests` | ídem | Verificado en tests |
| AC-03 | `ShadowRuntimeEngine.ValuePositionAsync` (mid real por pata, DTE en fecha ET, NO_DATA sin precio); decaimiento lineal eliminado | `ShadowRuntimeEngineTests` (Valuation_*) , `ShadowRuntimeTickTests.MonitorTick_OutsideSession_…` | ídem | Verificado en tests |
| AC-04 | `ShadowRuntimeTick.RunEntryTickAsync` (switch OFF → `PAUSED`, no evalúa) y `RunMonitorTickAsync` (sin switch); store sin borrado | `ShadowRuntimeTickTests.SwitchOff_PausesEntries_KeepsState_MonitorKeepsValuing`, `Store_HasNoWayToWipeTheState` | ídem | Verificado en tests; en vivo en AC-08 |
| AC-05 | `ShadowRuntimeStore` (historial acotado, eventos de ciclo de vida no se descartan); eventos por gate, NO_DATA, descarte y valuación sin precio | `EveryEvaluationIsKept_NotOnlyTheLast`, `Store_*`, `Valuation_NoDataEvent_OnlyWhenTheProblemChanges` | ídem | Verificado en tests |
| AC-06 | `shadow_runtime_test_v1.json` (renombrada); hashes viejo/nuevo en el handoff | `RuntimeSpecJsonTests` | hashes abajo | Verificado |
| AC-07 | Runtime sólo pide cadena, griegas y cotización | `ShadowRuntimeBoundaryTests` (patrones ampliados en R1-m5) | ídem | Verificado en tests |
| AC-08 | API local desde la rama, Development, 24/09 17:05-17:40 UTC (mercado abierto); corridas 3 y 4 con el código de `07501d1`/`e3eb613` y `docs/evidence/gc-0002/ac08_capture.py` (cada request con hora, SHA, payload y respuesta) | — | `ac08-run3-forced-nodata.jsonl`, `ac08-run4-real-and-off.jsonl` (y las corridas 1-2, previas a Codex C1) | Hecho salvo candidato/fill/valuación en vivo (ver "AC-08, 24/09") |
| AC-09 | Tests nuevos para AC-01..05 y AC-07 | `dotnet test source/galecore-datafeed/DataFeed.Tests/DataFeed.Tests.csproj` → 398/398 (base 331) | `docs/evidence/gc-0002/dotnet-test-e3eb613.txt` | Verificado |
| AC-10 | — | Interno R1 CHANGES_REQUESTED → corregido; recheck R2 APPROVE (MINORs corregidos); Codex C1 CHANGES_REQUESTED → corregido (abajo) | `docs/engineering/reviews/GC-0002-20260924T171716Z.md` | Codex recheck PENDING |

## Implementer handoff

**State:** IMPLEMENTING — interno R2 APPROVE; Codex C1 CHANGES_REQUESTED con sus MAJOR corregidos
(`07501d1`) salvo uno que decide el owner (edad de cotización desconocida, ver "Codex C1");
`dotnet test` 398/398; AC-08 hecho en vivo salvo candidato/fill/valuación (GEX negativo todo el día).
El owner aceptó la hora desconocida como limitación (C1-M1, `BL-013`). Siguiente: Codex `--recheck`.

**Hash de la spec (AC-06, R1-m8)**, `StrategySpecHasher` sobre el archivo:
- antes `pcs_spy_shadow_v1.json` (`5fa6615`): `sha256:09ad790a3d885d13ac13a6ecb1bde402345b7d9333741e4b5741a67764b1139b`
- ahora `shadow_runtime_test_v1.json`: `sha256:91f3fd0a240363f6d77b3f0046e51d3b4e45fe058323b8d13fb81b18622c6ba3`
- 24/09, decisión del owner en AC-08 (VIX por Trade, abajo): `sha256:68add468f142baaca705797e34ca4ad40fcc1bf4d20e20578e996b5daaacd076`

**Decisión del owner (24/09, durante AC-08):** en vivo, DXLink publica el Quote de VIX sin bid/ask
(`NaN`), así que el gate `vix_absolute` era NO_DATA en todo tick. El VIX real llega por Trade (así lo
leen RPF y GEX). El owner eligió leerlo de ahí: `metric_ref` → `capability:market_data.trade.VIX.price`
(`MetricResolver.UsableTradePrice`: sin precio positivo, sin hora del trade o con un trade más viejo
que la tolerancia = NO_DATA). El umbral
VIX < 30 no cambia. Evidencia de la corrida anterior: `docs/evidence/gc-0002/ac08-run1-vix-quote.json`.

**Limitaciones declaradas:**
- Sin calendario de feriados: un feriado de NYSE en día hábil cuenta como sesión abierta
  (`ShadowSession`). Cubre noche y fin de semana.
- Si DXLink no informa la hora de la cotización (`EventTime` = 0, confirmado en vivo), la edad no
  se puede medir y el chequeo de frescura no aplica a esa pata (`QuotesWithoutTime` en el snapshot y
  en `CANDIDATE_CREATED`). La protección en ese caso es no simular fills ni cierres fuera de sesión.
  **Aceptado por el owner el 24/09** (Codex C1-M1); la mejora de fondo quedó en el backlog de
  GaleCore-AI como `BL-013` (pedir a DXLink la hora de bid/ask).

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

## Internal recheck R2 (agente `reviewer`, 2026-09-24, rango `5fa6615..6e73ef0`) — APPROVE

Reprodujo 382/382 y el build de la API a directorio temporal. Los 12 hallazgos de R1 resueltos o
declarados; sin BLOCKER ni MAJOR ni regresiones. MINORs, corregidos en el commit siguiente (385/385):

| # | Hallazgo | Corrección |
|---|---|---|
| m-a | Línea en blanco al final de este archivo (`git diff --check`) | Quitada |
| m-b | Matriz de evidencia toda en PENDING | Completada |
| m-c | El VIX usaba el mid sin `QuoteRules.IsUsable` (bid 0 / ask 20 daba 10 y pasaba el gate); previo al item, cae en AC-01 | `MetricResolver.UsableQuotePrice` + `MetricResolverQuoteTests` |
| m-d | `ShadowSession` sin fallback a la zona de Windows: sesión cerrada para siempre en un host sin ICU | Prueba el id IANA y su equivalente de Windows |
| m-e | Con 0DTE, `TargetDte = 0` hace que el handler elija el de mayor DTE | El builder rechaza 0DTE con la razón explícita + test |

## AC-08, 24/09 (API local desde la rama, mercado abierto)

Evidencia sin credenciales en `docs/evidence/gc-0002/`. Reproducir (API local en
`http://localhost:7001`, `ASPNETCORE_ENVIRONMENT=Development`, `dotnet run --project
source/galecore-datafeed/DataFeed.Api/DataFeed.Api.csproj --no-launch-profile`):

```
python docs/evidence/gc-0002/ac08_capture.py <log> deploy <spec>
python docs/evidence/gc-0002/ac08_capture.py <log> switch on
python docs/evidence/gc-0002/ac08_capture.py <log> wait-evals <instance_id> 2 300
python docs/evidence/gc-0002/ac08_capture.py <log> snapshot <instance_id> before-off
python docs/evidence/gc-0002/ac08_capture.py <log> switch off
python docs/evidence/gc-0002/ac08_capture.py <log> wait-state <instance_id> PAUSED 200
python docs/evidence/gc-0002/ac08_capture.py <log> snapshot <instance_id> after-off   # >2 ticks después
```

Cada línea del log tiene hora UTC, `repo_head`, request (método, ruta, payload), status y respuesta.

- **Corrida 3, NO_DATA forzado** (`ac08-run3-forced-nodata.jsonl`, código `07501d1`, 17:31-17:33
  UTC): la API arrancó con una copia de la spec (`shadow_runtime_forced_nodata_v1.json`, en la
  carpeta de evidencia; sólo cambian nombre, id y el `metric_ref` de VIX, que apunta a un símbolo
  inexistente) copiada **sin commitear** en `Files/Runtime` y borrada después; por eso el log dice
  `07501d1` con el árbol no limpio. Hash `sha256:60f2a8fd…`. Dos evaluaciones: `METRICS_NO_DATA` →
  VIX NO_DATA → `GATES_NOT_PASSED`; 0 posiciones.
- **Corrida 4, spec real y switch OFF** (`ac08-run4-real-and-off.jsonl`, `e3eb613`, árbol limpio,
  17:34-17:40 UTC): evaluación 1: VIX 15.70 (PASS) y **GEX NO_DATA**: el primer barrido después de
  arrancar no tuvo cobertura completa y la regla nueva lo bloqueó (C1-M4 actuando sobre datos
  reales); evaluación 2: VIX 15.71 (PASS), GEX −87.4 (FAIL) → descarte explicado. Switch OFF: con
  más de dos ticks, 2 evaluaciones y 6 eventos iguales antes y después, 0 posiciones, instancia
  `RUNNING` / `PAUSED`.
- **Corridas 1 y 2** (previas a Codex C1, sin script de captura; `ac08-run1-vix-quote.json`,
  `ac08-run2-*.json`): Quote de VIX con bid/ask `NaN` → NO_DATA real, que llevó a la decisión de leer
  VIX por Trade; con Trade, VIX 15.48 y GEX −83.6 → descarte; switch OFF conservando estado.
- **No demostrado en vivo:** construcción de candidato, fill y valuación real. Con GEX negativo todo
  el día el gate corta antes (comportamiento correcto de la spec). Esos caminos quedan cubiertos
  sólo por tests con datos falsos; verlos en vivo requiere un día con GEX ≥ 0.
- **Confirmado en vivo:** el Quote de DXLink trae `eventTime` 0 (frescura de patas no medible) y la
  cobertura del GEX de SPY fue 442/442 en tres corridas seguidas a las ~17:20 UTC.
- El override del switch persiste en disco: al reiniciar, la API arranca con el último valor
  puesto, no "inerte". Comportamiento previo del `PlatformServiceSwitch`, fuera de este item; el
  switch quedó OFF al terminar.

## Independent review Codex C1 (`docs/engineering/reviews/GC-0002-20260924T171716Z.md`, modo `base`, `5fa6615..50dbb05`) — CHANGES_REQUESTED

Codex no pudo correr `dotnet test` ni el build (su sandbox no llega a NuGet); recalculó los tres
hashes (coinciden) y comparó las corridas 2 antes/después del OFF. Corregido en `07501d1` (398/398):

| # | Hallazgo | Resolución |
|---|---|---|
| C1-M1 | Cotización sin hora saltea la frescura; hora futura pasa; una pata sin hora enmascaraba una vieja | **Parcial.** Hora futura rechazada (`DataFreshness`, tolerancia 5 s); cada pata se valida por separado en el builder; `OldestQuoteAt` = la más vieja entre las que tienen hora y `QuotesWithoutTime` cuenta las otras. **Rechazar la hora desconocida: disputado, decisión del owner (24/09) de aceptarla como limitación declarada:** DXLink manda el Quote con `EventTime` 0 (confirmado en vivo), así que exigir hora hace que el runtime no pueda cotizar ninguna pata nunca. Mejora de fondo: `BL-013`. Tests `StaleLeg_NoCandidate_EvenIfTheOtherHasNoTime`, `FutureLegTime_NoCandidate`, `FutureQuoteTime_Rejected`, `Freshness_StaleFutureUnknown` |
| C1-M2 | VIX por Trade sin chequeo de antigüedad | Trade viejo (> 150 s) o con hora futura = NO_DATA. `StaleOrFutureTrade_IsNoData` |
| C1-M3 | La valuación no mira la hora de las cotizaciones | Pata vieja o futura → `VALUATION_NO_DATA`, sin salidas. `Valuation_StaleLegQuote_IsNoData_AndNeverCloses` |
| C1-M4 | Net GEX con cobertura parcial | Exige griegas de todos los símbolos pedidos y OI de calls y de puts (en vivo: 442/442). `PartialCoverage_OrOneSidedOi_IsNoData`; en vivo bloqueó un barrido incompleto (corrida 4) |
| C1-M5 | Switch apagado mientras se piden datos igual abre | El switch se consulta de nuevo justo antes del fill → `ENTRY_ABORTED`. `Entry_SwitchTurnedOffWhileBuilding_NoPosition` |
| C1-M6 | Infinito pasa `IsUsable` | Bid/ask, crédito, riesgo y valor del spread tienen que ser finitos. `QuoteRules_RejectNonFinite`, `InfiniteQuote_NeverReachesTheCandidate` |
| C1-M7 | AC-08 sin procedencia reproducible ni NO_DATA forzado | Script `ac08_capture.py`, corrida 3 (forzado) y 4 (real + OFF), salida de tests guardada |
| C1-m1 | Estado del handoff contradictorio | Actualizado |
