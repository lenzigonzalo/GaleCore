---
id: GC-AI-0002
title: Phase 4 — complete harness from the host with an evaluable record
status: IN_PROGRESS
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-0002 — Phase 4: complete harness from the host with an evaluable record

> **Contract approved by the product owner on 2026-09-16** (decisions D-1..D-5 below). Originally
> drafted the same day by the implementer from `roadmap/README.md` (Phase 4, UC-1/UC-2/UC-4
> and the query case), `GaleCore-AI-arquitectura-v5.md` §7.1/§9/§17 and a survey of what GaleCore
> exposes today. Prerequisite met: GC-AI-0001 is `CLOSED` (commit `4e42079`, tag
> `phase3-closed`, 2026-09-16). `ACTIVE_WORK_ITEM` points here since approval; work happens on
> branch `feature/gc-ai-0002`.

## Objective

From Claude Code as the host, complete one real use case end to end against local GaleCore: ask for
data → ask for an interpretation → ask for persistence → leave an **evaluable record** (what was
asked, which facts with hashes, what the model answered with its assurance trace, what happened
afterwards, what the human thought) → query that record later. The deliverable is the loop
"analysis is not lost; a series becomes comparable", not a new UI or runtime.

## Non-goals

- Strategy Development, ActionProposal, SHADOW/PAPER/LIVE (Phases 5–7).
- Autonomous runtime, scheduler, multi-agent orchestration, new model providers (v5 §7.3 frozen).
- Database persistence. The record starts as markdown + YAML frontmatter + git, per the roadmap
  ("crece a base de datos cuando la consulta lo pida").
- Curator/evaluator/proponent agents (BL-001): they activate once records exist; this item only
  produces the records.
- Any change to GaleCore code (`GaleCore/source/`). See UC-2 and UC-4 below: both need GaleCore
  work and are excluded unless the product owner authorizes them as separate GaleCore items.
- Real cognitive evaluation deferred from GC-AI-0001 AC-06 (stays a separate item).

## Scope

GaleCore-AI only: new capabilities in the registry (PURE_QUERY only), one new skill, an extension of
the interactive CLI (`prepare` / `accept` / new `record` and `query` subcommands or equivalent),
persistence of records as files, and the host entry point (`CLAUDE.md` + skill) that lets Claude
Code run the whole loop without ad-hoc prompting. Files written under `GaleCore/research/regime/`
are research artifacts, not platform code; GaleCore is never pushed.

### Use cases (from the roadmap) and what the survey found

| UC | Roadmap statement | Feasible with GaleCore as-is? | Proposed treatment |
|---|---|---|---|
| UC-1 | Daily regime analysis (GEX + skew25 + VIX/VVIX) interpreted, verified and persisted in `GaleCore/research/regime/YYYY-MM-DD.md` with trace | **Yes.** `GET /App/Gex/Analysis`, `GET /App.Analytics/PutSkew`, `GET /Tastytrade/MarketData/Trade?symbol=VIX|VVIX` exist (all PURE_QUERY). | **In scope — core of the item.** |
| Query | "What did I say about the regime last week and what happened?" | Yes, once UC-1 records exist and a follow-up price/GEX fact is fetched. | **In scope.** |
| UC-2 | GEX history and flow: GaleCore stores snapshots locally; a skill reads evolution, not a photo | **No.** GaleCore keeps GEX only in an in-memory cache; the snapshot sink is BL-004's first increment and lives in GaleCore. Only skew25 is persisted today (`Files/skew25_history.json`). | **Out of scope by default** — needs a GaleCore item (owner decision D-1). |
| UC-4 | Complete macro analysis from the ValidationLayer | **No.** The ValidationLayer runs inside the RPF tick (`RpfTickHandler` → `SignalGatesEvaluator`); no endpoint exposes it. | **Out of scope by default** — needs a GaleCore endpoint (owner decision D-2). |

## Acceptance criteria (draft)

- [ ] **AC-01 — Regime facts capability:** the registry exposes `compute.gex_analysis`, `compute.put_skew`
  (COMPUTE) and `market_data.trade` (PURE_QUERY; VIX, VVIX) — read-only classes only, as Phase 3 allows —
  *(ids/classes fixed by the implementer on 2026-09-16 to match GaleCore's actual endpoints; the draft said
  `put_skew`/`index_quote`, `PURE_QUERY`)*; `prepare --skill regime --symbol SPY`
  returns one `PreparedAnalysisView` whose `facts` carry all three sources with per-source
  provenance `GALECORE_VERIFIED`, observed timestamps and freshness; a missing or stale source
  fails closed with a documented error (no partial regime).
- [ ] **AC-02 — Regime skill and contract:** a versioned `regime-analysis` skill (YAML + Pydantic
  `RegimeInterpretation`) reuses the GEX assurance rules (no invented numbers, no numbers in prose,
  closed metric/unit set, evidence refs, no trading directive) extended to skew25 and VIX/VVIX
  metrics; `accept` rejects any interpretation that violates them, with adversarial tests per new
  metric and per guardrail (EN + ES).
- [ ] **AC-03 — Evaluable record:** an accepted result can be persisted as
  `GaleCore/research/regime/YYYY-MM-DD.md` with frontmatter containing: request, `run_id`, snapshot
  identity, facts with hashes, asset ids/versions/hashes, host-declared model metadata, accepted
  payload, trace summary, and empty `outcome` / `human_review` sections. Writing is idempotent per
  date+symbol (a second run of the same day appends a new entry, never overwrites), fails closed if
  the run was not accepted, and never stores secrets or raw logs.
- [ ] **AC-04 — Outcome and human review:** a `record outcome` step fetches a later fact set
  (spot, net_gex, VIX at time T+n) through the same capabilities and appends it to the record with
  its own provenance; a `record review` step appends the human's verdict (free text + enum
  `agree|partial|disagree`) with UTC timestamp. Neither step can modify the original accepted
  payload.
- [ ] **AC-05 — Query:** `query --since YYYY-MM-DD --symbol SPY` (or equivalent) returns the records
  as JSON (what was said, with which facts, what happened, what the human thought) without calling
  a model; a record with a corrupt frontmatter or a hash mismatch against its stored facts is
  reported as `INTEGRITY_FAILED`, not silently skipped.
- [ ] **AC-06 — Host entry point:** `CLAUDE.md` and the skill let Claude Code run the full loop
  (prepare → interpret → accept → record → later outcome → review → query) from the prompt
  "Analizá el régimen de hoy de SPY y guardalo" with no manual JSON assembly beyond the
  interpretation itself; the four-step protocol from GC-AI-0001 stays valid for the GEX skill.
