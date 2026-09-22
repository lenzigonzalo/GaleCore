"""Local read-only viewer for evaluable regime records (GC-AI-0003).

    python -B -m galecore_ai.adapters.regime_viewer [--port 8765]

Serves one static page and two JSON endpoints on the loopback interface only:

    GET  /                 the page (``regime_viewer_static/index.html``)
    GET  /api/meta         records dir, symbols present, today's trading date, annotation source
    GET  /api/records?symbol=SPY&since=YYYY-MM-DD[&until=YYYY-MM-DD]
    GET  /api/today?symbol=SPY          today's record (calendar date in the convention timezone) or NO_RECORD
    POST /api/reviews      {symbol, date, run_id, verdict, comment} -> record_review (GC-AI-0004)

The GaleCore monitor (a browser app on another local port) may call the JSON
endpoints: CORS is granted only to the origins in ``REGIME_VIEWER_ALLOWED_ORIGINS``
(default: the monitor's dev origin), never ``*``. The single write endpoint is
protected by three independent checks — loopback ``Host``, an allowed ``Origin``
and a shared secret in ``X-Review-Token`` (``REGIME_REVIEW_TOKEN``, or generated
and printed at start) — so neither a page on another origin nor a request without
the token can append a review. It appends through ``record_review`` with the same
checks as ``cli record review``; it never touches the hashed part of an entry.

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

Never calls GaleCore, never reads an API key. The only write is the review append.
"""

from __future__ import annotations

import argparse
import hmac
import json
import os
import re
import secrets
import sys
import threading
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

import yaml
from pydantic import BaseModel, ValidationError

from galecore_ai.adapters.asset_manifest import RequiredAssetError, load_required_assets
from galecore_ai.adapters.record_store import (
    FileRecordStore,
    RecordIntegrityError,
    RecordStoreError,
    default_records_dir,
)
from galecore_ai.application.record_regime import (
    RecordError,
    query_records,
    record_date_for,
    record_review,
)
from galecore_ai.contracts.regime_analysis import REGIME_SKILL_ID
from galecore_ai.contracts.regime_record import RegimeRecordEntry, ReviewVerdict
from galecore_ai.harness.assets import asset_root

ANNOTATIONS_REL_PATH = "viewer/record-annotations.yaml"
STATIC_DIR = Path(__file__).resolve().parent / "regime_viewer_static"
LOOPBACK = "127.0.0.1"
_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "[::1]"}
DEFAULT_PORT = 8765
ALLOWED_ORIGINS_ENV = "REGIME_VIEWER_ALLOWED_ORIGINS"
DEFAULT_ALLOWED_ORIGINS = ("http://localhost:3039", "http://127.0.0.1:3039")  # galecore-monitor dev server
REVIEW_TOKEN_ENV = "REGIME_REVIEW_TOKEN"
REVIEW_TOKEN_HEADER = "X-Review-Token"
MAX_REVIEW_BODY_BYTES = 16 * 1024
REQUEST_TIMEOUT_SECONDS = 10
# One writer at a time in this process: record_review is load → append → save on one file, and
# ThreadingHTTPServer runs each request on its own thread.
_WRITE_LOCK = threading.Lock()
_DATE_ARG = "YYYY-MM-DD"
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")  # fromisoformat also accepts 20260919 and week dates
READ_ATTEMPTS = 3
# Facts compared side by side between acceptance and each later outcome (all GaleCore-verified).
COMPARED_METRICS = ("spot", "net_gex", "zero_gamma_level", "call_wall", "put_wall", "vix", "vvix",
                    "put_skew_ratio", "atm_iv", "put_wing_iv")


class ViewerArgumentError(Exception):
    """A request parameter is invalid (HTTP 400)."""


class ReviewRejected(Exception):
    """A review request was refused; ``status`` is the HTTP status to answer."""

    def __init__(self, status: HTTPStatus, message: str) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class ViewerConfig:
    """What the server allows besides plain local reads."""

    timezone: str
    allowed_origins: frozenset[str] = field(default_factory=frozenset)
    review_token: str | None = None  # None = the write endpoint is disabled

    @property
    def reviews_enabled(self) -> bool:
        return bool(self.review_token)


