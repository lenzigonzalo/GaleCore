---
id: GC-AI-0014
title: Orden de fuentes por tipo de uso (regla del owner)
status: READY_FOR_REVIEW
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-0014 — Orden de fuentes por tipo de uso

Complemento de GC-AI-0012 (mapa de fuentes), decisión del owner del 29/09 sobre el MINOR que quedó abierto (el desempate
por costo comparaba la prosa alfabéticamente).

## Acuerdo breve

- **Regla del owner (29/09):** «depende la consulta: si es algo liviano y es mejor ir por MCP y el MCP es gratis,
  genial; si es algo que requiere de GaleCore, GaleCore; si tenemos un límite diario usarla sólo cuando haga falta».
  Propuesta aceptada («ok»): ordenar por tipo de uso — gratis → propia (GaleCore) → cupo diario → limitada por plan;
  dentro del mismo tipo decide `preference`.
- **Para qué:** que `sources query` devuelva primero la fuente más barata que cubre el dato y avise cuándo una consume
  cupo, en vez de un orden por texto que no significa nada.
- **Cómo veremos que sirve:** «curva de tasas» → FRED (gratis) antes que Alpha Vantage (cupo) y FMP (plan);
  «cotizaciones de SPY» → GaleCore antes que FMP; GEX → sólo GaleCore; Alpha Vantage aparece con el aviso de cupo.

## Non-goals

- Contar el consumo diario de cupos (se agrega cuando un cupo se agote de verdad en un trabajo).
- Clasificar «liviano/pesado» por pedido: lo que sólo calcula GaleCore ya sale sólo de GaleCore por cobertura.

## Acceptance criteria

- [x] **AC-01 — Tipo de uso declarado:** cada fuente del registro declara `usage` (free | own | daily_quota | plan); el
  contrato lo exige.
- [x] **AC-02 — Orden y aviso:** `sources query` y `sources list` ordenan por tipo de uso y después `preference`; cada
  resultado informa su tipo, y las de cupo diario dicen que se usan sólo si las anteriores no cubren el dato.
- [x] **AC-03 — Métodos al día:** catálogo y skills (`data-sources`, `context-research`, regla 0 de `research`)
  describen el orden nuevo; las fuentes preferidas del perfil desempatan dentro del mismo tipo.
- [ ] **AC-04 — Revisión:** interna y Codex; cierre, el owner.

## Requirement-to-evidence matrix

| Criterio | Implementación | Verificación automática | Artefacto | Estado |
|---|---|---|---|---|
| AC-01 | `contracts/sources.py` (`Usage`, `USAGE_RANK`, `DataSource.usage` obligatorio); `config/sources.yaml` (galecore own, fred free, alpha_vantage daily_quota, fmp plan) | `test_usage_is_required`, `test_every_usage_has_a_rank`, `test_config_sources_yaml_loads_and_validates` | — | DONE |
| AC-02 | `application/source_query.py` (`_sort_key` = rango de uso, preference, id; `usage` y `usage_note` en cada resultado) | `test_free_before_own_before_quota_before_plan_then_preference` (query y list, nota de cupo); `test_real_registry_follows_the_owners_rule` (registro real: tasas → fred, alpha_vantage, fmp; cotizaciones de SPY → galecore, fmp; GEX → sólo galecore) | `docs/engineering/reviews/GC-AI-0014-20260929T221435Z.md` (checks y reproducción por CLI: tasas fred → alpha_vantage → fmp; SPY galecore → fmp; GEX sólo galecore) | DONE |
| AC-03 | `config/catalog.yaml` (control de `data_sources`); `config/skills/data-sources` 1.1.0 (prompt e instrucciones); `context-research` 0.4.0 (reglas 0 y 4); `research` 1.3.0 (regla 0); ayuda de la CLI | — (texto de método; el desempate por las fuentes preferidas del perfil es instrucción al host, sin evaluación de comportamiento) | — | DONE (con esa limitación) |
| AC-04 | — | — | reviews en `docs/engineering/reviews/GC-AI-0014-*` | PENDING |

## Implementer handoff — Increment 1 (2026-09-29)

**Qué se hizo:** el registro declara cómo se paga el uso de cada fuente y la consulta ordena por ese tipo antes que por
`preference`; las de cupo diario llevan un aviso. Textos de método al día.

**Revisión interna R1 (`reviewer`):** APPROVE, 0 BLOCKER/MAJOR. MINOR: (1) las fuentes preferidas del perfil pasan a
desempatar sólo dentro del mismo tipo — hoy sin efecto (GaleCore es la única `own`); **confirmado por el owner el
29/09** («Si y 2 tambien»); (2) faltaba un test de que cada `Usage` tenga rango — agregado (`test_every_usage_has_a_rank`).

**Codex C1 (`GC-AI-0014-20260929T211332Z.md`) — CHANGES_REQUESTED → corregido:** matriz y handoff agregados;
«cotizaciones de SPY» ahora devuelve GaleCore y después FMP (la cobertura de FMP decía «quote/batch-quote», no
«cotizaciones») y el test fija la secuencia completa; instrucción de `data-sources` al día; handoff de sesión al día.
MINOR `codex_review.py`: se mantiene — es el driver con el que corre `/review-codex` sobre un worktree, con el mismo
patrón en `docs/evidence/gc-ai-0006..0013/`; no se presenta como evidencia de aceptación.

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```

## Independent review 2 (Codex, `--recheck`, 2026-09-29T22:14:35Z) — `docs/engineering/reviews/GC-AI-0014-20260929T221435Z.md` — APPROVE

Los cuatro MAJOR de C1, resueltos. MINOR `codex_review.py`: aceptado como DISPUTED (driver establecido, no es evidencia
de aceptación). MINOR nuevo (puntero de artefacto de AC-02): corregido a este review, que contiene la reproducción.
Queda el cierre del owner.
