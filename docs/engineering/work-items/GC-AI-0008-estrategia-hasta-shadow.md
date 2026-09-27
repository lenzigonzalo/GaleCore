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
| AC-01 | `config/catalog.yaml` (`strategy_design`, `strategy_followup`), `config/skills/strategy-design/skill.yaml` 0.3.0 (continúa el piloto 0.2.0-draft), `config/skills/strategy-followup/skill.yaml` | `test_catalog_offers_the_strategy_path`, catálogo en `test_knowledge.py` | `cli catalog` lista 6 capacidades | Implementado; verificado local |
| AC-02 | `contracts/strategy.py` (`ProposalContent`: bloques obligatorios, `basis` por regla, plan de evaluación) | `test_every_block_needs_a_rule`, `test_grounded_rules_cite_and_unsupported_rules_explain`, `test_evaluation_plan_needs_dependence_and_sample_sufficiency` | `strategy:spy_prima_varianza_30_45d/1.0.0` (23 reglas) | Implementado; propuesta real guardada |
| AC-03 | `application/strategy.py` (`check_proposal`, tabla de soporte leída del código de GaleCore `bc62f22`) | `test_candidate_is_valid_with_its_declared_gaps`, `test_owner_draft_spec_is_refused_for_what_the_runtime_ignores`, `test_a_spec_promising_behavior_the_runtime_ignores_is_invalid` (5), `test_an_unmapped_field_fails_closed`, y 8 más | Chequeo real: `VALID_WITH_DECLARED_GAPS`, declaradas E3, E4, S2, R2, M2; `pcs_spy_16d_v1` → `INVALID` (sizing RISK_BASED, riesgo %, analytics_refs) | Implementado; verificado local |
| AC-04 | `galecore_spec_hash`; spec en GaleCore `Files/Runtime/spy_prima_varianza_30_45d.json` (rama local `feature/GC-AI-0008-estrategia-shadow`) | `test_hash_equals_the_one_galecore_computed` (v1, v2 contra los hashes persistidos en GaleCore Dev); GaleCore `StrategySpecVersionTests` (su loader: carga, valida, hash `sha256:dfed1af1…`) | 16/16 tests de specs en GaleCore | Implementado; revalidado con el código de GaleCore |
| AC-05 | `approve`, `deploy_check` (create-only, hash), `galecore_dev.py deploy --expect-hash` | `test_approval_needs_the_exact_hash`, `test_deploy_is_refused_without_approval_or_with_another_hash`, `test_an_edited_approval_blocks_the_deploy`, `test_cli_save_approve_deploy_check` | — | Implementado; **aprobación real pendiente del owner** |
| AC-06 | `galecore_dev.py deploy/stop` | — | — | **Bloqueado:** aprobación, parar v2, API de GaleCore Dev no levantada (ver hallazgos) |
| AC-07 | `strategy_followup` + `galecore_dev.py runtime-report` | `test_research_can_cite_the_strategy_version` | — | Implementado el camino; demostración después del despliegue |
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
