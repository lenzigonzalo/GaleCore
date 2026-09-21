# Local regime record viewer (read-only)

Work item `GC-AI-0003`. A browser page to consult the evaluable regime records written by
`accept --record` (GC-AI-0002) without opening YAML or running `query` by hand. It shows what the
host interpreted, from which facts and timestamps, what happened afterwards (`record outcome`),
what the owner said (`record review`) and what is still pending.

## Run

```bash
export PYTHONPATH=src                       # only inside a worktree (the editable install points to the main checkout)
export GALECORE_RECORDS_DIR=<...>/GaleCore/research/regime   # same variable `query` uses; omit next to a sibling GaleCore checkout
python -B -m galecore_ai.adapters.regime_viewer --port 8765
# open http://127.0.0.1:8765/
```

No GaleCore API, no API key, no model: the viewer only reads the records directory, which must
already exist (a wrong `GALECORE_RECORDS_DIR` is refused at start and never created). It binds
`127.0.0.1`, requires a loopback `Host` header and answers `GET` only (`/`, `/api/meta`,
`/api/records?symbol=&since=&until=`). Records are read on every request; the page itself is
loaded once at start.

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

No analysis execution, no writes (outcomes, reviews), no trading, no scheduler, no database, no
change to GaleCore. The viewer is not evidence for any acceptance criterion of GC-AI-0002.