- [ ] **AC-07 — Reproducible E2E:** sanitized evidence under `docs/evidence/gc-ai-0002-e2e/` records
  against live local GaleCore: ≥1 positive full loop (including outcome and review on a later
  run), and negatives for stale source, missing source, rejected interpretation, record of a
  non-accepted run, tampered record on query. One JSON per case with command, stdin, stdout,
  exit code, UTC timestamp. Runner extended from `tools/e2e_interactive_cases.py`.
- [ ] **AC-08 — Series evidence:** at least 3 real daily records on consecutive trading days exist
  in `GaleCore/research/regime/` produced through the host loop (not synthesized), and the query
  case reads them back. If the calendar does not allow 3 days before review, the criterion stays
  `PENDING`, never simulated.
- [ ] **AC-09 — Documentation coherence:** v5 §13/§17, `PHASE3-ALIGNMENT.md` (or a new
  `PHASE4-ALIGNMENT.md`), `CLAUDE.md`, validation guide and `roadmap/README.md` describe Phase 4
  as implemented/validated maturity, no more.
- [ ] **AC-10 — Repository validation:** engineering gate, pytest, Ruff, `git diff --check` and wheel
  build pass; new runtime assets are packaged.
- [ ] **AC-11 — Independent review:** internal `reviewer` then `/review-codex` inspect the diff and
  evidence, rerun checks, and record approval separately from the handoff.

