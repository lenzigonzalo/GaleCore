# Local regime record viewer and review adapter

Work items `GC-AI-0003` (viewer) and `GC-AI-0004` (adapter for the GaleCore monitor). A browser page to consult the evaluable regime records written by
`accept --record` (GC-AI-0002) without opening YAML or running `query` by hand. It shows what the
host interpreted, from which facts and timestamps, what happened afterwards (`record outcome`),
what the owner said (`record review`) and what is still pending.

## Run

```bash
export PYTHONPATH=src                       # only inside a worktree (the editable install points to the main checkout)
export GALECORE_RECORDS_DIR=<...>/GaleCore/research/regime   # same variable `query` uses; omit next to a sibling GaleCore checkout
python -B -m galecore_ai.adapters.regime_viewer --port 8765
# open http://127.0.0.1:8765/  — or the monitor's tab Inteligencia → Régimen (GaleCore GC-0001)
```

At start it prints the review token (`X-Review-Token`) generated for this run — paste it once in
the monitor's review form — unless `REGIME_REVIEW_TOKEN` is set. `--no-reviews` serves reads only.
`REGIME_VIEWER_ALLOWED_ORIGINS` (default `http://localhost:3039,http://127.0.0.1:3039`, the monitor's
dev server) is the only origin the browser API is opened to.

No GaleCore API, no API key, no model: the viewer only reads the records directory, which must
already exist (a wrong `GALECORE_RECORDS_DIR` is refused at start and never created). It binds
`127.0.0.1` and requires a loopback `Host` header on every request; `GET` for reads, one `POST`
for the review (below). Records are read on every request; the page itself is loaded once at
start. `--allow-origin <origin>` (repeatable) overrides the env allow-list for one run.

## Endpoints

| | |
|---|---|
| `GET /` | the standalone page |
| `GET /api/meta` | records dir, symbols, `today` (convention timezone), `reviews_enabled` |
| `GET /api/today?symbol=` | today's record or `NO_RECORD` (calendar date in the convention timezone; weekends are `NO_RECORD`). Always HTTP 200: the day's status is in the body |
| `GET /api/records?symbol=&since=&until=` | history (200 / 409 read inconsistent / 422 integrity failed, body always complete) |
| `POST /api/reviews` | `{symbol, date, run_id, verdict, comment}` → `record_review`; 201 with the day re-read |

The write is refused unless all three hold: loopback `Host`, allowed `Origin`, correct
`X-Review-Token` (constant-time compare). JSON only, ≤ 16 KiB, strict schema, symbol/date checked
by the store's own rules before any file is touched (400); unknown run_id/day 404; a day `query`
rejects 422; a failed disk write 503. Writes are serialized in the process (one at a time) so two
reviews on the same day cannot lose each other. Nothing is written on a refusal. Evidence of all of
this is regenerated with `python -B tools/capture_viewer_evidence.py` (synthetic records only).

## What it guarantees and what it does not

- The list of days and every `OK` / `INTEGRITY_FAILED` verdict come from `query_records`, the
  function behind `cli query`. Entry detail comes from `FileRecordStore.load`, the same
  verification `query` runs. There is no second parser. A rejected file shows its problems and
  nothing else; the HTTP status is 422 (the CLI exits 3). The detail read is compared field by
  field with what `query` returned; a file that changes in between is retried, and a day that
  stays inconsistent is `READ_INCONSISTENT` (409, no content shown) instead of a mix of versions.
- `outcome pending` / `review pending` mean exactly "no outcome / no review appended to this
  entry". Nothing is inferred or computed beyond the side-by-side difference between the facts
  at acceptance and the facts of each outcome (`compare_facts`, both GaleCore-verified).
- Timestamps are shown as stored (UTC). The header names the directory read and the time of the
  query; every value is a historical record, never current data.
- Reading never modifies a file (tests check byte identity).
- Owner annotations (`config/viewer/record-annotations.yaml`) are bound to `symbol + date +
  entry_hash` and cite their source. They are shown in a separate card, never as part of the
  record, and disappear if the hash no longer matches. Today the file carries one: the
  2026-09-17 SPY record kept as observed history that does not count toward AC-08 (owner
  decision F-7, 2026-09-19).

## Inspecting states with synthetic data

```bash
python -B tools/viewer_test_records.py <empty-dir>
GALECORE_RECORDS_DIR=<empty-dir> python -B -m galecore_ai.adapters.regime_viewer --port 8766
```

Writes three days under symbol `TEST` (prompt "SYNTHETIC TEST RECORD …", host `test-fixture`):
one with outcome + review, one with both pending, one tampered so `query` reports
`INTEGRITY_FAILED`. The tool refuses a non-empty directory and never touches the real records.
Query a symbol without records (e.g. `QQQ`) for the empty state.

## Not in scope

No analysis execution, no outcome capture, no trading, no scheduler, no database, no change to the
.NET API. The only write is the human review. Neither the viewer nor the adapter is evidence for
any acceptance criterion of GC-AI-0002.
