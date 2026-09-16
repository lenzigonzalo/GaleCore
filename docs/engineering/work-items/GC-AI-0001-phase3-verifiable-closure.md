---
id: GC-AI-0001
title: Phase 3 verifiable closure
status: READY_FOR_REVIEW
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: true
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-0001 — Phase 3 verifiable closure

## Objective

Stabilize the existing interactive GEX vertical and determine Phase 3 status from reproducible evidence. Correct traceability, trust-boundary claims, deterministic assurance, CLI behavior, E2E evidence, cognitive evaluation, and documentation before any new feature work.

## Non-goals

- New Skills or financial verticals.
- Strategy Development, SHADOW, PAPER or LIVE execution.
- Multi-agent orchestration, long-term memory platform, scheduling or new model providers.
- Modifying GaleCore.
- Reorganizing the repository beyond files required by these criteria.

## Scope

The current uncommitted Phase 3 changes are the implementation baseline. Preserve them and correct them in place. New product work remains frozen until this item is independently validated or explicitly superseded by the product owner.

## Acceptance criteria

- [ ] **AC-01 — Complete trace:** accepted and rejected results record snapshot identity, internally observed timestamps, facts provenance, effective asset IDs/versions/hashes, capability, freshness, guardrails, status, and explicitly host-declared model metadata. *Scope note (Codex review 1):* a rejection that happens before a stage (snapshot not found → no snapshot identity; integrity failure → no freshness/cognitive checks) records the stages it reached plus an explicit `snapshot_integrity` entry and the error; it does not fabricate entries for stages that never ran.
- [ ] **AC-02 — Honest trust boundary:** code and docs describe the file store as a cooperative local protocol boundary, validate TTL configuration, and fail closed on missing, expired or corrupt snapshots without claiming same-user filesystem isolation.
- [ ] **AC-03 — Contract and guardrails:** `limitations` follows the canonical minimum rule; trading directives matching the documented pattern set (English/Spanish, `harness/guardrails.py`) cannot receive `SUCCESS` and each pattern is covered by an adversarial test; novel phrasings are a declared limitation, not a guarantee; semantic limits remain documented. *(Wording narrowed by product-owner decision, 2026-09-16, option (a) of review 3 B1.)*
- [ ] **AC-04 — JSON CLI:** argument parsing and runtime errors produce documented JSON and exit codes, including a missing `--symbol` test.
- [ ] **AC-05 — Reproducible E2E:** sanitized evidence records a real GaleCore/interactive-host positive case and required negative cases with commands, timestamps, expected/observed results and exit codes. If dependencies are unavailable, the criterion remains pending.
- [ ] **AC-06 — Real cognitive evaluation:** 5–10 comparable cases contain actual with-assets and without-assets outputs, scoring, aggregate results and methodological limits. Illustrative prose does not satisfy this criterion. *(Product-owner decision, 2026-09-16: accepted as a documented gap for Phase 3 closure. `docs/evidence/phase3-gex-cognitive-evaluation.md` stays labelled as a simulated, non-independent mechanism check; no cognitive-effect claim is made anywhere. A real evaluation is deferred to a future work item.)*
- [ ] **AC-07 — Documentation coherence:** architecture, alignment, executive summary, handoff, validation guide and host entry point agree with implemented and validated maturity.
- [ ] **AC-08 — Repository validation:** engineering gate, pytest, Ruff, diff check and wheel build pass; required runtime assets are present in the wheel.
- [ ] **AC-09 — Independent review:** reviewer inspects the actual diff/evidence, reruns checks, resolves blocking findings and records approval separately from the implementer handoff.

## Requirement-to-evidence matrix

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 | IMPLEMENTED (pending AC-09) | accept tests incl. `conventions_hash` and `snapshot_integrity` in trace | `docs/evidence/increment4-e2e/P1-positive.json` (full trace), `N16` (integrity rejection trace), `N06` (missing snapshot) | IMPLEMENTED |
| AC-02 | IMPLEMENTED (pending AC-09) | store tests + `TestConventionIntegrity` (missing/malformed/mutated `conventions_hash` fail closed) | Threat-model statement in docstring + docs; manual case E | DONE |
| AC-03 | IMPLEMENTED (pending AC-09) | `test_interpretation_assurance.py` (77: omitted-field schema rejection, hold/accumulate directives EN+ES, near_zero fail-closed, closed metric/unit contract, no numbers in prose, evidence limits), guardrail tests EN+ES, golden cases 3/9–12 | Guardrail cases; manual cases A, C, D, F | DONE |
| AC-04 | IMPLEMENTED (pending AC-09) | 8 CLI subprocess tests | CLI subprocess outputs | DONE |
| AC-05 | IMPLEMENTED (pending AC-09) | `tools/e2e_interactive_cases.py` (reproducible runner) | `docs/evidence/increment4-e2e/` — 1 positive + 21 negatives on the current schema against live GaleCore, one JSON per case with exact stdin/stdout/exit code (2026-09-16). `phase3-gex-interactive-e2e.md` and `phase3-increment4-manual-cases.md` kept as history | IMPLEMENTED |
| AC-06 | ACCEPTED GAP | N/A | `docs/evidence/phase3-gex-cognitive-evaluation.md` (simulated mechanism check, not a cognitive evaluation) | ACCEPTED GAP (product owner, 2026-09-16) |
| AC-07 | IMPLEMENTED (pending AC-09) | Engineering gate | v5, alignment (host adapter row now CURRENT_IMPLEMENTED), validation guide (real current-schema payload and trace), CLAUDE.md, skill/protocol/instructions updated | IMPLEMENTED |
| AC-08 | Existing suite | Commands below | Exact command results in the Codex-review-1 resolution section; wheel rebuilt from the final tree, packaged assets byte-compared | IMPLEMENTED |
| AC-09 | N/A | Reviewer rerun | Review record below | PENDING |

### AC-06 status: ACCEPTED GAP (product-owner decision 2026-09-16; the text below is the original BLOCKED analysis, kept as history)

The cognitive evaluation in `docs/evidence/phase3-gex-cognitive-evaluation.md` was produced by the same operator (Claude Code) for both with-assets and without-assets conditions, with full knowledge of the guardrails and asset contents. This is not a blind evaluation and the "without assets" outputs simulate failure modes rather than representing genuine model behavior without asset context.

**What would satisfy AC-06:**
1. Two separate model invocations: one with asset prompt context, one without.
2. The invocations must be independent — the operator for condition A must not have knowledge of condition B's expected output.
3. Minimum 5 case pairs with automated scoring plus human review of semantic quality.
4. Methodological limitations (sample size, same model, etc.) documented honestly.

**Why this is blocked:** The interactive host path (`model_called=false` / `validator_called_model=false`) means the validator cannot orchestrate independent model invocations. A real evaluation requires either: (a) the autonomous runtime path with controlled prompts, or (b) a manual protocol where two separate sessions produce outputs independently. Neither is available within the current scope without additional infrastructure or manual effort by the product owner.

