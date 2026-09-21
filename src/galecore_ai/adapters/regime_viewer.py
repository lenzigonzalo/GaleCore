"""Local read-only viewer for evaluable regime records (GC-AI-0003).

    python -B -m galecore_ai.adapters.regime_viewer [--port 8765]

Serves one static page and two JSON endpoints on the loopback interface only:

    GET /                 the page (``regime_viewer_static/index.html``)
    GET /api/meta         records dir, symbols present, annotation source
    GET /api/records?symbol=SPY&since=YYYY-MM-DD[&until=YYYY-MM-DD]

What it reuses and what it adds. The list of records and every ``OK`` /
``INTEGRITY_FAILED`` verdict come from ``query_records`` — the same function
behind ``cli query`` — and entry detail (snapshot identity, effective assets,
guardrail trace) comes from ``FileRecordStore.load``, the same verification
``query`` runs. Nothing here parses a record file. A record ``query`` rejects is
shown with its problems only; its content never reaches the page. The HTTP
status mirrors the CLI exit code: 200 when every record is intact, 422 when any
is ``INTEGRITY_FAILED`` (CLI exit 3), 400 for bad arguments, 500 when the records
directory is missing or cannot be read (the CLI exits 1). The directory must exist
before the server starts: a wrong ``GALECORE_RECORDS_DIR`` is refused, never
created, so "no records" can never mean "wrong folder".

The detail read happens after ``query_records`` returned, so a file rewritten in
between (``record outcome`` appending, an edit) could differ from what ``query``
saw. Every field ``query`` emitted is therefore compared with the detail read; on
any difference the whole query is retried, and a day that stays inconsistent is
reported as ``READ_INCONSISTENT`` (no content rendered, HTTP 409) rather than
shown as a mixture of two versions.

Derived states are only what the record shows: ``outcome_pending`` = no outcome
appended yet, ``review_pending`` = no human review yet. Owner annotations
(``config/viewer/record-annotations.yaml``) are bound to an ``entry_hash`` and
carry their source; an entry whose hash does not match gets no annotation.

Never writes, never calls GaleCore, never reads an API key.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, date, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import yaml
from pydantic import BaseModel, ValidationError

from galecore_ai.adapters.record_store import (
    FileRecordStore,
    RecordIntegrityError,
    RecordStoreError,
    default_records_dir,
)
from galecore_ai.application.record_regime import RecordError, query_records
from galecore_ai.contracts.regime_record import RegimeRecordEntry
from galecore_ai.harness.assets import asset_root

ANNOTATIONS_REL_PATH = "viewer/record-annotations.yaml"
STATIC_DIR = Path(__file__).resolve().parent / "regime_viewer_static"
LOOPBACK = "127.0.0.1"
_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "[::1]"}
DEFAULT_PORT = 8765
_DATE_ARG = "YYYY-MM-DD"
READ_ATTEMPTS = 3
# Facts compared side by side between acceptance and each later outcome (all GaleCore-verified).
COMPARED_METRICS = ("spot", "net_gex", "zero_gamma_level", "call_wall", "put_wall", "vix", "vvix",
                    "put_skew_ratio", "atm_iv", "put_wing_iv")


class ViewerArgumentError(Exception):
    """A request parameter is invalid (HTTP 400)."""


class RecordAnnotation(BaseModel):
    """An owner statement about one entry, bound to its hash and citing its source."""

    model_config = {"extra": "forbid"}

    symbol: str
    date: str
    entry_hash: str
    kind: str
    label: str
    note: str
    source: str
    decided_on: str


def load_annotations(path: Path | None = None) -> list[RecordAnnotation]:
    """Annotations file, or an empty list when there is none. Invalid content fails closed."""
    path = path or (asset_root() / ANNOTATIONS_REL_PATH)
    if not path.is_file():
        return []
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    try:
        return [RecordAnnotation.model_validate(item) for item in data.get("annotations", [])]
    except (ValidationError, AttributeError) as exc:
        raise RecordStoreError(f"Invalid annotations file {path}: {exc}") from exc


def check_claims(payload: dict, facts: dict) -> list[dict]:
    """Each quantitative claim next to the fact it was validated against at acceptance."""
    return [
        {"metric": c.get("metric"), "value": c.get("value"), "unit": c.get("unit"),
         "fact_value": facts.get(c.get("metric")), "matches": facts.get(c.get("metric")) == c.get("value")}
        for c in payload.get("quantitative_claims", [])
    ]


def resolve_evidence(payload: dict, facts: dict) -> list[dict]:
    """Each evidence item with the fact value its path points to (top-level ``facts.<key>``)."""
    rows = []
    for ev in payload.get("evidence", []):
        path = str(ev.get("fact_path", ""))
        key = path.removeprefix("facts.")
        rows.append({"claim": ev.get("claim"), "fact_path": path, "fact_value": facts.get(key)})
    return rows


def compare_facts(before: dict, after: dict) -> list[dict]:
    """Per metric: value at acceptance, value observed later, and their difference (None if absent)."""
    rows = []
    for metric in COMPARED_METRICS:
        a, b = before.get(metric), after.get(metric)
        numeric = isinstance(a, int | float) and isinstance(b, int | float)
        rows.append({"metric": metric, "before": a, "after": b,
                     "delta": round(b - a, 6) if numeric else None})
    return rows


def _parse_date(value: str | None, *, name: str) -> date | None:
    if value is None or value == "":
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ViewerArgumentError(f"{name} must be {_DATE_ARG}, got {value!r}") from exc


def require_records_dir(store: FileRecordStore) -> None:
    """Fail closed when the directory the store points to is gone (never create it)."""
    if not store.base_dir.is_dir():
        raise RecordStoreError(f"records directory does not exist: {store.base_dir}")


def build_view(
    *,
    store: FileRecordStore,
    symbol: str,
    since: date,
    until: date | None = None,
    annotations: list[RecordAnnotation] | None = None,
) -> dict:
    """The page's data for one query: ``query_records`` output plus per-entry detail and states."""
    if not symbol or not symbol.strip():
        raise ViewerArgumentError("symbol is required")
    symbol = symbol.strip().upper()
    if until is not None and until < since:
        raise ViewerArgumentError("until must not be before since")
    require_records_dir(store)
    try:
        records = query_records(store=store, symbol=symbol, since=since, until=until)
    except RecordError as exc:
        raise ViewerArgumentError(str(exc)) from exc
    annotations = annotations if annotations is not None else load_annotations()
    by_hash = {(a.symbol.upper(), a.date, a.entry_hash): a for a in annotations}

    for _ in range(READ_ATTEMPTS):
        if not _enrich(records, store=store, symbol=symbol, by_hash=by_hash):
            break
        records = query_records(store=store, symbol=symbol, since=since, until=until)
    else:
        _enrich(records, store=store, symbol=symbol, by_hash=by_hash, final=True)

    return {
        "symbol": symbol,
        "since": since.isoformat(),
        "until": until.isoformat() if until else None,
        "records_dir": str(store.base_dir),
        "count": len(records),
        "integrity_failed": [r["date"] for r in records if r["status"] == "INTEGRITY_FAILED"],
        "read_inconsistent": [r["date"] for r in records if r["status"] == "READ_INCONSISTENT"],
        "records": records,
        "queried_at": datetime.now(UTC).isoformat(),
    }