## Requirement-to-evidence matrix

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 | `capabilities/contracts.py`, `dispatcher.py` (+`compute.put_skew`, `market_data.trade`), `galecore_dtos.py`, `regime_mapper.py`, `application/prepare_regime.py` | `test_regime_mapper.py` (real shapes, per-source freshness, fail-closed), `test_prepare_regime.py` (one failing/missing/stale source aborts without storing) | `docs/evidence/gc-ai-0002-e2e/P0-prepare.json`, `N01-stale-source.json`, `N02-missing-source.json` | IMPLEMENTED (pending AC-11) |
| AC-02 | `config/skills/regime-analysis/skill.yaml` v1.1.0 (v1.0.0 = before rule 10; the 2026-09-17 record carries v1.0.0 with its own hash), `contracts/regime_analysis.py`, `validate_interpretation.py` (`tail_pricing_level`, per-registry claims), `accept_interpretation.py` (dispatch by `skill_id`) | `test_regime_assurance.py` (every metric exact+unit, structural contradictions, digits/directives EN+ES, schema), `test_accept_regime.py`, `test_guardrails.py` (hyphenated positioning) | E2E `P1-accept-record.json`, `N03`–`N08` | IMPLEMENTED (pending AC-11) |
| AC-03 | `contracts/regime_record.py`, `adapters/record_store.py` (YAML **frontmatter is the authoritative document**: request, run_id, snapshot identity, facts+hashes, assets, host, accepted payload, trace, entry_hash, outcomes, human_reviews — Codex M1), `application/record_regime.py::record_accepted`, `cli.py accept --record --prompt` | `test_record_regime.py::TestRecordAccepted`, `TestReviewRoundFixes::test_frontmatter_holds_the_whole_record`, YAML-injection round-trip, schema_version guard | Real record `GaleCore/research/regime/SPY/2026-09-17.md` (migrated to the frontmatter format on 2026-09-19 with `entry_hash` unchanged; `step4-query-after-format-migration.json`). Real compliant record `SPY/2026-09-21.md` written directly in the frontmatter format (`day2-step3-accept-record.json`); E2E `P1-accept-record.json` regenerated 2026-09-21 in the current format. | IMPLEMENTED (pending AC-11) |
| AC-04 | `record_regime.py::record_outcome/record_review`, `cli.py record outcome|review` | `TestOutcomeAndReview` (GALECORE_VERIFIED outcome, run_id targeting, review verdict, entry_hash untouched), stale outcome rejected | Real, on `SPY/2026-09-21.md`: `record outcome` ~30 min after acceptance (`day2-step5`, GALECORE_VERIFIED) and the **owner's** `record review` (`agree`, comment verbatim, `day2-step7`), both read back by `query` (`day2-step8`). E2E `P2`/`P3`/`N12` cover the mechanics in a temporary dir. | IMPLEMENTED (pending AC-11) |
| AC-05 | `record_regime.py::query_records`, `record_store.py::parse_document/verify_entry/load_path` (frontmatter parsed and validated, hashes recomputed, Markdown body re-rendered and compared), `cli.py query` | `TestQueryAndIntegrity` (range filter, tampered payload/facts, corrupt frontmatter YAML, incomplete frontmatter, wrong location, later steps refuse), `TestReviewRoundFixes` (frontmatter symbol/date/schema tampering or missing → INTEGRITY_FAILED; edited Markdown body → INTEGRITY_FAILED; YAML-dangerous prose round-trips; dotted symbols rejected), CLI subprocess tests (exit 3 on INTEGRITY_FAILED) | E2E `P4-query.json`, `N10-tampered-record-query.json`, `N11-review-on-tampered.json`; manual `step4-query.json` | IMPLEMENTED (pending AC-11) |
| AC-06 | `CLAUDE.md` (99 lines, routes to guides), `docs/LOCAL-VALIDATION-REGIME-INTERACTIVE.md`, skill YAML instructions (rule 10: no comparisons from memory) | Manual host run, no runner, **compliant** (2026-09-21 post-session, F-2 applied, rule 10 respected): prepare → interpret → `accept --record` → `query`; earlier 2026-09-17 run kept as flagged history (F-7) | `docs/evidence/gc-ai-0002-manual-host-run/` (`day2-*.json`) | IMPLEMENTED (pending AC-11) — `record outcome` on the same entry: see AC-04 |
| AC-07 | `tools/e2e_regime_cases.py` (two phases; ALL records in temporary dirs; artifacts sanitized) | Regenerated 2026-09-21T15:42–15:47Z during the cash session (intraday prints, `MAX_STALENESS_SECONDS=36000`), 16/16 matched, current record format (YAML frontmatter, `snapshot_hash`, exact numbers); no key / no absolute paths in the artifacts (grep-verified); real series untouched | `docs/evidence/gc-ai-0002-e2e/` 19 artifacts (README, P0–P4, N01–N12, view, host-interpretation). P2/P3 remain mechanics only (outcome seconds later, runner-authored review) and do not satisfy "outcome and review on a later run" (Codex M4) | IMPLEMENTED (pending AC-11): the later-run outcome + human review are evidenced by the real run of 2026-09-21 (AC-04) |
| AC-08 | Real record loop; days 1-2 of the series: `SPY/2026-09-21.md` and `SPY/2026-09-22.md` (both post-session, compliant, each with outcome + owner review) | — | `query --since 2026-09-14` returns the three records, `integrity_failed: []` (`day3-step8-query-final.json`); verdicts `agree` (09-21) and `partial` (09-22, wall over-reading) | PENDING: 2/3 days (next: 2026-09-23 after the close) |
| AC-09 | v5 §13.4/§17 updated, `PHASE4-ALIGNMENT.md` new, `SESSION_HANDOFF.md`, `CLAUDE.md`, validation guide, `roadmap/README.md` (workspace) | Engineering gate (phase-aware closure claims) | This file | IMPLEMENTED (pending AC-11) |
| AC-10 | `tools/verify_wheel_assets.py` (builds the wheel, checks required modules and byte-identical assets, prints requires) | gate PASS, pytest green (count in the latest handoff), ruff clean, diff --check clean, `verify_wheel_assets.py` RESULT: PASS | Handoff sections (exact outputs) | IMPLEMENTED (pending AC-11) |
| AC-11 | — | Internal reviewer (2 rounds: CHANGES_REQUESTED → APPROVE) + `/review-codex` (3 rounds: CHANGES_REQUESTED → recheck → **APPROVE** 2026-09-21) | Review records below; `docs/engineering/reviews/GC-AI-0002-2026092{1T225617Z,0919T223349Z,0917T110236Z}.md` | APPROVED for the increment; AC-08 series still open |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
python -m build --wheel
```

Plus the E2E runner against live GaleCore (`localhost:5000`, ApiKey from user-secrets, never in
the repo) for AC-07/AC-08.

## Invariants carried from GC-AI-0001

- Fail-closed at every boundary; a rejected result never crosses into a record.
- The accepted payload is the boundary of SUCCESS; nothing is reformulated after acceptance.
- Facts vs interpretation: the model never recalculates GaleCore metrics; quantitative claims equal
  fact values exactly; prose has no digits.
- Provenance is labelled (`GALECORE_VERIFIED` / `VALIDATOR_OBSERVED` / `HOST_DECLARED`); the
  record stores which it is per field.
- No secrets, tokens, headers, chain-of-thought or raw logs in records, traces, evidence or docs.
- One work item = one branch/worktree; small reviewable commits; Codex recheck per increment.

## Product-owner decisions (2026-09-16, contract approval)

| # | Question | Recommendation | Decision |
|---|---|---|---|
| D-1 | Does UC-2 (GEX history) enter GC-AI-0002, or is it a separate GaleCore work item (BL-004 first increment: snapshot sink behind `GexAnalysisHandler`, fail-open, SPY only) that GC-AI-0002 consumes later? | **Separate GaleCore item, sequenced after 0002.** 0002 already produces daily regime records that include `net_gex`; that is a coarse series today. A proper sink belongs in GaleCore and needs your call on cadence/retention (BL-004 says so). | **Separate GaleCore item.** UC-2 out of scope. |
| D-2 | Does UC-4 (macro from the ValidationLayer) enter GC-AI-0002? It needs a new read-only GaleCore endpoint exposing the SignalGates/ValidationLayer evaluation. | **Defer to a GaleCore item.** Keep 0002 to the three sources that already exist; add macro as a fourth source once the endpoint exists. | **Deferred to a GaleCore item.** UC-4 out of scope. |
| D-3 | Where do records live: `GaleCore/research/regime/` (roadmap) or `GaleCore-AI/records/`? | **`GaleCore/research/regime/` as the roadmap says** — it is research, next to `research/data`; GaleCore is never pushed, so nothing leaks. Path configurable via env var so tests write to a temp dir. | **`GaleCore/research/regime/`**, env-var override for tests. |
| D-4 | Record entry granularity: one file per day+symbol with appended entries, or one file per run? | **One file per day+symbol, entries appended.** Matches the roadmap path and keeps "the series" browsable by hand. | **One file per day+symbol, appended entries.** |
| D-5 | Is AC-08 (≥3 real consecutive-day records) part of the DoD, or evidence gathered after VALIDATED? | **Part of the DoD**, because the roadmap's whole point is "the record is read, not just written"; accept `PENDING` if the calendar does not allow it before review. | **Part of the DoD**; `PENDING` allowed if the calendar does not permit. |

## Implementer handoff — Increment 1 (2026-09-16, branch `feature/gc-ai-0002`, uncommitted)

**State:** IN_PROGRESS → ready for internal review, then `/review-codex`.

### Decisions implemented (within the approved contract)

| # | Decision | Why |
|---|---|---|
| I-1 | Capability ids `compute.put_skew` (COMPUTE) and `market_data.trade` (PURE_QUERY) instead of the draft's `put_skew`/`index_quote` | Match GaleCore's actual endpoints and the P0 semantic classes; both read-only. AC-01 wording adjusted with a note. |
| I-2 | Skew metrics named `put_skew_ratio` / `put_wing_iv` (no digits) | First live accept failed: `no_invented_numbers` scans the serialized JSON and read the `25` in `put_skew_25d` as an invented number. Renaming is safer than loosening a guardrail shared with GEX. |
| I-3 | `tail_pricing` validated against GaleCore's `levelOk`, not a GaleCore-AI threshold | Principle "lo determinístico calcula, el modelo interpreta": the validator never thresholds. |
| I-4 | Snapshot gains `skill_id` (default `gex_interpretation`), `capability_traces` (default empty) and, after Codex B1, `snapshot_hash` (sealed at prepare, verified at accept, never filled on load); view gains `skill_id` | `accept` dispatches the output contract by `skill_id`; the digest binds skill_id, freshness window/status, assets and capabilities so an edited store file cannot pick a laxer contract or a wider window. A pre-Phase-4 dump still loads but is **rejected at accept** ("snapshot_hash missing") — no grace period, same rule as `conventions_hash`. |
| I-5 | Record written only by `accept --record` from a SUCCESS in the same process; no "record this payload" command | Removes the fabrication vector: nothing can be recorded that was not accepted. |
| I-6 | *(superseded by I-11)* Record file = frontmatter + human summary + authoritative JSON block | Replaced after Codex M1: the frontmatter is the record. |
| I-7 | Record date = `prepared_at` in the convention timezone (`America/New_York`); `tzdata` declared for Windows | Trading-day semantics; the E2E ran after 00:00 UTC and correctly landed on 2026-09-16. |
| I-8 | Guardrail exception for descriptive positioning widened to hyphenated forms (`short-gamma`, `corto-gamma`) | Real false positive in the live E2E (P1 rejected "short-gamma side of the flip point, between the put wall"). Narrow regex change, EN+ES tests. |
| I-9 | Engineering gate derives the closure-claim phase from the active item's title | With Phase 3 legitimately closed, the hardcoded "phase 3 closed" check blocked every gate run under GC-AI-0002. |
| I-10 | `CLAUDE.md` compacted to 99 lines, routing to the two validation guides | ENGINEERING.md rule (≤100 lines, route don't copy). |
| I-11 | Record file: YAML frontmatter is the authoritative document; the Markdown body is a derived summary | Codex M1: AC-03 says "frontmatter containing …". PyYAML round-trip verified (quoted timestamps, unfolded strings, unicode); `save` re-parses before replacing; `schema_version` must be known. Real record migrated in place with `entry_hash` unchanged. |
| I-12 | Text guardrails use exact numeric equality (tolerance 0.0) instead of 0.01 | Codex B3: 17.715 for 17.71 in an evidence claim or limitation is an invented number. Stricter than Phase 3 for GEX too; the golden cases still pass. |
| I-13 | Two more directive patterns (bullish/bearish position·stance·bet, posición/apuesta alcista·bajista) | Codex B2's probes now rejected. The bounded-pattern contract itself is the owner's Phase 3 decision (GC-AI-0001 AC-03, review 3 B1 option a): novel phrasings remain a declared limitation, not a guarantee. |

### Invariants now enforced

- No partial regime: any missing, malformed or stale source aborts `prepare` and nothing is stored.
- `accept` selects the output contract from the snapshot's `skill_id`; a GEX-shaped payload cannot pass a regime run and vice versa; unknown `skill_id` → `INTERNAL_ERROR`.
- `tail_pricing` must equal GaleCore's `put_skew_level_ok`; `gamma_regime` must equal the sign of `net_gex`; every claim equals its fact exactly with the registry unit.
- A record entry exists only for a SUCCESS; the same `run_id` cannot be recorded twice; a second run the same day appends.
- Acceptance-time content is hash-bound; `query` reports `INTEGRITY_FAILED` (exit 3) and later steps refuse tampered files.
- No secrets in records/evidence/fixtures (grep of the live ApiKey and header names over `docs/evidence`, `research/regime`, `tests/fixtures`: no hits).

### Manual host run (AC-06) — corrected after internal review R1

*Original claim (2026-09-16) withdrawn:* the loop from `accept` onward had been executed by `tools/e2e_regime_cases.py`, not by the host, and the runner had written a synthesized review into the real record. That record was deleted.

*Actual manual run (2026-09-17 10:50–10:54 UTC, `docs/evidence/gc-ai-0002-manual-host-run/`):* the host issued `prepare --skill regime`, authored the interpretation from the returned facts, ran `accept --record --prompt "Analizá el régimen de hoy de SPY y guardalo"` (SUCCESS, RECORDED → `SPY/2026-09-17.md`) and `query` (1 record, no integrity failures). Real fail-closed events observed on the way: an expired snapshot (TTL 3600 s after a ~10 h pause) rejected at `accept`; VVIX stale under a 10 h window in the pre-market (no pre-market print) — the run proceeded with the 24 h cap, disclosed in the interpretation's limitations and in the README. Not run on the real record: `record outcome` (to be run later in the session) and `record review` (owner's verdict).

Semantic-limit observation kept from the first attempt: an earlier draft of the prose said spot was *above* the zero-gamma level while the facts showed it *below*; the validator cannot catch that, the host must read the facts.

### Remaining limitations / findings (not in scope of this increment)

- **F-1 (product):** the regime snapshot can never be `VALID` while GaleCore's PutSkew publishes no timestamp; hosts must run with `ALLOW_UNKNOWN_FRESHNESS=true`. A GaleCore change (timestamp on `PutSkewResponse`) would fix it.
- **F-2 (operations → owner decision):** outside the session VIX/VVIX prints are hours old (VVIX has no pre-market print) while GaleCore stamps GEX with its computation time (always VALID). `MAX_STALENESS_SECONDS` must be widened (36000 for the E2E after the close; 86400 for the pre-market manual run) or `prepare` fails closed. Widening it effectively disables the index staleness guard. What "fresh enough" means for the daily record — and whether records should only be produced during/after the cash session — is the owner's call.
- **F-3 (semantic limit, known):** prose entailment is not verified (see manual run). Reviewer R1 recheck noted that the 2026-09-17 entry's prose compares with the previous session ("smaller than the previous session", "unchanged from the prior read") using values that are not in that run's facts — host-added context the validator cannot see. The skill and guide now say: compare with earlier records only through `query` and state it in limitations. The entry itself is hash-bound and left for the owner's review.
- **F-4 (GaleCore):** UC-2 / UC-4 need GaleCore work (decisions D-1/D-2); GaleCore untouched.
- **F-5 (AC-08):** only one real trading day recorded (2026-09-17); two more consecutive days are needed before review can mark it satisfied.
- **F-6 (AC-04):** the human review step has never been exercised with a real human verdict; only the owner can provide one.
- **F-7 (owner):** the 2026-09-17 record is real but its prose violates skill rule 10 (added afterwards). Keep it as history and start the AC-08 series on the next trading day, or delete it? Recommendation: keep it (hash-bound, flagged), do not count it toward AC-08.
- **F-9 (owner, hygiene):** the local GaleCore dev `ApiKey` is quoted verbatim in two immutable GC-AI-0001 review files (`GC-AI-0001-20260916T185033Z.md`, `GC-AI-0001-20260916T190907Z.md`). Recommendation: rotate the key in `dotnet user-secrets`. Not part of GC-AI-0002's scope.
- **F-8 (evidence freshness):** `docs/evidence/gc-ai-0002-e2e/` was generated before the Codex round-1 code changes and cannot be regenerated on a weekend (no prints since Friday → `prepare` fails closed at the 24 h cap, evidenced). Rerun on the next trading day before the next Codex round. **Resolved 2026-09-21:** regenerated intraday (see AC-07). The regeneration exposed a runner defect: the N10 tamper still edited the JSON form `"gamma_regime": "…"` while the record has been YAML frontmatter since round 1, so the tamper was a no-op and N10/N11 reported false mismatches on the first rerun; fixed (regex on the YAML line, `tamper_applied` check now meaningful). The file was also passed through `ruff format` (whole-file reformat, no other functional change). First rerun also caught a host mistake: the digit in "E2E" inside a limitation was rejected by `no_invented_numbers` (evidence the guardrail scans every string, including limitations).

### Files changed (increment 1)

*(Rewritten by the implementer from the actual diff after the `handoff` agent's draft contained
invented details — a `--fact-time` flag, a "no ellipsis" guardrail, a "VALIDATED" roadmap status.
The command outputs below are the agent's verbatim captures and were checked against a rerun.)*

**Contracts**
- `src/galecore_ai/contracts/regime_analysis.py` (new) — `RegimeFacts`, `RegimeSource`, `RegimeMetric`/`RegimeUnit` registry, `TailPricing`, `RegimeQuantitativeClaim`, `RegimeInterpretation`.
- `src/galecore_ai/contracts/regime_record.py` (new) — record document/entry models, `ReviewVerdict`, `compute_entry_hash`.
- `src/galecore_ai/contracts/prepared_analysis.py` — additive fields `skill_id` (default `gex_interpretation`) and `capability_traces` (default `[]`) on the stored snapshot; `skill_id` on the view.

**Capabilities**
- `src/galecore_ai/capabilities/contracts.py` — definitions for `compute.put_skew` (COMPUTE) and `market_data.trade` (PURE_QUERY).
- `src/galecore_ai/capabilities/dispatcher.py` — routes for the two capabilities (docstring + `_ROUTE_TABLE`); no other logic change.
- `src/galecore_ai/capabilities/galecore_dtos.py` — `GaleCorePutSkewResponse`, `GaleCoreTradeEvent` (tolerates `"NaN"` strings), `GaleCoreTradeResponse`.
- `src/galecore_ai/capabilities/regime_mapper.py` (new) — parse PutSkew/Trade, `trade_print`, `map_to_regime_facts` with per-source freshness; no recalculation.

**Application**
- `src/galecore_ai/application/prepare_regime.py` (new) — `fetch_regime_facts` (4 concurrent fetches, traces) and `prepare_regime_snapshot` (fail-closed, snapshot with `skill_id` + traces).
- `src/galecore_ai/application/accept_interpretation.py` — renamed to `accept_interpretation` (alias `accept_gex_interpretation` kept); output contract chosen by `snapshot.skill_id`; unknown skill → `INTERNAL_ERROR`; all capability traces copied to the trace.
- `src/galecore_ai/application/validate_interpretation.py` — regime branch: `_check_regime_sign` takes the enum, new `_check_tail_pricing`, `_validate_single_claim` takes the metric registry.
- `src/galecore_ai/application/record_regime.py` (new) — `record_accepted`, `record_outcome`, `record_review`, `query_records`, `record_date_for`.

**Adapters**
- `src/galecore_ai/adapters/record_store.py` (new) — `FileRecordStore` (path validation, atomic write, integrity verification on load), `render_markdown`, `default_records_dir` (`GALECORE_RECORDS_DIR` or `../GaleCore/research/regime`).
- `src/galecore_ai/adapters/cli.py` — `prepare --skill gex|regime`; `accept --record --prompt`; `record outcome --symbol --date [--run-id]`; `record review --symbol --date --run-id --verdict --comment`; `query --symbol --since [--until]`; exit-code map documented.
- `src/galecore_ai/adapters/asset_manifest.py` — `load_required_assets(skill_ids)` selects skills from `_KNOWN_SKILLS`; unknown/empty selection or mismatched `skill_id` fails.

**Harness**
- `src/galecore_ai/harness/guardrails.py` — `_NOT_DESCRIPTIVE_EN/ES` accept `[\s-]+` before the descriptive noun (hyphenated "short-gamma"/"corto-gamma" are not directives). No other pattern touched.

**Assets (config)**
- `config/skills/regime-analysis/skill.yaml` (new) — `regime_interpretation` v1.0.0.
- `config/agents/trading-agent.yaml` — v1.1.0: adds the regime skill and the two capabilities to the allowlist; description says Phases 3–4.

**Tools / packaging**
- `tools/engineering_gate.py` — closure-claim regex derived from the phase number in the active item title (fallback: any phase).
- `tools/e2e_regime_cases.py` (new) — two-phase runner (P0 prepare; P1–P4 loop; N01–N12 negatives in a temp records dir).
- `pyproject.toml` — `tzdata>=2023.3; platform_system == 'Windows'`.

**Tests**
- `tests/unit/regime_support.py` (new) — builders: fixture loaders, `RegimeFakeDispatcher`, `regime_facts`, `regime_snapshot`, `valid_regime_interpretation`.
- `tests/unit/test_regime_mapper.py`, `test_prepare_regime.py`, `test_regime_assurance.py`, `test_accept_regime.py`, `test_record_regime.py` (new).
- `tests/integration/test_cli_subprocess.py` — `TestCliRegimeAndRecords` (11 cases) and `extra_env` support in `_run_cli`.
- `tests/unit/test_engineering_gate.py` — `title` parameter; earlier-phase claim tolerated, own-phase claim rejected.
- `tests/unit/test_guardrails.py` — two hyphenated descriptive cases (EN, ES).
- `tests/unit/test_trading_agent.py` — agent v1.1.0, regime skill, new capabilities.
- `tests/fixtures/galecore/put_skew_spy.json`, `trade_vix.json`, `trade_vvix.json` (new) — real GaleCore payloads captured 2026-09-16 (no secrets).

**Docs**
- `CLAUDE.md` — both verticals, common env, exit codes; 99 lines, routes to the guides.
- `docs/LOCAL-VALIDATION-REGIME-INTERACTIVE.md` (new), `docs/architecture/PHASE4-ALIGNMENT.md` (new).
- `docs/architecture/GaleCore-AI-arquitectura-v5.md` — §13.4 gaps annotated with their current state, §17 Phase 4 first increment.
- `docs/architecture/SESSION_HANDOFF.md` — state line, verticals, reading order.
- `docs/evidence/gc-ai-0002-e2e/` (new) — `README.md`, `view.json`, `host-interpretation.json`, `P0`–`P4`, `N01`–`N12` JSON artifacts (temporary records dirs, sanitized).
- `docs/evidence/gc-ai-0002-manual-host-run/` (new) — README + 7 sanitized stdout files of the genuine host run that produced the real record.
- `docs/engineering/ACTIVE_WORK_ITEM` — points here. This work item (new).

**Workspace repo (`..`)**
- `roadmap/README.md` — Phase 4 row: **en curso** (not validated); Phase 4 use-case table with the D-1/D-2 decisions.

**Not a change:** `dist/` (build output, ignored). GaleCore code untouched; the only file written outside this repo is `GaleCore/research/regime/SPY/2026-09-17.md` (manual host run; the runner-written `2026-09-16.md` was deleted after review R1).

### Commands and exact results (2026-09-17T00:46:17 UTC)

> python tools/engineering_gate.py

```
Engineering gate: GC-AI-0002
Status: IN_PROGRESS
WARNING: 11 acceptance criteria remain open
PASS
```

> python -B -m pytest -q -p no:cacheprovider

```
============================== warnings summary ===============================
..\..\..\..\..\..\Apli\Gonza\Lib\site-packages\fastapi\testclient.py:1
  C:\Apli\Gonza\Lib\site-packages\fastapi\testclient.py:1: StarletteDeprecationWarning: Using `httpx` with `starlette.testclient` is deprecated; install `httpx2` instead.
    from starlette.testclient import TestClient as TestClient  # noqa

