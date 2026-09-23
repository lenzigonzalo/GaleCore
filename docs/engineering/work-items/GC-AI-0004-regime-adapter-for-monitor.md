---
id: GC-AI-0004
title: Regime record adapter for the GaleCore monitor (today, CORS, protected review write)
status: READY_FOR_REVIEW
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: true
review_result: APPROVED
approval_result: PENDING
---

# GC-AI-0004 — Regime record adapter for the GaleCore monitor

Authorized by the owner on 2026-09-21 (retake after `roadmap/REALINEACION-2026-09-21.md`): integrate
regime consultation and human review into the existing monitor while GC-AI-0002 completes its
series. This is the GaleCore-AI half; the monitor half is `GaleCore` item **GC-0001**
(`GaleCore/docs/engineering/work-items/GC-0001-monitor-inteligencia-regimen.md`). Branch
`feature/GC-AI-0004`, worktree `.worktrees/galecore-ai/GC-AI-0004`, based on the GC-AI-0003
checkpoint `7ad598b` (itself on the GC-AI-0002 checkpoint `ce6645a`). GC-AI-0002 keeps
`ACTIVE_WORK_ITEM`, its tree and its series untouched; integration with its final version is
verified before closing, not before starting (owner instruction).

## Objective

The monitor's "Inteligencia → Régimen" tab can read today's state, the history, the detail and
the outcome comparison through this adapter, and can append the owner's review to a selected
`run_id` through `record_review`, with the same guarantees as the CLI and without exposing the
write to any other page or process.

## Non-goals

- No analysis generation, no outcome capture, no macro, no SHADOW, no strategy work.
- No change to the `query` output contract, to the record format, to GaleCore's .NET API.
- The standalone page (`regime_viewer_static/index.html`) is preserved as is, not extended.
- Reviews of real records are entered by the owner, never by the implementer.
- No VALIDATED/CLOSED by the implementer. Commits are local; no push, no PR.

## Scope

`src/galecore_ai/adapters/regime_viewer.py` only (plus tests and docs):

- `ViewerConfig` (timezone, allowed origins, review token) and `convention_timezone()` from the
  same convention asset `accept --record` uses.
- `GET /api/meta` gains `today`, `timezone`, `reviews_enabled`.
- `GET /api/today?symbol=` → today's trading date and its record (`NO_RECORD` | `OK` |
  `INTEGRITY_FAILED` | `READ_INCONSISTENT`), reusing `build_view`.
- CORS restricted to `REGIME_VIEWER_ALLOWED_ORIGINS` (default: the monitor dev origin
  `http://localhost:3039`), never `*`; preflight only for an allowed origin.
- `POST /api/reviews` `{symbol, date, run_id, verdict, comment}` → `record_review`, then the day
  re-read through `query`. Protected by loopback `Host` **and** allowed `Origin` **and**
  `X-Review-Token` (`REGIME_REVIEW_TOKEN` or generated per run and printed), JSON only, body ≤ 16 KiB,
  strict schema. `--no-reviews` disables it.

## Acceptance criteria

- [ ] **AC-01 — Today:** `/api/today` reports the date in the convention timezone and the record's
  states (`outcome_pending`, `review_pending`) or `NO_RECORD`; nothing is inferred beyond the record.
- [ ] **AC-02 — Review through `record_review`:** a valid POST appends exactly one `HumanReview` to
  the selected `run_id`, leaves `entry_hash` unchanged, and the response is the day re-read through
  `query`; the CLI path reads the same review back.
- [ ] **AC-03 — Write protection:** the write is refused (and nothing is written) without the token
  (401), from a non-allowed or missing `Origin` (403), with a non-loopback `Host` (403), with a
  non-JSON body (415), oversized/empty body (413), invalid schema/verdict/comment/date (400),
  unknown run_id/day (404), or on a record `query` rejects (422). Reviews disabled → 403.
- [ ] **AC-04 — CORS:** only allowed origins receive `Access-Control-Allow-Origin` (echoed, with
  `Vary: Origin`) and a 204 preflight; other origins get neither.
- [ ] **AC-05 — Reads unchanged:** every GC-AI-0003 behaviour and test still holds (same `query`
  path, integrity, consistency between reads, annotation F-7, standalone page).
- [ ] **AC-06 — Repository validation:** gate, pytest, Ruff, `git diff --check`, wheel PASS in the
  worktree (`PYTHONPATH=src`).
- [ ] **AC-07 — Independent review:** internal `reviewer` then `/review-codex` on the diff.
- [ ] **AC-08 — Integration with GC-AI-0002 final:** before closing, the adapter is verified against
  the final `feature/gc-ai-0002` tree (rebase or merge, tests green). Not required to start.

