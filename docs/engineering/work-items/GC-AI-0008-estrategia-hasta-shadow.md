---
id: GC-AI-0008
title: Una estrategia completa desde la investigación hasta SHADOW, con seguimiento que vuelve a la investigación
status: IN_PROGRESS
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-0008 — Estrategia completa hasta SHADOW y retroalimentación (I4, integración)

Origen: pedido del owner del 27/09/2026 (sesión nueva): priorizar investigación → estrategia completa →
aprobación → SHADOW → seguimiento → retroalimentación. Autoriza los cambios locales necesarios; **no** autoriza
órdenes reales, PAPER/LIVE, cambios en producción ni push/PR de GaleCore. Continúa `roadmap/README.md` §4 I4;
reutiliza el método de GC-AI-0006 (piloto, abierto) y la investigación de GC-AI-0007.


## Punto de retorno documental (29/09; prevalece sobre pendientes históricos)

La copia de main quedó rezagada respecto del worktree de GC-AI-0009. Consultar el
[review del 28/09](../../../../.worktrees/galecore-ai/GC-AI-0009/docs/engineering/reviews/GC-AI-0009-20260928T221056Z.md)
y la [matriz vigente de 0009](../../../../.worktrees/galecore-ai/GC-AI-0009/docs/engineering/work-items/GC-AI-0009-seguimiento-recurrente.md).
AC-06 de 0008 tiene respaldo y `every_minutes` está resuelto. No repetir esos trabajos.
Pendientes: automática por horario desde main, revisión de evidencia de controles ya capturada,
recheck del arreglo posterior de `rebind` y consolidación de referencias antes del cierre del owner.
Esta nota no modifica estados de aceptación ni fabrica evidencia; el orden está en roadmap §4.

## Acuerdo breve (ENGINEERING §3)

- **Problema:** hay investigación retomable y un runtime SHADOW durable, pero no un camino controlado entre
  ambos: ninguna propuesta separa reglas fundamentadas, hipótesis y parámetros pendientes; nada dice qué reglas
  ejecuta realmente GaleCore; el `Deploy` de GaleCore no mira ninguna aprobación; y lo que pasa en SHADOW no
  vuelve a la investigación.
- **Qué vas a poder hacer:** pedir «desarrollá esta estrategia hasta SHADOW» desde el catálogo; recibir la
  propuesta completa, el mapa regla → comportamiento de GaleCore (con lo no soportado declarado) y una
  `StrategySpec` validada con su hash; aprobar esa versión exacta; verla desplegada en SHADOW de desarrollo;
  y pedir «¿qué hizo esta estrategia desde la última revisión…?» con respuesta guardada en su investigación.
- **Primera demostración:** la candidata recomendada, con su chequeo contra el runtime y el hash coincidente
  con el que calcula GaleCore; tras tu aprobación, desplegada en GaleCore Dev, y una evaluación real (entrada,
  descarte o bloqueo) explicada.
- **Qué falta para correrla:** tus decisiones de riesgo/utilidad, la aprobación de la versión exacta y la
  autorización para parar `shadow_runtime_test_v2` (una sola instancia RUNNING; su posición abierta se sigue
  valuando al parar). Sesión de mercado para una evaluación en sesión.
- **Fuera:** otro motor, soporte nuevo de reglas en el runtime, multiinstancia, host propio, gestor de modelos,
  plataforma de conectores, PAPER/LIVE, producción, afirmar rentabilidad.

## Acceptance criteria

- [ ] **AC-01 — Recorrido descubrible:** entrada `strategy_design` en el catálogo con su skill y su flujo
  (propuesta → chequeo → aprobación → despliegue → seguimiento).
- [ ] **AC-02 — Propuesta completa con procedencia:** hipótesis, entrada, construcción, sizing, monitoreo,
  ajustes, salidas, invalidación y plan de evaluación; cada regla dice si es fundamentada, hipótesis, parámetro
  pendiente, decisión del owner o elección de diseño, con sus fuentes.