-- Docs: https://docs.pytest.org/en/stable/how-to-capture-warnings.html
568 passed, 1 warning in 35.58s
```

> python -B -m ruff check --no-cache .

```
All checks passed!
```

> git diff --check

```
warning: in the working copy of 'docs/engineering/ACTIVE_WORK_ITEM', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/galecore_ai/adapters/cli.py', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/galecore_ai/capabilities/galecore_dtos.py', LF will be replaced by CRLF the next time Git touches it
Exit code: 0
```

> python -m build --wheel

```
Successfully built galecore_ai-0.1.0-py3-none-any.whl
```

> git status --short | wc -l

```
41
```

**UTC timestamp:** 2026-09-17T00:46:17.752688+00:00


### Commands and exact results after internal review R1 (2026-09-17T10:56 UTC)

```
> python tools/engineering_gate.py
Engineering gate: GC-AI-0002
Status: IN_PROGRESS
WARNING: 11 acceptance criteria remain open
PASS
> python -B -m pytest -q -p no:cacheprovider
582 passed, 1 warning in 37.52s
> python -B -m ruff check --no-cache .
All checks passed!
> git diff --check
(two LF/CRLF warnings on ACTIVE_WORK_ITEM and galecore_dtos.py; exit 0)
> python -m build --wheel
Successfully built galecore_ai-0.1.0-py3-none-any.whl
> python tools/e2e_regime_cases.py --phase run ... (live GaleCore, 2026-09-17T01:02-01:05Z)
All 16 cases matched their expected exit code, status, guardrails and record outcome.
```


### Commands and exact results after Codex review 1 (2026-09-19T22:26 UTC)

```
> python tools/engineering_gate.py
Engineering gate: GC-AI-0002
Status: IN_PROGRESS
WARNING: 11 acceptance criteria remain open
PASS
> python -B -m pytest -q -p no:cacheprovider
598 passed, 1 warning in 61.21s (0:01:01)
> python -B -m ruff check --no-cache .
All checks passed!
> git diff --check
(LF/CRLF warnings only; exit 0)
> python tools/verify_wheel_assets.py
wheel: galecore_ai-0.1.0-py3-none-any.whl
ok  ... 7 required modules, 6 packaged assets byte-identical to config/
requires: ... tzdata>=2023.3; platform_system == 'Windows' ...
RESULT: PASS
> python -B -m galecore_ai.adapters.cli prepare --symbol SPY --skill regime   (2026-09-19 22:18 UTC, Saturday, MAX_STALENESS_SECONDS=86400)
{"error": "Data is stale for source(s) ['vix', 'vvix'] (max 86400s)", ...}  exit 1
```

## Internal review 1 (Claude `reviewer` subagent, Opus, 2026-09-17 ~01:00 UTC) — CHANGES_REQUESTED

| # | Severity | Finding | Resolution |
|---|---|---|---|
| R1-B1 | BLOCKER | The E2E runner wrote a runner-authored "human review" and a T+10 s outcome into the **real** record `SPY/2026-09-16.md`, cited as AC-04/AC-06 evidence. | **Fixed.** Runner now writes only to temporary records dirs (deleted at the end); P3 is labelled runner-authored; the contaminated real file was deleted; AC-04 row now says the human review is pending the owner. E2E regenerated (16/16). |
| R1-M1 | MAJOR | `load_path` never checked the frontmatter; AC-05 literally requires corrupt frontmatter → `INTEGRITY_FAILED`. | **Fixed.** `verify_frontmatter` compares `schema_version`/`symbol`/`date`/`entry_count` with the JSON document; missing or disagreeing → `INTEGRITY_FAILED`; `save` re-parses the rendered text before replacing. 4 tests. |
| R1-M2 | MAJOR | "Manual host run" was the runner's subprocess calls. | **Fixed.** Genuine manual run performed and evidenced (`docs/evidence/gc-ai-0002-manual-host-run/`); claim rewritten. |
| R1-m1 | MINOR | ES hyphenated guardrail test did not exercise the change. | **Fixed.** Sentence now hits `(ponerse|ir)\s+corto-gamma`. |
| R1-m2 | MINOR | Marker/fence injection through the prompt bricked the day's record. | **Fixed.** Authoritative block = the one after the last marker line; `save` round-trips; test with marker+fence in prompt and in a review comment. |
| R1-m3 | MINOR | `_SYMBOL_RE` admitted `.`/`..`; `dates()` unvalidated; `RecordStoreError` uncaught in `query`. | **Fixed.** Symbol needs a letter/digit; `dates()` validates; `query_records`/CLI surface `RecordError` as JSON (exit 3). Tests. |
| R1-m4 | MINOR | `record outcome` accepted STALE-labelled facts. | **Fixed.** Outcome rejects STALE like prepare (UNKNOWN still allowed). Test. |
| R1-m5 | MINOR | Evidence embedded a raw .NET stack trace and absolute paths/username. | **Fixed.** Runner truncates errors to the first line and replaces repo/tmp/home paths; manual evidence sanitized the same way. |
| R1-m6 | MINOR | Sibling-dependent test. | **Fixed.** Skips without the sibling; added a fail-closed test without env/sibling. |
| R1-m7 | MINOR | No legacy-snapshot test for I-4. | **Fixed.** `TestLegacySnapshots` loads a dump without the new fields and accepts a GEX interpretation. |
| R1-m8 | MINOR | v5 §13.4 struck through a gap attributed to unreviewed Phase 4. | **Fixed.** Wording "en curso (GC-AI-0002)". |
| R1-n1 | NOTE | GEX timestamp is computation time (always VALID); widening the window disables the index guard. | Recorded in F-2 as an owner decision. |
| R1-n2 | NOTE | `accept --record` on a GEX SUCCESS → `RECORD_FAILED` exit 1 (documented). | Accepted as is. |
| R1-n3 | NOTE | All sources share one `response_received_at`. | Accepted as is (documented in `fetch_regime_facts`); not worth a per-source clock. |

### Internal review 1 — recheck 2 (same reviewer, 2026-09-19 22:26 UTC, after the Codex fixes): **APPROVE**

All C1 resolutions verified with the reviewer's own tamper probes (skill switch, window widening, null hash, asset rename, skill not in manifest; 17.715; YAML-dangerous prose; frontmatter edits). Three MINORs fixed in this round: skill asset bumped to v1.1.0 (content changed by rule 10); the Markdown body is now deterministic and compared on load (an edited summary → `INTEGRITY_FAILED`, test added); AC-05/I-6 wording and three test names updated. NOTE applied: the output contract is looked up only after `snapshot_integrity`. Still open: D-6/F-2/F-6/F-7 (owner), F-8 (E2E regeneration on a trading day), Codex recheck.

### Internal review 1 — recheck (same reviewer, 2026-09-17 ~11:10 UTC): **APPROVE**

All R1 resolutions verified against the tree (gate PASS, 582 passed, ruff, diff --check). Three MINORs, fixed in this round: stale sentence and missing evidence folder in "Files changed"; skill/guide rule against comparing with earlier sessions from memory (the 2026-09-17 entry's prose does so — left hash-bound for the owner's review, F-3); `CLAUDE.md` staleness line aligned with the 86400 cap (F-2). Open by design: AC-04 human verdict (owner), AC-08 series, AC-11 Codex.

## Internal review 2 (Claude `reviewer` subagent, Opus, 2026-09-21 ~23:00 UTC) — APPROVED (increment)

Rechecked the day-2 evidence, the regenerated E2E, the runner fix and the matrix against the real files; all checks reproduced (gate PASS, ruff, 599 passed, diff --check, wheel PASS); query rerun read-only, record hashes unchanged. No BLOCKER/MAJOR. MINORs and their disposition:

| # | Finding | Disposition |
|---|---|---|
| I2-m1 | `cli.py record outcome/review` printed a fresh `datetime.now()` instead of the persisted `observed_at`/`reviewed_at` (drift of ~50 ms visible in `day2-step5/7`) | **Fixed:** the CLI generates the timestamp once and passes it to `record_outcome(observed_at=)` / `record_review(reviewed_at=)`; test `test_caller_timestamps_are_persisted_verbatim`. The day-2 artifacts keep the pre-fix stdout (documented in the README). |
| I2-m2 | AC-03 row still said "E2E rerun pending" | **Fixed** (row updated). |
| I2-m3 | README step-5 time was the command start, not the persisted `observed_at` | **Fixed** (column clarified). |
| I2-m4 | Day-1 evidence sanitized as `<home>\OneDrive\…` vs day-2 `<workspace>` | **Not changed:** the day-1 files were already reviewed by Codex; no username leaked. |
| I2-m5 | Pre-existing, out of scope: GC-AI-0001 review files quote the dev ApiKey verbatim; `increment4-e2e` has absolute user paths | **Owner decision:** rotate the local dev ApiKey (reviews are immutable by rule) — recorded as F-9. |

## Independent review 1 (Codex, `--uncommitted`, effort high, 2026-09-17T11:02Z) — `docs/engineering/reviews/GC-AI-0002-20260917T110236Z.md`

**Verdict:** CHANGES_REQUESTED. Reviewed the full dirty tree on top of `4e42079`. Checks reproduced (gate PASS, ruff, 582 passed, diff --check).

| # | Severity | Finding | Resolution |
|---|---|---|---|
| C1-B1 | BLOCKER | `skill_id` and `freshness_max_age_seconds` unhashed: editing the store switched the contract / widened the window undetected | **Fixed (I-4).** `snapshot_hash` over run_id, symbol, skill_id, facts/conventions hashes, freshness metadata, assets and capabilities; sealed at prepare, verified in `snapshot_integrity` before schema selection; skill_id must be among the loaded assets. 5 tamper tests (`TestSnapshotHashBinding`); legacy dumps rejected. |
| C1-B2 | BLOCKER | Novel advisory phrasing ("A bullish position in SPY is warranted") reaches SUCCESS | **Partially fixed / owner decision.** Patterns for bullish/bearish position·stance·bet and posición/apuesta alcista·bajista added with tests (I-13). The bounded-pattern contract is the product owner's standing decision from GC-AI-0001 AC-03 (option a, 2026-09-16): novel phrasings are a declared limitation. A structural change (controlled implication categories) is out of this item's scope — escalated as decision D-6. |
| C1-B3 | BLOCKER | 0.01 tolerance in `no_invented_numbers` / evidence matching accepted 17.715 for 17.71 | **Fixed (I-12).** Exact equality; regression tests for evidence claims and limitations. |
| C1-M1 | MAJOR | AC-03 requires the record content in YAML frontmatter; it was in a JSON block | **Fixed (I-11).** Frontmatter is the authoritative document; real record migrated (`entry_hash` unchanged). |
| C1-M2 | MAJOR | Manual evidence has no outcome/review | **Recorded, pending.** Outcome and the owner's review on a real record require a trading day (Saturday attempt evidenced stale). AC-06 marked PARTIAL. |
| C1-M3 | MAJOR | The accepted 2026-09-17 interpretation compares with a previous session from memory | **Recorded, owner decision F-7.** Skill rule 10 added; a compliant run is due on the next trading day; the record is kept, flagged, not counted for AC-08. |
| C1-M4 | MAJOR | AC-07 marked implemented although outcome/review evidence is mechanics-only | **Fixed (matrix).** AC-07 is PARTIAL; the later-run outcome + human review part is PENDING. |
| C1-m1 | MINOR | Work item said it "is not the active item" | **Fixed.** |
| C1-m2 | MINOR | SESSION_HANDOFF pending list incomplete | **Fixed.** |
| C1 AC-10 | PARTIAL | Wheel/byte-identical assets only in prose | **Fixed.** `tools/verify_wheel_assets.py` (RESULT: PASS, output in the handoff). |

Next: `/review-codex --recheck` after the next trading day's compliant run and E2E regeneration (F-8).

## Independent review 2 (Codex, `--recheck`, effort medium, 2026-09-19T22:33Z) — `docs/engineering/reviews/GC-AI-0002-20260919T223349Z.md`

**Verdict:** CHANGES_REQUESTED, converging. C1-B1, C1-B3, C1-M1, C1-M4, C1-m1, C1-m2 **RESOLVED**; C1-B2 and C1-M3 **OWNER DECISION** (D-6, F-7); C1-M2 **STILL OPEN** (needs a trading day: compliant run + genuine later outcome + owner review + final query; E2E regeneration, F-8). New MINOR: `PHASE4-ALIGNMENT.md` status line overstated readiness → **fixed** (lists AC-04/06/07/08/11 and the decisions as open). Checks reproduced by Codex: gate PASS, ruff, 599 passed, diff --check.

**Next round — runbook for the next trading day (2026-09-21, after the cash close, 16:30–20:00 ET; owner decisions applied):**

1. Env: `GALECORE_BASE_URL=http://localhost:5000`, `GALECORE_API_KEY=<user-secrets>`, `ALLOW_UNKNOWN_FRESHNESS=true`, `MAX_STALENESS_SECONDS=36000`, `GALECORE_TIMEOUT_SECONDS=300`. GaleCore up.
2. E2E regeneration (temp records dirs; evidence only): `python tools/e2e_regime_cases.py --phase prepare --out docs/evidence/gc-ai-0002-e2e` → host authors `host-interpretation.json` from `view.json` (current facts only, rule 10) → `--phase run ...`. Expect 16/16.
3. Compliant manual run (real record): `prepare --skill regime` → host interpretation from those facts only → `accept --record --prompt "Analizá el régimen de hoy de SPY y guardalo"` → `query`. Capture sanitized stdout under `docs/evidence/gc-ai-0002-manual-host-run/` (day 2 files).
4. Later the same evening (≥ 30 min, still inside the post-session window): `record outcome --symbol SPY --date 2026-09-21 --run-id <run_id>`.
5. Owner: `record review --symbol SPY --date 2026-09-21 --run-id <run_id> --verdict agree|partial|disagree --comment "..."` (F-6). Then `query --since 2026-09-14` as the final step; copy sanitized stdout to the evidence folder.
6. Update matrix rows AC-04/06/07/08 with the real artifacts; `python tools/verify_wheel_assets.py`; gates; internal reviewer recheck; `/review-codex --recheck docs/engineering/reviews/GC-AI-0002-20260919T223349Z.md`.
7. Days 2 and 3 of the AC-08 series (2026-09-22, 2026-09-23): repeat steps 3–5 after each close; then the reviewer can evaluate AC-08.