def _same_as_query(entry: dict, source: RegimeRecordEntry) -> bool:
    """True when the detail read shows exactly what ``query_records`` projected for this entry."""
    return (
        entry["prompt"] == source.request.prompt
        and entry["accepted_at"] == source.trace.accepted_at.isoformat()
        and entry["facts_hash"] == source.snapshot.facts_hash
        and entry["facts"] == source.facts
        and entry["host"] == source.host.model_dump(mode="json")
        and entry["accepted_payload"] == source.accepted_payload
        and entry["outcomes"] == [o.model_dump(mode="json") for o in source.outcomes]
        and entry["human_reviews"] == [r.model_dump(mode="json") for r in source.human_reviews]
    )


def _enrich(records: list[dict], *, store: FileRecordStore, symbol: str,
            by_hash: dict[tuple[str, str, str], RecordAnnotation], final: bool = False) -> bool:
    """Add detail from the same load ``query`` did. Returns True if a retry is needed."""
    retry = False
    for record in records:
        if record["status"] != "OK":
            continue
        day, path = record["date"], record["path"]
        try:
            document = store.load(symbol, day)
        except RecordIntegrityError as exc:
            record.clear()
            record.update({"date": day, "status": "INTEGRITY_FAILED", "path": str(exc.path),
                           "problems": exc.problems})
            continue
        if document is None:
            record.clear()
            record.update({"date": day, "status": "INTEGRITY_FAILED", "path": path,
                           "problems": ["record disappeared while reading"]})
            continue
        details = {e.entry_id: e for e in document.entries}
        problems = [f"entry {e['run_id']}: changed or missing between the two reads"
                    for e in record["entries"]
                    if e["run_id"] not in details or not _same_as_query(e, details[e["run_id"]])]
        if problems or len(details) != len(record["entries"]):
            if final:
                record.clear()
                record.update({"date": day, "status": "READ_INCONSISTENT", "path": path,
                               "problems": problems or ["entries changed between the two reads"]})
            else:
                retry = True
            continue
        for entry in record["entries"]:
            source = details[entry["run_id"]]
            entry["recorded_at"] = source.recorded_at.isoformat()
            entry["snapshot"] = source.snapshot.model_dump(mode="json")
            entry["effective_assets"] = source.effective_assets.model_dump(mode="json")
            entry["trace"] = source.trace.model_dump(mode="json")
            entry["entry_hash"] = source.entry_hash
            entry["request"] = source.request.model_dump(mode="json")
            entry["claims"] = check_claims(entry["accepted_payload"], entry["facts"])
            entry["evidence"] = resolve_evidence(entry["accepted_payload"], entry["facts"])
            entry["comparisons"] = [
                {"observed_at": o["observed_at"], "rows": compare_facts(entry["facts"], o["facts"])}
                for o in entry["outcomes"]
            ]
            entry["states"] = {
                "outcome_pending": not entry["outcomes"],
                "review_pending": not entry["human_reviews"],
            }
            note = by_hash.get((symbol, day, source.entry_hash))
            entry["annotation"] = note.model_dump(mode="json") if note else None
    return retry


