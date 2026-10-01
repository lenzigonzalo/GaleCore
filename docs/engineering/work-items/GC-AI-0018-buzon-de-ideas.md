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

## Requirement-to-evidence matrix

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 guardar sin desviar | `inbox add`; skill `idea_inbox` regla 1 | `test_an_idea_is_kept_verbatim_and_pending`, `test_noting_never_writes_outside_the_inbox` | Demo con ideas reales | Pendiente: demo |
| AC-02 ver y resolver | `inbox list|show|resolve`, `destination_exists` | `test_inbox.py` (destinos, historia, integridad, orden) | Prueba con base temporal (30/09) | Hecho |
| AC-03 aviso al iniciar | `inbox_note()` del hook del workspace | Prueba con base temporal (30/09) | Salida del hook | Hecho |
| AC-04 regla | `ENGINEERING.md` §1, `/donde-va` | — | Commit del workspace | Hecho |
| AC-05 demostración | — | — | — | Pendiente |
| AC-06 revisión | — | — | — | Pendiente: interna en curso, Codex al cierre |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```
