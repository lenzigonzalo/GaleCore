"""Prepare daily-regime facts as an internally-stored snapshot (Phase 4, UC-1).

Fetches GEX, 25-delta put skew and the VIX / VVIX prints from GaleCore
concurrently, validates each, requires the regime cognitive assets, stores
the authoritative snapshot and returns only the view for the host.

Fail-closed: any source that is missing, malformed or stale aborts the whole
preparation; there is no partial regime. Does not invoke a model.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from galecore_ai.adapters.asset_manifest import RequiredAssetError, load_required_assets
from galecore_ai.adapters.snapshot_store import PreparedSnapshotStore
from galecore_ai.application.prepare_gex import PrepareError
from galecore_ai.capabilities.dispatcher import CapabilityDispatcher, CapabilityResult
from galecore_ai.capabilities.gex_mapper import (
    GexMappingError,
    map_to_gex_facts,
    parse_gex_response,
)
from galecore_ai.capabilities.regime_mapper import (
    GEX_CAPABILITY_ID,
    GEX_ENDPOINT,
    PUT_SKEW_CAPABILITY_ID,
    PUT_SKEW_ENDPOINT,
    TRADE_CAPABILITY_ID,
    TRADE_ENDPOINT,
    map_to_regime_facts,
    parse_put_skew_response,
    parse_trade_response,
)
from galecore_ai.contracts.agent_run import CapabilityTrace
from galecore_ai.contracts.gex_analysis import FreshnessStatus
from galecore_ai.contracts.prepared_analysis import (
    PreparedAnalysisView,
    StoredPreparedSnapshot,
    compute_facts_hash,
    seal_snapshot,
    snapshot_to_view,
)
from galecore_ai.contracts.regime_analysis import REGIME_SKILL_ID, RegimeFacts

logger = logging.getLogger(__name__)

_SOURCES: tuple[tuple[str, str, str, str | None], ...] = (
    # key, capability_id, endpoint, fixed symbol (None = requested symbol)
    ("gex", GEX_CAPABILITY_ID, GEX_ENDPOINT, None),
    ("put_skew", PUT_SKEW_CAPABILITY_ID, PUT_SKEW_ENDPOINT, None),
    ("vix", TRADE_CAPABILITY_ID, TRADE_ENDPOINT, "VIX"),
    ("vvix", TRADE_CAPABILITY_ID, TRADE_ENDPOINT, "VVIX"),
)


class RegimeFetch:
    """Facts plus the capability traces of the fetches that produced them."""

    __slots__ = ("facts", "traces")

    def __init__(self, facts: RegimeFacts, traces: list[CapabilityTrace]) -> None:
        self.facts = facts
        self.traces = traces


async def fetch_regime_facts(
    *,
    symbol: str,
    dispatcher: CapabilityDispatcher,
    max_staleness_seconds: float = 300.0,
) -> RegimeFetch:
    """Fetch and map the three regime sources. Raises PrepareError on any failure."""
    results: list[CapabilityResult] = await asyncio.gather(
        *(
            dispatcher.invoke(cap_id, {"symbol": fixed or symbol})
            for _key, cap_id, _endpoint, fixed in _SOURCES
        )
    )
    received_at = datetime.now(tz=UTC)

    traces: list[CapabilityTrace] = []
    by_key: dict[str, CapabilityResult] = {}
    for (key, cap_id, endpoint, _fixed), res in zip(_SOURCES, results, strict=True):
        by_key[key] = res
        traces.append(
            CapabilityTrace(
                capability_id=cap_id,
                endpoint=endpoint,
                transport="REST",
                latency_ms=res.latency_ms,
                outcome="ok" if res.ok else "error",
                error=res.error,
                response_received_at=received_at,
            )
        )

    failed = [f"{key}: {res.error}" for key, res in by_key.items() if not res.ok]
    if failed:
        raise PrepareError("Capability fetch failed: " + "; ".join(failed))

    try:
        gex_dto = parse_gex_response(by_key["gex"].data)
        gex = map_to_gex_facts(
            gex_dto, requested_symbol=symbol, max_staleness_seconds=max_staleness_seconds
        )
        facts = map_to_regime_facts(
            gex=gex,
            put_skew=parse_put_skew_response(by_key["put_skew"].data),
            vix=parse_trade_response(by_key["vix"].data),
            vvix=parse_trade_response(by_key["vvix"].data),
            requested_symbol=symbol,
            received_at={key: received_at for key in by_key},
            max_staleness_seconds=max_staleness_seconds,
        )
    except GexMappingError as exc:
        raise PrepareError(f"Fact validation failed: {exc}") from exc

    return RegimeFetch(facts, traces)


async def prepare_regime_snapshot(
    *,
    symbol: str,
    dispatcher: CapabilityDispatcher,
    store: PreparedSnapshotStore,
    max_staleness_seconds: float = 300.0,
    allow_unknown_freshness: bool = False,
) -> PreparedAnalysisView:
    """Fetch the regime sources, validate, store the snapshot, return the view.

    Raises PrepareError on capability failure, parse error, invalid facts,
    freshness rejection, or missing required assets.
    """
    try:
        assets = load_required_assets((REGIME_SKILL_ID,))
    except RequiredAssetError as exc:
        raise PrepareError(f"Required asset missing: {exc}") from exc

    fetched = await fetch_regime_facts(
        symbol=symbol, dispatcher=dispatcher, max_staleness_seconds=max_staleness_seconds
    )
    facts = fetched.facts

    stale = [k for k, s in facts.sources.items() if s.freshness_status == FreshnessStatus.STALE]
    if stale:
        raise PrepareError(f"Data is stale for source(s) {stale} (max {max_staleness_seconds:.0f}s)")
    if facts.freshness_status == FreshnessStatus.UNKNOWN and not allow_unknown_freshness:
        unknown = [
            k for k, s in facts.sources.items() if s.freshness_status == FreshnessStatus.UNKNOWN
        ]
        raise PrepareError(
            f"Data freshness is UNKNOWN for source(s) {unknown} — fail-closed. "
            "Set allow_unknown_freshness=True to override."
        )

    facts_dict = facts.model_dump(mode="json", exclude_none=True)
    snapshot = StoredPreparedSnapshot(
        symbol=symbol.upper(),
        skill_id=REGIME_SKILL_ID,
        facts=facts_dict,
        facts_hash=compute_facts_hash(facts_dict),
        market_data_as_of=facts.market_data_as_of,
        freshness_status=facts.freshness_status.value,
        freshness_max_age_seconds=max_staleness_seconds,
        capability_trace=fetched.traces[0],
        capability_traces=fetched.traces,
        effective_assets=assets.manifest,
        resolved_conventions=assets.resolved_conventions,
        conventions_hash=assets.conventions_hash,
    )
    snapshot = seal_snapshot(snapshot)
    store.save(snapshot)
    return snapshot_to_view(snapshot)
