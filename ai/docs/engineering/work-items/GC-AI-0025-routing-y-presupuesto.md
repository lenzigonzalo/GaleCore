---
id: GC-AI-0025
title: Routing y presupuesto de modelos (desarrollo y producto) — pieza 1b
status: CLOSED
implementer: claude-code
reviewer: internal
approver: user
feature_freeze: false
closure_blocked: false
review_result: APPROVED
approval_result: APPROVED
---

# GC-AI-0025 — Routing y presupuesto de modelos

## Qué y para qué

- **Qué hacemos:** un presupuesto por work item que se ve y frena el desarrollo, y una regla que elige el modelo de
  cada capacidad según el trabajo (código → Haiku → Sonnet → Opus).
- **Para qué:** que el owner vea cuánto gasta cada trabajo y que nada consuma cuota en silencio; que el trader pida
  y el sistema use el modelo adecuado sin nombrarlo.
- **Cómo veremos que sirve:** al iniciar la sesión aparece el consumo del item; al 80 % avisa; al 100 % sólo deja
  guardar el handoff; cada corrida programada registra modelo y motivo.
- **Qué queda fuera:** topes en USD, cambiar el modelo del chat, abrir sesiones solas, el lifecycle de skills.

## Objective

Pieza 1b del roadmap §4 (BL-001, addendum «Routing y presupuesto visibles», 04/10), con las decisiones del owner del
04/10: presupuesto **250 llamadas / 200 000 tokens de salida por work item**, aviso al 80 %, al 100 % **freno**
(guardar y explicar; el owner sube el límite); sesión nueva por work item con **comando listo que abre el owner**;
routing de producto **código → Haiku → Sonnet → Opus**, Opus sólo para interpretar, y una caída o falta de cuota
nunca sube de modelo.

## Lo que el host permite (verificado 04/10, Claude Code 2.1.288)

- Sesión interactiva: `--model`, `--effort` y `-n/--name` al abrir; no hay tope de gasto nativo. Un hook ve el
  transcript (`transcript_path`), que trae `usage` por llamada: se puede contar en vivo y bloquear herramientas.
- `-p` (lo que usa el runner): `--model`, `--max-turns`, `--fallback-model` (no se usa), `--max-budget-usd` (sólo
  USD de API; no aplica a la cuota de la suscripción: no se usa).
- Subagentes: `model` y `effort` en el frontmatter, o `model` al lanzarlos.
- `--bg` y `claude agents` existen; el owner eligió abrir él la sesión.
- Consumo real de referencia (últimas 30 sesiones del workspace): mediana 90 llamadas / 75k salida; percentil 75:
  263 llamadas / 195k salida. Las lecturas de caché dominan el volumen (mediana 16 M) y no entran al límite.

## Non-goals

- Tope en USD o tarifas; cambiar o detener el modelo de la sesión del chat.
- Abrir sesiones automáticamente; subagentes por defecto.
- Lifecycle general de skills (BL-001 sigue postergado).

## Scope

- Workspace (`.claude/`): hook de presupuesto, configuración de límites, alineación de `reviewer`/`autorun` con
  `ENGINEERING.md` §5, comando de sesión nueva en el handoff y en `work_item.py start`.
- GaleCore-AI: política de modelo por tipo de trabajo en el catálogo (`schedulable.work`), registro de modelo y
  motivo en cada corrida, inventario y `catalog --match` con el modelo que corresponde; sección «Qué y para qué» en la
  plantilla y aviso del gate si el item activo no la tiene.

## Acceptance criteria

- [x] **AC-01 — Presupuesto visible:** al iniciar la sesión y en cada aviso se ve llamadas y salida del item activo
  contra su límite, sumando sesiones anteriores y subagentes.
- [x] **AC-02 — Aviso y freno:** al 80 % avisa una vez; al 100 % bloquea herramientas salvo leer y escribir el
  work item / handoff, y explica cómo subir el límite.
- [x] **AC-03 — Agentes alineados:** `reviewer` y `autorun` siguen `ENGINEERING.md` §5 (Sonnet; Opus sólo al cierre).
- [x] **AC-04 — Sesión por trabajo:** `work_item.py start` y el handoff dejan el comando `claude -n <id> "retoma el
  handoff"` listo.
