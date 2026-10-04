---
id: GC-AI-0026
title: Estrategia y cartera como proyecto — pieza 2
status: IN_PROGRESS
implementer: claude-code
reviewer: internal
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: APPROVED
---

# GC-AI-0026 — Estrategia y cartera como proyecto

## Qué y para qué

- **Qué hacemos:** un «proyecto» por estrategia y uno de la cartera que junta lo que hoy está disperso (tesis, reglas,
  versiones y aprobaciones, seguimientos, investigaciones, evidencias, feedback, pendientes) y suma lo que falta:
  decisiones del owner y en qué historia del mercado funciona.
- **Para qué:** que el owner diga «en la estrategia X» o «en mi cartera» y la sesión arranque con todo cargado, sin
  reconstruirlo ni nombrar comandos.
- **Cómo veremos que sirve:** una sesión nueva, con «en la estrategia spy_prima_varianza», muestra tesis, reglas
  vigentes, versión en SHADOW, último seguimiento, pendientes y decisiones con sus referencias; «en mi cartera» muestra
  las estrategias, el perfil vigente y los límites contra lo abierto.
- **Qué queda fuera:** prender/apagar por contexto (pieza 3), supervisor (pieza 4), performance (pieza 5), front.

## Objective

Pieza 2 del roadmap §4 (Entregable 1 (c), BL-007), con el addendum de BL-008 del 04/10: el proyecto lee la misma
versión efectiva del perfil que el monitor.

## Lo que ya existe (verificado 04/10)

- `knowledge/strategies/<name>/<ver>.proposal.json` y `.approval.json` (`strategy save|approve|deploy-check`).
- `knowledge/followups/<name>/` (`strategy_followup`), investigaciones `research:` (incluidas las de `daily_attention`),
  `evidence:`, `feedback:`, `inbox`, `profile:vN`.
- El espacio en GaleCore (`TraderSpaceItem`, `space import|context|agents`) publica perfil, objetivos, convenciones,
  agentes y skills; `space context` corre al iniciar sesión.
- `catalog --match` resuelve el pedido en palabras del owner a una capacidad.

## Non-goals

- Nueva base de datos o migración general de `knowledge/` al espacio.
- Asignación de capital, elegibilidad automática o ranking de estrategias (resto de BL-007).
- Cambios al monitor (salvo lo que pida la decisión D-2).

## Scope

- GaleCore-AI: capacidad `strategy_project` (y su skill) en el catálogo; comando `project show strategy:<name>` y
  `project show portfolio` que arma la vista desde los stores existentes; un registro propio, append-only, para lo que
  no tiene dónde vivir (tesis, en qué historia funciona, decisiones, pendientes), con referencias a lo existente.
- Coherencia del perfil (BL-008, addendum 04/10) según la decisión D-2.

## Decisiones del owner (04/10)

Aprobado con las propuestas (a) de D-1, D-2 y D-3: «Sobre lo demás AVANCEMOS con el work item» (owner, 04/10).

- **D-1 — Dónde vive el proyecto:** (a, propuesta) `knowledge/projects/<name>.json` append-only, que referencia lo
  existente y no lo copia; (b) como pieza del espacio en GaleCore, visible en el monitor.
- **D-2 — Qué perfil manda:** (a, propuesta) GaleCore (el espacio) manda; `knowledge/profile` queda como copia con la
  versión y el hash del espacio, y si GaleCore no responde se declara y no se usa una copia distinta; (b) manda el
  local y el monitor sólo lo muestra.
- **D-3 — «En qué historia funciona»:** (a, propuesta) texto del owner + referencias a lecturas de régimen/historia
  guardadas; (b) condiciones evaluables sobre los datos de la historia (eso se acerca a la pieza 3).

## Acceptance criteria

- [ ] **AC-01 — Proyecto de estrategia:** `project show strategy:<name>` devuelve tesis, reglas de la versión vigente,
  versiones y aprobaciones, versión desplegada en SHADOW, último seguimiento, investigaciones, pendientes abiertos,
  decisiones y feedback, cada uno con su referencia resoluble; lo que falta se declara.
- [ ] **AC-02 — Proyecto de cartera:** `project show portfolio` lista las estrategias con su estado, el perfil vigente
  (versión y fuente) y los límites del perfil contra el riesgo abierto que informa GaleCore.
- [ ] **AC-03 — Registrar decisiones y pendientes:** `project add` guarda tesis, decisión, pendiente o «historia en la
  que funciona» con las palabras del owner, append-only y con hash; `kb search` los encuentra.
- [ ] **AC-04 — Pedido sin nombrar:** «en la estrategia X» / «en mi cartera» resuelven a `strategy_project` por
  `catalog --match`; `catalog --check` valida la entrada.
