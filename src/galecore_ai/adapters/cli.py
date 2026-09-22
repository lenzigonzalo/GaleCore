"""CLI JSON adapter — prepare, accept, record and query via stdin/stdout.

Usage:
    python -m galecore_ai.adapters.cli prepare --symbol SPY [--skill gex|regime]
    python -m galecore_ai.adapters.cli accept [--record --prompt "..."] < request.json
    python -m galecore_ai.adapters.cli record outcome --symbol SPY --date YYYY-MM-DD [--run-id ID]
    python -m galecore_ai.adapters.cli record review --symbol SPY --date YYYY-MM-DD --run-id ID \\
        --verdict agree|partial|disagree --comment "..."
    python -m galecore_ai.adapters.cli query --symbol SPY --since YYYY-MM-DD [--until YYYY-MM-DD]

Exit codes:
    0  SUCCESS
    1  PREPARE_FAILED / RECORD_FAILED / INTERNAL_ERROR
    2  INSUFFICIENT_DATA
    3  VALIDATION_ERROR (also: argument errors, and query with INTEGRITY_FAILED records)

All output is JSON. Errors go to stdout as JSON with an "error" key.
stderr is reserved for optional diagnostic logging only.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from datetime import UTC, date, datetime

from galecore_ai.adapters.record_store import (
    FileRecordStore,
    RecordStoreError,
    default_records_dir,
)
from galecore_ai.adapters.snapshot_store import FileSnapshotStore, SnapshotNotFoundError
from galecore_ai.application.accept_interpretation import accept_interpretation
from galecore_ai.application.prepare_gex import PrepareError, prepare_gex_snapshot
from galecore_ai.application.prepare_regime import fetch_regime_facts, prepare_regime_snapshot
from galecore_ai.application.record_regime import (
    RecordError,
    query_records,
    record_accepted,
    record_outcome,
    record_review,
)
from galecore_ai.capabilities.contracts import KNOWN_CAPABILITIES
from galecore_ai.capabilities.dispatcher import CapabilityDispatcher
from galecore_ai.capabilities.registry import CapabilityRegistry
from galecore_ai.contracts.agent_run import RunStatus
from galecore_ai.contracts.prepared_analysis import AcceptanceRequest
from galecore_ai.contracts.regime_record import ReviewVerdict

logger = logging.getLogger(__name__)

_EXIT_SUCCESS = 0
_EXIT_PREPARE_FAILED = 1
_EXIT_INSUFFICIENT_DATA = 2
_EXIT_VALIDATION_ERROR = 3
_EXIT_INTERNAL_ERROR = 1
_EXIT_RECORD_FAILED = 1

_STATUS_EXIT_MAP = {
    RunStatus.SUCCESS: _EXIT_SUCCESS,
    RunStatus.INSUFFICIENT_DATA: _EXIT_INSUFFICIENT_DATA,
    RunStatus.VALIDATION_ERROR: _EXIT_VALIDATION_ERROR,
    RunStatus.MODEL_ERROR: _EXIT_INTERNAL_ERROR,
    RunStatus.TIMEOUT: _EXIT_INTERNAL_ERROR,
    RunStatus.INTERNAL_ERROR: _EXIT_INTERNAL_ERROR,
}

_SKILLS = {"gex": prepare_gex_snapshot, "regime": prepare_regime_snapshot}


def _json_out(data: dict, *, exit_code: int = 0) -> None:
    """Print JSON to stdout and exit."""
    print(json.dumps(data, indent=2, default=str))
    sys.exit(exit_code)


def _error_out(message: str, *, exit_code: int = 1) -> None:
    """Print an error as JSON to stdout and exit."""
    _json_out({"error": message, "timestamp": datetime.now(UTC).isoformat()}, exit_code=exit_code)


class _JsonArgumentParser(argparse.ArgumentParser):
    """ArgumentParser that outputs JSON errors instead of plain-text usage."""

    def error(self, message: str) -> None:  # type: ignore[override]
        _error_out(f"Argument error: {message}", exit_code=_EXIT_VALIDATION_ERROR)


def _build_dispatcher() -> CapabilityDispatcher:
    base_url = os.environ.get("GALECORE_BASE_URL", "http://localhost:5000")
    api_key = os.environ.get("GALECORE_API_KEY")

    local_mode = os.environ.get("LOCAL_VALIDATION", "true").lower() == "true"
    if local_mode:
        from urllib.parse import urlparse
        host = urlparse(base_url).hostname or ""
        if host not in ("localhost", "127.0.0.1", "::1"):
            _error_out(f"LOCAL_VALIDATION=true but host is '{host}'")

    registry = CapabilityRegistry()
    registry.register_many(KNOWN_CAPABILITIES)

    timeout = int(os.environ.get("GALECORE_TIMEOUT_SECONDS", "120"))
    return CapabilityDispatcher(base_url=base_url, registry=registry, api_key=api_key, timeout=timeout)


def _build_store() -> FileSnapshotStore:
    ttl = float(os.environ.get("SNAPSHOT_TTL_SECONDS", "3600"))
    return FileSnapshotStore(ttl_seconds=ttl)


def _build_record_store() -> FileRecordStore:
    try:
        return FileRecordStore(default_records_dir())
    except (RecordStoreError, OSError) as exc:
        _error_out(f"Record store unavailable: {exc}", exit_code=_EXIT_RECORD_FAILED)
        raise AssertionError("unreachable") from exc


def _max_staleness() -> float:
    return float(os.environ.get("MAX_STALENESS_SECONDS", "300"))


def _allow_unknown() -> bool:
    return os.environ.get("ALLOW_UNKNOWN_FRESHNESS", "false").lower() == "true"


def _parse_date(value: str, *, flag: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        _error_out(f"Argument error: {flag} must be YYYY-MM-DD, got {value!r}",
                   exit_code=_EXIT_VALIDATION_ERROR)
        raise AssertionError("unreachable")


async def _cmd_prepare(args: argparse.Namespace) -> None:
    dispatcher = _build_dispatcher()
    store = _build_store()
    prepare = _SKILLS[args.skill]

    try:
        view = await prepare(
            symbol=args.symbol,
            dispatcher=dispatcher,
            store=store,
            max_staleness_seconds=_max_staleness(),
            allow_unknown_freshness=_allow_unknown(),
        )
    except PrepareError as exc:
        _error_out(str(exc), exit_code=_EXIT_PREPARE_FAILED)

    _json_out(view.model_dump(mode="json"))


async def _cmd_accept(args: argparse.Namespace) -> None:
    if args.record and not (args.prompt and args.prompt.strip()):
        _error_out("Argument error: --record requires a non-empty --prompt",
                   exit_code=_EXIT_VALIDATION_ERROR)

    try:
        raw = sys.stdin.read()
    except (OSError, UnicodeDecodeError) as exc:
        _error_out(f"Failed to read stdin: {exc}")
        return  # unreachable but satisfies type checker

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        _error_out(f"Invalid JSON input: {exc}", exit_code=_EXIT_VALIDATION_ERROR)
        return

    if not isinstance(payload, dict):
        _error_out("Input must be a JSON object", exit_code=_EXIT_VALIDATION_ERROR)
        return

    # Require run_id and interpretation
    if "run_id" not in payload or "interpretation" not in payload:
        _error_out(
            "Input must contain 'run_id' and 'interpretation' keys",
            exit_code=_EXIT_VALIDATION_ERROR,
        )
        return

    try:
        request = AcceptanceRequest(
            run_id=payload["run_id"],
            interpretation=payload["interpretation"],
            host_provider=payload.get("host_provider"),
            host_model=payload.get("host_model"),
        )
    except (ValueError, TypeError, KeyError) as exc:
        _error_out(f"Invalid acceptance request: {exc}", exit_code=_EXIT_VALIDATION_ERROR)
        return

    store = _build_store()
    # The record store is resolved before validation so a misconfigured
    # records directory is reported without consuming the run.
    record_store = _build_record_store() if args.record else None

    result = accept_interpretation(
        store=store,
        request=request,
        allow_unknown_freshness=_allow_unknown(),
    )
    out = result.model_dump(mode="json")
    exit_code = _STATUS_EXIT_MAP.get(result.status, _EXIT_INTERNAL_ERROR)

    if record_store is not None and result.status == RunStatus.SUCCESS:
        try:
            snapshot = store.get(request.run_id)
            entry, path = record_accepted(
                store=record_store, snapshot=snapshot, result=result, prompt=args.prompt,
            )
        except (RecordError, SnapshotNotFoundError) as exc:
            out["record"] = {"status": "RECORD_FAILED", "error": str(exc)}
            _json_out(out, exit_code=_EXIT_RECORD_FAILED)
        out["record"] = {
            "status": "RECORDED",
            "path": path,
            "date": path.replace("\\", "/").rsplit("/", 1)[-1].removesuffix(".md"),
            "entry_id": entry.entry_id,
            "entry_hash": entry.entry_hash,
        }
    elif record_store is not None:
        out["record"] = {"status": "NOT_RECORDED", "error": "Only SUCCESS results are recorded"}

    _json_out(out, exit_code=exit_code)


async def _cmd_record_outcome(args: argparse.Namespace) -> None:
    _parse_date(args.date, flag="--date")
    record_store = _build_record_store()
    dispatcher = _build_dispatcher()
    try:
        fetched = await fetch_regime_facts(
            symbol=args.symbol, dispatcher=dispatcher, max_staleness_seconds=_max_staleness(),
        )
    except PrepareError as exc:
        _error_out(f"Outcome fetch failed: {exc}", exit_code=_EXIT_PREPARE_FAILED)
        return
    observed_at = datetime.now(UTC)
    try:
        entry_ids, path = record_outcome(
            store=record_store, symbol=args.symbol, day=args.date, fetched=fetched,
            run_id=args.run_id, observed_at=observed_at,
        )
    except RecordError as exc:
        _error_out(str(exc), exit_code=_EXIT_RECORD_FAILED)
        return
    _json_out({
        "status": "RECORDED", "kind": "outcome", "path": path, "entry_ids": entry_ids,
        "observed_facts": fetched.facts.model_dump(mode="json", exclude_none=True),
        "observed_at": observed_at.isoformat(),
    })


async def _cmd_record_review(args: argparse.Namespace) -> None:
    _parse_date(args.date, flag="--date")
    record_store = _build_record_store()
    reviewed_at = datetime.now(UTC)
    try:
        entry_id, path = record_review(
            store=record_store, symbol=args.symbol, day=args.date, run_id=args.run_id,
            verdict=ReviewVerdict(args.verdict), comment=args.comment, reviewed_at=reviewed_at,
        )
    except RecordError as exc:
        _error_out(str(exc), exit_code=_EXIT_RECORD_FAILED)
        return
    _json_out({
        "status": "RECORDED", "kind": "review", "path": path, "entry_id": entry_id,
        "verdict": args.verdict, "reviewed_at": reviewed_at.isoformat(),
    })


async def _cmd_query(args: argparse.Namespace) -> None:
    since = _parse_date(args.since, flag="--since")
    until = _parse_date(args.until, flag="--until") if args.until else None
    record_store = _build_record_store()
    try:
        records = query_records(store=record_store, symbol=args.symbol, since=since, until=until)
    except RecordError as exc:
        _error_out(str(exc), exit_code=_EXIT_VALIDATION_ERROR)
        return
    failed = [r["date"] for r in records if r["status"] == "INTEGRITY_FAILED"]
    _json_out(
        {
            "symbol": args.symbol.upper(),
            "since": since.isoformat(),
            "until": until.isoformat() if until else None,
            "records_dir": str(record_store.base_dir),
            "count": len(records),
            "integrity_failed": failed,
            "records": records,
            "queried_at": datetime.now(UTC).isoformat(),
        },
        exit_code=_EXIT_VALIDATION_ERROR if failed else _EXIT_SUCCESS,
    )


def main() -> None:
    parser = _JsonArgumentParser(
        prog="galecore-ai-cli",
        description="Interactive host adapter: prepare facts, accept interpretations, keep records",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_prepare = sub.add_parser("prepare", help="Fetch facts and produce a snapshot")
    p_prepare.add_argument("--symbol", required=True, help="Ticker symbol (e.g. SPY)")
    p_prepare.add_argument("--skill", choices=sorted(_SKILLS), default="gex",
                           help="gex (GEX only) or regime (GEX + put skew + VIX/VVIX)")

    p_accept = sub.add_parser("accept", help="Validate interpretation against stored snapshot (stdin)")
    p_accept.add_argument("--record", action="store_true",
                          help="On SUCCESS, append the run to the evaluable record (regime skill)")
    p_accept.add_argument("--prompt", help="What the user asked; required with --record")

    p_record = sub.add_parser("record", help="Append later facts or a human verdict to a record")
    rec_sub = p_record.add_subparsers(dest="record_command", required=True)
    p_outcome = rec_sub.add_parser("outcome", help="Fetch regime facts now and attach them as outcome")
    p_outcome.add_argument("--symbol", required=True)
    p_outcome.add_argument("--date", required=True, help="Record date YYYY-MM-DD")
    p_outcome.add_argument("--run-id", dest="run_id", help="Only this entry (default: all of the day)")
    p_review = rec_sub.add_parser("review", help="Attach the human's verdict to one entry")
    p_review.add_argument("--symbol", required=True)
    p_review.add_argument("--date", required=True, help="Record date YYYY-MM-DD")
    p_review.add_argument("--run-id", dest="run_id", required=True)
    p_review.add_argument("--verdict", required=True, choices=[v.value for v in ReviewVerdict])
    p_review.add_argument("--comment", required=True)

    p_query = sub.add_parser("query", help="Read records back as JSON (no model call)")
    p_query.add_argument("--symbol", required=True)
    p_query.add_argument("--since", required=True, help="YYYY-MM-DD inclusive")
    p_query.add_argument("--until", help="YYYY-MM-DD inclusive")

    args = parser.parse_args()

    try:
        if args.command == "prepare":
            asyncio.run(_cmd_prepare(args))
        elif args.command == "accept":
            asyncio.run(_cmd_accept(args))
        elif args.command == "record" and args.record_command == "outcome":
            asyncio.run(_cmd_record_outcome(args))
        elif args.command == "record" and args.record_command == "review":
            asyncio.run(_cmd_record_review(args))
        elif args.command == "query":
            asyncio.run(_cmd_query(args))
    except SystemExit:
        raise
    except (OSError, ValueError, RuntimeError) as exc:
        _error_out(f"Internal error: {exc}")


if __name__ == "__main__":
    main()
