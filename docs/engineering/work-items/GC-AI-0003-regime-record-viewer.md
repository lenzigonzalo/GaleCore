---
id: GC-AI-0003
title: Local read-only viewer for evaluable regime records
status: READY_FOR_REVIEW
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: true
review_result: APPROVED
approval_result: PENDING
---

# GC-AI-0003 — Local read-only viewer for evaluable regime records

Separate increment authorized by the owner on 2026-09-21 while the GC-AI-0002 daily series is
being completed. Branch `feature/GC-AI-0003`, worktree `.worktrees/galecore-ai/GC-AI-0003`, based
on the GC-AI-0002 checkpoint `ce6645af95a26bafb08b338e9604fb1b8c9db647` (`feature/gc-ai-0002`,
not `main`). GC-AI-0002 keeps `ACTIVE_WORK_ITEM`, its tree and its series untouched.

## Objective

The owner can consult the real regime records in a browser and understand what the host
interpreted, from which data, what happened afterwards and what still needs review — without
opening YAML or running commands by hand — through the same `query` path and integrity checks the
CLI uses.

## Non-goals

- No analysis execution, no writing of outcomes or reviews, no trading, no new providers, no
  scheduler, no database.
- No change to GaleCore code. No change to the `query` output contract of GC-AI-0002.
- No alternative parser of the record files: the viewer never reads frontmatter itself.
- No fabricated records, outcomes, reviews or metrics. Test data is synthetic, isolated in a
  directory chosen by the operator, and identified by symbol `TEST` and an explicit prompt.
- No evidence for the closure of GC-AI-0002 is produced or claimed by this item.
- No commit, push, tag or PR of the viewer work in this task (owner instruction); the only commit
  authorized was the GC-AI-0002 checkpoint.

## Scope

- `src/galecore_ai/adapters/record_store.py`: additive `FileRecordStore.symbols()` (which symbol
  folders exist), reused by the viewer to offer the filter.
- `src/galecore_ai/adapters/regime_viewer.py`: view model (`build_view`), loopback HTTP adapter
  (GET only), `__main__` entry point.
- `src/galecore_ai/adapters/regime_viewer_static/index.html`: single static page, no CDN, no
  framework.
- `config/viewer/record-annotations.yaml`: owner annotations bound to `entry_hash` with their
  source (today: the 2026-09-17 record, decision F-7).
- `tools/viewer_test_records.py`: writes clearly identified synthetic records (symbol `TEST`) to an
  operator-chosen directory for manual inspection of empty / pending / integrity-failed states.
- `tests/unit/test_regime_viewer.py`, `docs/LOCAL-REGIME-VIEWER.md`, one line in `CLAUDE.md`.

## Acceptance criteria

- [ ] **AC-01 — Same read path as `query`:** the list of records and every OK/INTEGRITY_FAILED
  verdict come from `query_records`; entry detail comes from `FileRecordStore.load` (same
  verification) and must agree field by field with what `query` returned, else the query is
  retried and a day that stays inconsistent is `READ_INCONSISTENT` (no content, HTTP 409). A
  tampered file appears as INTEGRITY_FAILED with its problems and none of its content; the HTTP
  response carries the same non-success signal the CLI gives (exit 3 ↔ HTTP 422).
- [ ] **AC-02 — Filter by date and symbol:** `GET /api/records?symbol=&since=&until=` mirrors the
  CLI flags; invalid parameters return 400 JSON and never a 500.
- [ ] **AC-03 — Detail:** facts with their per-source freshness timestamps, snapshot identity
  (`prepared_at`, `market_data_as_of`, `freshness_status`, hashes), effective assets (skill
  version), accepted interpretation (regime, tail pricing, observations, implications, claims,
  evidence, limitations), guardrail trace, host declaration.
- [ ] **AC-04 — Outcome and human review:** shown when present, with a side-by-side comparison of
  facts at acceptance vs facts observed later; explicit states `outcome pending` and
  `review pending` derived from the record (no outcome / no review), never inferred.
