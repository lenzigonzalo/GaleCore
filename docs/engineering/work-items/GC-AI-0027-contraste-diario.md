---
id: GC-AI-0027
title: Contraste diario y prender/apagar por contexto — pieza 3
status: IN_PROGRESS
implementer: claude-code
reviewer: internal
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: APPROVED
---

# GC-AI-0027 — Contraste diario y prender/apagar por contexto

## Qué y para qué

- **Qué hacemos:** cada día, la historia del mercado de hoy contra cada estrategia (su proyecto: en qué historia
  funciona, decisiones, estado en SHADOW) y la cartera (perfil y límites): qué conviene prender, mantener o apagar en
  SHADOW, con el motivo, e ideas nuevas.
- **Para qué:** que el owner decida rápido con todo a la vista; las ideas se prueban en SHADOW, no con backtest.
- **Cómo veremos que sirve:** `contrast pack` junta todo sin modelo; la lectura queda como revisión de una
  investigación «contraste diario» con una propuesta por estrategia; «¿prendo o apago algo hoy?» llega solo.
- **Qué queda fuera:** ejecutar el prender/apagar (decide y hace el owner), la estructura nueva en SHADOW (item de
  GaleCore aparte), el supervisor de posiciones (pieza 4).

## Objective

Pieza 3 del roadmap §4 (BL-007; agente `oportunidades` de GC-AI-0020), sobre la historia del mercado (GC-AI-0024) y
el proyecto de estrategia (GC-AI-0026).

## Decisiones (recomendadas, owner 04/10: «avanzá con recomendados»)

- **D-1:** la estructura nueva en SHADOW (call credit spread primero, espejo del PCS) va en un work item de GaleCore
  aparte; acá se declara como faltante cuando la historia la pediría.
- **D-2:** propuesta por estrategia `prender | mantener | apagar | sin datos`, nunca automática; la decisión del owner
  se guarda con `project add <name> --kind decision`.
- **D-3:** el contraste usa la última lectura de la historia guardada (no la recalcula); si es vieja, lo declara.

## Non-goals

- Cambiar despliegues, instancias o parámetros; órdenes.
- Estructuras nuevas en GaleCore; asignación de capital.

## Scope

- GaleCore-AI: `application/contrast.py` (pack por código), CLI `contrast pack`, capacidad `daily_contrast` en el
  catálogo con su skill (trabajo `interpretation`, programable después de `market_story`).

## Acceptance criteria

- [ ] **AC-01 — Pack del contraste:** `contrast pack` devuelve la última historia (ref, fecha, antigüedad), cada
  estrategia con su proyecto (historia en la que funciona, decisiones, pendientes, último seguimiento) y el perfil;
  lo que falta se declara.
- [ ] **AC-02 — Propuesta guardada:** la lectura se guarda como revisión de la investigación de contraste citando el
  pack, con una propuesta por estrategia y su motivo.
- [ ] **AC-03 — Pedido sin nombrar:** «¿prendo o apago algo hoy?» resuelve a `daily_contrast`; `catalog --check` OK.
- [ ] **AC-04 — Cierre:** owner.

## Requirement-to-evidence matrix

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 | `application/contrast.py` (`pack`), CLI `contrast pack` | `tests/unit/test_contrast.py` (pack con historia, estrategias y faltantes; historia y decisiones del proyecto llegan; historia ausente o vieja se declara) | real 04/10: historia `research:2026-10-04-historia-del-mercado-spy` (11 h), 1 estrategia, `profile:v5` coherente con GaleCore | DONE |
| AC-02 | lectura guardada con `research save --capability daily_contrast` | controles de research (refs resuelven, perfil citado) | `research:2026-10-04-contraste-diario` r1: spy_prima_varianza_30_45d → mantener, con motivo, riesgo contra el perfil e idea | DONE |
| AC-03 | `config/catalog.yaml` `daily_contrast`, `skills/daily-contrast/` | `test_knowledge.py::TestCatalog`, `test_route.py` | `catalog --match "¿Prendo o apago algo hoy?"` → `daily_contrast`; `catalog --check` complete | DONE |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```

## Implementer handoff

**State:** DONE (04/10)

- 1108 tests + ruff + gate PASS en `feature/GC-AI-0027`.
- Primer contraste real: mantener `spy_prima_varianza_30_45d` (IV sobre HV y volatilidad calma; vigilar CPI 14/10).
- Límites: usa la última historia guardada (no la recalcula); la estructura nueva en SHADOW queda para un item de
  GaleCore (D-1); no es programable todavía (se corre a pedido, después de `market_story`).

## Independent review

**Reviewer:** PENDING
**Review result:** PENDING