- [ ] **AC-03 — Regla → runtime, sin omisiones silenciosas:** cada regla declara su comportamiento en GaleCore
  (soportada con el campo que la ejecuta, no soportada, no aplica); el chequeo rechaza una regla "soportada" que
  el runtime no consume y una spec que declara comportamiento que el runtime ignora.
- [ ] **AC-04 — Spec versionada y validada:** `StrategySpec` con el hash calculado como GaleCore (verificado
  contra los hashes que GaleCore ya calculó) y revalidada por GaleCore al cargarla.
- [ ] **AC-05 — Aprobación atada a la versión:** tu aprobación queda registrada (create-only) con nombre,
  versión y hash exactos; el despliegue se niega si el hash que reporta GaleCore no es el aprobado.
- [ ] **AC-06 — SHADOW de desarrollo:** desplegada en GaleCore Dev después de la aprobación; una evaluación real
  con su resultado explicado (entrada, descarte o bloqueo legítimo; sin tocar umbrales).
- [ ] **AC-07 — Seguimiento y retroalimentación:** el pedido «¿qué hizo esta estrategia…?» lee GaleCore, lo
  vincula a la versión, separa funcionamiento operativo / resultados SHADOW / evidencia económica y se guarda
  como revisión de la investigación.
- [ ] **AC-08 — Revisión:** interna y Codex; utilidad y cierre los decide el owner.

## Requirement-to-evidence matrix