- [x] **AC-05 — Routing de producto:** toda capacidad programable por modelo declara su trabajo; el modelo sale de la
  política; un modelo que no corresponde se rechaza en `catalog --check`; nunca hay modelo de respaldo.
- [x] **AC-06 — Elección registrada:** cada corrida guarda modelo y motivo; `inventory` y `catalog --match` lo muestran.
- [x] **AC-07 — Qué y para qué:** la plantilla tiene la sección y el gate avisa si el item activo no la tiene.
- [x] **AC-08 — Cierre:** owner, 04/10.

## Requirement-to-evidence matrix

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 | workspace `.claude/hooks/budget.py` (`session-start`), `.claude/budget.json` | workspace `tests/test_budget.py` (sesión + subagentes, sesiones sumadas, sesión vista a mitad) | estado en vivo `.engineering-state/budget/GC-AI-0025.json` (esta sesión: 8 llamadas al registrarse) | DONE |
| AC-02 | `budget.py pre-tool` (aviso una vez; exit 2 salvo Read/Grep/Glob/AskUserQuestion/ToolSearch y Edit/Write del item o `SESSION_HANDOFF.md`) | `tests/test_budget.py` (aviso, freno, guardar permitido, límite por item, config rota no frena) | — | DONE |
| AC-03 | `.claude/agents/reviewer.md` sonnet/medium; `autorun/SKILL.md` paso 6 | revisión del diff | — | DONE |
| AC-04 | workspace `tools/work_item.py` (`session:` en `start`), `ENGINEERING.md` §5 | `tests/test_work_item.py::test_start_leaves_the_items_session_command_ready` | — | DONE |
| AC-05 | `harness/catalog.py` (`WORK_MODELS`, `Schedulable.work`), `config/catalog.yaml` | `tests/unit/test_model_routing.py`, `test_catalog_check.py` | `catalog --check` | DONE |
| AC-06 | `application/tasks.py` (`route` en la corrida y en `task status`), `inventory.py`, `route.py` (`model` en `--match`) | `tests/unit/test_model_routing.py::test_match_says_which_model_the_work_needs` | — | DONE |
| AC-07 | `WORK-ITEM-TEMPLATE.md`, `tools/engineering_gate.py` | `tests/unit/test_engineering_gate.py::test_an_item_without_que_y_para_que_warns_and_one_with_it_does_not` | — | DONE |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```

## Implementer handoff

**State:** DONE (04/10)

- GaleCore-AI `feature/GC-AI-0025`: 1093 tests (sesión completa) + gate PASS, ruff limpio.
- Workspace `main`: gate PASS (pytest + ruff + diff --check).
- Cambio de comportamiento: `daily_attention` pasa del modelo del host (Opus) a Sonnet (`work: reading`).
- Límites conocidos: el freno cuenta lo que el transcript registra (no es un tope del host); la sesión que estaba
  activa antes de abrir el item se cobra desde que el hook la vio; `--max-budget-usd` no se usa (USD de API).

## Independent review

**Reviewer:** internal (subagente `reviewer`, Sonnet), 04/10
**Review result:** APPROVE — sin BLOCKER ni MAJOR; 97 tests reejecutados, gate y ruff PASS; conteo verificado contra
transcripts reales (dedupe, offsets, subagentes), ~0,2 s por herramienta.

| Hallazgo | Severidad | Resolución |
|---|---|---|
| Estado corrupto deja el freno apagado sin aviso | MINOR | arreglado: se aparta como `.bad` y el conteo sigue (test) |
| Config con forma inválida o límite 0 rompe con traceback | MINOR | arreglado: se capturan `TypeError`/`AttributeError`/`ZeroDivisionError` (test) |
| Sesión reanudada/compactada se cobra entera al item | MINOR | arreglado: sólo `source=startup` cuenta desde el inicio; volver a un item dejado sobreestima (documentado) |
| AC-04 sin evidencia del lado del handoff | MINOR | arreglado: `.claude/agents/handoff.md` termina con el comando |
| `warned` no se rearma al subir el límite; textos/largo de línea; `<synthetic>` | NIT | sin cambio |

## Cierre

CLOSED por el owner el 2026-10-04 («cerremos esto»), en `main`.
