"""AnalyzeGexUseCase — application service for the GEX analysis vertical.

Orchestrates: fetch from GaleCore → parse DTO → validate → map to GexFacts
→ CognitiveRuntime.execute → return result.

This is NOT a Skill. It is the application-level coordinator that:
1. Invokes GaleCore capabilities via CapabilityDispatcher
2. Parses the response into a typed DTO (GaleCoreGexAnalysisResponse)
3. Validates and maps to internal GexFacts via the mapper
4. Passes validated facts to CognitiveRuntime for cognitive interpretation
5. Returns AgentRunResult with full trace

The Skill (gex_interpretation) lives in skills/ and contains only the
cognitive instructions for the model.
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
from galecore_ai.contracts.agent_run import AgentRunRequest, AgentRunResult, RunStatus, TraceRecord
from galecore_ai.contracts.gex_analysis import FreshnessStatus, GexInterpretation
from galecore_ai.harness.definitions import AgentDefinition
from galecore_ai.harness.runtime import CognitiveRuntime

logger = logging.getLogger(__name__)

# Capability ID for GEX analysis — maps to GET /App/Gex/Analysis
GEX_CAPABILITY_ID = "compute.gex_analysis"


class AnalyzeGexUseCase:
    """Fetches GEX data from GaleCore, validates, and runs cognitive interpretation.

    Fail-closed:
    - Capability fetch failure → INSUFFICIENT_DATA, model not called
    - DTO parse failure → INSUFFICIENT_DATA, model not called
    - Invalid/missing facts → INSUFFICIENT_DATA, model not called
    - Stale data → INSUFFICIENT_DATA, model not called
    - Unknown freshness → INSUFFICIENT_DATA by default (configurable)
    """

    def __init__(
        self,
        *,
        runtime: CognitiveRuntime,
        dispatcher: CapabilityDispatcher,
        max_staleness_seconds: float = 300.0,
        allow_unknown_freshness: bool = False,
    ) -> None:
        self._runtime = runtime
        self._dispatcher = dispatcher
        self._max_staleness = max_staleness_seconds
        self._allow_unknown_freshness = allow_unknown_freshness

    async def run(
        self,
        *,
        symbol: str,
        agent_definition: AgentDefinition,
        request: AgentRunRequest | None = None,
    ) -> AgentRunResult:
        """Execute the full GEX analysis vertical for a symbol."""
        if request is None:
            request = AgentRunRequest(
                task_type="gex_interpretation",
                parameters={"symbol": symbol},
            )

        trace = TraceRecord(started_at=datetime.now(tz=UTC))

        # ── 1. Fetch GEX data from GaleCore ──────────────────────
        cap_result = await self._dispatcher.invoke(
            GEX_CAPABILITY_ID,
            {"symbol": symbol},
            agent_allowed=agent_definition.allowed_capabilities,
        )

        trace.capabilities_invoked.append({
            "capability_id": GEX_CAPABILITY_ID,
            "ok": cap_result.ok,
            "latency_ms": cap_result.latency_ms,
            "error": cap_result.error,
        })

        if not cap_result.ok:
            trace.completed_at = datetime.now(tz=UTC)
            trace.error = f"Capability fetch failed: {cap_result.error}"
            return AgentRunResult(
                run_id=request.run_id,
                status=RunStatus.INSUFFICIENT_DATA,
                error_detail=trace.error,
                trace=trace,
            )

        # ── 2. Parse DTO ─────────────────────────────────────────
        try:
            dto = parse_gex_response(cap_result.data)
        except GexMappingError as exc:
            trace.completed_at = datetime.now(tz=UTC)
            trace.error = f"DTO parse failed: {exc}"
            return AgentRunResult(
                run_id=request.run_id,
                status=RunStatus.INSUFFICIENT_DATA,
                error_detail=trace.error,
                trace=trace,
            )

        # ── 3. Map to GexFacts ────────────────────────────────────
        try:
            facts = map_to_gex_facts(
                dto,
                requested_symbol=symbol,
                max_staleness_seconds=self._max_staleness,
            )
        except GexMappingError as exc:
            trace.completed_at = datetime.now(tz=UTC)
            trace.error = f"Fact validation failed: {exc}"
            return AgentRunResult(
                run_id=request.run_id,
                status=RunStatus.INSUFFICIENT_DATA,
                error_detail=trace.error,
                trace=trace,
            )

        # ── 4. Freshness gate ─────────────────────────────────────
        if facts.freshness_status == FreshnessStatus.STALE:
            trace.completed_at = datetime.now(tz=UTC)
            trace.error = (
                f"Data is stale (freshness_status=STALE, "
                f"market_data_as_of={facts.market_data_as_of})"
            )
            return AgentRunResult(
                run_id=request.run_id,
                status=RunStatus.INSUFFICIENT_DATA,
                error_detail=trace.error,
                trace=trace,
            )

        if facts.freshness_status == FreshnessStatus.UNKNOWN and not self._allow_unknown_freshness:
            trace.completed_at = datetime.now(tz=UTC)
            trace.error = (
                "Data freshness is UNKNOWN (GaleCore did not provide timestamp). "
                "Fail-closed: model not called. Set allow_unknown_freshness=True to override."
            )
            return AgentRunResult(
                run_id=request.run_id,
                status=RunStatus.INSUFFICIENT_DATA,
                error_detail=trace.error,
                trace=trace,
            )

        # ── 5. Run through CognitiveRuntime ───────────────────────
        facts_dict = facts.model_dump(exclude_none=True)

        result = await self._runtime.execute(
            request,
            agent_definition=agent_definition,
            facts=facts_dict,
            output_schema=GexInterpretation,
        )

        # Merge capability trace
        for cap_entry in trace.capabilities_invoked:
            result.trace.capabilities_invoked.append(cap_entry)

        return result
