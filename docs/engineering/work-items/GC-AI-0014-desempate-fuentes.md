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

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```
