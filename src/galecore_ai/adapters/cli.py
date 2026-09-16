"""CLI JSON adapter — prepare and accept GEX analysis via stdin/stdout.

Usage:
    python -m galecore_ai.adapters.cli prepare --symbol SPY
    python -m galecore_ai.adapters.cli accept < request.json

Exit codes:
    0  SUCCESS
    1  PREPARE_FAILED / INTERNAL_ERROR
    2  INSUFFICIENT_DATA
    3  VALIDATION_ERROR

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
from datetime import UTC, datetime

from galecore_ai.adapters.snapshot_store import FileSnapshotStore
from galecore_ai.application.accept_interpretation import accept_gex_interpretation
from galecore_ai.application.prepare_gex import PrepareError, prepare_gex_snapshot
from galecore_ai.capabilities.contracts import KNOWN_CAPABILITIES
from galecore_ai.capabilities.dispatcher import CapabilityDispatcher
from galecore_ai.capabilities.registry import CapabilityRegistry
from galecore_ai.contracts.agent_run import RunStatus
from galecore_ai.contracts.prepared_analysis import AcceptanceRequest

logger = logging.getLogger(__name__)

_EXIT_SUCCESS = 0
_EXIT_PREPARE_FAILED = 1
_EXIT_INSUFFICIENT_DATA = 2
_EXIT_VALIDATION_ERROR = 3
_EXIT_INTERNAL_ERROR = 1

_STATUS_EXIT_MAP = {
    RunStatus.SUCCESS: _EXIT_SUCCESS,
    RunStatus.INSUFFICIENT_DATA: _EXIT_INSUFFICIENT_DATA,
    RunStatus.VALIDATION_ERROR: _EXIT_VALIDATION_ERROR,
    RunStatus.MODEL_ERROR: _EXIT_INTERNAL_ERROR,
    RunStatus.TIMEOUT: _EXIT_INTERNAL_ERROR,
    RunStatus.INTERNAL_ERROR: _EXIT_INTERNAL_ERROR,
}


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


async def _cmd_prepare(args: argparse.Namespace) -> None:
    dispatcher = _build_dispatcher()
    store = _build_store()
    max_staleness = float(os.environ.get("MAX_STALENESS_SECONDS", "300"))
    allow_unknown = os.environ.get("ALLOW_UNKNOWN_FRESHNESS", "false").lower() == "true"

    try:
        view = await prepare_gex_snapshot(
            symbol=args.symbol,
            dispatcher=dispatcher,
            store=store,
            max_staleness_seconds=max_staleness,
            allow_unknown_freshness=allow_unknown,
        )
    except PrepareError as exc:
        _error_out(str(exc), exit_code=_EXIT_PREPARE_FAILED)

    _json_out(view.model_dump(mode="json"))


async def _cmd_accept(_args: argparse.Namespace) -> None:
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
    allow_unknown = os.environ.get("ALLOW_UNKNOWN_FRESHNESS", "false").lower() == "true"

    result = accept_gex_interpretation(
        store=store,
        request=request,
        allow_unknown_freshness=allow_unknown,
    )

    exit_code = _STATUS_EXIT_MAP.get(result.status, _EXIT_INTERNAL_ERROR)
    _json_out(result.model_dump(mode="json"), exit_code=exit_code)


def main() -> None:
    parser = _JsonArgumentParser(
        prog="galecore-ai-cli",
        description="GEX analysis: prepare snapshot and accept interpretation",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_prepare = sub.add_parser("prepare", help="Fetch GEX and produce snapshot")
    p_prepare.add_argument("--symbol", required=True, help="Ticker symbol (e.g. SPY)")

    sub.add_parser("accept", help="Validate interpretation against stored snapshot (stdin)")

    args = parser.parse_args()

    try:
        if args.command == "prepare":
            asyncio.run(_cmd_prepare(args))
        elif args.command == "accept":
            asyncio.run(_cmd_accept(args))
    except SystemExit:
        raise
    except (OSError, ValueError, RuntimeError) as exc:
        _error_out(f"Internal error: {exc}")


if __name__ == "__main__":
    main()
