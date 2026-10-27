# GC-AI-0003 — viewer evidence (2026-09-21, regenerated after reviews R1 and C1)

Sanitized HTTP responses of `python -B -m galecore_ai.adapters.regime_viewer` captured from the
worktree `.worktrees/galecore-ai/GC-AI-0003` (base `ce6645a`, `PYTHONPATH=src`). Paths are
replaced by `<workspace>` / `<tmp>`. Nothing here is evidence for any GC-AI-0002 criterion.

| File | Server | What it shows |
|---|---|---|
| `real-meta.json` | real dir `GaleCore/research/regime` | `symbols: ["SPY"]`, `read_only: true`, annotations file |
| `real-records-SPY-since-2026-09-01.json` | real dir | 200; the one real record (2026-09-17) with `states` both pending, `claims`/`evidence` resolved, and the F-7 `annotation` bound to its `entry_hash` |
| `real-records-QQQ-empty.json` | real dir | 200, `count: 0` — explicit empty state |
| `real-bad-symbol-400.json` | real dir | 400 from the store's own symbol validation |
| `synthetic-records-TEST-422.json` | `tools/viewer_test_records.py` output (symbol `TEST`) | 422; `2026-09-18` with outcome + review + `comparisons`, `2026-09-19` pending, `2026-09-20` `INTEGRITY_FAILED` with problems and no content |

Real record file `SPY/2026-09-17.md`: sha256 `57a485420fe41bf0ac7756f53923dcb745a1bb216eada30e1b0664888b0d5f53`
before and after serving (identical). Browser rendering was inspected with Playwright/Chromium
(no console errors, no horizontal scroll at 1400 px and 900 px); screenshots were not committed.
