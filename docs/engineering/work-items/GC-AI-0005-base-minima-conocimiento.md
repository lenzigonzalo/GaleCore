---
id: GC-AI-0005
title: Base mínima probada con trabajo real — catálogo, base de conocimiento e investigación retomable
status: IN_PROGRESS
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-0005 — Base mínima probada con trabajo real

Paso 1 del plan único ([`roadmap/README.md`](../../../../roadmap/README.md)). Autorizado por el owner
el 2026-09-23 (objetivo, alcance y tercer caso confirmados en la sesión).

## Objective

Que el host descubra las capacidades disponibles desde un catálogo común, que su trabajo quede en una
base de conocimiento estable fuera del checkout de código, y que una **investigación** (tercer caso,
distinto de interpretar un indicador) se pueda producir con antecedentes citados, conservar y retomar
en otra sesión — sin romper GEX ni régimen.

**Tercer caso:** "Desde el host, investigar una idea utilizando antecedentes disponibles, producir una
hipótesis y un plan de prueba con fuentes y limitaciones, conservarlos y retomar la investigación en
otra sesión." Entrega una investigación retomable y un plan de prueba, no una estrategia validada.

## Non-goals

- Runtime autónomo o scheduler; plataforma multiagente; administración multiusuario; marketplace o
  editor de skills; pantallas nuevas; ejecución de estrategias, PAPER o LIVE.
- Migración de `GaleCore/research/` más allá de los registros de régimen, y de documentos históricos.
- Base vectorial, servicios nuevos o framework de memoria.
- Reparar el cálculo o el contrato GEX (`BL-002`, `BL-011`): se preservan como limitaciones conocidas.
- Integraciones nuevas o un backtester: la investigación usa fuentes locales y capabilities existentes.

## Scope

- **Base de conocimiento** en `<workspace>/knowledge/`, repo git propio sólo de datos (rama `main`),
  ignorado por el repo del workspace igual que `GaleCore/` y `GaleCore-AI/`. Se resuelve por
  `GALECORE_KNOWLEDGE_DIR` o, si no está, subiendo desde el checkout hasta la raíz del workspace.
  Registros de régimen en `knowledge/regime/<SYMBOL>/<fecha>.md` (mismo formato, movidos byte a
  byte); investigaciones en `knowledge/research/<id>.md`. `GALECORE_RECORDS_DIR` sigue funcionando
  como override del régimen.
- **Catálogo** `config/catalog.yaml`: qué trabajos existen, qué pedido resuelve cada uno, su skill,
  su contrato de salida, su flujo de comandos, dónde se guarda y qué controles aplica. `cli catalog`
  lo expone con la versión y el hash de cada skill cargada. La lista de skills conocidas deja de
  estar duplicada en código.
- **Referencias** entre trabajos: `regime:<SYMBOL>/<fecha>`, `research:<id>`, `file:<ruta relativa al
  workspace>`; se resuelven y verifican al guardar.
- **Investigación:** skill `research`, contrato `ResearchNote`, validación propia del tipo de trabajo,
  store con revisiones append-only y hash por revisión, comandos `kb search`, `kb show`,
  `research save`, `research revise`.

## Acceptance criteria

- [ ] **AC-01 (A) — Descubrimiento:** desde un pedido normal, el host usa `catalog` para encontrar la
  capacidad adecuada y su flujo; GEX, régimen e investigación figuran con skill, contrato y flujo.
- [ ] **AC-02 (B) — Antecedentes con efecto:** una investigación sólo se guarda si cada antecedente
  resuelve a un item de la base o a un archivo local y declara cómo afecta a la hipótesis o al plan.
- [ ] **AC-03 (C) — Procedencia y estado:** la investigación guarda pregunta, estado, antecedentes,
  afirmaciones tipadas (hecho / interpretación / hipótesis / decisión; un hecho sin fuente se
  rechaza), plan de prueba, faltantes y siguientes pasos, con host declarado, skill (versión + hash)
  y hash de contenido por revisión.
- [ ] **AC-04 (D) — Retomar sin memoria:** una sesión nueva del host, sin la conversación anterior,
  encuentra la investigación por `kb search`, la lee con `kb show` y la continúa desde sus pendientes
  con `research revise`.
- [ ] **AC-05 (E) — Corrección o resultado vinculado:** una revisión posterior (`continuation`,
  `correction`, `result`) se agrega sin alterar las anteriores; una revisión anterior modificada se
  detecta como `INTEGRITY_FAILED`.
- [ ] **AC-06 (F) — GEX y régimen intactos:** las suites existentes pasan; los registros de régimen
  existentes siguen legibles y verificables desde la nueva ubicación con el mismo contenido.
- [ ] **AC-07 (G) — Independiente de la rama:** la base vive fuera de todo checkout de código; cambiar la
  rama de GaleCore o GaleCore-AI no cambia su contenido.
- [ ] **AC-08 (H) — La tercera capacidad usa el mecanismo común:** el handoff enumera qué se declaró y qué
  código específico hizo falta, sin ocultar excepciones.
- [ ] **AC-09 (I) — Repositorio:** gate, pytest, ruff, `git diff --check`, verificación del wheel.
- [ ] **AC-10 (J) — Review:** `reviewer` interno y `/review-codex` sobre el diff.

## Requirement-to-evidence matrix

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 (A) | PENDING | PENDING | PENDING | PENDING |
| AC-02 (B) | PENDING | PENDING | PENDING | PENDING |
| AC-03 (C) | PENDING | PENDING | PENDING | PENDING |
| AC-04 (D) | PENDING | PENDING | PENDING | PENDING |
| AC-05 (E) | PENDING | PENDING | PENDING | PENDING |
| AC-06 (F) | PENDING | PENDING | PENDING | PENDING |
| AC-07 (G) | PENDING | PENDING | PENDING | PENDING |
| AC-08 (H) | PENDING | PENDING | PENDING | PENDING |
| AC-09 (I) | PENDING | PENDING | PENDING | PENDING |
| AC-10 (J) | PENDING | PENDING | PENDING | PENDING |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
python tools/verify_wheel_assets.py
```

## Implementer handoff

**State:** PENDING