def convention_timezone() -> str:
    """The record-date timezone, from the same convention asset ``accept --record`` uses."""
    try:
        bundle = load_required_assets((REGIME_SKILL_ID,))
    except RequiredAssetError as exc:
        raise RecordStoreError(f"cannot load the convention timezone: {exc}") from exc
    timezone = str(bundle.resolved_conventions["timezone"])
    try:
        ZoneInfo(timezone)
    except (KeyError, ValueError) as exc:
        raise RecordStoreError(f"convention timezone {timezone!r} is unknown") from exc
    return timezone


def allowed_origins_from_env() -> frozenset[str]:
    raw = os.environ.get(ALLOWED_ORIGINS_ENV)
    values = [v.strip() for v in raw.split(",")] if raw else list(DEFAULT_ALLOWED_ORIGINS)
    return frozenset(v.rstrip("/") for v in values if v)


class ReviewRequest(BaseModel):
    """Body of ``POST /api/reviews``; the same arguments ``cli record review`` takes."""

    model_config = {"extra": "forbid"}

    symbol: str
    date: str
    run_id: str
    verdict: ReviewVerdict
    comment: str


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


def build_meta(store: FileRecordStore, annotations: list[RecordAnnotation] | None = None,
               config: ViewerConfig | None = None) -> dict:
    require_records_dir(store)
    annotations = annotations if annotations is not None else load_annotations()
    meta = {
        "records_dir": str(store.base_dir),
        "symbols": store.symbols(),
        "annotations_file": str(asset_root() / ANNOTATIONS_REL_PATH),
        "annotation_count": len(annotations),
        "read_only": not (config and config.reviews_enabled),
        "reviews_enabled": bool(config and config.reviews_enabled),
        "served_at": datetime.now(UTC).isoformat(),
    }
    if config is not None:
        meta["timezone"] = config.timezone
        meta["today"] = record_date_for(datetime.now(UTC), config.timezone)
    return meta


def build_today(*, store: FileRecordStore, symbol: str, timezone: str,
                annotations: list[RecordAnnotation] | None = None) -> dict:
    """Today's trading date in the convention timezone and its record, or ``NO_RECORD``."""
    today = record_date_for(datetime.now(UTC), timezone)
    day = date.fromisoformat(today)
    view = build_view(store=store, symbol=symbol, since=day, until=day, annotations=annotations)
    record = view["records"][0] if view["records"] else None
    return {
        "date": today,
        "timezone": timezone,
        "symbol": view["symbol"],
        "status": record["status"] if record else "NO_RECORD",
        "record": record,
        "records_dir": view["records_dir"],
        "queried_at": view["queried_at"],
    }


def _review_status(exc: RecordError) -> HTTPStatus:
    """HTTP status for a refused review, by the cause ``record_review`` attached — not by its text."""
    cause = exc.__cause__
    if isinstance(cause, RecordIntegrityError):
        return HTTPStatus.UNPROCESSABLE_ENTITY  # the day is one query rejects
    if isinstance(cause, OSError):
        return HTTPStatus.SERVICE_UNAVAILABLE  # the write itself failed (lock, permissions)
    if isinstance(cause, RecordStoreError):
        return HTTPStatus.BAD_REQUEST
    return HTTPStatus.NOT_FOUND  # no record for the day / run_id not found


def submit_review(*, store: FileRecordStore, request: ReviewRequest,
                  annotations: list[RecordAnnotation] | None = None) -> dict:
    """Append the human verdict through ``record_review`` and return the day re-read via ``query``.

    Argument checks happen before any file is touched; the write and its re-read run under the
    process-wide write lock so two reviews on the same day cannot lose each other.
    """
    if not request.comment.strip():
        raise ReviewRejected(HTTPStatus.BAD_REQUEST, "a non-empty comment is required")
    if not _DATE_RE.match(request.date):
        raise ReviewRejected(HTTPStatus.BAD_REQUEST, f"date must be {_DATE_ARG}")
    try:
        day = date.fromisoformat(request.date)
    except ValueError as exc:
        raise ReviewRejected(HTTPStatus.BAD_REQUEST, f"date must be {_DATE_ARG}") from exc
    symbol = request.symbol.strip().upper()
    try:
        store.path_for(symbol, day.isoformat())  # the store's own symbol/date rules, before touching files
    except RecordStoreError as exc:
        raise ReviewRejected(HTTPStatus.BAD_REQUEST, str(exc)) from exc
    require_records_dir(store)
    with _WRITE_LOCK:
        try:
            run_id, path = record_review(store=store, symbol=symbol, day=day.isoformat(),
                                         run_id=request.run_id, verdict=request.verdict,
                                         comment=request.comment)
        except RecordError as exc:
            raise ReviewRejected(_review_status(exc), str(exc)) from exc
        # From here on the review IS on disk. A failure while re-reading must not turn into an error
        # status: the client would retry and append the review twice. It is reported next to the
        # acknowledgement instead, with no record.
        try:
            view = build_view(store=store, symbol=symbol, since=day, until=day, annotations=annotations)
        except (RecordStoreError, RecordError, OSError) as exc:
            return {"recorded": {"run_id": run_id, "path": path, "verdict": request.verdict.value},
                    "record": None, "reread_error": f"review saved, but re-reading the day failed: {exc}",
                    "queried_at": datetime.now(UTC).isoformat()}
    return {"recorded": {"run_id": run_id, "path": path, "verdict": request.verdict.value},
            "record": view["records"][0] if view["records"] else None, "reread_error": None,
            "queried_at": view["queried_at"]}


