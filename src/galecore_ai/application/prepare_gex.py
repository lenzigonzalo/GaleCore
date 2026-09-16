"""Prepare GEX facts as an immutable snapshot for deferred acceptance.

Extracts the fetch-parse-map-freshness path from AnalyzeGexUseCase so that
the same validated facts can be accepted later without repeating the query.

Does not invoke a model. Does not require CognitiveRuntime.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from galecore_ai.capabilities.dispatcher import CapabilityDispatcher
from galecore_ai.capabilities.gex_mapper import (
    GexMappingError,
    map_to_gex_facts,
    parse_gex_response,
)
from galecore_ai.contracts.agent_run import CapabilityTrace
from galecore_ai.contracts.gex_analysis import FreshnessStatus
from galecore_ai.contracts.prepared_analysis import (
    AssetManifest,
    PreparedSnapshot,
    compute_facts_hash,
)

logger = logging.getLogger(__name__)

GEX_CAPABILITY_ID = "compute.gex_analysis"
_GEX_ENDPOINT = "/App/Gex/Analysis"


class PrepareError(Exception):
    """Preparation failed — facts cannot be produced."""


async def prepare_gex_snapshot(
    *,
    symbol: str,
    dispatcher: CapabilityDispatcher,
    max_staleness_seconds: float = 300.0,
    allow_unknown_freshness: bool = False,
    effective_assets: AssetManifest | None = None,
) -> PreparedSnapshot:
    """Fetch GEX data from GaleCore and produce an immutable snapshot.

    Raises PrepareError on capability failure, parse error, invalid facts,
    or freshness rejection.
    """
    # ── 1. Fetch from GaleCore ───────────────────────────────────
    cap_result = await dispatcher.invoke(
        GEX_CAPABILITY_ID,
        {"symbol": symbol},
    )

    response_received_at = datetime.now(tz=UTC)
    cap_outcome = "ok" if cap_result.ok else "error"
    cap_trace = CapabilityTrace(
        capability_id=GEX_CAPABILITY_ID,
        endpoint=_GEX_ENDPOINT,
        transport="REST",
        latency_ms=cap_result.latency_ms,
        outcome=cap_outcome,
        error=cap_result.error,
        response_received_at=response_received_at,
    )

    if not cap_result.ok:
        raise PrepareError(f"Capability fetch failed: {cap_result.error}")

    # ── 2. Parse DTO ─────────────────────────────────────────────
    try:
        dto = parse_gex_response(cap_result.data)
    except GexMappingError as exc:
        raise PrepareError(f"DTO parse failed: {exc}") from exc

    # ── 3. Map to GexFacts ───────────────────────────────────────
    try:
        facts = map_to_gex_facts(
            dto,
            requested_symbol=symbol,
            max_staleness_seconds=max_staleness_seconds,
        )
    except GexMappingError as exc:
        raise PrepareError(f"Fact validation failed: {exc}") from exc

    # ── 4. Freshness gate ────────────────────────────────────────
    if facts.freshness_status == FreshnessStatus.STALE:
        raise PrepareError(
            f"Data is stale (market_data_as_of={facts.market_data_as_of})"
        )

    if facts.freshness_status == FreshnessStatus.UNKNOWN and not allow_unknown_freshness:
        raise PrepareError(
            "Data freshness is UNKNOWN — fail-closed. "
            "Set allow_unknown_freshness=True to override."
        )

    # ── 5. Build snapshot ────────────────────────────────────────
    facts_dict = facts.model_dump(mode="json", exclude_none=True)

    return PreparedSnapshot(
        symbol=symbol.upper(),
        facts=facts_dict,
        facts_hash=compute_facts_hash(facts_dict),
        market_data_as_of=facts.market_data_as_of,
        freshness_status=facts.freshness_status.value,
        freshness_max_age_seconds=max_staleness_seconds,
        capability_trace=cap_trace,
        effective_assets=effective_assets or AssetManifest(),
    )