## Requirement-to-evidence matrix

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 | `build_today` (date via `record_date_for` with the convention timezone from `convention_timezone()`), `GET /api/today`; `build_meta` adds `today`/`timezone`/`reviews_enabled` | `TestTodayAndMeta` (4 tests) | `docs/evidence/gc-ai-0004-adapter/today-QQQ-no-record.json` (asserted `NO_RECORD`), `today-TEST.json`, `meta.json` | IMPLEMENTED (AC-07 APPROVED) |
| AC-02 | `submit_review` → `record_review` → `build_view` of the day (a re-read failure after the save is still 201 with `record: null` + `reread_error`, never an error status that invites a retry); `ReviewRequest` (extra=forbid, `ReviewVerdict`) | `TestReviewEndpoint::test_review_is_appended_through_record_review_and_reread` (entry_hash unchanged, CLI path reads it back), `test_reread_failure_after_save_is_still_201_and_not_retried_into_a_duplicate` | `records-before-review.json` + `review-ok-201.json` (same `entry_hash`, reviews 0 → 1), `cli-query-reads-review-back.json` | IMPLEMENTED (AC-07 APPROVED) |
| AC-03 | `do_POST`: loopback Host, `reviews_enabled`, allowed Origin, `hmac.compare_digest` token, JSON media type, size ≤ 16 KiB, `Handler.timeout`, schema; `submit_review` validates date/symbol with the store's rules before any file; `_review_status` maps by exception cause → 400/401/403/404/408/413/415/422/503; `_WRITE_LOCK` serializes writes | `test_review_requires_token_origin_and_loopback_host`, `test_review_rejects_bad_requests_without_writing`, `test_review_on_tampered_record_is_refused`, `test_oversized_or_empty_body_is_refused`, `test_invalid_symbol_or_date_is_400_before_any_file_is_touched`, `test_concurrent_reviews_on_the_same_day_all_land`, `test_write_failure_is_503_not_422`, `test_under_sent_body_is_408_and_nothing_is_written`, `test_no_reviews_flag_disables_the_write`, `TestHttpAdapter::test_unknown_paths_and_writes_are_rejected` | `review-wrong-token-401.json` (`<wrong-token>`), `review-other-origin-403.json`, `review-bad-verdict-400.json`, `review-bad-date-400.json`, `review-unknown-run-404.json`, `review-tampered-day-422.json` — all regenerable with `tools/capture_viewer_evidence.py` | IMPLEMENTED (AC-07 APPROVED) |
| AC-04 | `_cors_headers` (echo + `Vary: Origin`), `do_OPTIONS` preflight only for an allowed origin, `allowed_origins_from_env` | `TestCors` (3 tests) | `preflight-allowed-origin-204.json`, `preflight-other-origin-405.json`, `meta.json` (CORS header) | IMPLEMENTED (AC-07 APPROVED) |
| AC-05 | Read paths untouched; `make_handler` defaults to `ViewerConfig(timezone="UTC")` without reviews | all 30 GC-AI-0003 tests still pass; 19 new → 49 in `test_regime_viewer.py`; standalone page served | full suite 647 passed | IMPLEMENTED (AC-07 APPROVED) |
| AC-06 | — | gate PASS; ruff clean; `git diff --check` clean; pytest 647 passed, 1 skipped (pre-existing); wheel PASS | commands below | IMPLEMENTED |
| AC-07 | — | — | internal review R1: CHANGES_REQUESTED → fixed; Codex C1 (`reviews/GC-AI-0004-20260922T001230Z.md`): CHANGES_REQUESTED → fixed; Codex recheck C2 (`reviews/GC-AI-0004-20260923T000602Z.md`): **APPROVE**, both findings RESOLVED, no new findings | IMPLEMENTED (APPROVE is an input; closure = owner) |
| AC-08 | — | Read of the real directory with this code: `cli query --symbol SPY --since 2026-09-01` → 2 records OK (2026-09-17, 2026-09-21 with 1 outcome + review `agree` written by the owner), `integrity_failed: []`; `record_store.py`/`regime_record.py` unchanged in the GC-AI-0002 tree | `real-dir-readonly-check.json` (full sha256 before/after, identical; query summary; `/api/today`), monitor browser run on the real dir (`--no-reviews`) | VERIFIED READ-ONLY against the current GC-AI-0002 tree; formal rebase/merge before closing PENDING |

## Required validation

```powershell
$env:PYTHONPATH = "src"
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
python tools/verify_wheel_assets.py
```

## Implementer handoff — Increment 1 (2026-09-21, worktree `.worktrees/galecore-ai/GC-AI-0004`, base `7ad598b`)

**State:** READY_FOR_REVIEW (AC-01..AC-06 implemented and verified locally; AC-07 pending; AC-08 verified read-only, formal integration pending).

### Decisions (routine, within scope)

