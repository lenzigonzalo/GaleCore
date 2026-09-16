"""CLI JSON adapter — prepare and accept GEX analysis via stdin/stdout.

Usage:
    python -m galecore_ai.adapters.cli prepare --symbol SPY
    python -m galecore_ai.adapters.cli accept < request.json

The prepare command outputs a PreparedSnapshot JSON to stdout.
The accept command reads an AcceptanceRequest + snapshot from stdin,
validates the interpretation, and outputs AgentRunResult JSON to stdout.

Requires GALECORE_BASE_URL for prepare (needs live GaleCore).
Accept is purely deterministic — no network calls.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from datetime import UTC, datetime

from galecore_ai.adapters.asset_manifest import build_asset_manifest
from galecore_ai.application.accept_interpretation import accept_gex_interpretation
from galecore_ai.application.prepare_gex import PrepareError, prepare_gex_snapshot
from galecore_ai.capabilities.contracts import KNOWN_CAPABILITIES
from galecore_ai.capabilities.dispatcher import CapabilityDispatcher
from galecore_ai.capabilities.registry import CapabilityRegistry
from galecore_ai.contracts.prepared_analysis import AcceptanceRequest, PreparedSnapshot

logger = logging.getLogger(__name__)


def _build_dispatcher() -> CapabilityDispatcher:
    base_url = os.environ.get("GALECORE_BASE_URL", "http://localhost:5000")
    api_key = os.environ.get("GALECORE_API_KEY")

    local_mode = os.environ.get("LOCAL_VALIDATION", "true").lower() == "true"
    if local_mode:
        from urllib.parse import urlparse
        host = urlparse(base_url).hostname or ""
        if host not in ("localhost", "127.0.0.1", "::1"):
            print(
                json.dumps({"error": f"LOCAL_VALIDATION=true but host is '{host}'"}),
                file=sys.stderr,
            )
            sys.exit(1)

    registry = CapabilityRegistry()
    registry.register_many(KNOWN_CAPABILITIES)

    timeout = int(os.environ.get("GALECORE_TIMEOUT_SECONDS", "120"))
    return CapabilityDispatcher(base_url=base_url, registry=registry, api_key=api_key, timeout=timeout)


async def _cmd_prepare(args: argparse.Namespace) -> None:
    dispatcher = _build_dispatcher()
    max_staleness = float(os.environ.get("MAX_STALENESS_SECONDS", "300"))
    allow_unknown = os.environ.get("ALLOW_UNKNOWN_FRESHNESS", "false").lower() == "true"

    manifest = build_asset_manifest()

    try:
        snapshot = await prepare_gex_snapshot(
            symbol=args.symbol,
            dispatcher=dispatcher,
            max_staleness_seconds=max_staleness,
            allow_unknown_freshness=allow_unknown,
            effective_assets=manifest,
        )
    except PrepareError as exc:
        output = {
            "error": str(exc),
            "status": "PREPARE_FAILED",
            "symbol": args.symbol,
            "timestamp": datetime.now(UTC).isoformat(),
        }
        print(json.dumps(output, indent=2, default=str))
        sys.exit(1)

    print(json.dumps(snapshot.model_dump(mode="json"), indent=2, default=str))


async def _cmd_accept(args: argparse.Namespace) -> None:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(json.dumps({"error": f"Invalid JSON input: {exc}"}), file=sys.stderr)
        sys.exit(1)

    # Expect { "snapshot": {...}, "interpretation": {...}, ... }
    if "snapshot" not in payload or "interpretation" not in payload:
        print(
            json.dumps({"error": "Input must contain 'snapshot' and 'interpretation' keys"}),
            file=sys.stderr,
        )
        sys.exit(1)

    snapshot = PreparedSnapshot.model_validate(payload["snapshot"])
    request = AcceptanceRequest(
        run_id=snapshot.run_id,
        interpretation=payload["interpretation"],
        host_provider=payload.get("host_provider"),
        host_model=payload.get("host_model"),
    )

    allow_unknown = os.environ.get("ALLOW_UNKNOWN_FRESHNESS", "false").lower() == "true"

    result = accept_gex_interpretation(
        snapshot=snapshot,
        request=request,
        allow_unknown_freshness=allow_unknown,
    )

    print(json.dumps(result.model_dump(mode="json"), indent=2, default=str))


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="galecore-ai-cli",
        description="GEX analysis: prepare snapshot and accept interpretation",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_prepare = sub.add_parser("prepare", help="Fetch GEX and produce snapshot")
    p_prepare.add_argument("--symbol", required=True, help="Ticker symbol (e.g. SPY)")

    sub.add_parser("accept", help="Validate interpretation against snapshot (stdin)")

    args = parser.parse_args()

    if args.command == "prepare":
        asyncio.run(_cmd_prepare(args))
    elif args.command == "accept":
        asyncio.run(_cmd_accept(args))


if __name__ == "__main__":
    main()
