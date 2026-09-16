# GaleCore-AI — Domain Intelligence + Assurance

## Engineering workflow gate

Before changing this repository, read `AGENTS.md`, `docs/engineering/ACTIVE_WORK_ITEM`, the referenced work item, and `docs/engineering/OPERATING-MODEL.md`.

The active item is the only authorized implementation scope. Respect its feature and closure freezes. As implementer, update its evidence matrix and handoff; do not mark your own work `VALIDATED` or `CLOSED`. A different reviewer must inspect the actual diff and evidence. Run `python tools/engineering_gate.py` before reporting readiness.

## What this repository is

GaleCore-AI transforms a general host (like Claude Code) into a disciplined financial specialist for GaleCore. It provides versioned cognitive assets, structured contracts, and deterministic assurance — not a standalone AI application.

## Architecture (v5)

```
GaleCore     = financial machine and operational truth
GaleCore-AI  = domain intelligence and deterministic assurance
Host         = environment that runs the model (Claude Code, Codex, etc.)
```

The host executes the model. GaleCore-AI teaches it how to work and verifies the output.

## Current vertical: GEX-SPY analysis

The only active use case is: **"Analizá el GEX actual de SPY."**

### How to execute

**Step 1 — Prepare** (requires GaleCore running on localhost:5000):

```bash
GALECORE_BASE_URL=http://localhost:5000 \
GALECORE_API_KEY=<your GaleCore ApiKey from user-secrets> \
ALLOW_UNKNOWN_FRESHNESS=true \
MAX_STALENESS_SECONDS=600 \
python -B -m galecore_ai.adapters.cli prepare --symbol SPY
```

This outputs a `PreparedAnalysisView` JSON with `run_id`, `facts`, and asset hashes. The authoritative snapshot is stored internally.

**Step 2 — Interpret** (you are the host):

Read the facts from the prepare output. Produce a `GexInterpretation` JSON following these rules:

- **regime**: `positive_gamma` if net_gex > 0, `negative_gamma` if net_gex < 0. Do not use `near_zero`: the validator always rejects it because GaleCore publishes call_gex/put_gex and net_gex in incompatible scales.
- **observations**: qualitative prose about dealer positioning (at least 1). **No digits** — any number in prose is rejected.
- **implications**: qualitative prose about expected market behavior. **No digits.**
- **quantitative_claims**: where interpretive numbers go (at least 1). Each is `{"metric", "value", "unit"}` with `metric` in `net_gex | spot | zero_gamma_level | call_wall | put_wall`, `unit` = `billion_usd` for net_gex and `usd` for the rest, and `value` exactly equal to the fact (1500.0 stays 1500.0, never 1.5). call_gex/put_gex cannot be claimed.
- **evidence**: array of `{fact_path, claim}` linking qualitative claims to facts (at least 1). Paths like `facts.net_gex`, `facts.spot`. The validator checks the path resolves; it does not prove the prose is entailed.
- **limitations**: data quality notes, timing caveats (at least 1). Digits are allowed here only if they match a fact value; prefer prose.
- **NEVER** invent, rescale or round numbers
- **NEVER** recommend trading actions
- **NEVER** add facts or calculations not provided by GaleCore

**Step 3 — Accept**:

```bash
echo '{"run_id": "<run_id from prepare>", "interpretation": <your JSON>, "host_provider": "claude-code", "host_model": "claude-opus-5"}' | python -B -m galecore_ai.adapters.cli accept
```

Exit code 0 = SUCCESS. Non-zero = rejected (result is null).

**Step 4 — Present**: Show the user exactly the accepted payload. Do not reformulate or add new claims after acceptance.

### What the assets prove and what they don't

- Asset hashes in the prepare output prove **which definitions were loaded**
- They do **not** prove the host read or obeyed them
- `HOST_DECLARED` provenance means the validator recorded what the host claimed but did not independently verify it
- `GALECORE_VERIFIED` means the facts came through controlled integration with GaleCore

## Cognitive assets

| Asset | Path | Purpose |
|---|---|---|
| TradingAgent | `config/agents/trading-agent.yaml` | Agent definition: mission, capabilities, restrictions |
| GEX Skill | `config/skills/gex-analysis/skill.yaml` | Instructions, output contract, examples |
| Facts Discipline | `config/protocols/facts-discipline.yaml` | Guardrails: no invented numbers, facts match source, no trading recommendation, no numbers in prose, quantitative claims valid |
| Trading Defaults | `config/conventions/trading-defaults.yaml` | Near-zero threshold, timezone, currency |

## Constraints

- Phase 3 is read-only. No trading actions, no strategy development.
- No secrets in code, logs, fixtures, or traces.
- Do not modify GaleCore.
- Do not expand the autonomous runtime (FastAPI/CognitiveRuntime — frozen).
- The accepted payload is the boundary of SUCCESS. Reformulating after acceptance does not inherit that acceptance.

## Reference

- Architecture: `docs/architecture/GaleCore-AI-arquitectura-v5.md`
- Contracts: `docs/architecture/P0-CONTRACTS.md`
- Validation guide: `docs/LOCAL-VALIDATION-GEX-INTERACTIVE.md`
