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

Evidencia de uso real: [`docs/evidence/gc-ai-0005/`](../../evidence/gc-ai-0005/README.md).

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 (A) | `config/catalog.yaml`, `harness/catalog.py` (`load_catalog`, `describe`), `cli catalog`; `asset_manifest` toma las skills del catálogo | `TestCatalog` (3 entradas disponibles, `prepare_skill` ↔ código, hash de la skill de régimen igual al de los registros), `TestCli::test_catalog_lists_three_capabilities` | `s1-step1-catalog.json`, `s2-step1-catalog.json` (la sesión 2 eligió `research` desde el catálogo) | IMPLEMENTED |
| AC-02 (B) | `application/knowledge.py::check_content` / `resolve_ref`; `Antecedent.bearing` obligatorio | `TestSave::test_controls_reject` (archivo inexistente, investigación inexistente), `test_antecedent_without_bearing_is_not_valid_content`, `test_regime_record_can_be_cited` | `s1-step3-research-save.json` (6 refs con sha256), `s2-step6-research-revise.json` (13 refs) | IMPLEMENTED |
| AC-03 (C) | `contracts/research.py` (tipos de afirmación, estado, plan, faltantes, pasos), `ResearchRevision` con host declarado, skill (versión + hash), `resolved_refs` y `content_hash` | `test_valid_investigation_is_stored_with_provenance`, `test_controls_reject` (hecho sin fuente, open sin pasos, test_planned sin hipótesis, sin limitaciones) | `knowledge/research/2026-09-23-gex-0dte-post-cierre.md` (sha256 `ed50078f…`, knowledge `d56a5fb`) | IMPLEMENTED |
| AC-04 (D) | `kb search` (con `--status unfinished`), `kb show` (pendientes, historial, `cited_by`), `research revise` | `TestSearchAndShow`, `TestCli::test_save_search_show_revise` | Sesión 2 sin la conversación: `s2-*` y `s2-transcript.md`; encontró la investigación, leyó pendientes y registró la revisión 2. Defecto hallado (`--status open` no ve `test_planned`) corregido: `s3-kb-search-unfinished-after-fix.json` | IMPLEMENTED (real, con un defecto corregido después) |
| AC-05 (E) | `FileResearchStore.append` (relee y exige revisiones intactas), `RevisionReason` continuation/correction/result, `note` obligatoria; `cited_by` para vínculos entre investigaciones | `TestRevise` (anteriores sin cambios, revisión inválida, autocita, revisión anterior adulterada → `INTEGRITY_FAILED` y `search` la reporta) | Revisión 2 real (`continuation`) sobre la 1, que queda intacta (`s2-step7-kb-show-after.json`) | IMPLEMENTED |
| AC-06 (F) | `record_store` sin cambio de formato (frontmatter extraído a `adapters/frontmatter.py` con el mismo YAML); registros movidos byte a byte | Suite completa (689), incluidos `test_record_regime`, `test_regime_viewer`, E2E de CLI | `migration-report.json` (sha256 igual, integridad OK, `query` igual); `query` sin variables lee `knowledge/regime`: 4 registros, `integrity_failed: []` | IMPLEMENTED |
| AC-07 (G) | Base en `<workspace>/knowledge` (repo de datos propio, `main`), `knowledge_base.knowledge_dir`; nunca se crea implícitamente | `TestLocation` | `g-branch-independence.json` (7 archivos idénticos al cambiar GaleCore-AI de rama y volver; ninguna rama de GaleCore tiene registros en `research/regime`); GaleCore `6e13394` | IMPLEMENTED |
| AC-08 (H) | Ver "Qué se declaró y qué se programó" abajo | `test_prepare_skills_have_code_behind_them` | — | IMPLEMENTED |
| AC-09 (I) | — | gate PASS, ruff, pytest 689 passed, `git diff --check`, wheel PASS (módulos nuevos exigidos) | comandos abajo | IMPLEMENTED |
| AC-10 (J) | — | — | — | PENDING |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
python tools/verify_wheel_assets.py
```

## Implementer handoff

**State:** IMPLEMENTED — pendiente de review (AC-10).

### Qué se declaró y qué se programó (AC-08)

- **Declarado (sin código):** la entrada `research` del catálogo (pedido que resuelve, contrato,
  flujo, dónde se guarda, controles) y la skill `config/skills/research/skill.yaml` (método).
- **Común, generalizado desde GEX y régimen:** el catálogo como lista única de capacidades y skills
  (antes repetida en `cli.py` y `asset_manifest.py`); la ubicación de la base y las referencias
  (`knowledge_base.py`); la lectura/escritura de frontmatter (`frontmatter.py`, usada por los dos
  stores); búsqueda y lectura sobre registros e investigaciones (`knowledge.py::search/show`).
- **Código específico de la investigación:** su contrato (`contracts/research.py`), su store con
  revisiones (`research_store.py`), sus controles (`knowledge.py::check_content`) y sus comandos
  (`research save/revise`). No usa `prepare → accept` ni los guardrails de GEX: parte de
  antecedentes, no de un snapshot de hechos, y controla referencias y estructura.
- **Excepciones que quedan a la vista:** `prepare --skill` sigue mapeando a funciones en código
  (`_SKILLS`; un test exige que coincida con el catálogo); el registro de régimen conserva su formato
  propio; la búsqueda es por términos, no semántica; instalada como wheel fuera del workspace, la
  base necesita `GALECORE_KNOWLEDGE_DIR` (la búsqueda hacia arriba sólo funciona desde un checkout).

### Files changed

GaleCore-AI (`feature/GC-AI-0005`, desde `feature/GC-AI-0004`): `config/catalog.yaml`,
`config/skills/research/skill.yaml`, `src/galecore_ai/adapters/{knowledge_base,frontmatter,research_store}.py`
(nuevos), `adapters/{record_store,asset_manifest,cli}.py`, `application/knowledge.py`,
`contracts/research.py`, `harness/catalog.py`, `tests/unit/test_knowledge.py`,
`tests/unit/test_record_regime.py`, `tools/{migrate_regime_to_knowledge,check_knowledge_branch_independence,verify_wheel_assets}.py`,
`CLAUDE.md`, `docs/evidence/gc-ai-0005/`. Workspace: `.claude/hooks/guard_git.py` (repo `knowledge`,
timeouts por check), `tests/test_guard_git.py`, `.gitignore` (`/knowledge/`). GaleCore
(`feature/pcs-spy-shadow-runtime`, `6e13394`): `research/regime/` → README de puntero. `knowledge/`
(repo nuevo): `c9be9dd`, `d56a5fb`.

### Commands and exact results (2026-09-23, después de `db51c3a`)

```text
python tools/engineering_gate.py          → PASS (10 criterios abiertos)
python -B -m ruff check --no-cache .      → All checks passed!
git diff --check                          → exit 0
python tools/verify_wheel_assets.py       → RESULT: PASS
python -B -m pytest -q -p no:cacheprovider → 689 passed, 1 warning in 121.45s
```

### Limitaciones y decisiones

- La revisión 1 de la investigación real quedó con acentos rotos (bug de stdin ya corregido); no se
  reescribe por ser append-only. Está declarado en la evidencia.
- La "otra sesión" de AC-04 es un subagente con contexto limpio, no una sesión del owner.
- Controles de la investigación: verifican referencias y estructura, no que el razonamiento sea
  correcto ni que la fuente sostenga el hecho.
- `--status open` vs `unfinished`: el cambio de la skill a 1.1.0 queda en las revisiones futuras; las
  revisiones 1 y 2 registran la 1.0.0 que las produjo.
