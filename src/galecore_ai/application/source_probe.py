"""Minimal-call probes this repo's code can run: GaleCore and FRED (GC-AI-0012, AC-03).

Alpha Vantage and FMP have no probe here: they are reached only through the
host's own connectors (MCP tools), which this repo's code cannot call — the
host observes them and records what it saw with ``sources declare``, as
``HOST_DECLARED``.

Each probe function does the smallest call that tells whether the source is
reachable right now, classifies the result into one of the four known states
(available, denied, limited, down) and returns the observation ready to store —
it does not write it; the CLI command decides where and when.
"""

from __future__ import annotations

import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime

from galecore_ai.capabilities.dispatcher import CapabilityDispatcher
from galecore_ai.contracts.source_status import (
    AccessState,
    ObservationOrigin,
    SourceStatusObservation,
)

FRED_BASE = "https://api.stlouisfed.org/fred/"
FRED_PROBE_SERIES = "DGS10"  # 10-Year Treasury: stable, low-volume metadata call
_TIMEOUT_S = 20


def _observation(state: AccessState, note: str) -> SourceStatusObservation:
    return SourceStatusObservation(
        observed_at=datetime.now(UTC),
        state=state,
        origin=ObservationOrigin.CODE_PROBE,
        note=note,
    )


async def probe_galecore(dispatcher: CapabilityDispatcher) -> SourceStatusObservation:
    """GET market_data.trade for SPY: the smallest read GaleCore's API answers."""
    result = await dispatcher.invoke("market_data.trade", {"symbol": "SPY"})
    if result.ok:
        return _observation(AccessState.AVAILABLE, f"market_data.trade SPY respondió en {result.latency_ms} ms")
    error = result.error or ""
    if "HTTP 401" in error or "HTTP 403" in error:
        return _observation(AccessState.DENIED, f"market_data.trade SPY: {error}")
    if "HTTP 429" in error:
        return _observation(AccessState.LIMITED, f"market_data.trade SPY: {error}")
    return _observation(AccessState.DOWN, f"market_data.trade SPY: {error or 'sin respuesta'}")


def probe_fred() -> SourceStatusObservation:
    """GET fred/series metadata for one stable series; the key never leaves this function."""
    key = os.environ.get("FRED_API_KEY")
    if not key:
        return _observation(AccessState.DENIED, "FRED_API_KEY no está configurada en este entorno")
    query = urllib.parse.urlencode({"series_id": FRED_PROBE_SERIES, "file_type": "json"})
    public_url = f"{FRED_BASE}series?{query}"
    try:
        with urllib.request.urlopen(f"{public_url}&api_key={key}", timeout=_TIMEOUT_S) as resp:
            status = resp.status
    except urllib.error.HTTPError as exc:
        status = exc.code
    except (urllib.error.URLError, TimeoutError) as exc:
        return _observation(AccessState.DOWN, f"fred/series {FRED_PROBE_SERIES}: {exc} ({public_url})")
    if status == 200:
        return _observation(AccessState.AVAILABLE, f"fred/series {FRED_PROBE_SERIES} respondió 200 ({public_url})")
    if status in (400, 401, 403):
        # FRED returns 400 (not 401/403) for a malformed or invalid api_key.
        return _observation(AccessState.DENIED, f"fred/series {FRED_PROBE_SERIES}: HTTP {status} ({public_url})")
    if status == 429:
        return _observation(AccessState.LIMITED, f"fred/series {FRED_PROBE_SERIES}: HTTP {status} ({public_url})")
    return _observation(AccessState.DOWN, f"fred/series {FRED_PROBE_SERIES}: HTTP {status} ({public_url})")