Weekend note: 2026-09-19 (Sat) and 2026-09-20 (Sun) attempts are impossible by design — the last VIX/VVIX prints are from Friday 20:15 UTC and `prepare` fails closed at any allowed window (Saturday attempt evidenced).

## Independent review 3 (Codex, `--recheck`, effort medium, 2026-09-21T22:56Z) — `docs/engineering/reviews/GC-AI-0002-20260921T225617Z.md`

**Scope:** recheck of `GC-AI-0002-20260919T223349Z.md`; range `4e42079..ce6645a` + uncommitted tree (5 modified, 9 untracked day-2 evidence files). Checks reproduced by Codex: gate PASS, ruff, 600 passed, diff --check.

**Verdict: APPROVE** (increment). Does not close the work item: AC-08 1/3, owner closure separate.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| C1-B2 | BLOCKER (carried) | bounded `no_trading_recommendation` patterns | **Owner decision D-6**, no fix required. |
| C1-M2 | MAJOR (carried) | full loop not evidenced | **RESOLVED** by the 2026-09-21 real run (acceptance 21:42:50Z, outcome 22:15:20Z, review 22:44:32Z, final query). |
| C1-M3 | MAJOR (carried) | 2026-09-17 comparisons from memory | **Owner decision F-7**, kept flagged, excluded from AC-08. |
| C2-m1 | MINOR (carried) | PHASE4-ALIGNMENT readiness overstatement | **RESOLVED**. |
| C3-m1 | MINOR (new) | PHASE4-ALIGNMENT / SESSION_HANDOFF status lines still listed evidence and decisions as pending | **Fixed** (both status lines rewritten: evidence done, AC-08 1/3 and owner closure pending, F-9 open). |
| C3-m2 | MINOR (new) | day-2 README times were command-issue times, not the artifact timestamps | **Fixed** (table transcribes `accepted_at`/`queried_at`/`observed_at`/`reviewed_at`). |