def build_meta(store: FileRecordStore, annotations: list[RecordAnnotation] | None = None) -> dict:
    require_records_dir(store)
    annotations = annotations if annotations is not None else load_annotations()
    return {
        "records_dir": str(store.base_dir),
        "symbols": store.symbols(),
        "annotations_file": str(asset_root() / ANNOTATIONS_REL_PATH),
        "annotation_count": len(annotations),
        "read_only": True,
        "served_at": datetime.now(UTC).isoformat(),
    }


# ── HTTP ─────────────────────────────────────────────────────────


def _now() -> str:
    return datetime.now(UTC).isoformat()


def make_handler(store: FileRecordStore, annotations: list[RecordAnnotation]) -> type[BaseHTTPRequestHandler]:
    page = (STATIC_DIR / "index.html").read_bytes()

    class Handler(BaseHTTPRequestHandler):
        server_version = "galecore-ai-regime-viewer"

        def log_message(self, fmt: str, *args) -> None:  # quiet; loopback only
            sys.stderr.write(f"{self.address_string()} - {fmt % args}\n")

        def _send(self, status: HTTPStatus, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: HTTPStatus, data: dict) -> None:
            self._send(status, json.dumps(data, ensure_ascii=False).encode("utf-8"),
                       "application/json; charset=utf-8")

        def do_GET(self) -> None:
            host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
            if host not in _LOOPBACK_HOSTS:
                self._json(HTTPStatus.FORBIDDEN, {"error": "loopback only", "at": _now()})
                return
            url = urlsplit(self.path)
            params = {k: v[-1] for k, v in parse_qs(url.query).items()}
            try:
                if url.path == "/":
                    self._send(HTTPStatus.OK, page, "text/html; charset=utf-8")
                elif url.path == "/api/meta":
                    self._json(HTTPStatus.OK, build_meta(store, annotations))
                elif url.path == "/api/records":
                    since = _parse_date(params.get("since"), name="since")
                    if since is None:
                        raise ViewerArgumentError(f"since is required ({_DATE_ARG})")
                    view = build_view(store=store, symbol=params.get("symbol", ""), since=since,
                                      until=_parse_date(params.get("until"), name="until"),
                                      annotations=annotations)
                    status = HTTPStatus.OK
                    if view["read_inconsistent"]:
                        status = HTTPStatus.CONFLICT
                    if view["integrity_failed"]:
                        status = HTTPStatus.UNPROCESSABLE_ENTITY
                    self._json(status, view)
                else:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "not found", "at": _now()})
            except ViewerArgumentError as exc:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc), "at": _now()})
            except (RecordStoreError, OSError) as exc:
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR,
                           {"error": f"record store unavailable: {exc}", "records_dir": str(store.base_dir),
                            "at": _now()})

        def _reject(self) -> None:
            self.send_response(HTTPStatus.METHOD_NOT_ALLOWED)
            self.send_header("Allow", "GET")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def __getattr__(self, name: str):
            # http.server dispatches on ``do_<METHOD>``: every method but GET is refused with 405
            # (the default would be 501 for TRACE, CONNECT or anything unusual).
            if name.startswith("do_"):
                return self._reject
            raise AttributeError(name)

    return Handler


def serve(store: FileRecordStore, *, port: int = DEFAULT_PORT,
          annotations: list[RecordAnnotation] | None = None) -> ThreadingHTTPServer:
    """Bind the loopback interface only; the caller runs ``serve_forever``."""
    handler = make_handler(store, annotations if annotations is not None else load_annotations())
    return ThreadingHTTPServer((LOOPBACK, port), handler)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Local read-only viewer for regime records (loopback only)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args(argv)
    try:
        records_dir = default_records_dir()
        if not records_dir.is_dir():
            raise RecordStoreError(f"records directory does not exist: {records_dir} (not created; check GALECORE_RECORDS_DIR)")
        store = FileRecordStore(records_dir)
        annotations = load_annotations()
    except (RecordStoreError, OSError) as exc:
        print(f"Record store unavailable: {exc}", file=sys.stderr)
        return 1
    server = serve(store, port=args.port, annotations=annotations)
    host, bound_port = server.server_address[:2]
    print(f"Regime record viewer (read-only) on http://{host}:{bound_port}/")
    print(f"Records dir: {store.base_dir}  (symbols: {', '.join(store.symbols()) or 'none'})")
    print("Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