- [ ] **AC-05 — Empty and error states:** no records in range, records dir unavailable, integrity
  failed, all shown explicitly; the page always names the directory read and the query time.
- [ ] **AC-06 — Observed-history annotation:** the 2026-09-17 SPY record shows the owner's F-7
  condition ("kept as observed history; does not count toward AC-08") bound to its `entry_hash`
  and citing the work-item source, visually separated from the validated content, not as an
  integrity failure nor as a pending decision. If the hash no longer matches, the annotation is
  not shown.
- [ ] **AC-07 — Read-only, loopback, no secrets:** server binds `127.0.0.1` only; every non-GET method → 405;
  no GaleCore API call, no API key read; static page has no external resources.
- [ ] **AC-08 — Real records untouched:** reading the real directory leaves every file
  byte-identical (verified by hash before/after in the handoff).
- [ ] **AC-09 — Repository validation:** engineering gate, pytest, Ruff and `git diff --check`
  pass in the worktree (`PYTHONPATH=src`, since the editable install points to the main checkout).
- [ ] **AC-10 — Independent review:** internal `reviewer` then `/review-codex` inspect the diff.

## Requirement-to-evidence matrix

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 | `regime_viewer.build_view` calls `query_records` for the list/verdicts and `_enrich` → `FileRecordStore.load` for detail; `_same_as_query` compares every field `query` emitted, up to `READ_ATTEMPTS` retries, then `READ_INCONSISTENT` (HTTP 409); INTEGRITY_FAILED records keep only `date/path/problems`; HTTP 422 when `integrity_failed` is non-empty | `TestBuildView::test_tampered_record_is_integrity_failed_without_content`, `TestTwoReadConsistency` (3 tests: transient change retried, persistent change → READ_INCONSISTENT without content, entry missing), `TestHttpAdapter::test_integrity_failure_is_not_a_success_response`, `test_read_inconsistency_is_409_not_success`, `TestAnnotations::test_annotation_on_tampered_record_is_not_shown` | Synthetic `TEST/2026-09-20.md` tampered by `tools/viewer_test_records.py`, `docs/evidence/gc-ai-0003-viewer/synthetic-records-TEST-422.json` (2026-09-20) | IMPLEMENTED (pending AC-10) |
| AC-02 | `GET /api/records?symbol&since[&until]` → `_parse_date`, `build_view` (symbol validated by the store's own regex through `query_records`) | `test_filters_mirror_query`, `test_invalid_arguments_fail_closed`, `TestHttpAdapter::test_bad_arguments_are_400_not_500` | `real-records-QQQ-empty.json`, `real-bad-symbol-400.json` | IMPLEMENTED (pending AC-10) |
| AC-03 | Entry enriched with `recorded_at`, `snapshot`, `effective_assets`, `trace`, `entry_hash`, `request`; page cards "Cuándo y con qué datos", "Interpretación aceptada", "Facts y assurance" | `test_pending_states_come_from_the_record` (snapshot/assets/trace/hash fields present and equal to the record) | `real-records-SPY-since-2026-09-01.json` (snapshot, assets, trace, claims, evidence) | IMPLEMENTED (pending AC-10) |
| AC-04 | `states.outcome_pending/review_pending` = empty lists; `compare_facts` over `COMPARED_METRICS`; page cards "Qué pasó después" / "Review humano" | `test_outcome_and_review_are_shown_and_compared`, `test_compare_facts_handles_missing_and_non_numeric` | `synthetic-records-TEST-422.json` (2026-09-18: outcome + review + comparisons; 2026-09-19: pending); real SPY record: both pending | IMPLEMENTED (pending AC-10) |
| AC-05 | Page states: "Sin registros" (names symbol, range, dir), "Directorio de registros no disponible" (500 via `require_records_dir`; `main` refuses a missing dir and never creates it; the page handles a failed `/api/meta` explicitly), "INTEGRIDAD FALLIDA" / "LECTURA INCONSISTENTE" list notes; error JSON carries `at` (+ `records_dir` on 500) and the page keeps directory and time on every error | `test_no_records_is_an_explicit_empty_result`, `test_missing_records_dir_fails_closed_and_is_never_created`, `TestHttpAdapter::test_records_dir_removed_after_start_is_500_not_empty`, `test_error_responses_carry_time_and_directory`; page behaviour: `TestPageBehaviour` (3 tests, Playwright/Chromium, skipped where not installed) | `docs/evidence/gc-ai-0003-viewer/real-records-QQQ-empty.json`, `synthetic-records-TEST-422.json` | IMPLEMENTED (pending AC-10) |
| AC-06 | `config/viewer/record-annotations.yaml` (SPY 2026-09-17, `entry_hash sha256:7bdcba8a…3edb27`, source = GC-AI-0002 owner decisions 2026-09-19 F-7); `build_view` matches by `(symbol, date, entry_hash)`; page card "Anotación del owner (no forma parte del registro)" | `TestAnnotations` (4 tests: shown separately, wrong hash/day hidden, tampered hidden, shipped file valid) | `real-records-SPY-since-2026-09-01.json`: `annotation` present, `integrity_failed: []` | IMPLEMENTED (pending AC-10) |
| AC-07 | `serve` binds `LOOPBACK` = `127.0.0.1`; every `do_<METHOD>` other than GET resolves to `_reject` (405, incl. TRACE/CONNECT/unknown); `Host` header must be loopback (403 otherwise, DNS-rebinding guard); no dispatcher/API-key code path imported; page has no external URL | `test_binds_loopback_only`, `test_page_is_self_contained`, `test_unknown_paths_and_writes_are_rejected`, `test_foreign_host_header_is_refused` | `http`/`https` absent from `index.html` (asserted) | IMPLEMENTED (pending AC-10) |
| AC-08 | Viewer never opens files for writing (`FileRecordStore.load` only) and never creates the records directory (checked before the store is built) | `test_reading_leaves_files_byte_identical`, `test_missing_records_dir_fails_closed_and_is_never_created` | `sha256 SPY/2026-09-17.md` before/after serving the real dir: `57a48542…0d5f53` both times; `git -C GaleCore status research/` unchanged (`?? research/regime/`, untracked as before) | IMPLEMENTED (pending AC-10) |
| AC-09 | — | gate PASS; ruff clean; `git diff --check` clean; pytest 628 passed, 1 skipped (pre-existing `test_record_regime.py:317`: no sibling GaleCore checkout from a worktree); `tools/verify_wheel_assets.py` PASS (page + annotations packaged) | Command outputs below | IMPLEMENTED |
| AC-10 | — | — | Internal review R1: CHANGES_REQUESTED → fixed; Codex C1 (`reviews/GC-AI-0003-20260921T165841Z.md`): CHANGES_REQUESTED → fixed; Codex recheck C2 (`reviews/GC-AI-0003-20260921T171056Z.md`): **APPROVE**, all findings RESOLVED, no new findings | IMPLEMENTED (APPROVE is an input; closure = owner) |

## Required validation

```powershell
$env:PYTHONPATH = "src"
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```

## Implementer handoff — Increment 1 (2026-09-21, worktree `.worktrees/galecore-ai/GC-AI-0003`, base `ce6645a`, uncommitted)

**State:** READY_FOR_REVIEW (AC-01..AC-09 implemented and verified locally; AC-10 pending).

### Decisions taken (routine, within the authorized scope)

- Server: stdlib `http.server.ThreadingHTTPServer`, no new dependency, no FastAPI (the existing
  `api/` package is the frozen Phase-3 runtime and carries model/provider wiring the viewer must
  not touch).
- `query_records` output is **not** modified (it is GC-AI-0002's AC-05 contract). Detail fields
  the page needs but `query` does not emit (snapshot identity, assets, guardrail trace,
  `entry_hash`, `recorded_at`) are read with `FileRecordStore.load` — the same function and the
  same checks `query_records` just ran — never with a parser of its own.
- Everything compared or resolved is computed in the adapter (`compare_facts`, `check_claims`,
  `resolve_evidence`), not in the browser, so the page renders and never calculates.
- One additive method on the shared store, `FileRecordStore.symbols()`, to offer the symbol
  filter without re-implementing the symbol regex in the viewer.
- Annotations live in `config/viewer/` (packaged like the other assets; `asset_manifest` loads
  only its fixed paths, so hashes of the cognitive assets are unaffected — verified by the full
  test suite and `verify_wheel_assets.py`).
- Synthetic records use symbol `TEST`, prompt "SYNTHETIC TEST RECORD …", host `test-fixture`,
  and are written only to an operator-chosen empty directory.

### Files changed

- `src/galecore_ai/adapters/regime_viewer.py` (new, 291 lines): view model, annotations, loopback HTTP adapter, `__main__`.
- `src/galecore_ai/adapters/regime_viewer_static/index.html` (new, 301 lines): single page, no CDN, no framework.
- `src/galecore_ai/adapters/record_store.py`: `+symbols()` (6 lines).
- `config/viewer/record-annotations.yaml` (new): F-7 annotation bound to the real `entry_hash`.
- `tests/unit/test_regime_viewer.py` (new, 30 tests; 3 of them drive the page with Playwright when available).
- `docs/evidence/gc-ai-0003-viewer/` (new): sanitized HTTP responses, real and synthetic.
- `tools/viewer_test_records.py` (new): synthetic states for manual inspection.
- `docs/LOCAL-REGIME-VIEWER.md` (new), `CLAUDE.md` (+1 line, 100 lines), this work item.
- Not changed: `ACTIVE_WORK_ITEM` (still GC-AI-0002), GaleCore, `query` output, hooks.

### Criteria claimed complete

AC-01..AC-09 (see matrix). AC-10 pending.

### Commands and exact results (2026-09-21 ~17:40 UTC, after internal review R1 and Codex review C1, `PYTHONPATH=src`)

```
python tools/engineering_gate.py                 → Engineering gate: GC-AI-0002 / Status: IN_PROGRESS / WARNING: 11 acceptance criteria remain open / PASS
python -m ruff check --no-cache .                → All checks passed!
git diff --check                                 → clean
python -B -m pytest -q -p no:cacheprovider       → 628 passed, 1 skipped, 1 warning in 56.03s
python tools/verify_wheel_assets.py              → RESULT: PASS (regime_viewer.py, regime_viewer_static/index.html, _assets/viewer/record-annotations.yaml packaged)
sha256 GaleCore/research/regime/SPY/2026-09-17.md before/after serving → 57a485420fe41bf0ac7756f53923dcb745a1bb216eada30e1b0664888b0d5f53 (identical)
GET /api/records?symbol=SPY&since=2026-09-01 (real dir) → 200, count 1, integrity_failed [], states {outcome_pending: true, review_pending: true}, annotation "Observed history — does not count toward AC-08"
GET /api/records?symbol=TEST&since=2026-01-01 (synthetic dir) → 422, integrity_failed ["2026-09-20"], 2026-09-18 with outcome+review, 2026-09-19 pending
```

Browser inspection (Playwright, Chromium 1400×900 and 900×900, no console errors, no horizontal
scroll): real SPY 2026-09-17 record; synthetic TEST days (integrity failed, outcome + review with
Δ table, pending); empty state (`QQQ`); invalid symbol (400). Screenshots kept in the session
scratchpad only (not evidence of any GC-AI-0002 criterion; not committed).

### Known gaps and risks

- Two reads remain (query, then detail) because `query_records` does not return the document; a
  change in between is detected field by field and retried (C1-M1), never merged. Making `query`
  return the document would change GC-AI-0002's contract and is deliberately not done here.
- Fixed after R1: a missing `GALECORE_RECORDS_DIR` is refused at start and answered with 500
  afterwards (the shared `FileRecordStore` constructor still creates its directory for the write
  paths of GC-AI-0002; the viewer checks before building it).
- The page is loaded once at server start (`make_handler` reads `index.html` into memory); a
  page edit needs a restart. Records are read on every request.
- The pre-existing `test_record_regime.py:317` skips from a worktree (it expects a sibling
  `GaleCore/` next to the checkout). `GALECORE_RECORDS_DIR` must be set from a worktree; the
  server prints the directory it reads.
- `compare_facts` shows numeric differences only; it does not judge the interpretation
  (evaluation stays with the human review, per HUMAN-REVIEW-GUIDE.md).
- Annotations are owner statements transcribed by hand into YAML; the viewer cannot tell whether
  the source document still says the same. The source is displayed so it can be checked.
- No commit of this work (owner instruction). The tree is the state to review.

## Internal review R1 (Claude `reviewer` subagent, Opus, 2026-09-21 ~16:55 UTC) — CHANGES_REQUESTED → fixed

Verified by the reviewer: same `query_records` path, INTEGRITY_FAILED never a success nor shown,
loopback binding, no API key / GaleCore involvement, F-7 annotation hash-bound and separated,
real file byte-identical, checks reproduced (gate PASS, ruff, 617 passed / 1 skipped, diff-check),
wheel PASS. Browser rendering not observed by the reviewer (read the HTML only).

| # | Sev | Finding | Resolution |
|---|---|---|---|
| R1-M1 | MAJOR | `FileRecordStore(...)` creates a missing `GALECORE_RECORDS_DIR`; a wrong path looked like "no records" (200) | `main` refuses a non-existent dir before building the store; `require_records_dir` → 500 in `build_view`/`build_meta`; tests `test_missing_records_dir_fails_closed_and_is_never_created`, `test_records_dir_removed_after_start_is_500_not_empty` |
| R1-M2 | MAJOR | AC-05 matrix cited tests that did not cover "dir unavailable" | Matrix row rewritten with the new tests |
| R1-m1 | MINOR | HEAD/OPTIONS → 501, AC-07 says non-GET → 405 | `do_HEAD = do_OPTIONS = _reject`; test extended |
| R1-m2 | MINOR | Claim-vs-fact equality computed in the browser | Moved to the adapter (`check_claims`, `resolve_evidence`); page renders `entry.claims` / `entry.evidence` |
| R1-m3 | MINOR | Frontmatter `IN_PROGRESS` vs handoff `READY_FOR_REVIEW` | Frontmatter set to `READY_FOR_REVIEW` |
| R1-m4 | MINOR | Screenshots in the scratchpad are not reproducible artifacts | Sanitized HTTP responses committed to the tree under `docs/evidence/gc-ai-0003-viewer/`; matrix cites them |
| R1-m5 | MINOR | No `Host` header check (DNS rebinding) | Loopback `Host` required (403 otherwise); test added |
| R1-n1..n3 | NOTE | tool docstring, redundant ternary, page cached at start | Docstring and ternary fixed; caching documented |

## Independent review 1 (Codex, `--uncommitted`, effort high, 2026-09-21T16:58Z) — `docs/engineering/reviews/GC-AI-0003-20260921T165841Z.md`

**Scope:** dirty tree on `ce6645a` (`feature/GC-AI-0003`), 2 tracked changes + 13 untracked files. Run
through a session driver that points the workspace runner at this worktree and at GC-AI-0003
(`ACTIVE_WORK_ITEM` untouched; runner unmodified). **Verdict:** CHANGES_REQUESTED. Codex reproduced
gate PASS, ruff, 620 passed / 1 skipped, diff-check, and the real-file hash before/after.

| # | Sev | Finding | Resolution |
|---|---|---|---|
| C1-M1 | MAJOR | Detail read joined to `query` only by `run_id`: a file rewritten between the two reads could render a mix of two versions; a missing entry silently continued without `states` | **Fixed.** `_same_as_query` compares every field `query` emitted (prompt, accepted_at, facts_hash, facts, host, payload, outcomes, reviews); on any difference or missing entry the query is retried (`READ_ATTEMPTS`), then the day is `READ_INCONSISTENT` with problems and no content, HTTP 409. Tests: `TestTwoReadConsistency` (3), `test_read_inconsistency_is_409_not_success`. |
| C1-M2 | MAJOR | Page ignored a failed `/api/meta` (showed "no symbol folders") and cleared the query time on errors | **Fixed.** `showError` renders the error card with the directory (`records_dir` from the 500 body) and the attempt time (`at`, now in every error JSON) plus the HTTP status; `loadMeta` handles `!r.ok`. Tests: `test_error_responses_carry_time_and_directory`, `TestPageBehaviour` (Playwright, 3 tests). |
| C1-m1 | MINOR | TRACE/CONNECT → 501 instead of 405 | **Fixed.** Handler `__getattr__` maps every `do_<METHOD>` but GET to `_reject`; test covers TRACE, CONNECT and an unknown method. |

Limitations Codex declared: no browser inspection, no wheel build, no synthetic-generator rerun
(all three were done by the implementer and are recorded above; the page tests now exercise the
browser where Playwright is installed).

### Verification rerun (after fixes)

- gate PASS · ruff clean · diff-check clean · pytest 628 passed, 1 skipped · wheel PASS · real
  file hash unchanged (`57a48542…0d5f53`) · evidence JSON regenerated (`read_inconsistent: []`).

## Independent review 2 (Codex, `--recheck`, effort medium, 2026-09-21T17:10Z) — `docs/engineering/reviews/GC-AI-0003-20260921T171056Z.md`

**Verdict:** APPROVE. C1-M1, C1-M2, C1-m1 **RESOLVED**; no new findings. Codex reproduced gate PASS,
ruff, 628 passed / 1 skipped, diff-check, and ran the Chromium page tests. Declared limitations: no
wheel build, no synthetic rerun, no real-directory rehash, no visual layout inspection (all done by
the implementer, recorded in the handoff).

### Product-owner decision

- PENDING. `status`, `closure_blocked` and `approval_result` unchanged: VALIDATED/CLOSED only by
  the owner. The viewer work is uncommitted in the worktree by owner instruction.

## Handoff de realineación (2026-09-21, tras `roadmap/REALINEACION-2026-09-21.md`)

Escrito a pedido del owner para contrastar este item con el plan de acción. Nuevos desarrollos de UI
pausados; nada borrado, integrado ni commiteado en este paso.

**Rama / worktree / pendiente.** `feature/GC-AI-0003` en `.worktrees/galecore-ai/GC-AI-0003`, base
`ce6645a` (checkpoint de `feature/gc-ai-0002`). 12 entradas sin commit: `CLAUDE.md` (+1 línea),
`src/galecore_ai/adapters/record_store.py` (+`symbols()`), y nuevos `config/viewer/`,
`docs/LOCAL-REGIME-VIEWER.md`, `docs/engineering/reviews/GC-AI-0003-*.md` (2),
`docs/engineering/work-items/GC-AI-0003-*.md`, `docs/evidence/gc-ai-0003-viewer/`,
`src/galecore_ai/adapters/regime_viewer.py`, `src/galecore_ai/adapters/regime_viewer_static/`,
`tests/unit/test_regime_viewer.py`, `tools/viewer_test_records.py`. Claim activo en
`tools/work_item.py status`. El worktree **no** contiene los avances de GC-AI-0002 posteriores a
`ce6645a` (registro del 21/09 con outcome y review): al integrar hay que rebasar/mergear sobre el
estado final de `feature/gc-ai-0002`; el conflicto esperable es solo `record_store.py` (aditivo).

**Qué está implementado y qué puede hacer hoy el usuario.** Visor local de solo lectura:
`python -B -m galecore_ai.adapters.regime_viewer` (con `PYTHONPATH=src` y `GALECORE_RECORDS_DIR`
desde el worktree) y abrir `http://127.0.0.1:8765/`. Permite: filtrar por símbolo y fechas; ver por
día el estado (integridad OK / INTEGRITY_FAILED / READ_INCONSISTENT, outcome pendiente, review
pendiente), el detalle (prompt, timestamps por fuente, interpretación aceptada, claims vs facts,
evidencia, limitaciones, guardrails, assets, hashes), la comparación facts-al-aceptar vs outcome y
el review humano cuando existen, y la anotación F-7 del registro del 17/09 (histórico observado,
no cuenta para AC-08) separada del contenido. **No** permite pedir análisis, escribir outcomes ni
reviews, ni ve otra cosa que los registros de régimen.

**Independiente o integrado.** Visor **independiente** (página HTML servida por un adapter Python
en loopback). **No se inició ninguna integración al monitor React**: `GaleCore/source/galecore-monitor`
no tiene cambios (verificado con `git status`); la integración solo se conversó y quedó propuesta
en la sesión (sección "Inteligencia" → pestaña "Régimen": Hoy / Serie / Detalle / Review), sin item
ni árbol. Coincide con lo que registra la realineación.

**Pruebas y reviews.**
- Tests: `tests/unit/test_regime_viewer.py` (30; 3 de página con Playwright, se saltan si no está).
  Suite completa en el worktree: 628 passed, 1 skipped (preexistente, sin checkout hermano).
  Gate PASS, ruff, `git diff --check`, `tools/verify_wheel_assets.py` PASS.
- Evidencia: `docs/evidence/gc-ai-0003-viewer/` (README + 5 respuestas HTTP sanitizadas, reales y
  sintéticas). Registro real byte-idéntico antes/después (`57a48542…0d5f53`).
- Review interno R1 (agente `reviewer`): CHANGES_REQUESTED → resuelto (tabla arriba).
- Codex C1 `docs/engineering/reviews/GC-AI-0003-20260921T165841Z.md`: CHANGES_REQUESTED → resuelto.
- Codex C2 `docs/engineering/reviews/GC-AI-0003-20260921T171056Z.md`: **APPROVE**.
- Divergencia señalada por la realineación (encabezado `review_result: PENDING` vs review APPROVE):
  corregida en este handoff a `review_result: APPROVED`, que transcribe el veredicto del reviewer.
  `status`, `closure_blocked` y `approval_result` no cambian: VALIDATED/CLOSED son del owner.

**Qué falta / procesos.** Falta la decisión del owner (VALIDATED/CLOSED, commit del trabajo) y el
destino del visor según el plan (punto 6 de la realineación). Ningún proceso de esta sesión sigue
ejecutándose (los servidores de prueba y los reviews terminaron). En el momento de escribir esto
hay un servidor del visor escuchando en `127.0.0.1:8765` lanzado por el owner desde su propia
terminal; se cierra con Ctrl+C allí. No se tocó GC-AI-0002 ni su serie.

**Reutilizable para integrarlo al monitor existente** (sin reescribir):
- `regime_viewer.build_view` / `build_meta`: view model completo (estados, comparaciones,
  claims/evidencia resueltos, anotaciones) sobre `query_records` + `FileRecordStore.load`, con
  chequeo de consistencia entre lecturas. Independiente del transporte.
- `regime_viewer.serve` / `make_handler`: adapter HTTP loopback `GET /api/meta`, `GET /api/records`.
  Para que el monitor (`localhost:3000`/`:7001`) lo consuma hace falta CORS restringido a ese
  origen (hoy no lo tiene, y el chequeo de `Host` sigue vigente).
- `config/viewer/record-annotations.yaml` + `load_annotations`: anotaciones del owner ligadas a hash.
- `tools/viewer_test_records.py`: datos sintéticos (`TEST`) para probar estados en cualquier front.
- Tests HTTP/view-model: valen tal cual para el adapter; los de página son específicos del HTML.
- El HTML (`regime_viewer_static/index.html`) es el único componente descartable: la estructura de
  sus tarjetas (Hoy/estados, Cuándo y con qué datos, Interpretación, Qué pasó después, Review,
  Facts y assurance) sirve de especificación para los componentes React.
- Lo que **no** existe y habría que agregar en el adapter para la pestaña propuesta: endpoint de
  serie comparable por día y, si se decide, `POST` de review que llame a `record_review`.

**Próximo paso del plan.** Esperar el acuerdo del siguiente incremento sobre el plan completo
(realineación, punto 6). Este item no se amplía hasta entonces.