- Three independent checks on the write instead of relying on loopback + CORS: a wrong or missing
  `X-Review-Token` is 401 even from the allowed origin; a foreign `Origin` is 403 even with the
  token; a non-loopback `Host` is 403. The token is per run (printed once, `flush=True`) or from
  `REGIME_REVIEW_TOKEN`; it is never written to disk by the adapter.
- CORS is an explicit allow-list echoing the origin (never `*`), default the monitor dev origin.
- `today` comes from the same convention asset the record date uses (`load_required_assets`),
  never from the browser clock.
- The review response is the day re-read through `query` so the UI shows what is on disk.
- `make_handler` without a config keeps the GC-AI-0003 behaviour (reads only, no CORS, POST → 403).

### Files changed

- `src/galecore_ai/adapters/regime_viewer.py` (+~330 lines: config, today, review, CORS, POST).
- `tests/unit/test_regime_viewer.py` (+18 tests → 48).
- `tools/capture_viewer_evidence.py` (new): regenerates the evidence set from synthetic records.
- `docs/LOCAL-REGIME-VIEWER.md`, `CLAUDE.md` (one line reworded, still 100 lines).
- `docs/evidence/gc-ai-0004-adapter/` (README + 12 sanitized exchanges), this work item.
- Not changed: `query` output, record format, `cli.py`, `record_regime.py`, the standalone page,
  `ACTIVE_WORK_ITEM`, GaleCore.

### Commands and exact results (2026-09-22 ~01:10 UTC, after reviews R1 and C1, `PYTHONPATH=src`)

```
python tools/engineering_gate.py            → Engineering gate: GC-AI-0002 / IN_PROGRESS / PASS (gate evaluates the active item, GC-AI-0002, by owner instruction)
python -m ruff check --no-cache .           → All checks passed!
git diff --check                            → clean
python -B -m pytest -q -p no:cacheprovider  → 647 passed, 1 skipped, 1 warning
python tools/verify_wheel_assets.py         → RESULT: PASS
sha256 GaleCore/research/regime/SPY/*.md before/after serving the real dir → 57a48542…, 20b9c3b7… (identical)
```

Browser run: see `GaleCore` item GC-0001 (monitor tab against this adapter on port 8767, synthetic
records for the write, real records read-only).

### Known gaps and risks

- The token travels in a browser header on loopback; it protects against other pages/processes,
  not against someone with access to the same terminal that printed it. Adequate for a local
  single-operator tool; documented, not hidden.
- `/api/today` performs a full `build_view` for one day; fine for one file per day.
- The pre-existing `test_record_regime.py:317` skip (no sibling checkout from a worktree) remains.
- AC-08: the adapter reads the current GC-AI-0002 tree's real records without integrity failures,
  but the formal rebase/merge onto the final `feature/gc-ai-0002` (and rerun of the suite) is
  still due before closing — as the owner instructed, it did not block starting.

## Internal review R1 (Claude `reviewer` subagent, Opus, 2026-09-22 ~00:05 UTC) — CHANGES_REQUESTED → fixed

Verified by the reviewer: token + origin + host each refuse independently (Host/Origin/token
variants probed, all fail closed), nothing written on refusal, `query` contract and record format
unchanged, no GaleCore API, real files untouched; checks reproduced (gate PASS, ruff, 641 passed,
diff-check, wheel PASS).

| # | Sev | Finding | Resolution |
|---|---|---|---|
| R1-M1 | MAJOR | Writes not serialized under `ThreadingHTTPServer`: concurrent POSTs on one day lost a review (201 not on disk) or failed with 422 on file contention | `_WRITE_LOCK` around `record_review` + re-read; write failures map to 503; `test_concurrent_reviews_on_the_same_day_all_land` (6 threads, 6×201, 6 reviews on disk), `test_write_failure_is_503_not_422` |
| R1-m1 | MINOR | `20260919`/week dates and bad symbols reached the store and came back 422 "cannot be trusted" | `_DATE_RE` + `store.path_for` before any file; 400; `test_invalid_symbol_or_date_is_400_before_any_file_is_touched`; artifact `review-bad-date-400.json` |
| R1-m2 | MINOR | HTTP status chosen by exception text | `_review_status` by `__cause__` (integrity 422, OSError 503, store 400, else 404) |
| R1-m3 | MINOR | `rfile.read` could hang a thread; success response wrapped in the error handler | `Handler.timeout = 10`, short body → 400, timeout → 408, response written outside the `try`; `test_under_sent_body_is_408_and_nothing_is_written` |
| R1-m4 | MINOR | Unknown convention timezone would surface as a traceback | validated with `ZoneInfo` in `convention_timezone()` (exit 1 at start) |
| R1-m5 | MINOR | `REGIME_REVIEW_TOKEN=""` printed `<from environment>` | empty counts as unset (`test_empty_env_token_counts_as_unset`) |
| R1-m6 | MINOR | Content-Type check by prefix | media type parsed and lower-cased |
| R1-m7 | MINOR | `test_main_disables_reviews_on_flag` did not test the flag | replaced by `test_no_reviews_flag_disables_the_write` (real `main` → config without token → 403) |
| R1-m8 | MINOR | Evidence: wrong token sanitized like the right one; no before-state; not regenerable | `tools/capture_viewer_evidence.py`; `<wrong-token>`; `records-before-review.json` |
| R1-n1 | NOTE | stale "GET only" sentence, `--allow-origin` undocumented, "trading date" wording, `/api/today` always 200 | guide and docstring updated |

