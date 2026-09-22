# GC-AI-0004 — adapter evidence (2026-09-21)

Sanitized HTTP exchanges of `galecore_ai.adapters.regime_viewer` captured in-process against a
**synthetic** records directory written by `tools/viewer_test_records.py` (symbol `TEST`; never the
real `GaleCore/research/regime`). Token and temp paths are replaced by `<token>` / `<tmp>`.
Nothing here is evidence for any GC-AI-0002 criterion.

| File | Shows |
|---|---|
| `meta.json` | `today`, `timezone`, `reviews_enabled`, CORS header echoed for the allowed origin |
| `today-TEST-no-record.json` | `NO_RECORD` for today's trading date |
| `preflight-allowed-origin-204.json` / `preflight-other-origin-405.json` | preflight only for the allowed origin |
| `review-wrong-token-401.json`, `review-other-origin-403.json`, `review-bad-verdict-400.json`, `review-unknown-run-404.json`, `review-tampered-day-422.json` | refusals; no file is written |
| `review-ok-201.json` | the review appended through `record_review`; response = the day re-read through `query` (`review_pending: false`, `entry_hash` unchanged) |
| `records-after-review.json` | history after the write (422 because the synthetic tampered day is still INTEGRITY_FAILED, as designed) |
| `cli-query-reads-review-back.json` | `cli query` reads the same review back (exit 0) |

Browser run (monitor `GC-0001`, Chromium/Playwright, fake local session, API .NET down): tab
Inteligencia → Régimen shows today/history/detail; wrong token → 401 shown, right token → 201,
review re-read on screen; real directory read-only (`--no-reviews`) shows 2026-09-21 (outcome +
review by the owner) and 2026-09-17 with the F-7 annotation. Real files byte-identical before and
after (`57a48542…`, `20b9c3b7…`). Screenshots not committed.