| Criterio | Implementación | Verificación automática | Artefacto | Estado |
|---|---|---|---|---|
| AC-01 | `config/catalog.yaml` (`strategy_design`, `strategy_followup`), `config/skills/strategy-design/skill.yaml` 0.3.1 (continúa el piloto 0.2.0-draft), `config/skills/strategy-followup/skill.yaml` | `test_catalog_offers_the_strategy_path`, catálogo en `test_knowledge.py` | `cli catalog` lista 6 capacidades | Implementado; verificado local |
| AC-02 | `contracts/strategy.py` (`ProposalContent`: bloques obligatorios, `basis` por regla, plan de evaluación) | `test_every_block_needs_a_rule`, `test_grounded_rules_cite_and_unsupported_rules_explain`, `test_evaluation_plan_needs_dependence_and_sample_sufficiency` | `strategy:spy_prima_varianza_30_45d/1.0.3` (22 reglas; 1.0.0–1.0.2 guardadas, nunca aprobadas) | Implementado; propuesta real guardada |
| AC-03 | `application/strategy.py` (`check_proposal`, tabla de soporte leída del código de GaleCore `bc62f22`) | `test_candidate_is_valid_with_its_declared_gaps`, `test_owner_draft_spec_is_refused_for_what_the_runtime_ignores`, `test_a_spec_promising_behavior_the_runtime_ignores_is_invalid` (5), `test_an_unmapped_field_fails_closed`, `test_fields_with_a_single_runtime_semantics_are_fixed` (4), `test_every_gate_leaf_is_validated` (5), y más | Chequeo real: `VALID_WITH_DECLARED_GAPS`, declaradas E3, E4, S2, R2, M2; `pcs_spy_16d_v1` → `INVALID` (sizing RISK_BASED, riesgo %, analytics_refs) | Implementado; verificado local |
| AC-04 | `galecore_spec_hash`; spec en GaleCore `Files/Runtime/spy_prima_varianza_30_45d.json` (rama local `feature/GC-AI-0008-estrategia-shadow`) | `test_hash_equals_the_one_galecore_computed` (v1, v2 contra los hashes persistidos en GaleCore Dev); GaleCore `StrategySpecVersionTests` (su loader: carga, valida, hash 1.0.3 `sha256:19884e77…`) | 16/16 tests de specs en GaleCore | Implementado; revalidado con el código de GaleCore |
| AC-05 | `approve`, `deploy_check` (create-only, hash), `galecore_dev.py deploy --approval` (relee aprobación y propuesta, verifica sus hashes y el cargado por GaleCore) | `test_approval_needs_the_exact_hash`, `test_deploy_is_refused_without_approval_or_with_another_hash`, `test_an_edited_approval_blocks_the_deploy`, `test_cli_save_approve_deploy_check` | `knowledge/strategies/spy_prima_varianza_30_45d/1.0.3.approval.json` (frase del owner, 27/09 20:20 local, HOST_DECLARED por diseño) | Implementado; **aprobación real registrada** (ver «Decisión del owner y despliegue») |
| AC-06 | Deploy Dev con aprobación/hash; evaluación real de 1.0.3 | Revisión independiente del payload | [Review del 28/09](../../../../.worktrees/galecore-ai/GC-AI-0009/docs/engineering/reviews/GC-AI-0009-20260928T221056Z.md), sección Evidence matrix check | Respaldado; cierre del item pendiente |
| AC-07 | `application/followup.py`, `followup run/history`, `strategy_followup` 0.2.0, `galecore_dev.py runtime-report` | `tests/unit/test_followup.py` (6) | 2 seguimientos reales (`knowledge/followups/spy_prima_varianza_30_45d/`), evidencia directa, revisión `result` de la investigación | Implementado y ejecutado con datos reales; sin resultados SHADOW de esta versión hasta desplegarla |
| AC-08 | — | — | — | Pendiente |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```

## Estado inicial verificado (27/09)

- `pcs_spy_16d_v1.json`: archivo **sin trackear** en GaleCore (`Files/Runtime/`, 26/09), nota «estrategia simple
  del owner», nunca desplegado ni aprobado. Declara `sizing RISK_BASED 5 %`, que el runtime no ejecuta.
- GaleCore Dev (lectura SQL, 27/09): `shadow_runtime_test_v2` **RUNNING** (desde 25/09) con **una posición OPEN**
  (SPY 731/726 P, vence 06/11, crédito 0,44, −$0,50 no realizado, valuada por última vez el 26/09 17:15 UTC);
  `shadow_runtime_test_v1` STOPPED. Advisor de Supabase: RLS deshabilitado en las 9 tablas (ver hallazgos).
- Runtime (código de `feature/GC-0004-shadow-durable`, `bc62f22`): una sola instancia RUNNING; `Stop` deja de
  entrar y sigue valuando lo abierto; las specs se cargan de `Files/Runtime/*.json` **al arrancar** y GaleCore
  calcula su hash (JCS + SHA-256); `Deploy` no verifica ninguna aprobación.

## Hallazgos (27/09)

- **La API de GaleCore Dev no está corriendo.** En :7001 escucha un `DataFeed.Api` lanzado el 26/09 19:20 con
  `dotnet run --no-launch-profile --urls http://localhost:7001` **sin** la configuración de GaleCore Dev (login → 503
  «falta ConnectionStrings:GaleCore»); no lo lanzó esta sesión. La instancia v2 figura RUNNING en la base pero nadie la
  evalúa desde el 26/09 17:15 UTC. Desplegar exige reemplazarlo por `galecore_dev.py api` (mismo puerto), lo que
  además reactiva v2 hasta pararla. Se hace con la autorización del owner, junto con la aprobación.
- **RLS deshabilitado** en las 9 tablas de GaleCore Dev (advisor de Supabase, nivel crítico): cualquiera con la anon key
  puede leer y modificar las filas. La API usa roles propios (`galecore_api`), no la anon key; en producción debe
  resolverse antes de activar la persistencia (plan de GC-0004). No se aplicó nada.
- Las skills `gc-*` de `GaleCore/.claude/skills` (08/09) están ignoradas por git y apuntan a documentos que ya no
  existen; ningún código las usa. Se siguió `StrategySpec`, que es lo que ejecuta el runtime.
- `tools/work_item.py start` crea la rama desde el HEAD del checkout principal (`feature/GC-AI-0005`); GC-AI-0008 se
  creó con `git worktree add` desde `feature/GC-AI-0007` porque necesita su código. Sin claim registrado.

## Inventario de lo que tiene que volver a GaleCore (rama local, sin push)

`feature/GC-AI-0008-estrategia-shadow` (desde `feature/GC-0004-shadow-durable`): la spec de la estrategia, su test
de hash y `dev/galecore_dev.py` (`deploy --expect-hash`, `stop`, `runtime-report`). Nada toca el código del runtime.

## Revisión interna R1 (agente `reviewer`, Sonnet, `778201b..8cc97f6` + GaleCore HEAD) — CHANGES_REQUESTED

Re-corrió gate PASS, ruff, pytest completo (762) y `diff --check`; contrastó cada entrada de la tabla de soporte con el
código del runtime de GaleCore sin encontrar clasificaciones erróneas; verificó con el encoder real de .NET los escapes.

| # | Sev. | Hallazgo | Resolución |
|---|---|---|---|
| R1-M1 | MAJOR | `galecore_spec_hash` no reproducía `UnsafeRelaxedJsonEscaping` para U+2028/2029 ni para caracteres fuera del BMP | Corregido: esos casos, controles C1, `\b` y `\f` se escapan como .NET (formas observadas por el reviewer); además el chequeo rechaza strings no ASCII en la spec, así un caso no reproducido no llega a una aprobación (+2 tests) |
| R1-M2 | MAJOR | El hash de la candidata no estaba fijado en los tests de este repo | Corregido: `spy_prima_varianza_30_45d.json` en `GALECORE_HASHES` (mismo valor que `StrategySpecVersionTests` de GaleCore) |
| R1-m1 | MINOR | `deploy --expect-hash` hace GET y después POST | Aceptado: ambos leen la spec cargada una vez al arrancar; sólo un reinicio de la API entre las dos llamadas podría cambiarla |
| R1-m2 | MINOR | El hash se transcribe a mano entre repos | Aceptado: un error sólo produce un deploy rechazado (fail-closed) |

## Revisión Codex C1 (`GC-AI-0008-20260927T192259Z.md`, base `778201b..2e66f4e` + GaleCore `ef6d1a5`) — CHANGES_REQUESTED

Gate, ruff, 765 tests y `diff --check` en verde; hash de la candidata reproducido; 16 tests de specs de GaleCore.

| # | Sev. | Hallazgo | Resolución |
|---|---|---|---|
| C1-B1 | BLOCKER | Campos con comportamiento clasificados como informativos (`universe.mode=DYNAMIC`, `selection_method=AI_RECOMMENDED`, método de pata) pasaban | Corregido: lista exacta de informativos; `_FIXED` exige el único valor que el runtime ejecuta (modo, tipos, excluidos, selección, pass_rule/on_fail, eligible_modes, método por pata); otras hojas de `defensive_roll` sólo null (+5 tests) |
| C1-B2 | BLOCKER | Gates validados como objeto entero: propiedad desconocida y umbral vacío pasaban | Corregido: propiedades del gate y del umbral en lista blanca; forma del umbral según operador (+5 tests) |
| C1-B3 | BLOCKER | `--expect-hash` comparaba contra un hash que da quien llama, sin leer aprobación | Corregido: `deploy --approval <archivo>` relee aprobación y propuesta, verifica sus hashes, nombre, alcance y que aprueba esa propuesta, y exige el hash cargado por GaleCore; verificado contra archivos reales (íntegra → hash; editada y otra spec → rechazo). **Residual declarado:** el endpoint `Runtime/Deploy` de GaleCore no conoce aprobaciones (admin-only, D-0003); que lo exija el endpoint es una decisión de arquitectura del owner antes de producción |
| C1-M1 | MAJOR | M1 decía 15 s; GaleCore multiplica ×10 y acepta cotizaciones sin hora | Corregido en 1.0.1: la regla dice 150 s y la aceptación sin hora; la tabla lo documenta |
| C1-M2 | MAJOR | C2, C3, R1, X1–X3 marcados `owner_decision` estando pendientes | Corregido en 1.0.1: `pending_parameter` hasta tu confirmación |
| C1-M3 | MAJOR | C3 prometía exactamente 5 USD; el builder elige el strike más cercano con ±1 USD | Corregido en 1.0.1: la regla describe el strike más cercano, la tolerancia y el ancho real en el riesgo |
| C1-m1 | MINOR | Limitaciones decían tres reglas no soportadas | Corregido: cinco (E3, E4, S2, R2, M2) |
| C1-m2 | MINOR | Matriz decía 23 reglas | Corregido: 22 |
| C1-m3 | MINOR | La investigación decía que todas las reglas de entrada eran ejecutables | Corregido: revisión r3 `correction` |

La versión a aprobar es **1.0.1** (`sha256:48b5a3c36fdf9fe64c18dd2dc9bc1140d545525219b210b2f6b193d1b4a40b3a`); 1.0.0 queda guardada como historia.

## Recheck Codex C2 (`GC-AI-0008-20260927T194521Z.md`, `2e66f4e..2d7445d` + GaleCore `ef6d1a5..8ae9be1`) — CHANGES_REQUESTED

C1-B1, B2, M1–M3 y m1–m3 RESUELTOS; C1-B3 pasa a **decisión del owner** (exigir la aprobación en el endpoint antes de producción).

| # | Sev. | Hallazgo | Resolución |
|---|---|---|---|
| C2-M1 | MAJOR | La propuesta 1.0.1 pedía aprobar `…/1.0.0` y un test registraba esas palabras contra 1.0.1 | Corregido: versión **1.0.2** (`sha256:8a7443812d0291dcb27aad6cb8674cf92496fd32f036267640521059ca77e149`); la propuesta no puede mencionar otra versión en sus decisiones del owner y `approve` rechaza palabras que nombran otra versión (+2 tests) |
| C2-m1 | MINOR | Matriz decía skill 0.3.0 | Corregido: 0.3.1 |

## Recheck Codex C3 (`GC-AI-0008-20260927T195809Z.md`, `2d7445d..76e9958`) — CHANGES_REQUESTED

C2-M1 y C2-m1 RESUELTOS; el límite del endpoint sigue como decisión del owner.

| # | Sev. | Hallazgo | Resolución |
|---|---|---|---|
| C3-M1 | MAJOR | El plan de evaluación de 1.0.2 decía «estas reglas (v1.0.0)»; también la investigación | Corregido de forma general: ninguna parte operativa (propósito, hipótesis, reglas, plan, decisiones del owner) puede nombrar otra versión; sólo limitaciones y pendientes citan historia (+2 casos). Versión **1.0.3** (`sha256:19884e779e3722f6221cf86c03b411307cdc41e04880e26f8f88395cf960bc51`); investigación r5 ata la reproducción histórica a la versión aprobada |

## Recheck Codex C4 (`76e9958..bb8f592`) — NO CORRIÓ

Dos intentos (27/09 ~17:08 y ~17:11): Codex respondió «You've hit your usage limit… try again at 5:48 PM»; el runner no
escribió revisión. Pendiente de correr con el mismo comando (`codex_review.py --recheck --model gpt-5.6-sol`). No se
compraron créditos. Sin este recheck no hay APPROVE independiente de las correcciones C3.

## Implementer handoff (27/09)

**State:** IN_PROGRESS. Implementado y revisado (interna R1 + Codex C1–C3, correcciones aplicadas; C4 pendiente por límite
de Codex). Versión para aprobar: `strategy:spy_prima_varianza_30_45d/1.0.3`,
`sha256:19884e779e3722f6221cf86c03b411307cdc41e04880e26f8f88395cf960bc51`.

**Para desplegar (después de la aprobación y autorizaciones):**
1. `strategy approve --ref strategy:spy_prima_varianza_30_45d/1.0.3 --spec-hash <hash> --owner-words "<owner>" --host-model <m>`
2. Reemplazar el DataFeed.Api sin base que ocupa :7001 por `python GaleCore/dev/galecore_dev.py api` (reactiva v2).
3. `galecore_dev.py stop --instance 0bbd904a-baf2-44a6-b81c-166e13896cf4` (v2; su posición se sigue valuando).
4. `galecore_dev.py deploy --spec spy_prima_varianza_30_45d --approval knowledge/strategies/spy_prima_varianza_30_45d/1.0.3.approval.json`
5. En sesión (lunes 28/09 desde 09:30 ET): `galecore_dev.py runtime-report --spec spy_prima_varianza_30_45d` → `evidence add`
   con la salida exacta → `research revise --capability strategy_followup --reason result` sobre
   `research:2026-09-27-spy-prima-varianza-estrategia`.

**Comandos y resultados:** pytest `tests/unit/test_strategy.py` 49 passed; suite completa 777 passed (Codex C3); ruff limpio;
GaleCore `StrategySpecVersionTests` 1/1 con hash 1.0.3.

## Arranque controlado de GaleCore Dev (27/09, autorizado por el owner)

- Antes: override del switch `runtime` en `Files/platform_services_switch_state.json` = `enabled: true` (25/09); se
  puso en `false` **antes** de arrancar (mismo efecto que apagar el switch: sin entradas nuevas, lo abierto se sigue
  valuando; decisión del owner del 24/09). Domingo: además, fuera de sesión no hay entradas.
- Se detuvo el `DataFeed.Api` sin base de :7001 (PID 2012, lanzado el 26/09 por otra sesión) y se levantó
  `galecore_dev.py api`. Log: specs cargadas, entre ellas `spy_prima_varianza_30_45d` con el hash de la 1.0.3; «recuperadas
  2 instancias, 1 posición abierta, 213 evaluaciones, 435 eventos; problemas: ninguno».
- Verificado por la API con login real (`runtime-report`): persistencia disponible, switch OFF (`source: platform`),
  v2 RUNNING/PAUSED con su posición OPEN (0,44 de crédito, −0,50 USD), `VALUATION_NO_DATA` fuera de mercado. No se
  aprobó ni desplegó nada. `runtime-report` corregido para escribir UTF-8.

## Propuesta operativa para tu decisión (no ejecutada)

1. **Aprobar** `strategy:spy_prima_varianza_30_45d/1.0.3`, hash `sha256:19884e779e3722f6221cf86c03b411307cdc41e04880e26f8f88395cf960bc51`.
   Reglas: SPY, put credit spread; put vendido con delta más cercano a −0,16 (±0,04) en un vencimiento de 30–45 DTE (el
   más cercano a 37); comprado en el strike más cercano a 5 USD debajo (±1); crédito mínimo 0,10; entrada sólo con
   VIX < 30 (sin dato fresco, bloqueo); 1 contrato, 1 posición a la vez, riesgo ≤ 500 USD; salidas: pérdida ≥ 2× crédito,
   valor ≤ 50 % del crédito, DTE ≤ 21 (en ese orden); sin roll; sin filtro de GEX (decisión explícita, E5). No
   ejecutables y declaradas: IV30/RV20, eventos, sizing por riesgo, kill switch, feriados. Parámetros heredados del
   borrador del 26/09, **pendientes de tu confirmación**.
2. **Parar `shadow_runtime_test_v2`** (`galecore_dev.py stop --instance 0bbd904a-…`). Efecto: deja de evaluar entradas y
   libera el único lugar RUNNING; su posición 731/726P (vence 06/11) **se sigue valuando hasta su salida** por las reglas de
   v2 (stop 2×, objetivo 50 %, salida a 7 DTE); queda visible en la pestaña SHADOW y en el reporte.
3. **Desplegar**: `galecore_dev.py deploy --spec spy_prima_varianza_30_45d --approval knowledge/strategies/spy_prima_varianza_30_45d/1.0.3.approval.json`.
   **Encender el switch** del runtime (hoy OFF) para que la estrategia pueda entrar en sesión: es una decisión separada
   que va con el despliegue.
4. **Verificación posterior**: `followup run` → la 1.0.3 con instancia RUNNING y el hash aprobado; en la primera sesión
   (lunes 28/09 desde 09:30 ET) al menos una evaluación explicada (entrada, descarte o bloqueo), sin tocar umbrales.

## Estudios preregistrados (27/09, trabajo independiente autorizado)

Scripts commiteados antes de correrlos (`hypothesis_study.py` en `11d69b8`, `real_rate_study.py` en `f049e24`); resultados en
`docs/evidence/gc-ai-0008/*_result.json` (`f7e3c40`); FRED (VIXCLS, DTB3, DFII10, DGS10) guardado como evidencia directa.

- **Hipótesis de la 1.0.3 (2013–2023, fills naturales + comisiones): REFUTA.** 314 operaciones, 76 % ganadoras, promedio
  −2,85 USD; exceso anual −17,7 % sobre 500 USD, IC 90 % [−40,8 %; +3,9 %]. Sensibilidad a mid sin costos: +33,8 %, IC 90 %
  [+12,0 %; +53,9 %]. Extensión 2024–2025: −53,6 % (insuficiente sola). Lectura: la prima existe antes de costos; la fricción
  de cruzar el spread y las comisiones la superan. Ver revisión 7 de la investigación de la estrategia.
- **Shocks de tasa real (contexto SPY): INSUFICIENTE** — 6 eventos (12 con la tasa nominal) < 27; sin diferencias.

**Efecto sobre la propuesta operativa de arriba:** desplegar la 1.0.3 en SHADOW sigue siendo válido **como prueba
operativa** del recorrido (el runtime la ejecuta tal cual), pero sus resultados a mid van a verse mejores que lo que el
estudio indica con ejecución realista: no son evidencia económica. La alternativa es rediseñar antes (una versión nueva,
p. ej. precio límite en el mid o crédito mínimo relativo al spread, con su propio estudio preregistrado). Decisión del owner.

## Decisión del owner y despliegue (27/09/2026, 20:20 local)

Owner: «Vamos con tus recomendaciones, y usa tastytrade via galecore. IBKR e IOL todavía no» — sobre la propuesta de
desplegar la 1.0.3 como prueba operativa (sabiendo que el estudio la refuta con ejecución realista), parar v2 y encender el
switch. Ejecutado, en este orden:
1. `strategy approve` → `knowledge/strategies/spy_prima_varianza_30_45d/1.0.3.approval.json` (palabras del owner transcriptas,
   hash `sha256:19884e77…`, alcance SHADOW:galecore-dev).
2. `strategy deploy-check` con el hash que reporta GaleCore → `DEPLOY_ALLOWED`.
3. `galecore_dev.py stop` de `shadow_runtime_test_v2` → STOPPED, `openPositions: 1` (se sigue valuando hasta su salida).
4. `galecore_dev.py deploy --approval … --switch-on` → aprobación íntegra, hash cargado = aprobado; instancia
   `d533f033-628a-4dc8-bc70-5c3d38f484d2` RUNNING; switch `enabled: true`.
5. Verificación: `followup run` → versión aprobada, hash coincide, instancia RUNNING/IDLE, estado OK. Primera evaluación en
   sesión: lunes 28/09 desde 09:30 ET; el seguimiento diario de las 17:05 ET la recoge.

**Corrección de un hallazgo:** RLS deshabilitado en GaleCore Dev **no** expone las tablas: `anon` y `authenticated` no tienen
privilegios de SELECT ni INSERT sobre `accounts`, `users`, `shadow_positions`, `strategy_instances` (sólo `galecore_api`),
consultado el 27/09. El aviso del advisor sobrestimaba; RLS sigue recomendado como defensa en profundidad antes de producción.
