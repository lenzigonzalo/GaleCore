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
| AC-01 | PENDING | PENDING | PENDING | PENDING |
| AC-02 | PENDING | PENDING | PENDING | PENDING |
| AC-03 | PENDING | PENDING | PENDING | PENDING |
| AC-04 | PENDING | PENDING | PENDING | PENDING |
| AC-05 | PENDING | PENDING | PENDING | PENDING |
| AC-06 | PENDING | PENDING | PENDING | PENDING |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```

## Implementer handoff

**State:** IN_PROGRESS (04/10)

## Independent review

**Reviewer:** PENDING
**Review result:** PENDING