The existing evaluation document is preserved as evidence of the mechanism (guardrails catch the modeled failure modes) but does not satisfy the criterion for independent evaluation.

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
python -m build --wheel
```

Inspect the wheel and verify that canonical assets required at runtime are packaged.

**Important (F-08):** The engineering gate (`python tools/engineering_gate.py`) validates structural prerequisites — work item exists, status is tracked, feature freeze is respected. A PASS from the gate does **not** mean the work item is closed or that acceptance criteria are satisfied. Closure requires independent review (AC-09) and product-owner approval.

## Process deviation record (F-09)

Commits `421c019` and `bbbc5a7` were made during a period that was described as a read-only checkpoint in the previous session handoff. This was a process deviation — the implementer should not have committed during that phase. The commits contain legitimate implementation work (not destructive), but the timing violated the stated operating model.

**Decision:** The commits are not reverted because they contain valid work. The deviation is documented here as an honest record. Future sessions must respect stated checkpoint constraints.

## Implementer handoff (increment 2)

**State:** READY_FOR_REVIEW
**Date:** 2026-09-16
**Previous increment:** 2026-09-16 (increment 1, reviewed by Codex → CHANGES_REQUESTED)

### Findings addressed

| Finding | Resolution | Tests |
|---|---|---|
| F-01 (AC-06 not real) | AC-06 marked BLOCKED with protocol for real eval | N/A (process) |
| F-02 (Spanish trading recs) | 8 Spanish patterns added to `_TRADING_REC_PATTERNS` | 10 new parametrized cases |
| F-03 (near_zero magnitude) | 5% threshold from trading-defaults.yaml enforced; fail-closed without call_gex/put_gex | 8 new tests in TestNearZeroMagnitude |
| F-04 (misattribution) | Documented that `facts_match_source` already validates per-path; added 3 adversarial tests | TestMisattribution (3 tests) |
| F-05 (model_called ambiguous) | Replaced `model_called` with `validator_called_model` + `host_model_execution` | All existing trace tests updated |
| F-06 (asset compliance) | Clarified in CLAUDE.md and docs that hashes prove loading, not compliance | Doc updates |
| F-07 (evidence count) | Reconciled: E2E evidence has 1 positive + 13 negative cases (13 in work item was correct including all negatives; artifact had 10 at first increment, now 13) | Updated evidence doc |
| F-08 (gate vs closure) | Added explicit note distinguishing gate PASS from closure status | Work item section above |
| F-09 (process deviation) | Documented honestly in work item | Section above |

### Files changed (increment 2)

**Guardrails:**
- `src/galecore_ai/harness/guardrails.py` — Added 8 Spanish trading rec patterns; updated `no_invented_numbers` docstring to document misattribution boundary

**Assurance:**
- `src/galecore_ai/application/validate_interpretation.py` — Implemented near_zero 5% magnitude threshold with fail-closed on missing call_gex/put_gex

**Contracts:**
- `src/galecore_ai/contracts/agent_run.py` — Replaced `model_called: bool` with `validator_called_model: bool` + `host_model_execution: str`

**Application:**
- `src/galecore_ai/application/accept_interpretation.py` — Updated to use new trace fields
- `src/galecore_ai/harness/runtime.py` — Updated to use `validator_called_model`

**Tests:**
- `tests/unit/test_guardrails.py` — 10 Spanish adversarial cases, 3 misattribution tests (TestMisattribution)
- `tests/unit/test_interpretation_assurance.py` — 8 near_zero magnitude tests (TestNearZeroMagnitude)
- `tests/unit/test_accept_interpretation.py` — Updated for new trace fields
- `tests/unit/test_trace.py` — Updated for new trace fields
- `tests/evals/test_gex_golden_cases.py` — Updated for new trace fields

**Docs:**
- `docs/engineering/work-items/GC-AI-0001-phase3-verifiable-closure.md` — This file: AC-06 BLOCKED, process deviation, gate clarification, new handoff

### Commands and exact results

```
> python tools/engineering_gate.py
Engineering gate: GC-AI-0001
Status: CHANGES_REQUESTED
WARNING: 9 acceptance criteria remain open
WARNING: feature freeze is active; only the active work item is authorized
PASS

> python -B -m pytest -q -p no:cacheprovider
331 passed, 1 warning in 16.82s

> python -B -m ruff check --no-cache .
All checks passed!
```

### Specific regression checks

- **Spanish trading rec:** "Comprar puts de SPY" → REJECTED (no_trading_recommendation)
- **near_zero rejection:** net_gex=200000, call_gex=1000000, put_gex=-1000000 (10% >= 5%) → REJECTED (gex_regime_sign)
- **near_zero acceptance:** net_gex=50000, call_gex=1000000, put_gex=-1000000 (2.5% < 5%) → ACCEPTED
- **near_zero fail-closed:** missing call_gex → REJECTED (fail-closed)
- **Misattribution:** evidence `facts.net_gex` + claim "750" when net_gex=1500 → REJECTED (facts_match_source)
- **Host metadata provenance:** `validator_called_model=false`, `host_model_execution=HOST_DECLARED`
- **Rejected trace completeness:** rejected results still contain facts_hash, prepared_at, assets, provider

### Known gaps and risks

- **AC-06 BLOCKED**: cognitive eval is not blind; requires independent protocol (see section above)
- **AC-09 PENDING**: independent review not yet performed for this increment
- `no_trading_recommendation` is pattern-based; novel phrasings in languages other than English/Spanish bypass it
- Near-zero magnitude validated at 5% threshold; units depend on GaleCore's GEX calculation methodology
- Numbers in observations not backed by evidence refs can match unrelated fact values (known limitation, documented in guardrail docstring)
- Store is ephemeral; no durable trace persistence
- Free-text semantic claims not verified

## Independent review

**Reviewer:** Codex
**Review result:** PENDING
**Reviewed revision/worktree:** PENDING

### Findings

- Phase closure remains blocked until every acceptance criterion has reproducible evidence.
- AC-06 is explicitly BLOCKED pending real independent evaluation protocol.

### Verification rerun

- PENDING

### Product-owner decision

- PENDING

---

## Implementation checkpoint — Increment 4 contracts

**Date:** 2026-09-16
**Type:** Conceptual checkpoint — no code changes
**Status:** Approved — D1–D7 approved by product owner with mandatory Codex adjustments

### Approval record — Increment 4

**Product owner:** Approved D1–D7 on 2026-09-16.
**Reviewer (Codex) mandatory adjustments:**
1. Claims must use raw fact values (e.g. 1500.0), not normalized (not 1.5)
2. Units are a closed technical contract (enums), not conventions
3. near_zero always rejected — host can propose it, validator always rejects
4. No grace period for snapshots without conventions_hash
5. metric and unit must be closed enums/allowlists
6. Validator derives fact_path from metric internally
7. EvidenceRef qualitative — does not prove semantic entailment
8. call_gex/put_gex not enabled as quantitative metrics (unit not formally published)
9. fact_path not received from host; derived internally, optionally included in trace

**Implementation started:** 2026-09-16 (first session hit its usage limit after D1/D2 and half of D5; a second session resumed from the working tree and the saved spec on 2026-09-16 and completed D1–D7).

---

### 1. Evidence of GaleCore's current unit contract

Source files inspected (GaleCore repo, not GaleCore-AI):

| File | Relevant code | Unit |
|---|---|---|
| `GammaExposureHandler.cs:576` | `strikeResult.CallGEX = Math.Round(gex / 1_000_000, 4)` | raw_gex / 10⁶ |
| `GammaExposureHandler.cs:586` | `strikeResult.PutGEX = Math.Round(-gex / 1_000_000, 4)` | raw_gex / 10⁶ |
| `GammaExposureResponse.cs:88-95` | `CallGEX => Strikes.Sum(x => x.CallGEX)` | sum of per-strike (millions) |
| `GammaExposureResponse.cs:97-103` | `PutGEX => Strikes.Sum(x => x.PutGEX)` | sum of per-strike (millions) |
| `GammaExposureResponse.cs:105-110` | `NetGEX => (CallGEX + PutGEX) / 1000` | millions / 1000 = **billions** |
| `GexAnalysisHandler.cs:199-201` | `CallGex = gex.CallGEX, PutGex = gex.PutGEX, NetGex = gex.NetGEX` | direct copy |
| `GexAnalysisResponse.cs:65` | `/// <summary>Net GEX en billones de USD.</summary>` | documented as billions |

**Conclusion confirmed by code:**
- `callGex` and `putGex` in the API response are in **millions of USD** (raw_gex / 10⁶)
- `netGex` in the API response is in **billions of USD** (raw_gex / 10⁹)
- The three fields are **not in the same unit**

**Current GaleCore-AI docstring claim (validate_interpretation.py line 14):**
> "call_gex, put_gex, and net_gex are all declared as float in GexFacts, produced by the same GaleCore GEX calculation, and denominated in the same units."

**This claim is false.** The GaleCore-AI mapper (`gex_mapper.py:135-139`) copies the values verbatim from the DTO without normalization.