AC-09 was PARTIAL for those two minors; with them fixed the documentation matches the matrix. Next: days 2 and 3 of the AC-08 series (2026-09-22, 2026-09-23 after the close, steps 3–5 of the runbook), then the reviewer evaluates AC-08 and the owner decides closure.

## Product-owner decisions (2026-09-19, after Codex recheck 1)

| # | Question | Recommendation | Decision |
|---|---|---|---|
| D-6 | Codex B2: keep the bounded-pattern `no_trading_recommendation` (your GC-AI-0001 decision, now with two more patterns) or require a structural change (implications restricted to controlled categories/templates)? | **Keep the bounded contract for GC-AI-0002**; a structural redesign is a Phase 4 backlog item, not a fix. | **Keep** (owner, 2026-09-19). C1-B2 closed as owner decision. |
| F-2 | Staleness policy outside the cash session (records at pre-market with the 24 h cap, or only during/after the session?) | **Only produce daily records after the cash session** (e.g. 16:30–20:00 ET) with `MAX_STALENESS_SECONDS=36000`; document it in the guide. | **Post-session only** (owner, 2026-09-19). Guide §1/§7 and `CLAUDE.md` updated; the 86400 cap is not to be used for the daily series. |
| F-7 | Disposition of `SPY/2026-09-17.md` | **Keep as flagged history; series for AC-08 starts on the next trading day.** | **Keep** (owner, 2026-09-19); not counted toward AC-08. |
| F-6 | A real `record review` on a real record | Needs you: run it on the first compliant record. | **Agreed** (owner, 2026-09-19): the owner will run `record review` on the first compliant record. |