- [ ] **AC-05 — Perfil coherente:** según D-2, monitor y métodos usan la misma versión efectiva; una importación no
  revierte una edición; sin la fuente que manda se declara el estado (reproducido con un dato de prueba).
- [ ] **AC-06 — Demostración:** sesión nueva con spy_prima_varianza_30_45d y con la cartera, guardada como evidencia.
- [ ] **AC-07 — Cierre:** owner.

## Requirement-to-evidence matrix

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 | `application/project.py` (`strategy_project`), CLI `project show strategy:<name>` | `tests/unit/test_project.py` (vista con referencias, aprobada vigente, faltantes declarados) | real 04/10: `spy_prima_varianza_30_45d` → 1.0.5 aprobada, 24 reglas, 3 decisiones, 4 investigaciones, 1 feedback, seguimiento 03/10 OK; falta tesis e historia | DONE |
| AC-02 | `portfolio_project`, CLI `project show portfolio` | `test_portfolio_without_galecore_declares_the_profile_unconfirmed` | real 04/10: 1 estrategia, `profile:v5` coherente con GaleCore Dev; riesgo en vivo declarado como no consultado | PARTIAL — el contraste límites × riesgo abierto en vivo pasa a la pieza 4 (supervisor), recomendada por la revisión; acá se muestra el último seguimiento con fecha |
| AC-03 | `contracts/project.py` (encadenado), `project add`, `kb search --kind project` | `test_owner_entries_are_kept_verbatim_and_open_items_close`, `test_bad_entries_are_refused`, `test_an_edited_log_is_integrity_failed`, `test_kb_search_finds_project_entries`, `test_a_damaged_log_does_not_hide_the_rest_of_the_view` | — | DONE |
| AC-04 | `config/catalog.yaml` `strategy_project`, `skills/strategy-project/` | `test_knowledge.py::TestCatalog`, `test_route.py` | `catalog --check` complete; `catalog --match "Estemos en la estrategia…"` y `"Abrí mi cartera"` → `strategy_project` primero | DONE |
| AC-05 | `space.py` `profile_state`, `guard_profile`, `pull_profile`; CLI `space import` y `space pull-profile` | `test_a_monitor_edit_is_not_overwritten_and_is_pulled`, `test_a_local_version_not_imported_yet_is_local_newer`, `test_a_field_removed_in_the_monitor_is_removed_when_pulled` | contra GaleCore Dev 04/10: `coherent` (v5) | DONE |
| AC-06 | demostración con datos reales (salidas arriba) | — | sesión del 04/10; la de una sesión nueva la hace el owner con `claude -n GC-AI-0026` | PARTIAL |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```

## Implementer handoff

**State:** DONE (04/10)

- 1103 tests (suite completa) + ruff + gate PASS en `feature/GC-AI-0026`.
- Decisiones aplicadas: D-1 (a) `knowledge/projects/<name>.json`; D-2 (a) manda el espacio; D-3 (a) texto del owner + referencias.
- Límites: el riesgo abierto en vivo no se consulta (se muestra el último seguimiento con fecha); la edición del perfil
  en el monitor se detecta por contenido distinto con versión no menor a la local; las tesis e historias reales las
  escribe el owner (no se inventaron).
- Mejoras de `strategy_design` propuestas en BL-007 (addendum 04/10), fuera de este item.

## Independent review

**Reviewer:** internal (subagente `reviewer`, Sonnet), 04/10
**Review result:** REQUEST_CHANGES → arreglado (ver tabla); 85 tests + ruff + gate PASS en la revisión.

| Hallazgo | Severidad | Resolución |
|---|---|---|
| Un log alterado rompía `project show` entero | MAJOR | arreglado: se reporta en `integrity_failed` y la vista sigue (test) |
| AC-02 marcado DONE sin contraste con el riesgo abierto | MAJOR | AC-02 PARTIAL; el contraste en vivo pasa a la pieza 4 |
| `feedback_status`/`cited_by` podían romper la vista; slug con `endswith` laxo | MINOR | arreglado: capturados; slug anclado a `-<slug>` |
| Refs de entradas no se re-resolvían en la vista | MINOR | arreglado: `refs_not_resolving` |
| `pull_profile` hacía merge: un campo borrado en el monitor no se borraba | MINOR | arreglado: se trae el contenido completo (test) |
| Pieza del perfil ilegible no frenaba `import` | MINOR | arreglado: también se retiene |
| Edición del monitor no detectada si el local ya avanzó de versión | MINOR | sin cambio: límite documentado |
| AC-01 «versión en SHADOW» sólo vía `last_followup` | MINOR | sin cambio: el seguimiento es la fuente de lo desplegado |
| Uso de `project` en el docstring del CLI | NIT | arreglado |