**Reproduced case (reviewer's example):**
```
call_gex = 2_000_000  (millions)
put_gex  = -1_800_000 (millions)
net_gex  = 200        (billions, = (2M + (-1.8M)) / 1000)

Current formula: |200| / (|2_000_000| + |1_800_000|) * 100 = 0.00526%
  → accepted (< 5% threshold)

Unit-aligned: |200 * 1000| / (|2_000_000| + |1_800_000|) * 100 = 5.26%
  → rejected (>= 5% threshold)
```

---

### 2. Comparative table — unit alternatives

| Criterion | A. Normalize in adapter | B. Metadata per field | C. Modify GaleCore HTTP contract | D. Change GaleCore values | E. Fail-closed near_zero |
|---|---|---|---|---|---|
| **Files changed (GaleCore-AI)** | `gex_mapper.py`, `gex_analysis.py`, `validate_interpretation.py`, docstrings, fixtures | `gex_analysis.py` (GexFacts), `gex_mapper.py`, `validate_interpretation.py`, all consumers | `galecore_dtos.py` only (read new fields) | `gex_mapper.py` (if values change shape) | `validate_interpretation.py` only |
| **Files changed (GaleCore)** | None | None | `GexAnalysisResponse.cs`, `GexScope`, handler | `GammaExposureResponse.cs` NetGEX property | None |
| **Requires modifying GaleCore** | No | No | Yes | Yes | No |
| **Breaking change risk** | None — DTO preserved, only internal model changes | None — additive metadata | Medium — new fields are additive, but consumers may need update | **High** — every consumer of NetGEX (Monitor, RPF, front) breaks | None |
| **Compatibility with existing snapshots** | Breaks — old snapshots have non-normalized facts | Breaks — old snapshots lack unit metadata | Compatible if additive | Breaks — all cached/stored values change | Compatible |
| **Impact on fixtures/golden cases** | All GEX fixtures need updated values | All fixtures need unit annotations | Minimal — only if AI reads new metadata | All values change everywhere | Minimal — near_zero tests only |
| **Impact on traces** | facts values change → facts_hash changes | facts structure changes → facts_hash changes | No impact on AI traces | facts values change → facts_hash changes | No impact |
| **Impact on hashing/provenance** | facts_hash changes (different values) | facts_hash changes (different structure) | None | facts_hash changes | None |
| **Risk of duplicating GaleCore methodology** | **Medium** — embeds knowledge of the /1000 factor | Low — metadata comes from source | None — source declares itself | None | None |
| **Contract drift detection** | Must monitor if GaleCore changes the /1000 | Metadata makes drift self-declaring | Self-declaring by design | N/A | No detection — stays closed |
| **Migration strategy** | Version GexFacts, update mapper, update all fixtures | Version GexFacts, add unit fields | GaleCore PR + AI DTO update | GaleCore PR, all downstream update | Remove formula, add rejection message |
| **Contractual tests needed** | Test that net_gex * 1000 ≈ call_gex + put_gex on live data | Test unit fields present and consistent | Test new metadata fields in response | Test all consumers handle new scale | Test near_zero always rejected |
| **Sunk-work risk** | Low — localized to mapper | Medium — touches every consumer | High — cross-repo coordination | Very high — cascading breaks | **Zero** |

---

### 3. Recommendation for unit contract

**Recommended: E (fail-closed) now, then A (normalize in adapter) as a separate work item.**

**Rationale:**

1. **E is the only option that can ship within GC-AI-0001 scope.** The near_zero formula is provably wrong. Disabling it requires changing one function and its docstring. No new features, no cross-repo coordination.

2. **A is the correct long-term solution** but it belongs in a dedicated work item because:
   - It embeds knowledge of GaleCore's internal scaling (`/1000`), which is not declared in any contract.
   - Without a contractual test that `net_gex * 1000 ≈ call_gex + put_gex` holds, a GaleCore refactor that changes the scaling silently breaks the normalization.
   - The normalization factor should ideally come from GaleCore (option C), not be reverse-engineered.

3. **B is over-engineered** for three fields where the relationship is a known constant.

4. **C is the ideal end state** but violates the non-goal "do not modify GaleCore" in GC-AI-0001. It should be proposed as a future GaleCore enhancement.

5. **D is dangerous.** NetGEX is consumed by GaleCore Monitor, RPF gates, and the frontend. Changing its scale is a breaking change with cascading risk.

**Concrete proposal for E:**
- `_validate_near_zero` returns `(False, "near_zero validation disabled: call_gex/put_gex and net_gex are not in the same unit (millions vs billions) — cannot compute ratio without normalization")` unconditionally when `regime == near_zero`.
- The docstring drops the false comparability claim and documents why it's disabled.
- The convention entry `gex_near_zero_threshold_pct` remains — it will be used when normalization is implemented.
- Tests updated to expect fail-closed on near_zero.
- **near_zero regime classification by the host still works** — the host can classify near_zero qualitatively. The validator rejects the classification deterministically until unit alignment exists.

---

### 4. Decision: does GaleCore need a contract modification?

**Not within GC-AI-0001.** The non-goal is explicit: "do not modify GaleCore."

**Recommended future enhancement (separate work item):**
Add a `units` or `scale` metadata object to `GexScope` in `GexAnalysisResponse.cs`:
```csharp
/// <summary>Scale metadata for GEX fields. Additive, backward-compatible.</summary>
public GexScaleMetadata? Scale { get; set; }

public class GexScaleMetadata
{
    public string CallGexUnit { get; set; } = "million_usd";
    public string PutGexUnit { get; set; } = "million_usd";
    public string NetGexUnit { get; set; } = "billion_usd";
}
```
This is additive (new nullable field), backward-compatible, and makes drift self-declaring. But it's a GaleCore change and out of scope.

---

### 5. Comparative table — quantitative claim alternatives

| Criterion | A. Textual match obs↔claim | B. Structured obs with fact_paths | C. QuantitativeClaim | D. No numbers in prose | E. Evolve EvidenceRef | F. Document limitation |
|---|---|---|---|---|---|---|
| **Prevents misattribution** | Partially — displaces to claim text | Partially — wrong path still possible | **Yes** — metric+path+value verified | **Yes** — no numbers to misattribute | **Yes** — value+path verified per ref | No |
| **Fail-closed behavior** | Weak — text matching is fragile | Weak — path can be wrong | **Strong** — deterministic field check | **Strong** — any number rejects | Strong — deterministic | N/A |
| **Complexity** | Low | Medium | Medium-high | Low | Medium | Zero |
| **Compatibility with existing outputs** | Breaking — observations format changes | Breaking — observations become objects | Breaking — new field added | Breaking — observations must drop numbers | Breaking — EvidenceRef gains fields | Compatible |
| **Impact on GexInterpretation** | None | `observations: list[str]` → `list[ObservationRef]` | Add `quantitative_claims` field | None (constraint only) | `EvidenceRef` gains `value`, `unit` | None |
| **Impact on OutputContracts** | None | Medium | Medium | Low (validation rule) | Medium | None |
| **Impact on skills/protocols/instructions** | Skill instructions update | Skill instructions + schema update | Skill instructions + schema + protocol | Skill instructions update | Skill instructions + schema update | Docstring only |
| **Clarity for host** | Low — rules opaque | Medium | **High** — explicit contract | High — simple rule | High — clear contract | Low |
| **Structured Output ease** | Easy — same schema | Medium — nested objects | Medium — new array | Easy — same schema | Medium — richer objects | N/A |
| **Deterministic validation** | Weak — text comparison | Weak — path may be wrong | **Strong** — field-by-field | **Strong** — regex sufficient | Strong — field-by-field | N/A |
| **Traceability** | Low — no structured binding | Medium — path declared | **High** — metric+path+value+unit | Medium — claims separate | High — per-ref binding | Low |
| **Migration strategy** | Update canned responses + skill | Schema migration + skill + tests | Schema migration + skill + tests + guardrail | Guardrail rule + skill update | Schema migration + skill + tests | None |
| **Adversarial tests needed** | Text mismatch, partial match | Wrong path, missing path | Wrong metric, wrong value, wrong unit, missing field | Number in obs, number in impl | Wrong value in ref, missing unit | None |
| **Sunk-work risk** | Low | Medium | Medium | Low | Medium | Zero |

---

### 6. Recommendation for OutputContracts

**Recommended: D (no numbers in prose) + C (QuantitativeClaim), implemented together.**

**Rationale:**

1. **D alone is simple and effective** — if observations/implications cannot contain numbers, there's nothing to misattribute. The existing `observation_grounded` regex becomes a rejection guardrail instead of a matching guardrail. But D without C loses all quantitative content from the output.

2. **C provides the structured channel** for quantitative claims that D removes from prose. Together they form a clean separation:
   - `observations`: qualitative prose, no numbers allowed
   - `implications`: qualitative prose, no numbers allowed
   - `quantitative_claims`: structured, deterministically validated
   - `evidence`: links claims to facts (existing, unchanged)

3. **The combination is deterministically validatable:**
   - Guardrail 1 (D): regex scan observations+implications for numbers → reject if any found
   - Guardrail 2 (C): for each quantitative_claim: resolve fact_path → compare value → check unit
   - No NLP, no fuzzy matching, no semantic analysis

4. **Evidence becomes redundant for quantitative claims** but remains necessary for qualitative claims ("dealers are long gamma" needs a fact_path even without a number). Keep `evidence` as-is; `quantitative_claims` is orthogonal.

**Proposed GexInterpretation schema:**

```python
class QuantitativeClaim(BaseModel):
    metric: str           # e.g. "net_gex", "spot"
    fact_path: str        # e.g. "facts.net_gex"
    value: float          # the numeric value claimed
    unit: str             # e.g. "billion_usd", "usd"
    model_config = {"extra": "forbid"}

class GexInterpretation(BaseModel):
    regime: GexRegime
    observations: list[str]           # qualitative only, numbers rejected
    implications: list[str]           # qualitative only, numbers rejected
    quantitative_claims: list[QuantitativeClaim] = Field(min_length=1)
    evidence: list[EvidenceRef]       # for qualitative grounding
    limitations: list[str]
    model_config = {"extra": "forbid"}
```

**Validation rules:**
1. `observations` and `implications` must not contain numbers (regex, fail-closed)
2. Each `quantitative_claim.fact_path` must resolve to a scalar in facts
3. `quantitative_claim.value` must match the resolved scalar (within tolerance)
4. `quantitative_claim.unit` must match the declared unit for that field (from GexFacts or convention)
5. `quantitative_claim.metric` must be consistent with `fact_path` (e.g. `metric="net_gex"` ↔ `fact_path="facts.net_gex"`)
6. Unknown fact_path → reject
7. Missing/empty quantitative_claims → reject

**Note on unit validation (interaction with Problem 1):**
Until unit normalization exists (Problem 1, option A), the `unit` field in quantitative_claims can only be validated against a declared mapping. If we ship E (fail-closed near_zero) for Problem 1, the unit mapping is:
- `net_gex` → `"billion_usd"` (as documented in GaleCore)
- `call_gex`, `put_gex` → `"million_usd"` (derived from code)
- `spot`, `call_wall`, `put_wall`, `zero_gamma_level` → `"usd"`

This mapping would live in the GexFacts contract or a convention, not hardcoded in the guardrail.

---

### 7. Hash/value coherence analysis for conventions

**Current behavior (prepare_gex.py:59-61):**
```python
manifest = build_required_asset_manifest()      # loads YAML → computes hash
resolved_conventions = resolve_convention_entries()  # loads YAML AGAIN → extracts values
```

**Problems:**
1. **Two loads:** The YAML file is loaded twice. In theory, the file could change between loads (TOCTOU). In practice on a single-threaded async loop this is unlikely, but the design is fragile.
2. **Hash covers the file, not the values:** `manifest.conventions["trading_defaults"].content_hash` hashes the entire YAML structure. `resolved_conventions` extracts only `.entries[].{key, value}`. A YAML change that modifies non-entry fields (e.g. `display_name`) changes the hash but not the values. Conversely, this can't happen in reverse (value changes always change the hash), so the risk is limited to unnecessary invalidation, not silent drift.
3. **Mutable dict in frozen model:** `StoredPreparedSnapshot` is `frozen=True` but `resolved_conventions: dict` is a mutable Python dict. Pydantic's `frozen` prevents reassignment of the attribute but not mutation of the dict's contents.
4. **No hash of resolved values:** `facts_hash` covers `facts` only. There is no hash covering `resolved_conventions`. `accept_interpretation` trusts the dict from the snapshot without verifying it against the convention hash.

**Comparative analysis:**

| Option | Description | Files changed | Complexity | Risk |
|---|---|---|---|---|
| A. Single loader | One function loads YAML once, returns both manifest entry + resolved values | `asset_manifest.py` | Low | Low |
| B. Hash resolved_conventions | Add `conventions_hash` to snapshot, verify at accept time | `prepared_analysis.py`, `prepare_gex.py`, `accept_interpretation.py` | Medium | Low |
| C. Integral snapshot_hash | Single hash covering facts + conventions | `prepared_analysis.py`, `prepare_gex.py`, `accept_interpretation.py` | Medium | Medium (changes facts_hash semantics) |
| D. Immutable values | Use `tuple[tuple[str, ...], ...]` or frozen dataclass instead of dict | `prepared_analysis.py`, all consumers | High | Medium (breaks serialization) |
| E. Combination: A + B | Single load + conventions_hash | `asset_manifest.py`, `prepared_analysis.py`, `prepare_gex.py`, `accept_interpretation.py` | Medium | Low |

**Recommendation: E (A + B)**

1. **A (single loader):** Refactor `build_required_asset_manifest` to also return resolved convention values from the same load. This eliminates the TOCTOU window.

```python
def build_required_asset_manifest() -> tuple[AssetManifest, dict[str, float | int | str | bool]]:
    # ... existing code ...
    # For conventions: load once, compute hash AND extract values
    conv = load_asset(rel_path, ConventionSet)
    convention_entries[conv.convention_id] = AssetEntry(...)
    resolved_values = {entry.key: entry.value for entry in conv.entries}
    return manifest, resolved_values
```

`resolve_convention_entries()` is deleted.

2. **B (conventions_hash):** Add `conventions_hash: str` to `StoredPreparedSnapshot`, computed as `sha256(json.dumps(resolved_conventions, sort_keys=True))`. At accept time, verify `conventions_hash` matches — same pattern as `facts_hash`.

The mutable-dict-in-frozen-model issue (point 3) is a known Pydantic limitation. Making the dict truly immutable would require `MappingProxyType` or a custom type, which adds complexity for marginal safety. The existing `frozen=True` prevents accidental reassignment, which is the primary risk. Document the limitation.

---

### 8. JSON before/after example

**Before (current GexInterpretation):**
```json
{
  "regime": "positive_gamma",
  "observations": [
    "Net GEX is positive at 1500.0, dealers are long gamma"
  ],
  "implications": [
    "Mean reversion expected around spot 450.5"
  ],
  "evidence": [
    {"fact_path": "facts.net_gex", "claim": "Net GEX is positive at 1500.0"},
    {"fact_path": "facts.spot", "claim": "Spot at 450.5"}
  ],
  "limitations": [
    "Based on current open interest snapshot"
  ]
}
```

**After (proposed GexInterpretation):**
```json
{
  "regime": "positive_gamma",
  "observations": [
    "El posicionamiento agregado muestra gamma positiva, los dealers tienen cobertura larga."
  ],
  "implications": [
    "El régimen puede amortiguar movimientos de corto plazo."
  ],
  "quantitative_claims": [
    {
      "metric": "net_gex",
      "fact_path": "facts.net_gex",
      "value": 1.5,
      "unit": "billion_usd"
    },
    {
      "metric": "spot",
      "fact_path": "facts.spot",
      "value": 450.5,
      "unit": "usd"
    }
  ],
  "evidence": [
    {"fact_path": "facts.net_gex", "claim": "Net GEX is positive — dealers are long gamma"},
    {"fact_path": "facts.spot", "claim": "Spot is within normal range relative to zero-gamma level"}
  ],
  "limitations": [
    "Snapshot puntual sujeto a cambios intradiarios."
  ]
}
```

**Key differences:**
- `observations` and `implications`: qualitative only, zero numbers
- `quantitative_claims`: structured, every number has metric + fact_path + value + unit
- `evidence`: qualitative grounding remains (claims without numbers)
- Validation is fully deterministic: regex for prose, field-by-field for claims

---

### 9. Files that would change

**Problem 1 (E — fail-closed near_zero):**

| File | Change |
|---|---|
| `src/galecore_ai/application/validate_interpretation.py` | `_validate_near_zero` always rejects; docstring updated |
| `tests/unit/test_interpretation_assurance.py` | `TestNearZeroMagnitude` tests expect rejection |
| `tests/unit/test_accept_interpretation.py` | near_zero test cases updated |
| `tests/unit/test_runtime.py` | If any near_zero case exists |

**Problem 2 (D+C — quantitative claims):**

| File | Change |
|---|---|
| `src/galecore_ai/contracts/gex_analysis.py` | Add `QuantitativeClaim`, update `GexInterpretation` |
| `src/galecore_ai/harness/guardrails.py` | New `no_numbers_in_prose` guardrail; update `observation_grounded` → `quantitative_claims_valid` |
| `src/galecore_ai/application/validate_interpretation.py` | Register new guardrails for GexInterpretation |
| `config/skills/gex-analysis/skill.yaml` | Update instructions for new output format |
| `config/protocols/facts-discipline.yaml` | Add new guardrail IDs |
| `CLAUDE.md` | Update host instructions for new schema |
| All test files with canned GexInterpretation responses | Update to new schema |
| `tests/fixtures/galecore/gex_analysis_spy.json` | No change (facts fixture, not interpretation) |

**Problem 3 (E — single load + conventions_hash):**

| File | Change |
|---|---|
| `src/galecore_ai/adapters/asset_manifest.py` | Merge `resolve_convention_entries` into `build_required_asset_manifest` |
| `src/galecore_ai/application/prepare_gex.py` | Use combined return value |
| `src/galecore_ai/contracts/prepared_analysis.py` | Add `conventions_hash` field |
| `src/galecore_ai/application/accept_interpretation.py` | Verify `conventions_hash` |
| `tests/unit/test_prepare_gex.py` | Updated for combined loader |
| `tests/unit/test_accept_interpretation.py` | Verify conventions_hash check |

**No changes to GaleCore.** No changes to FastAPI, CLI, MCP, ModelProvider, or CognitiveRuntime infrastructure.

---

### 10. Compatibility and migration strategy

**Problem 1 (fail-closed near_zero):**
- Backward-compatible. near_zero was previously accepted; now it's rejected. No existing SUCCESS outputs are invalidated — they just can't be reproduced with near_zero regime.
- Existing snapshots remain valid (facts unchanged).
- Host can still attempt near_zero; validator rejects with clear message.

**Problem 2 (quantitative claims):**
- **Breaking change to GexInterpretation schema.** All existing canned responses, golden cases, and host instructions must be updated simultaneously.
- Migration is atomic: old-format interpretations fail Pydantic validation.
- No versioning needed — this is Phase 3 stabilization, not a shipped API.
- The `observation_grounded` guardrail from Increment 3 is superseded by `no_numbers_in_prose` + `quantitative_claims_valid`. Remove the old guardrail.

**Problem 3 (conventions hash):**
- Backward-compatible for new snapshots. Old snapshots in the ephemeral store lack `conventions_hash` — but the store TTL means they expire naturally.
- `conventions_hash` defaults to `""` for old snapshots; accept_interpretation skips the check when empty (grace period, not a bypass — hash was never computed).

---

### 11. Proposed adversarial tests

**Problem 1:**
1. near_zero regime with any facts → always rejected with unit-mismatch message
2. positive_gamma and negative_gamma unaffected (sign check still works)
3. near_zero with threshold=None → rejected (existing test, reason changes)

**Problem 2:**
1. **Number in observation** → rejected by `no_numbers_in_prose`
2. **Number in implication** → rejected by `no_numbers_in_prose`
3. **quantitative_claim with wrong value** → rejected (value != fact)
4. **quantitative_claim with wrong unit** → rejected (unit mismatch)
5. **quantitative_claim with wrong fact_path** → rejected (path doesn't resolve)
6. **quantitative_claim with wrong metric** → rejected (metric inconsistent with path)
7. **quantitative_claim referencing a dict/list fact** → rejected (must be scalar)
8. **Empty quantitative_claims** → rejected (min_length=1)
9. **Correct quantitative_claims, correct qualitative prose** → accepted
10. **Original misattribution case:** obs="Net GEX is 750" → rejected by `no_numbers_in_prose` (number in prose). No need for semantic analysis.
11. **Mixed: some valid claims, one invalid** → rejected (all must pass)

**Problem 3:**
1. Snapshot with matching conventions_hash → accepted
2. Snapshot with mismatched conventions_hash (simulated corruption) → rejected
3. Snapshot without conventions_hash (old format) → accepted (grace period)

---

### 12. Risks and decisions requiring approval

| # | Decision | Risk if wrong | Requires approval from |
|---|---|---|---|
| D1 | Disable near_zero validation entirely (fail-closed) instead of implementing normalization | near_zero regime cannot be validated until a future work item. Host can still classify it, but validator always rejects it. | Product owner |
| D2 | Embed unit knowledge (`net_gex` is billions, `call_gex`/`put_gex` are millions) in a convention or constant rather than receiving it from GaleCore | If GaleCore changes the /1000 factor, GaleCore-AI breaks silently unless a contractual test catches it. | Product owner + reviewer |
| D3 | Add `quantitative_claims` field to GexInterpretation (breaking schema change) | All host instructions (CLAUDE.md, skill YAML), canned responses, and golden cases must be updated atomically. | Product owner + reviewer |
| D4 | Prohibit numbers in observations/implications | The host must learn to produce qualitative prose and structured claims separately. More constrained but deterministically validatable. | Product owner |
| D5 | Remove `observation_grounded` guardrail (superseded by D3+D4) | Increment 3 work on that guardrail becomes sunk cost. The replacement is strictly stronger. | Reviewer |
| D6 | Single convention loader + conventions_hash | Minor refactor; low risk. | Reviewer |
| D7 | Do NOT modify GaleCore within this work item | Unit metadata in GaleCore's response would be the ideal solution but is out of scope. | Product owner (confirm non-goal) |

---

### 13. Non-goals (explicit)

- Do not implement GEX unit normalization (option A) within GC-AI-0001. Propose as future work item.
- Do not modify GaleCore's API response format.
- Do not add NLP, embeddings, or fuzzy semantic matching for claim validation.
- Do not version GexInterpretation schema (no v1/v2 — this is pre-release stabilization).
- Do not add a generic configuration platform for conventions.
- Do not expand FastAPI, CLI, MCP, ModelProvider, or CognitiveRuntime.
- Do not make commits, push, or create PRs.
- Do not mark any acceptance criterion as DONE.
- Do not close Phase 3.

---

### 14. Proposed Increment 4 — NOT AUTHORIZED

**Scope (pending approval of D1–D7):**

1. **near_zero fail-closed:** Disable `_validate_near_zero` formula. Update docstring to document unit incompatibility and reference GaleCore source. Update tests.

2. **QuantitativeClaim + no-numbers-in-prose:** Add `QuantitativeClaim` to `gex_analysis.py`. Add `no_numbers_in_prose` guardrail. Add `quantitative_claims_valid` guardrail. Remove `observation_grounded`. Update `GexInterpretation`, skill instructions, CLAUDE.md host instructions, all test fixtures.

3. **Convention hash coherence:** Merge convention loading into single function. Add `conventions_hash` to snapshot. Verify at accept time.

4. **Verification:** Full test suite, ruff, gate, wheel. Adversarial cases from section 11.

**Estimated file count:** ~15 files modified, 0 new files, 1 guardrail deleted.

**Prerequisite:** Explicit approval of decisions D1–D7 by reviewer and product owner.

**This increment does NOT close GC-AI-0001.** AC-06 remains BLOCKED. AC-09 remains PENDING.

---

### Checkpoint corrections (mandatory, applied in Increment 4)

The checkpoint above is preserved as history. The following statements in it are superseded by
the product-owner approval with Codex's mandatory adjustments; the implementation follows this list:

1. **No normalization in claims.** The "after" JSON example shows `net_gex` claimed as `1.5`; the
   contract requires the raw fact: `facts.net_gex = 1500.0` → `value = 1500.0`. The validator rejects
   `1.5` (`test_rescaled_value_rejected`, golden case 12).
2. **Units are a technical contract, not a convention.** The unit mapping lives in
   `METRIC_REGISTRY` (validator-owned, `GexMetric`/`GexUnit` enums), never in
   `trading-defaults.yaml` nor `ConventionResolver`.
3. **`near_zero` does not "still work".** The host may propose it; the validator always rejects it
   (`gex_regime_sign`) and it can never reach `SUCCESS`.
4. **No grace period.** `conventions_hash` is required on `StoredPreparedSnapshot`; a snapshot without
   it fails schema validation and is treated as corrupt by the store. The "accepted (grace period)"
   test in §11 was not written; its inverse was (`test_missing_hash_snapshot_rejected`).
5. **`metric` and `unit` are closed enums.** Unknown values are rejected by schema before any
   guardrail runs.
6. **The validator derives `fact_path` from `metric`.** `QuantitativeClaim` has no `fact_path`;
   a host-supplied one is rejected by `extra="forbid"`.
7. **`EvidenceRef` proves path resolution, not entailment.** Documented in the contract docstring,
   skill instructions, CLAUDE.md and the alignment doc; `test_qualitative_evidence_accepted_without_semantic_check`
   pins the limit.

---

## Implementer handoff — Increment 4

**State:** READY_FOR_REVIEW · **Date:** 2026-09-16 (UTC) · **Implementer:** Claude Code · **Reviewer:** Codex (pending)
**Scope executed:** D1–D7 as approved, with Codex's mandatory adjustments. No commit, no push, no PR.

### Decisions implemented

| Decision | Implementation | Classification |
|---|---|---|
| D1 near_zero fail-closed | `_check_regime_sign` rejects `near_zero` unconditionally with the scale message; `near_zero_threshold_pct` plumbing removed from validator, `accept_interpretation`, `runtime`; YAML entry preserved and documented as inert | verified locally + E2E (case A) |
| D2 units as closed contract | `GexMetric`, `GexUnit`, `METRIC_REGISTRY` in `contracts/gex_analysis.py`; call_gex/put_gex not claimable; BL-002 captured for GaleCore unit metadata | verified locally |
| D3 structured claims | `QuantitativeClaim {metric, value, unit}`, `extra=forbid`, `quantitative_claims` `min_length=1`; validator derives fact_path/unit, exact value equality (`==`, no tolerance), `value` strict (JSON strings rejected), non-finite/absent/null/non-scalar rejected, one bad claim rejects all, `result=None` | verified locally + E2E (B, C) |
| D4 no numbers in prose | `no_numbers_in_prose` guardrail (regex: int, signed, decimal, %, scientific; thousands separators reject via the digit groups); mandatory for `GexInterpretation`; word-numbers and semantic limits documented | verified locally + E2E (D) |
| D5 replace observation_grounded | Guardrail, registration, tests and doc claims removed; `no_numbers_in_prose` + `quantitative_claims_valid` mandatory even if the protocol omits them; the raw-text runner no longer carries a pass-through for structural checks (an unregistered ID fails closed) | verified locally |
| D6 single load + conventions_hash | `load_required_assets()` → `RequiredAssetBundle` (manifest, resolved values, hash from one read); `build_required_asset_manifest`/`resolve_convention_entries` deleted; `compute_conventions_hash` (canonical JSON, sha256); `StoredPreparedSnapshot.conventions_hash` required, format-validated; accept recomputes and stops before cognitive validation on mismatch; hash exposed in view and trace | verified locally + E2E (E) |
| D7 GaleCore untouched | No file under `GaleCore/` changed; backlog BL-002 records the future contract work | verified (`git -C ../GaleCore status` unaffected by this work) |

### Files changed in this increment

Code: `contracts/gex_analysis.py`, `contracts/prepared_analysis.py`, `contracts/agent_run.py`,
`application/validate_interpretation.py`, `application/accept_interpretation.py`, `application/prepare_gex.py`,
`adapters/asset_manifest.py`, `harness/guardrails.py`, `harness/runtime.py`.
Assets: `config/skills/gex-analysis/skill.yaml` (1.3.0), `config/skills/gex-analysis/instructions.md`,
`config/protocols/facts-discipline.yaml` (1.2.0), `config/conventions/trading-defaults.yaml` (description only).
Tests: `tests/unit/test_interpretation_assurance.py` (rewritten, 66), `tests/unit/test_accept_interpretation.py`
(+`TestConventionIntegrity`), `tests/unit/test_asset_bundle.py` (new), `tests/unit/test_runtime.py`,
`tests/unit/test_gex_runner.py`, `tests/unit/test_snapshot_store.py`, `tests/integration/test_gex_vertical.py`,
`tests/contract/test_contracts.py`, `tests/evals/test_gex_golden_cases.py` (case 3 → rejection; cases 11–12 new).
Docs: `CLAUDE.md`, `docs/architecture/GaleCore-AI-arquitectura-v5.md`, `PHASE3-ALIGNMENT.md`, `SESSION_HANDOFF.md`,
`PRODUCT-BACKLOG.md` (BL-002), `docs/LOCAL-VALIDATION-GEX-INTERACTIVE.md`, `docs/evidence/phase3-gex-interactive-e2e.md`
(note that it predates the schema), `docs/evidence/phase3-increment4-manual-cases.md` (new), this work item.

### Invariants now enforced at the boundary

- `near_zero` never reaches `SUCCESS`.
- Any digit in observations/implications rejects (`no_numbers_in_prose`, scope per D4). Numbers inside evidence claims must equal the referenced fact (`facts_match_source`); numbers in limitations are only checked against the fact set (`no_invented_numbers`) — a fact-coincident number there is a residual, documented gap (see internal review, MAJOR-1).
- A claim's metric fixes its fact path and unit; the value must equal the fact exactly.
- Every accepted snapshot carries `conventions_hash`; acceptance recomputes it before any cognitive check.
- A rejected output never crosses the boundary (`result=None`).

### Mandatory tests (spec numbering) → where

1–6 `TestNearZeroFailClosed` · 7–19 `TestQuantitativeClaims` + `test_quantitative_claim_is_closed` · 20–26 `TestNoNumbersInProse`
· 27–33 `test_asset_bundle.py` + `TestConventionIntegrity` · 34–37 `test_spanish_trading_recommendation_rejected`,
`TestEvidence`, `test_rejected_payload_is_never_returned` · 38 accept trace tests · 39 canned/golden updated · 40 golden case 1/2, vertical success.

### Commands and exact results (2026-09-16, UTC ~18:36)

```
> python tools/engineering_gate.py
Engineering gate: GC-AI-0001 / Status: IN_PROGRESS (before this handoff) / PASS
> python -B -m pytest -q -p no:cacheprovider
399 passed, 1 warning in 19.00s (after internal-review fixes: strict value, exact equality, unicode numerics)
> python -B -m ruff check --no-cache .
All checks passed!
> git diff --check HEAD
(only CRLF warnings; no whitespace errors)
> python -m build --wheel
Successfully built galecore_ai-0.1.0-py3-none-any.whl
  wheel contains galecore_ai/_assets/{agents/trading-agent.yaml, conventions/trading-defaults.yaml,
  protocols/facts-discipline.yaml, skills/gex-analysis/instructions.md, skills/gex-analysis/skill.yaml}
```

Build verified (hatchling available in this environment; isolated build succeeded).

### Manual cases A–F

Executed against live GaleCore (`run_id 01a0ab80-b122-7620-ac07-4c123e8cc1fb`, `net_gex=-1062.5`):
A rejected (gex_regime_sign) · B accepted (exit 0) · C rejected (quantitative_claims_valid) · D rejected (no_numbers_in_prose)
· E rejected (INTERNAL_ERROR, conventions_hash mismatch, no guardrails ran) · F rejected (no_trading_recommendation).
Full record: `docs/evidence/phase3-increment4-manual-cases.md`.

### Findings recorded (not in scope of D1–D7)

- **F-10** `no_trading_recommendation` patterns use `.*` over the whole serialized JSON; a verb in one field and an
  instrument noun in another combine (observed in case F), and the intra-field variant also fires: "Dealers are long gamma
  and their hedging positions dampen moves" is rejected (`long … positions`). Fail-closed direction, but a false-rejection
  risk on realistic GEX prose. Needs per-field scanning and tighter patterns; not changed here (outside D1–D7).
- **AC-05** needs the negative set re-run on the new schema; the old E2E file is kept as history with a note.

### Remaining limitations

- Spelled-out numbers bypass `no_numbers_in_prose`; qualitative prose and causal claims are not semantically verified.
- call_gex/put_gex cannot be claimed until BL-002 lands; `near_zero` stays rejected until facts are normalized.
- Store is a cooperative local boundary; traces are ephemeral.
- **AC-06 remains BLOCKED** (no blind cognitive evaluation exists). **AC-09 remains PENDING.**

### git status --short (42 entries; 31 tracked files modified, 11 untracked paths)

Tracked: docs (7), pyproject.toml, src (10), tests (13). Untracked: `AGENTS.md`, `CLAUDE.md`, `docs/architecture/PRODUCT-BACKLOG.md`,
`docs/engineering/`, `docs/evidence/`, `src/galecore_ai/adapters/snapshot_store.py`, `tests/integration/test_cli_subprocess.py`,
`tests/unit/test_asset_bundle.py`, `tests/unit/test_engineering_gate.py`, `tests/unit/test_snapshot_store.py`, `tools/`.

**No commit, no push, no PR were made.** Phase 3 is not declared closed. `closure_blocked: true`.

### Internal review (Claude reviewer subagent, 2026-09-16) — resolved before Codex

Verdict APPROVE for the increment. MAJOR-1 (overstated invariant "numbers only in quantitative_claims") → reworded honestly in
the work item, `instructions.md` and `CLAUDE.md`; the D4 scope (observations/implications) is unchanged — whether `limitations`
and `evidence.claim` should also be digit-free is a contract decision for the product owner. MINOR fixes applied: Unicode
superscripts/fractions/subscripts now count as digits; `QuantitativeClaim.value` is strict; equality is exact `==`; F-10 notes the
intra-field variant; stale guardrail row in `CLAUDE.md` fixed; matrix rows say IMPLEMENTED (pending AC-09) instead of DONE.
Not changed (pre-existing, out of scope): empty strings allowed in prose lists.

### Independent review 1 (Codex, 2026-09-16) — `docs/engineering/reviews/GC-AI-0001-20260916T185033Z.md`

**Verdict:** CHANGES_REQUESTED. Resolution by the implementer (a second Codex round is required; nothing below is self-approval):

| # | Finding | Resolution |
|---|---|---|
| B1 | `default_factory=list` + `min_length=1`: Pydantic does not validate defaults, so omitted `quantitative_claims`/`limitations` reached SUCCESS | **Fixed.** Mandatory lists are required (no default) and `validate_default=True`; `test_omitted_mandatory_field_rejected_by_schema` (4 fields) + E2E N18. Confirmed reproducible before the fix. |
| B2 | "Hold SPY shares" passed `no_trading_recommendation` | **Fixed.** Patterns extended (hold/accumulate/acquire/add to/trim/unload/dump; mantener/acumular/sumar/agregar/reducir; conjugations recomendamos/sugerimos/…); 7 parametrized cases + E2E N19. F-10 (false-positive risk of `.*`) still open and now slightly larger. |
| B3 | Manual cases evidence not reproducible | **Fixed.** `tools/e2e_interactive_cases.py` regenerates `docs/evidence/increment4-e2e/` (P0, P1, N01–N20) with exact stdin, stdout, exit code per case; old files marked superseded/history. |
| B4 | AC-06 not a real cognitive evaluation | **Unchanged — BLOCKED.** Requires an independent protocol the product owner must run or authorize (see AC-06 section). Not claimable by the implementer. |
| M1 | AC-01 trace incomplete on early rejections | **Fixed + narrowed.** Explicit `snapshot_integrity` trace entry on every accept after snapshot recovery; AC-01 text now states that stages not reached are not fabricated. |
| M2 | Validation guide showed a pre-Increment-4 payload | **Fixed.** Guide carries the real P1 payload, real prepare view and real trace. |
| M3 | Alignment labelled the host adapter as unimplemented | **Fixed.** Row updated to CURRENT_IMPLEMENTED with evidence link. |
| M4 | Wheel stale vs. tree; pytest not reproducible in reviewer sandbox | **Fixed.** Wheel rebuilt from the final tree and its 5 assets byte-compared with `config/` (see commands). pytest cannot run in a read-only sandbox (`No usable temporary directory`); the implementer's run is recorded below and the reviewer may rerun with a writable `TMP`. |
| m1 | CLI subprocess test depended on no service listening | **Fixed.** Test forces an unreachable endpoint (`127.0.0.1:9`, 2 s timeout). |
| m2 | `<GaleCore dev ApiKey literal, redacted>` in CLAUDE.md | **Fixed.** Placeholder in CLAUDE.md and the validation guide. It is the GaleCore development `ApiKey` from user-secrets on this machine (localhost only), not a provider credential; the literal is redacted from implementer-authored text but remains in the Codex review files, which the implementer does not edit. Rotating the key (`dotnet user-secrets set ApiKey <new>`) and/or redacting review history is the product owner's call. |

Codex also noted it wrote no review artifact because file modification was prohibited: the artifact is written by the `/review-codex` runner from Codex's final message, not by Codex.

Commands after the resolutions (2026-09-16, UTC ~19:05): `engineering_gate.py` PASS (READY_FOR_REVIEW) · `ruff` All checks passed · `pytest -q` **409 passed** · `git diff --check HEAD` clean · `python -m build --wheel` OK, 5 packaged assets byte-identical to `config/` · E2E `docs/evidence/increment4-e2e/` 22/22 as expected.

### Independent review 2 (Codex, 2026-09-16) — `docs/engineering/reviews/GC-AI-0001-20260916T190907Z.md`

**Verdict:** CHANGES_REQUESTED. Resolution by the implementer:

| # | Finding | Resolution |
|---|---|---|
| B1 | "Increase your SPY position", "Add SPY shares", "Favor SPY puts", "Conviene adquirir puts" accepted; an open regex cannot prove a universal guarantee | **Partially fixed; decision for the product owner.** Verbs added (add/increase/reduce/favor/overweight/…; adquirir/aumentar/conviene/…) with 5 new cases. The guardrail was also rewritten per field with a bounded gap and a "short/long gamma" exclusion (F-10, see below). The universal wording of AC-03 ("explicit trading recommendations cannot receive SUCCESS") cannot be proven by any pattern set; the honest options are (a) narrow AC-03 to "directives matching the documented pattern set (EN/ES) cannot receive SUCCESS; novel phrasings are a declared limitation", or (b) a closed output vocabulary/template for implications. **Not decided by the implementer.** |
| B2 | Acceptance freshness used `snapshot.market_data_as_of`, which is outside `facts_hash` | **Fixed.** Acceptance now requires the outer timestamp to equal `facts.market_data_as_of` (hashed); mismatch → `INTERNAL_ERROR` via `snapshot_integrity`. Tests `test_outer_timestamp_must_equal_hashed_one`; E2E N21. |
| B3 | Positive E2E interpretation was runner-generated | **Fixed.** `tools/e2e_interactive_cases.py --reuse-view --interpretation`: P1 is `P1-host-interpretation.json`, authored by Claude Code in-session from `P0-view.json` (five claims, qualitative prose). Host identity remains HOST_DECLARED and the docs say so. |
| B4 | AC-06 | **Unchanged — BLOCKED**, product-owner protocol required. |
| M1 | Missing/expired snapshots lacked a failing trace entry | **Fixed.** `snapshot_lookup` entry (failed) recorded; E2E N06/N09 assert it. |
| M2 | Every freshness error traced as STALE | **Fixed.** `UNKNOWN` / `FUTURE` / `INVALID_POLICY` / `STALE` per observed reason; tests for STALE and FUTURE. |
| M3 | Guide claimed the evidence proves the host is Claude Code | **Fixed.** Reworded to HOST_DECLARED. |
| M4 | Alignment: wheel "not built", 274 tests, 10 negatives | **Fixed.** Current numbers with historical values labelled. |
| M5/M6 | `LOCAL-VALIDATION-GEX-SPY.md`: obsolete payload/versions, `<GaleCore dev ApiKey literal, redacted>` | **Fixed.** Illustrative block updated to the current contract and labelled illustrative; placeholder for the key. |
| m1 | E2E runner returned 0 without asserting | **Fixed.** Every case carries expected exit/status/guardrails; any mismatch is listed and the runner exits 1. |

**F-10 resolved in scope (blocked AC-05):** the host-authored positive was rejected by `no_trading_recommendation` because "short gamma" in one sentence and "put wall" in another matched `short.*put`. The guardrail now scans each prose field separately, requires the directive verb within a bounded, sentence-local gap of the instrument noun, and excludes "short/long gamma|vol|volatility|convexity". 5 descriptive-prose acceptance cases + 4 directive rejections added. This narrows false rejections; it does not widen what is accepted beyond descriptive positioning language.

**Codex sandbox note:** Codex cannot run pytest in its read-only sandbox (no writable temp dir). Runner switched to `workspace-write` for the next round with a post-run `git status` diff check so any file the reviewer touches is detected.

Commands after review-2 resolutions (2026-09-16, UTC ~19:40): gate PASS (READY_FOR_REVIEW) · ruff clean · **pytest 427 passed** · `git diff --check HEAD` clean · wheel rebuilt, 5 assets byte-identical · E2E `docs/evidence/increment4-e2e/` 23/23 verified by the runner (exit 0).

### Independent review 3 (Codex, 2026-09-16) — `docs/engineering/reviews/GC-AI-0001-20260916T192943Z.md`

**Verdict:** CHANGES_REQUESTED (AC-02, AC-04, AC-08 PASS; pytest reproduced by the reviewer: 427). Resolution:

| # | Finding | Resolution |
|---|---|---|
| B1 | "You should own SPY puts" accepted; universal AC-03 guarantee unprovable by regex | **Product-owner decision pending** (unchanged): narrow AC-03 to the documented pattern set, or move to a closed output vocabulary. Not decidable by the implementer. |
| B2 | Host authorship only declared | **Evidenced as far as possible.** `docs/evidence/increment4-e2e/P1-host-authorship.md`: transcript excerpt of the Claude Code session with timestamps and tool-use ids for the prepare (19:22:45Z) and the interpretation Write (19:24:38Z), and sha256 equality between the transcript content and the file on disk. This proves the text was written in the host session after reading the view; it cannot prove which model produced it — HOST_DECLARED remains the honest label. |
| B3 | AC-06 | **Unchanged — BLOCKED**, product-owner protocol. |
| M1 | Malformed hashed timestamp raised `ValueError` | **Fixed.** `_MalformedFacts` → `INTERNAL_ERROR` with failed `snapshot_integrity`; test added. |
| M2 | Guide payload ≠ retained artifact | **Fixed.** Step 1/2/4 blocks regenerated verbatim from `P0-view.json` and `P1-positive.json`. |
| M3 | Key literal in work item / review files | **Redacted** from implementer-authored text; review files untouched by policy. Rotation is the product owner's call (see review-1 m2). |
| m1 | SESSION_HANDOFF counts | **Fixed.** |
| m2 | Alignment "proposed / not yet existing" | **Fixed.** Sections labelled historical; CLI adapter marked implemented. |
| m3 | N12/N20 without expected guardrails; N04/N18 schema text | **Fixed.** Every case asserts; N04/N18 check the schema message. |

Commands after review-3 resolutions (2026-09-16, UTC ~19:55): gate PASS · ruff clean · **pytest 428 passed** · `git diff --check HEAD` clean · wheel rebuilt, assets byte-identical · E2E 23/23 verified (runner exit 0).

**Open items that require the product owner (the implementer stops here):**
1. AC-03 wording: (a) bounded pattern set with declared limitation — recommended — or (b) closed output vocabulary for implications (a contract change).
2. AC-06: authorize and run an independent with/without-assets evaluation protocol (≥5 paired cases), or accept AC-06 as a documented gap for Phase 3 closure.
3. GaleCore development ApiKey: rotate and/or redact review history.

### Product-owner decisions (2026-09-16, after review 3)

1. **AC-03 → option (a).** The criterion now claims only what the deterministic pattern set can prove; novel phrasings are a declared limitation. The guardrail docstring and validation guide already state this.
2. **AC-06 → accepted gap.** Phase 3 may close without an independent cognitive evaluation, provided no document claims a cognitive effect of the assets. Deferred to a future work item.
3. **GaleCore development ApiKey → left as is.** Localhost-only development secret; the owner chose not to rotate it and not to redact review history.

These decisions are the product owner's, recorded verbatim by the implementer. `closure_blocked` stays `true` until AC-09 (independent review approval) and the owner's final acceptance.

### Independent review 4 (Codex, recheck, 2026-09-16) — `docs/engineering/reviews/GC-AI-0001-20260916T232610Z.md`

**Verdict:** CHANGES_REQUESTED, converging: AC-01/02/04/05/08 PASS; B1/B3/M3 of review 3 recorded as OWNER DECISION; all other previous findings RESOLVED. New findings and resolution (commit `61c8243`):

| # | Finding | Resolution |
|---|---|---|
| B-new | Spanish `tomar una posición larga/corta` pattern had no adversarial test | **Fixed, and the test found a real gap:** the accented conjugation "Tomá posición corta" was not matched. Pattern extended; 6 cases added (position/operation/price-target, EN+ES). 434 tests. |
| B-new | Cognitive-evaluation doc claimed assets make the host "more likely" to avoid failures | **Fixed.** Replaced by an explicit no-effect-claim statement; simulated outputs draw no behavioural inference (owner condition for the AC-06 gap). |
| M-new | AC-06 live status still BLOCKED | **Fixed.** Live section = ACCEPTED GAP; original analysis kept as history. |
| m-new | 20 vs 21 negatives; 427 vs 428 tests | **Fixed** (21; 434 after the new cases). |

Ready for recheck 5 (`/review-codex --recheck`).

### Independent review 5 (Codex, recheck, 2026-09-16) — `docs/engineering/reviews/GC-AI-0001-20260916T233541Z.md`

**Verdict:** CHANGES_REQUESTED on one item: AC-01/02/03/04/05/08 PASS, AC-06 ACCEPTED GAP, all prior findings RESOLVED or OWNER DECISION. The single NEW finding — `PHASE3-ALIGNMENT.md` still saying AC-06 "sigue BLOCKED" — is fixed in this commit (current-tense status = ACCEPTED GAP). Ready for recheck 6.
