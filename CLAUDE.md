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

## Start here: the catalog and the knowledge base

```bash
python -B -m galecore_ai.adapters.cli catalog      # what can be asked: capability, skill (version+hash), contract, flow, controls
python -B -m galecore_ai.adapters.cli kb search --text "<terms>" [--kind research|regime|evidence|strategy|profile] [--status unfinished]
python -B -m galecore_ai.adapters.cli kb show <ref>   # regime:SPY/2026-09-23 · research:<id> · profile:v3 · file:<path from the workspace root>
python -B -m galecore_ai.adapters.cli profile show     # the user's profile in force: apply it, cite it, report what is missing or provisional
```

Pick the capability for the user's request from `catalog` (no routing table here), follow its `flow`,
and read its `skill` asset for the method. Before new work, **retrieve**: `kb search` for antecedents
and unfinished investigations. The knowledge base is `<workspace>/knowledge/` (outside every code
checkout, its own data-only git; `GALECORE_KNOWLEDGE_DIR` overrides; never created implicitly). After
a session that wrote to it, commit it: `git -C <workspace>/knowledge add -A`, then
`git -C <workspace>/knowledge commit -m "..."` (local only, never pushed).

Current capabilities: `gex_interpretation` (read-only GEX), `regime_interpretation` (daily regime
with an evaluable record), `research` (resumable investigation, below), `context_research` (context
of a trading idea with GaleCore + the host's external sources; every response kept as `evidence:`),
`strategy_design` (proposal → `strategy check` against the runtime → `strategy save` → owner's
`strategy approve` of the exact hash → `strategy deploy-check` → deploy to SHADOW in GaleCore Dev only) and
`strategy_followup` (what a deployed version did, saved as a revision of its investigation),
`data_sources` (which source covers a need, its cost, limits and last checked access: `sources list|query|check|declare`)
and `user_profile` (objectives, reference capital, horizon, limits, preferred sources, format:
`profile show|set|history`, versions `profile:vN` in `knowledge/profile/`; fields in `provisional` are
placeholders). While a profile exists, `research`/`context_research` refuse to save unless an antecedent
cites the version in force.

Common environment (GaleCore on `localhost:5000`; the ApiKey comes from GaleCore's user-secrets and is never written anywhere):

```bash
export GALECORE_BASE_URL=http://localhost:5000
export GALECORE_API_KEY=<GaleCore ApiKey>
export ALLOW_UNKNOWN_FRESHNESS=true   # PutSkew has no GaleCore timestamp; the regime snapshot is UNKNOWN at best
export MAX_STALENESS_SECONDS=36000    # daily regime records: after the cash session only (16:30–20:00 ET), owner decision F-2; use 600 for intraday GEX
export GALECORE_TIMEOUT_SECONDS=300   # a cold GEX computation can exceed 120 s
```

stdin is read as UTF-8 (a BOM is accepted) whatever the console code page.

Exit codes: `0` SUCCESS · `1` prepare/record/internal failure · `2` INSUFFICIENT_DATA · `3` VALIDATION_ERROR (also argument errors and `query` with an `INTEGRITY_FAILED` record). All output is JSON.

## Vertical 1: GEX-SPY analysis

Full guide with payload rules: `docs/LOCAL-VALIDATION-GEX-INTERACTIVE.md`.

```bash
python -B -m galecore_ai.adapters.cli prepare --symbol SPY                          # PreparedAnalysisView: run_id, facts, asset hashes; snapshot stored internally
echo '{"run_id": "<run_id>", "interpretation": <GexInterpretation JSON>, "host_provider": "claude-code", "host_model": "claude-opus-5"}'   | python -B -m galecore_ai.adapters.cli accept                                    # exit 0 = SUCCESS; non-zero = rejected (result null)
```

`GexInterpretation` in one line: `regime` = `positive_gamma` (net_gex > 0) or `negative_gamma` (net_gex < 0), never `near_zero` (always rejected: call/put GEX and net GEX use incompatible scales); `observations`/`implications` without digits; numbers only in `quantitative_claims` (`net_gex→billion_usd`; `spot`, `zero_gamma_level`, `call_wall`, `put_wall→usd`; value exactly equal to the fact); `evidence` paths must resolve (entailment is not checked); at least one limitation. Never invent, rescale or round numbers; never recommend trading actions; never add facts GaleCore did not provide. Present exactly the accepted payload; do not reformulate.

## Vertical 2: daily regime with an evaluable record

Full guide with payload rules and the record format: `docs/LOCAL-VALIDATION-REGIME-INTERACTIVE.md`.

```bash
python -B -m galecore_ai.adapters.cli prepare --symbol SPY --skill regime          # GEX + 25Δ put skew + VIX/VVIX; any missing/stale source fails closed
echo '{"run_id": "<run_id>", "interpretation": <RegimeInterpretation JSON>, "host_provider": "claude-code", "host_model": "claude-opus-5"}'   | python -B -m galecore_ai.adapters.cli accept --record --prompt "Analizá el régimen de hoy de SPY y guardalo"   # record written only on SUCCESS
python -B -m galecore_ai.adapters.cli record outcome --symbol SPY --date <YYYY-MM-DD> [--run-id <run_id>]      # later: facts now, GALECORE_VERIFIED
python -B -m galecore_ai.adapters.cli record review  --symbol SPY --date <YYYY-MM-DD> --run-id <run_id> --verdict agree|partial|disagree --comment "..."
python -B -m galecore_ai.adapters.cli query --symbol SPY --since <YYYY-MM-DD> [--until <YYYY-MM-DD>]           # no model call; INTEGRITY_FAILED is reported, never skipped
```

`RegimeInterpretation` in one line: `gamma_regime` by the sign of `net_gex`; `tail_pricing` = `calm`/`elevated` exactly as `facts.put_skew_level_ok`; prose without digits; numbers only in `quantitative_claims` with the fact's exact value and its unit (`billion_usd`, `usd`, `ratio`, `iv_decimal`, `index_points`); `evidence` paths must resolve; at least one limitation. Records: `<workspace>/knowledge/regime/<SYMBOL>/<YYYY-MM-DD>.md` (America/New_York date; moved from `GaleCore/research/regime/` by GC-AI-0005; `GALECORE_RECORDS_DIR` overrides), one file per day (YAML frontmatter = the record), entries appended, acceptance-time content covered by `entry_hash`. Never compare with earlier sessions from memory — only through `query`, stated in limitations. Present the accepted payload and the record path; do not reformulate.

## Capability 3: resumable investigation (`research`, GC-AI-0005)

No GaleCore needed. Method: `config/skills/research/skill.yaml`.

```bash
python -B -m galecore_ai.adapters.cli kb search --text "<idea>"          # antecedents; --status unfinished = open or test_planned
echo '{"content": <ResearchContent JSON>, "host_provider": "claude-code", "host_model": "<model>"}' | python -B -m galecore_ai.adapters.cli research save --slug <slug> --prompt "<user request>"
python -B -m galecore_ai.adapters.cli kb show research:<id>                 # pending next steps, missing, history, cited_by
echo '{...}' | python -B -m galecore_ai.adapters.cli research revise --id <id> --reason continuation|correction|result --note "<what changes>" --prompt "<user request>"
```

`ResearchContent` in one line: `title`, `question`, `status` (open | test_planned | concluded | abandoned);
`antecedents` `{ref, summary, bearing}` — each ref must resolve and `bearing` says how it changes the
hypothesis or plan; `statements` `{kind: fact|interpretation|hypothesis|decision, text, sources}` — a fact
cites a source; `hypothesis`; `test_plan` `{step, data_needed, supports_if, weakens_if}`; `missing`;
`next_steps` (required while open or test_planned); at least one limitation. Revisions are append-only
and hashed. Storing does not validate the reasoning; it is not a strategy.

## Capability 4: context of a trading idea (`context_research`, GC-AI-0007)

Method: `config/skills/context-research/skill.yaml` (factors by idea and horizon, sources by verified
access, observation / implied expectation / consensus / hypothesis, competing scenarios). Each source
response used is stored first, then cited; the investigation itself is `research` with the method stamped:

```bash
echo '{"content": <EvidenceContent JSON>, "host_provider": "...", "host_model": "..."}' | python -B -m galecore_ai.adapters.cli evidence add --slug <source-series> --prompt "<request>"
echo '{"content": <ResearchContent JSON>, ...}' | python -B -m galecore_ai.adapters.cli research save --capability context_research --slug <slug> --prompt "<request>"
python -B -m galecore_ai.adapters.cli kb search --text "<terms>" --kind evidence
```

Evidence (`<knowledge>/evidence/<id>.json`) is create-only, hashed and always `HOST_DECLARED`: GaleCore-AI
did not fetch it and never labels it GaleCore-verified. Params that may carry credentials are refused.

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
| Regime Skill | `config/skills/regime-analysis/skill.yaml` | Daily regime: GEX + put skew + VIX/VVIX, output contract, examples |
| Research Skill | `config/skills/research/skill.yaml` | Resumable investigation: antecedents, typed statements, test plan, next steps |
| Catalog | `config/catalog.yaml` | Every capability: request served, skill, contract, flow, storage, controls |
| Facts Discipline | `config/protocols/facts-discipline.yaml` | Guardrails: no invented numbers, facts match source, no trading recommendation, no numbers in prose, quantitative claims valid |
| Trading Defaults | `config/conventions/trading-defaults.yaml` | Near-zero threshold, timezone, currency |

## Constraints

- Phases 3–4 are read-only. No trading actions, no strategy development.
- No secrets in code, logs, fixtures, or traces.
- Do not modify GaleCore.
- Do not expand the autonomous runtime (FastAPI/CognitiveRuntime — frozen).
- The accepted payload is the boundary of SUCCESS. Reformulating after acceptance does not inherit that acceptance.

## Reference

- Architecture: `docs/architecture/GaleCore-AI-arquitectura-v5.md`
- Contracts: `docs/architecture/P0-CONTRACTS.md`
- Validation guides: `docs/LOCAL-VALIDATION-GEX-INTERACTIVE.md` (GEX), `docs/LOCAL-VALIDATION-REGIME-INTERACTIVE.md` (regime + record)
- Record viewer + review adapter for the monitor (loopback, reuses `query`/`record_review`): `docs/LOCAL-REGIME-VIEWER.md` — `python -B -m galecore_ai.adapters.regime_viewer`
- Phase 4 alignment: `docs/architecture/PHASE4-ALIGNMENT.md`
