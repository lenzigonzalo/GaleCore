---
id: GC-AI-0018
title: Buzón de ideas — «anotá esto» desde el chat, por revisar después (entregable 1, pieza h)
status: IN_PROGRESS
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-0018 — Buzón de ideas

Roadmap §4, entregable 1, pieza **h** (ajuste 4, aprobado el 30/09). Según el orden del entregable va después de b
(entrega 5, que espera la corrida por horario del 1/10) y de a (entrega 4, que espera a Codex el 3/10). Rama desde
`feature/GC-AI-0017`. **Aprobado por el owner el 30/09** («dale»), con las dos recomendaciones de abajo.

## Acuerdo breve

- **Para qué:** que una idea que se te ocurre mientras trabajamos quede guardada en el momento, con tus palabras, sin
  cortar lo que estamos haciendo y sin que yo la evalúe, la ordene en el plan o la mande al backlog en ese momento.
- **Qué vas a poder pedir:** «Anotá esto: …» · «¿Qué hay en el buzón?» · «Revisemos el buzón» · «Esa ya está, descartala».
- **Cómo veremos que sirve:** dejás 2 o 3 ideas durante una sesión de trabajo, seguimos sin desviarnos, y en la
  revisión cada una termina en su lugar (roadmap, backlog, work item, descartada) con la referencia de adónde fue.
- **Comparado con hoy:** hoy cada idea que mencionás se contrasta en el momento con el roadmap (`ENGINEERING.md` §1,
  «Ideas nuevas y el plan»), lo que interrumpe y a veces abre trabajo fuera del plan.

## Propuesta

| Pieza | Qué es |
|---|---|
| Guardar | `inbox add --text "<tus palabras>" [--context "<qué estábamos haciendo>"]` → `knowledge/inbox/<fecha>-<slug>.json`: palabras textuales, fecha y hora, contexto y refs opcionales (`research:`, `strategy:`, …). Estado `pending` |
| Ver | `inbox list [--status pending]` y `inbox show <id>` |
| Resolver | `inbox resolve <id> --to roadmap|backlog:BL-xxx|work-item:GC-AI-xxxx|done|discarded --note "<por qué>"`: el destino tiene que existir (por ejemplo, el `BL-` en el backlog) y queda la historia del cambio. Nunca se borra |
| Capacidad | Entrada `idea_inbox` en el catálogo con su skill: cuando decís «anotá esto», guardo tus palabras tal cual y sigo; no evalúo ni ordeno la idea en ese momento |
| Regla | `ENGINEERING.md` §1: una idea que pedís anotar va al buzón; se contrasta con el plan recién en la revisión. Lo que surge del trabajo mismo (hallazgos, mejoras) sigue yendo al backlog como hoy |

## Decisiones tuyas antes del código

| # | Pregunta | Recomendación |
|---|---|---|
| 1 | ¿Cuándo se revisa el buzón? | **Decidido (30/09):** **al empezar cada sesión, si hay pendientes:** el aviso de inicio dice «N ideas en el buzón» y vos elegís si las revisamos ahora o después. Más adelante lo hace el curador (pieza f) |
| 2 | ¿Qué entra? | **Decidido (30/09):** **sólo lo que vos pedís anotar.** Lo que yo encuentro trabajando sigue la regla actual (backlog o work item), así el buzón queda como tuyo |

## Non-goals

- Que el modelo priorice o evalúe las ideas solo: eso es la revisión con vos, y después el curador (pieza f).
- Una vista en el front: la pieza g puede mostrarlo después.
- Mover o reescribir el backlog existente.

## Acceptance criteria

- [ ] **AC-01 — Guardar sin desviar:** «anotá esto» en una sesión deja la idea con tus palabras textuales en
  `knowledge/inbox/`, y la conversación sigue con lo que estaba.
- [x] **AC-02 — Ver y resolver:** `inbox list|show|resolve`; un destino inexistente se rechaza; la historia queda y
  nada se borra. **Evidencia 30/09:** `application/inbox.py`, `contracts/inbox.py`, CLI `inbox`; tests
  `tests/unit/test_inbox.py`; prueba de punta a punta con una base temporal (destino `backlog:BL-999` rechazado,
  `discarded` resuelto, pendientes 2 → 1).
- [x] **AC-03 — Aviso al iniciar:** si hay ideas pendientes, el inicio de sesión lo dice.
  **Evidencia 30/09:** `inbox_note()` en `.claude/hooks/session_start.py` del workspace: «[buzón] N idea(s) del owner
  por revisar» con las primeras tres, por orden de anotación; corre antes del trabajo activo (también sin ítem activo).