# ── HTTP ─────────────────────────────────────────────────────────


def _now() -> str:
    return datetime.now(UTC).isoformat()


def make_handler(store: FileRecordStore, annotations: list[RecordAnnotation],
                 config: ViewerConfig | None = None) -> type[BaseHTTPRequestHandler]:
    page = (STATIC_DIR / "index.html").read_bytes()
    config = config or ViewerConfig(timezone="UTC")

    class Handler(BaseHTTPRequestHandler):
        server_version = "galecore-ai-regime-viewer"
        timeout = REQUEST_TIMEOUT_SECONDS  # a client that under-sends its Content-Length cannot pin a thread

        def log_message(self, fmt: str, *args) -> None:  # quiet; loopback only
            sys.stderr.write(f"{self.address_string()} - {fmt % args}\n")

        def _allowed_origin(self) -> str | None:
            origin = (self.headers.get("Origin") or "").rstrip("/")
            return origin if origin and origin in config.allowed_origins else None

        def _loopback_host(self) -> bool:
            host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
            return host in _LOOPBACK_HOSTS

        def _cors_headers(self) -> None:
            origin = self._allowed_origin()
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")

        def _send(self, status: HTTPStatus, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self._cors_headers()
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: HTTPStatus, data: dict) -> None:
            self._send(status, json.dumps(data, ensure_ascii=False).encode("utf-8"),
                       "application/json; charset=utf-8")

        def do_GET(self) -> None:
            if not self._loopback_host():
                self._json(HTTPStatus.FORBIDDEN, {"error": "loopback only", "at": _now()})
                return
            url = urlsplit(self.path)
            params = {k: v[-1] for k, v in parse_qs(url.query).items()}
            try:
                if url.path == "/":
                    self._send(HTTPStatus.OK, page, "text/html; charset=utf-8")
                elif url.path == "/api/meta":
                    self._json(HTTPStatus.OK, build_meta(store, annotations, config))
                elif url.path == "/api/today":
                    self._json(HTTPStatus.OK, build_today(store=store, symbol=params.get("symbol", ""),
                                                          timezone=config.timezone, annotations=annotations))
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

        def do_OPTIONS(self) -> None:
            # CORS preflight for the monitor only; any other OPTIONS is refused like every non-GET.
            origin = self._allowed_origin()
            if not self._loopback_host() or not origin or not self.headers.get("Access-Control-Request-Method"):
                self._reject()
                return
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", f"Content-Type, {REVIEW_TOKEN_HEADER}")
            self.send_header("Access-Control-Max-Age", "600")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_POST(self) -> None:
            url = urlsplit(self.path)
            try:
                if not self._loopback_host():
                    raise ReviewRejected(HTTPStatus.FORBIDDEN, "loopback only")
                if url.path != "/api/reviews":
                    raise ReviewRejected(HTTPStatus.NOT_FOUND, "not found")
                if not config.reviews_enabled:
                    raise ReviewRejected(HTTPStatus.FORBIDDEN, "reviews are disabled on this server")
                if not self._allowed_origin():
                    raise ReviewRejected(HTTPStatus.FORBIDDEN, "origin not allowed")
                token = self.headers.get(REVIEW_TOKEN_HEADER) or ""
                if not hmac.compare_digest(token.encode(), (config.review_token or "").encode()):
                    raise ReviewRejected(HTTPStatus.UNAUTHORIZED, f"missing or wrong {REVIEW_TOKEN_HEADER}")
                media_type = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
                if media_type != "application/json":
                    raise ReviewRejected(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "Content-Type must be application/json")
                try:
                    length = int(self.headers.get("Content-Length") or "0")
                except ValueError as exc:
                    raise ReviewRejected(HTTPStatus.BAD_REQUEST, "invalid Content-Length") from exc
                if length <= 0 or length > MAX_REVIEW_BODY_BYTES:
                    raise ReviewRejected(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "body missing or too large")
                try:
                    raw = self.rfile.read(length)
                except (TimeoutError, OSError) as exc:
                    raise ReviewRejected(HTTPStatus.REQUEST_TIMEOUT, "request body not received in time") from exc
                if len(raw) != length:
                    raise ReviewRejected(HTTPStatus.BAD_REQUEST, "request body shorter than Content-Length")
                try:
                    request = ReviewRequest.model_validate(json.loads(raw.decode("utf-8")))
                except (ValueError, ValidationError) as exc:
                    raise ReviewRejected(HTTPStatus.BAD_REQUEST, f"invalid review request: {exc}") from exc
                result = submit_review(store=store, request=request, annotations=annotations)
            except ReviewRejected as exc:
                self._json(exc.status, {"error": str(exc), "at": _now()})
                return
            except (RecordStoreError, OSError) as exc:
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR,
                           {"error": f"record store unavailable: {exc}", "records_dir": str(store.base_dir),
                            "at": _now()})
                return
            self._json(HTTPStatus.CREATED, result)  # outside the try: a write that succeeded is never reported as failed

        def _reject(self) -> None:
            self.send_response(HTTPStatus.METHOD_NOT_ALLOWED)
            self.send_header("Allow", "GET, POST, OPTIONS")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def __getattr__(self, name: str):
            # http.server dispatches on ``do_<METHOD>``: every other method is refused with 405
            # (the default would be 501 for TRACE, CONNECT or anything unusual).
            if name.startswith("do_"):
                return self._reject
            raise AttributeError(name)

    return Handler


