> **HISTÓRICO — no se sigue.** Archivado el 05/10/2026 (F0-1, WS-0003). Objetivo y plan vigentes:
> `roadmap/README.md` del workspace; forma de trabajo: `ENGINEERING.md` del workspace; estado para retomar:
> «Para retomar» de cada work item.

# GaleCore-AI agentic engineering operating model

> **Superseded (2026-09-16):** the operating model of the whole ecosystem now lives in the workspace repo, `../ENGINEERING.md` (github.com/lenzigonzalo/galecore-workspace). This file is kept because the engineering gate, `AGENTS.md` and the work items reference it; its content below is the GaleCore-AI-specific view and must not diverge from `ENGINEERING.md`. When in doubt, `ENGINEERING.md` wins.

## Purpose

This protocol keeps Codex, Claude Code, and future coding agents aligned around one reviewable objective. It is a lightweight engineering control plane based on repository artifacts. It does not add an agent platform or autonomous orchestration to GaleCore-AI.

## Roles

| Role | Responsibility | Current default |
|---|---|---|
| Product owner | Sets priority, resolves product decisions, approves final closure | User |
| Lead/reviewer | Defines acceptance criteria, checks architecture, independently verifies implementation and evidence | Codex |
| Implementer | Changes code and docs, runs checks, produces the structured handoff | Claude Code |

Roles may change per work item, but the implementer cannot be the sole final reviewer of the same change.

## One active work item

`ACTIVE_WORK_ITEM` points to the only authorized work item. Every work item states:

- objective and non-goals;
- roles and current state;
- scope and feature/closure freezes;
- acceptance criteria;
- requirement-to-evidence matrix;
- validation commands;
- implementer handoff;
- independent review result.

New discoveries go to the active item's findings or the product backlog. They do not silently expand scope.

## States

```text
DRAFT -> APPROVED -> IN_PROGRESS -> READY_FOR_REVIEW
                    ^                    |
                    |                    v
               CHANGES_REQUESTED <- independent review
                                         |
                                         v
                                      VALIDATED -> CLOSED
```

`BLOCKED` is allowed when an external dependency prevents progress. `VALIDATED` means every acceptance criterion has reproducible evidence and an independent reviewer approved it. `CLOSED` additionally requires product-owner acceptance when the work item says so.

## Development loop

1. **Contract:** lead and product owner define objective, boundaries and observable acceptance criteria.
2. **Implementation:** implementer changes only the active scope and records material decisions.
3. **Self-check:** implementer runs the required commands and links artifacts; summaries are not evidence by themselves.
4. **Handoff:** implementer reports files changed, criteria believed satisfied, commands and known gaps.
5. **Independent review:** reviewer inspects the actual diff and artifacts, reruns checks, and records findings by severity.
6. **Correction:** failed criteria return the item to `CHANGES_REQUESTED`.
7. **Closure:** milestone language changes only after the evidence matrix is complete and the gate passes.

## Evidence rules

- Every acceptance criterion maps to code, a test or evaluation, and an artifact when applicable.
- Real-host or real-GaleCore claims require sanitized, reproducible evidence. A prose statement is insufficient.
- Model behavior claims require actual outputs and a documented evaluation protocol.
- Record timestamps in UTC and distinguish observed metadata from host-declared metadata.
- Never store credentials, tokens, private headers, chain-of-thought, or sensitive raw logs.
- Passing unit tests cannot substitute for an E2E criterion or cognitive evaluation.

## Change isolation

The current dirty worktree predates this protocol, so `GC-AI-0001` is a stabilization exception. After it closes, each new work item should use a dedicated branch or worktree and small reviewable commits. Two agents must not edit the same worktree concurrently.

## Required gates

Before `READY_FOR_REVIEW`:

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```

Before `VALIDATED` or `CLOSED`, the independent reviewer reruns the applicable commands, verifies every evidence link, and records `review_result: APPROVED`.

## How this model is executed

The rules above are enforced by workspace tooling in `../.claude/` (the folder above this
repository, shared with GaleCore), not by memory or prose:

| Rule | Mechanism |
|---|---|
| Every session knows the active item, its freezes and unmet criteria | `SessionStart` hook prints them from `ACTIVE_WORK_ITEM` |
| Ruff never reaches the reviewer | `PostToolUse` hook runs `ruff --fix` on each edited `.py`; leftovers are returned to the implementer |
| Required gates run before any commit | `PreToolUse` hook on `git commit` runs gate, Ruff, pytest and `git diff --check`; failure blocks the commit |
| No push during the MVP | `PreToolUse` hook blocks `git push` |
| Internal review before the expensive one | `reviewer` subagent (Opus, high effort, read-only) returns findings by severity |
| Handoff and evidence matrix are cheap and factual | `handoff` subagent (Haiku) fills them from `git diff` and real check output; it cannot change status |
| Independent review by a different model family | `/review-codex` runs `codex exec review` non-interactively and saves the result in `docs/engineering/reviews/` |

Model routing: implementation on Opus; internal review on Opus at high effort; summaries,
handoffs and code search on Haiku. The user remains the approver and the only one who moves an
item to `VALIDATED` or `CLOSED`.

## Communication format

Agent summaries must lead with current state and unmet criteria. They must distinguish:

- implemented;
- verified locally;
- verified E2E;
- host-declared;
- inferred;
- pending or blocked.

No agent may use test count, file count, or implementation completion alone to announce phase closure.