- [x] **AC-04 — Regla actualizada:** `ENGINEERING.md` §1 y `/donde-va` mandan al buzón lo que pedís anotar.
  **Evidencia 30/09:** fila nueva en «Lo que surge mientras se trabaja» y la excepción en «Ideas nuevas y el plan»;
  paso 0 de `/donde-va`. Hasta mergear, `inbox` corre desde este worktree (`PYTHONPATH=src`).
- [ ] **AC-05 — Demostración:** 2 o 3 ideas reales anotadas en una sesión y revisadas después.
- [ ] **AC-06 — Revisión:** interna; Codex al cierre (toca una regla de trabajo); utilidad y cierre, vos.

## Revisión interna (30/09, CHANGES_REQUESTED) y arreglos

| Hallazgo | Arreglo | Verificación |
|---|---|---|
| MAJOR: el aviso de inicio se rompía con un JSON que no es objeto (y se perdía el aviso del trabajo activo) | Un archivo que no es objeto cuenta como «(unreadable)»; `inbox_note()` envuelto: nunca corta el inicio | `docs/evidence/gc-ai-0018/hook_check.py` + `hook_check_runs.jsonl` |
| MAJOR: el filtro de claves cubría sólo `words` y `context` | También `prompt` de la idea y `note`/`prompt` de cada revisión | `test_no_field_keeps_a_credential` |
| MAJOR: las revisiones estaban fuera del hash | Cada revisión encadena el hash anterior (el de la idea para la primera); reescribir una o borrar una anterior es `INTEGRITY_FAILED`. Borrar las últimas no se ve desde el archivo: declarado en `controls` (lo muestra el git de `knowledge/`) | `test_a_rewritten_or_dropped_review_is_integrity_failed` |
| MINOR: `load` sin validar el id ni que el contenido coincida | Id validado y debe coincidir con el contenido | `test_ids_are_checked_and_a_renamed_copy_is_refused` |
| MINOR: un archivo ilegible bloqueaba `inbox list` | Se lista el resto y los ilegibles se informan (`unreadable`, salida 3) | `test_an_unreadable_file_is_reported_and_the_rest_is_listed` |
| MINOR: §1 decía «hacia una de las filas de abajo» | El texto nombra los destinos reales; una decisión se registra como ADR y la idea queda `done` citándola | `ENGINEERING.md` §1 |
| MINOR: `roadmap` sin referencia | La sección va en `--note` (dicho en §1 y en la skill) | — |
| MINOR: AC-03 sin evidencia reproducible | `hook_check.py` | corrida del 30/09 |
| NIT: línea larga, doble carga en `list`, `--status` desconocido | Corregidos (`--status` desconocido se rechaza) | — |
| MINOR fuera de alcance: el filtro de claves no detecta claves con prefijo sin `key=` | Regex compartido con `evidence.py`: va al backlog, no se arregla acá | — |

## Requirement-to-evidence matrix