## Independent review 1 (Codex, `--commit 0b9b089`, effort high, 2026-09-22T00:12Z) — `docs/engineering/reviews/GC-AI-0004-20260922T001230Z.md`

**Verdict:** CHANGES_REQUESTED. Codex reproduced gate PASS, ruff, 646 passed, diff-check; regenerated the
evidence in a temp dir (statuses matched, hashes recomputed); wheel not buildable in its sandbox (no
network for `hatchling`) — built by the implementer, PASS.

| # | Sev | Finding | Resolution |
|---|---|---|---|
| C1-M1 | MAJOR | A failure while re-reading the day after a successful save returned 500 → a client retry appended the review twice | **Fixed.** The re-read is outside the write's error path: 201 with `record: null` and `reread_error`; the monitor tells the operator not to resend. `test_reread_failure_after_save_is_still_201_and_not_retried_into_a_duplicate` (exactly one review on disk) |
| C1-m1 | MINOR | `today-TEST-no-record.json` actually held `INTEGRITY_FAILED` (synthetic days are relative to the run date) | **Fixed.** `today-QQQ-no-record.json` (symbol without records, asserted `NO_RECORD` by the tool) + `today-TEST.json` named honestly; README corrected |

## Independent review 2 (Codex, `--recheck`, effort medium, 2026-09-23T00:06Z) — `docs/engineering/reviews/GC-AI-0004-20260923T000602Z.md`

**Scope:** `0b9b089..b7f76b9` (20 changed files) against review C1. **Verdict: APPROVE** — C1-M1 and
C1-m1 RESOLVED, no new findings. Codex reran the four required checks (gate PASS, ruff, 647 passed /
1 skipped, diff-check) and regenerated the 15 synthetic artifacts (capture and CLI exit 0).

Declared limitations: the wheel build, the monitor browser run, the historical real-directory capture
and the final GC-AI-0002 integration were not reproduced by Codex (wheel and browser run were done by
the implementer and are recorded above; AC-08 integration stays deferred by owner decision).

Run without a rebase onto the current `feature/gc-ai-0002` by owner decision relayed on 2026-09-22:
zero file overlap between the branches, so the reviewed content would not change; rebasing now would
be redone after the AC-08 series closes and would invalidate this review's declared SHA range.

### Product-owner decision

- PENDING. `status`, `closure_blocked` and `approval_result` unchanged; `review_result: APPROVED`
  only transcribes the reviewer's verdict. AC-08 (integration with the final GC-AI-0002 tree) stays
  open, to be done once after that series closes.

## Rebase onto the final `feature/gc-ai-0002` (2026-09-23)

Done once, after the GC-AI-0002 AC-08 series was completed and reviewed (owner's instruction of
2026-09-22: no rebase before that). `feature/GC-AI-0003` was rebased onto `feature/gc-ai-0002`
(`02a3df3`), then `feature/GC-AI-0004` onto it with `--onto`. No conflicts: GC-AI-0002 and this item
touch disjoint files. Pre-rebase refs kept as `backup/GC-AI-0003-pre-rebase` and
`backup/GC-AI-0004-pre-rebase`.

| Commit | Before | After |
|---|---|---|
| GC-AI-0003 checkpoint | `7ad598b` | `7adb741` |
| GC-AI-0004 feat | `0b9b089` | `35b5c08` |
| GC-AI-0004 review fixes | `b7f76b9` | `3ad84c3` |
| GC-AI-0004 recheck recorded | `297da6f` | `48c8f02` |

The Codex reviews above cite the pre-rebase SHAs; their content is unchanged by the rebase (same
patches, new parents). Verified after the rebase in this worktree: `ruff` clean, `pytest` 648 passed /
1 skipped (with `PYTHONPATH=src`), and `query --since 2026-09-14` against the real records dir reads
the four records of the GC-AI-0002 series (09-23 with two outcomes and the owner's review),
`integrity_failed: []`. Pre-existing and unchanged: `git diff --check` flags a blank line at EOF of
the GC-AI-0003 work item (already in `7ad598b`).
