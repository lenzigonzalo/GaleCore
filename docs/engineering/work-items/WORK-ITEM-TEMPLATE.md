---
id: GC-AI-NNNN
title: Short title
status: DRAFT
implementer: UNASSIGNED
reviewer: UNASSIGNED
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-NNNN — Short title

## Qué y para qué

- **Qué hacemos:** una línea.
- **Para qué:** qué podrá hacer el owner cuando esté.
- **Cómo veremos que sirve:** lo que se ve funcionando.
- **Qué queda fuera:** lo que no entra.
- **Filas del catálogo:** U-xx (`roadmap/README.md` §1.4) y pieza del plan (§3).

## Objective

State one observable outcome.

## Non-goals

- Explicitly excluded work.

## Scope

List allowed components and constraints.

## Acceptance criteria

- [ ] **AC-01 — Observable name:** verifiable result.

## Requirement-to-evidence matrix

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 | PENDING | PENDING | PENDING | PENDING |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```

## Implementer handoff

**State:** PENDING

### Files changed

- PENDING

### Criteria claimed complete

- PENDING

### Commands and exact results

- PENDING

### Known gaps and risks

- PENDING

## Independent review

**Reviewer:** PENDING  
**Review result:** PENDING  
**Reviewed revision/worktree:** PENDING

### Findings

- PENDING

### Verification rerun

- PENDING

### Product-owner decision

- PENDING

## Para retomar

≤ 30 líneas, al cerrar cada sesión: dónde quedó, qué sigue, qué falta comprobar y el comando para abrir la
sesión siguiente (`claude -n <id> "retoma"`). Reemplaza a `SESSION_HANDOFF.md` (archivado el 05/10/2026).
