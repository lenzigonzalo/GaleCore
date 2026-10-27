# GC-AI-0004 — adapter evidence (2026-09-21)

Sanitized HTTP exchanges of `galecore_ai.adapters.regime_viewer` captured in-process against a
**synthetic** records directory written by `tools/viewer_test_records.py` (symbol `TEST`; never the
real `GaleCore/research/regime`). Regenerate with `python -B tools/capture_viewer_evidence.py`.
Tokens and paths are replaced by `<token>` / `<wrong-token>` / `<tmp>` / `<worktree>`.
Nothing here is evidence for any GC-AI-0002 criterion.

| File | Shows |
|---|---|
| `meta.json` | `today`, `timezone`, `reviews_enabled`, CORS header echoed for the allowed origin |
| `today-QQQ-no-record.json` | `NO_RECORD` for a symbol with no records (asserted by the tool) |
| `today-TEST.json` | today's status for the synthetic set — depends on the run date because the synthetic days are relative to today (may be `NO_RECORD`, `OK` or `INTEGRITY_FAILED`) |
| `preflight-allowed-origin-204.json` / `preflight-other-origin-405.json` | preflight only for the allowed origin |
| `review-wrong-token-401.json`, `review-other-origin-403.json`, `review-bad-verdict-400.json`, `review-unknown-run-404.json`, `review-tampered-day-422.json` | refusals; no file is written |
| `records-before-review.json`, `review-ok-201.json` | the review appended through `record_review`; response = the day re-read through `query` (`review_pending: false`, same `entry_hash`, reviews 0 → 1). A 201 with `record: null` and `reread_error` means the review IS saved but the re-read failed: do not retry |
| `records-after-review.json` | history after the write (422 because the synthetic tampered day is still INTEGRITY_FAILED, as designed) |
| `cli-query-reads-review-back.json` | `cli query` reads the same review back (exit 0) |
| `real-dir-readonly-check.json` | read of the **real** directory with this code: sha256 of every record before/after (identical), `cli query` summary (2 records OK, no integrity failures), `/api/today` status. Captured by hand on 2026-09-22; no file written |

Browser run (monitor `GC-0001`, Chromium/Playwright, fake local session, API .NET down): tab
Inteligencia → Régimen shows today/history/detail; wrong token → 401 shown, right token → 201,
review re-read on screen; real directory read-only (`--no-reviews`) shows 2026-09-21 (outcome +
review by the owner) and 2026-09-17 with the F-7 annotation. Real files byte-identical before and
after (`57a48542…`, `20b9c3b7…`). Screenshots not committed.