| Criterion | Implementation | Automated verification | Reproducible artifact | Provenance | Status |
|---|---|---|---|---|---|
| AC-01 guardar sin desviar | `inbox add`; skill `idea_inbox` regla 1 | `test_an_idea_is_kept_verbatim_and_pending`, `test_noting_never_writes_outside_the_inbox` | Demo con ideas reales | pending | Pending demo |
| AC-02 ver y resolver | `src/galecore_ai/application/inbox.py` (load, list, resolve); `src/galecore_ai/contracts/inbox.py` (destination_exists) | `tests/unit/test_inbox.py` (25 tests: destinos, historia, integridad, orden) | `tests/unit/test_inbox.py::test_inbox` (1012 tests en suite, 0 fallos) | verified locally | Implemented |
| AC-03 aviso al iniciar | `.claude/hooks/session_start.py` inbox_note() | `docs/evidence/gc-ai-0018/hook_check.py` (exit 0, 6 checks) | `docs/evidence/gc-ai-0018/hook_check_runs.jsonl` (2 corridas: 2026-10-01T01:54:40Z, 2026-10-01T20:12:41Z) | verified locally | Implemented |
| AC-04 regla | `ENGINEERING.md` §1 («Ideas nuevas y el plan»), `/donde-va` paso 0 | — | Commits 058f995, ec64e56, c1552df del workspace main | implemented | Implemented |
| AC-05 demostración | — | — | — | pending | Pending owner ideas |
| AC-06 revisión interna | Arreglos: encadenamiento de revisiones, filtro de claves (words, context, prompt, note, review note), ids validados, ilegibles informados | `tests/unit/test_inbox.py::test_a_rewritten_or_dropped_review_is_integrity_failed`, `test_no_field_keeps_a_credential`, `test_ids_are_checked_and_a_renamed_copy_is_refused`, `test_an_unreadable_file_is_reported_and_the_rest_is_listed` | Commit fd0171c, hook_check.py runs | verified locally | CHANGES_REQUESTED arreglos aplicados → recheck pendiente + Codex |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```

## Implementer handoff

**State:** IN_PROGRESS — AC-02/03/04 con evidencia; AC-01/05 esperan la demo con ideas reales del owner; AC-06 abierto (falta el recheck interno de los arreglos y Codex al cierre). No se reporta READY_FOR_REVIEW.

**Timestamp:** 2026-10-01T20:12:41Z

### Files changed

**GC-AI-0018 worktree (commits 96c32c4..fd0171c sobre feature/GC-AI-0017):**
- `src/galecore_ai/application/inbox.py` — lógica de persistencia (add, load, list, resolve)
- `src/galecore_ai/contracts/inbox.py` — esquema y validación (Idea, Review, destinos válidos)
- `src/galecore_ai/adapters/cli.py` — comandos `inbox add|list|show|resolve`
- `config/catalog.yaml` — entrada `idea_inbox` con skill 1.0.0, flow, storage y controls
- `config/skills/idea-inbox/skill.yaml` — instrucciones, contrato y ejemplos
- `tests/unit/test_inbox.py` — 25 tests (carga/validación/integridad/destinos/orden/ilegibles)
- `docs/evidence/gc-ai-0018/hook_check.py` — validador reproducible para AC-03
- `docs/evidence/gc-ai-0018/hook_check_runs.jsonl` — corridas (línea nueva: 2026-10-01T20:12:41Z)

**Workspace (commits c1552df, ec64e56, 058f995 en rama main):**
- `.claude/hooks/session_start.py` — `inbox_note()` con manejo de JSON inválido, archivos ilegibles, límite de 3 ideas
- `ENGINEERING.md` §1 — regla actualizada: lo que el owner pide anotar va al buzón
- `/donde-va` paso 0 — referencia al buzón para ideas del owner

### Criteria claimed complete

- **AC-02 — Ver y resolver:** `implemented`, verificado con tests locales (destinos validados, historia encadenada, integridad por hash, orden por hora)
- **AC-03 — Aviso al iniciar:** `verified locally`, corridas del hook en `hook_check_runs.jsonl` (2 corridas, casos: 3 pendientes con ilegibles → 2 pendientes, avisos de no-cortador de sesión)
- **AC-04 — Regla actualizada:** `implemented`, visible en commits del workspace (§1 nombra destinos reales, paso 0 de `/donde-va`)

### Commands and exact results

```powershell
# Desde C:/Users/lenzi/OneDrive/Escritorio/GaleCore/.worktrees/galecore-ai/GC-AI-0018
# PYTHONPATH=src

python tools/engineering_gate.py
# Result: PASS (Engineering gate: GC-AI-0018, Status: IN_PROGRESS, WARNING: 3 acceptance criteria remain open)

python -B -m pytest -q -p no:cacheprovider
# Result: PASS (1012 passed, 1 warning in 161.45s)

python -B -m ruff check --no-cache .
# Result: PASS (All checks passed!)

git diff --check
# Result: PASS (no output)

python docs/evidence/gc-ai-0018/hook_check.py
# Result: PASS (exit code 0, all checks: exit_code_0=true, one_line_per_idea=true, counts_2_pending=true, reviewed_not_listed=true, unreadable_named=true, active_item_still_shown=true)
```

### Known gaps and risks

- **AC-01 — Guardar sin desviar:** pendiente demostración con 2–3 ideas reales anotadas en sesión; implementación disponible (`inbox add`), regla en skill, tests unitarios pasan. Sin bloqueador técnico.
- **AC-05 — Demostración:** pendiente revisión con owner de ideas reales después de ser anotadas; depende de que el owner aporte ideas durante trabajo.
- **AC-06 — Revisión interna completa + Codex:** arreglos aplicados, recheck interno hace falta, Codex al cierre (pieza h es de utilidad/aceptación del owner, requiere aprobación).

### Provenance

- Implementer: Claude Code (Haiku 4.5)
- Verification: automated gates (ruff, pytest, git, engineering_gate); reproducible artifact (hook_check.py)
- Evidence sources: test suite, hook_check_runs.jsonl, commits sobre feature/GC-AI-0017, workspace commits (c1552df, ec64e56, 058f995)

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