def serve(store: FileRecordStore, *, port: int = DEFAULT_PORT,
          annotations: list[RecordAnnotation] | None = None,
          config: ViewerConfig | None = None) -> ThreadingHTTPServer:
    """Bind the loopback interface only; the caller runs ``serve_forever``."""
    handler = make_handler(store, annotations if annotations is not None else load_annotations(), config)
    return ThreadingHTTPServer((LOOPBACK, port), handler)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Local viewer/review adapter for regime records (loopback only)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-reviews", action="store_true",
                        help="serve reads only; POST /api/reviews answers 403")
    parser.add_argument("--allow-origin", action="append", metavar="ORIGIN",
                        help=f"browser origin allowed to call the API (repeatable; default: {ALLOWED_ORIGINS_ENV} "
                             f"or {', '.join(DEFAULT_ALLOWED_ORIGINS)})")
    args = parser.parse_args(argv)
    try:
        records_dir = default_records_dir()
        if not records_dir.is_dir():
            raise RecordStoreError(f"records directory does not exist: {records_dir} (not created; check GALECORE_RECORDS_DIR)")
        store = FileRecordStore(records_dir)
        annotations = load_annotations()
        timezone = convention_timezone()
    except (RecordStoreError, OSError) as exc:
        print(f"Record store unavailable: {exc}", file=sys.stderr)
        return 1
    origins = frozenset(o.rstrip("/") for o in args.allow_origin) if args.allow_origin else allowed_origins_from_env()
    token = None
    generated = False
    if not args.no_reviews:
        token = os.environ.get(REVIEW_TOKEN_ENV) or secrets.token_urlsafe(24)
        generated = not os.environ.get(REVIEW_TOKEN_ENV)
    config = ViewerConfig(timezone=timezone, allowed_origins=origins, review_token=token)
    server = serve(store, port=args.port, annotations=annotations, config=config)
    host, bound_port = server.server_address[:2]
    print(f"Regime record viewer on http://{host}:{bound_port}/  (records dir: {store.base_dir}; "
          f"symbols: {', '.join(store.symbols()) or 'none'}; record dates in {timezone})", flush=True)
    print(f"Browser origins allowed: {', '.join(sorted(origins)) or 'none'}", flush=True)
    if token:
        shown = token if generated else "<from environment>"
        print(f"Reviews: ENABLED. {REVIEW_TOKEN_HEADER}: {shown}"
              + ("  (generated for this run; paste it in the monitor's review form)" if generated else ""), flush=True)
    else:
        print("Reviews: disabled (--no-reviews)", flush=True)
    print("Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
