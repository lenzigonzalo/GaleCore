# Manual host run — daily regime loop (GC-AI-0002, AC-06 / AC-08)

**Host:** Claude Code session (Opus 5), acting as the interactive host described in `CLAUDE.md`.
**GaleCore:** live, `http://localhost:5000`. **Records dir:** the real one,
`GaleCore/research/regime/` (default). **No runner involved:** every command below was issued by
the host one at a time; the only hand-written artifact is `step2-host-interpretation.json`.
All files here are sanitized copies of the exact stdout (absolute paths → `<repo>`/`<home>`;
no API key anywhere).

Environment: `ALLOW_UNKNOWN_FRESHNESS=true`, `GALECORE_TIMEOUT_SECONDS=300`,
`MAX_STALENESS_SECONDS` as noted per step.

| Step | UTC | Command | Exit | Result | File |
|---|---|---|---|---|---|
| 1 (attempt 1, 2026-09-17 01:06) | 01:06:17 | `prepare --symbol SPY --skill regime` (`MAX_STALENESS_SECONDS=36000`) | 0 | run_id `01a0ace6-…`, facts identical to the E2E view | not kept (superseded) |
| 3 (attempt 1) | 10:50:34 | `accept --record --prompt "Analizá el régimen de hoy de SPY y guardalo"` against that run_id | 3 | `VALIDATION_ERROR`, `snapshot_lookup` failed: the snapshot had **expired** (TTL 3600 s; the session paused ~10 h). `record: NOT_RECORDED`. Fail-closed as designed. | `step3-accept-attempt-1-expired-snapshot.json` |
| 1 (attempt 2) | 10:50:53 | `prepare --symbol SPY --skill regime` (`MAX_STALENESS_SECONDS=36000`) | 1 | `Data is stale for source(s) ['vvix'] (max 36000s)` — VVIX has no pre-market print; last print 2026-09-16 20:15 UTC | `step1-prepare-attempt-1-MAX_STALENESS_36000.json` |
| 1 (attempt 3) | 10:52:54 | `prepare --symbol SPY --skill regime` (`MAX_STALENESS_SECONDS=86400`, the hard cap) | 0 | run_id `01a0aeff-a70d-7a90-83b6-24175654b390`; gex VALID (10:52 UTC), vix VALID (pre-market print 10:52 UTC), vvix VALID under the 24 h window (previous close), put_skew UNKNOWN; snapshot freshness UNKNOWN | `step1-prepare.json` |
| 2 | — | Host reads the facts and writes `RegimeInterpretation` | — | negative_gamma / calm; spot a fraction below zero-gamma and on the put wall; limitations state the pre-market read and the widened window | `step2-host-interpretation.json` |
| 3 | 10:53:39 | `accept --record --prompt "Analizá el régimen de hoy de SPY y guardalo"` | 0 | `SUCCESS`; all 8 checks passed; `record: RECORDED` → `GaleCore/research/regime/SPY/2026-09-17.md`, entry_hash `sha256:7bdcba8a…` | `step3-accept-request.json`, `step3-accept-record.json` |
| 4 | 10:53:40 | `query --symbol SPY --since 2026-09-10` | 0 | 1 record (2026-09-17), `integrity_failed: []`, 1 entry, 0 outcomes, 0 human reviews | `step4-query.json` |
| 1 (attempt 4, 2026-09-19 Sat) | 22:18:43 | `prepare --symbol SPY --skill regime` (`MAX_STALENESS_SECONDS=86400`) | 1 | `Data is stale for source(s) ['vix', 'vvix'] (max 86400s)` — no prints since Friday; fail-closed even at the cap. No record can be produced on a weekend. | `step1-prepare-attempt-4-saturday-stale.json` |
| migration (2026-09-19) | 22:2x | one-off script re-rendered `SPY/2026-09-17.md` from its JSON block into the YAML-frontmatter format (Codex M1); `entry_hash` unchanged, then `query` | 0 | 1 record, `integrity_failed: []` | `step4-query-after-format-migration.json` |

## What this evidences and what it does not

- **Evidenced:** the host can run prepare → interpret → accept+record → query from the documented
  entry point; the record lands in the real research folder with the accepted payload, facts,
  hashes, assets and trace; the snapshot TTL and the staleness guard fail closed for real.
- **Not evidenced here:** `record outcome` (should be run later in the session on this entry) and
  `record review` (a human verdict — the product owner's, not the host's). AC-04's mechanics are
  covered by unit tests and by the E2E runner in a temporary records dir.
- **Operator choice disclosed:** attempt 3 used the 24 h staleness cap to admit the previous
  close of VVIX at 06:52 ET. The per-source timestamps are in the snapshot and in the record; the
  interpretation's limitations say so. Whether a pre-market record with a 24 h window is acceptable
  for the daily series is a product-owner decision (work item F-2).
- **Not compliant (Codex M3):** the accepted interpretation of 2026-09-17 compares with the
  previous session from memory; skill rule 10 forbidding that was added afterwards. The record is
  kept as flagged history (owner decision F-7); a compliant run is due on the next trading day.
- The earlier record `SPY/2026-09-16.md`, written by the first E2E run and contaminated with a
  runner-authored review, was deleted before this run (internal review BLOCKER). Whether the
  2026-09-17 file counts as day 1 of the AC-08 series is the owner's call (F-7).
