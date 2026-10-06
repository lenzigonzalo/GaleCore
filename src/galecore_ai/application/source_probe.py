"""Minimal-call probes this repo's code can run: GaleCore and FRED through GaleCore (GC-AI-0012, AC-03; WS-0014).

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

from datetime import UTC, datetime

from galecore_ai.capabilities.dispatcher import CapabilityDispatcher
from galecore_ai.contracts.source_status import (
    AccessState,
    ObservationOrigin,
    SourceStatusObservation,
)

FRED_PROBE_SERIES = "DGS10"  # 10-Year Treasury: stable and light


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


async def probe_fred(dispatcher: CapabilityDispatcher) -> SourceStatusObservation:
    """FRED as GaleCore serves it (macro.fred_series, WS-0014): this code no longer calls FRED nor needs its key."""
    today = datetime.now(UTC).date()
    params = {"SeriesId": FRED_PROBE_SERIES, "From": today.replace(day=1).isoformat()}
    result = await dispatcher.invoke("macro.fred_series", params)
    what = f"macro.fred_series {FRED_PROBE_SERIES} (GaleCore)"
    if result.ok:
        return _observation(AccessState.AVAILABLE, f"{what} respondió en {result.latency_ms} ms")
    error = result.error or ""
    if "HTTP 401" in error or "HTTP 403" in error:
        return _observation(AccessState.DENIED, f"{what}: {error}")
    if "HTTP 429" in error:
        return _observation(AccessState.LIMITED, f"{what}: {error}")
    # 502 = GaleCore responde pero FRED no (o falta FredApi:Key en GaleCore); 404 = GaleCore sin WS-0014.
    return _observation(AccessState.DOWN, f"{what}: {error or 'sin respuesta'}")
