"""GexAnalysisRunner — application service for the GEX analysis vertical.

Orchestrates: validate → fetch facts from GaleCore → validate facts → runtime.execute.
This is the layer that connects CapabilityDispatcher to CognitiveRuntime.
The runtime never calls GaleCore directly — this runner does.
"""

from __future__ import annotations

import logging
import math
from datetime import UTC, datetime

from galecore_ai.capabilities.dispatcher import CapabilityDispatcher
from galecore_ai.contracts.agent_run import AgentRunRequest, AgentRunResult, RunStatus, TraceRecord
from galecore_ai.contracts.gex_analysis import GexFacts, GexInterpretation
from galecore_ai.harness.definitions import AgentDefinition
from galecore_ai.harness.runtime import CognitiveRuntime

logger = logging.getLogger(__name__)


class FactValidationError(Exception):
    """Facts from GaleCore failed validation."""

    def __init__(self, message: str, *, field: str | None = None):
        super().__init__(message)
        self.field = field


class GexAnalysisRunner:
    """Fetches GEX facts from GaleCore, validates them, and runs the cognitive pipeline.

    Fail-closed: if facts cannot be fetched or validated, returns INSUFFICIENT_DATA
    with model_called=false and result=null.
    """

    def __init__(
        self,
        *,
        runtime: CognitiveRuntime,
        dispatcher: CapabilityDispatcher,
        max_staleness_seconds: float = 300.0,
    ) -> None:
        self._runtime = runtime
        self._dispatcher = dispatcher
        self._max_staleness = max_staleness_seconds

    async def run(
        self,
        *,
        symbol: str,
        agent_definition: AgentDefinition,
        request: AgentRunRequest | None = None,
    ) -> AgentRunResult:
        """Execute the full GEX analysis vertical for a symbol.

        1. Invoke compute.gamma_exposure capability via GaleCore REST
        2. Validate the response (HTTP ok, payload correct, fields present, values finite)
        3. Build GexFacts from the response
        4. Pass validated facts to CognitiveRuntime
        5. Return AgentRunResult (SUCCESS or INSUFFICIENT_DATA)
        """
        if request is None:
            request = AgentRunRequest(
                task_type="gex_interpretation",
                parameters={"symbol": symbol},
            )

        trace = TraceRecord(started_at=datetime.now(tz=UTC))

        # ── 1. Fetch GEX data from GaleCore ──────────────────────
        cap_result = await self._dispatcher.invoke(
            "compute.gamma_exposure",
            {"symbol": symbol},
            agent_allowed=agent_definition.allowed_capabilities,
        )

        trace.capabilities_invoked.append({
            "capability_id": "compute.gamma_exposure",
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

        # ── 2. Validate and build GexFacts ────────────────────────
        try:
            facts = self._validate_and_build_facts(cap_result.data, symbol)
        except FactValidationError as exc:
            trace.completed_at = datetime.now(tz=UTC)
            trace.error = f"Fact validation failed: {exc}"
            return AgentRunResult(
                run_id=request.run_id,
                status=RunStatus.INSUFFICIENT_DATA,
                error_detail=trace.error,
                trace=trace,
            )

        # ── 3. Run through CognitiveRuntime ───────────────────────
        facts_dict = facts.model_dump(exclude_none=True)

        result = await self._runtime.execute(
            request,
            agent_definition=agent_definition,
            facts=facts_dict,
            output_schema=GexInterpretation,
        )

        # Merge our capability trace into the runtime trace
        for cap_entry in trace.capabilities_invoked:
            result.trace.capabilities_invoked.append(cap_entry)

        return result

    def _validate_and_build_facts(
        self,
        data: dict | list | None,
        symbol: str,
    ) -> GexFacts:
        """Validate raw GaleCore response and build GexFacts.

        Checks:
        - Payload is a dict (not null, not a list)
        - Required fields are present (net_gex, call_gex, put_gex, spot)
        - Values are finite numbers (not NaN, not Inf)
        - Symbol matches request
        - Freshness: market_data_as_of within max_staleness (if present)
        """
        if not isinstance(data, dict):
            raise FactValidationError(
                f"Expected dict payload, got {type(data).__name__}",
                field="payload",
            )

        # Required fields
        required = ["net_gex", "call_gex", "put_gex", "spot"]
        for field in required:
            if field not in data:
                raise FactValidationError(
                    f"Missing required field: {field}",
                    field=field,
                )
            val = data[field]
            if not isinstance(val, (int, float)):
                raise FactValidationError(
                    f"Field '{field}' must be numeric, got {type(val).__name__}",
                    field=field,
                )
            if not math.isfinite(val):
                raise FactValidationError(
                    f"Field '{field}' is not finite: {val}",
                    field=field,
                )

        # Symbol check
        resp_symbol = data.get("symbol", symbol)
        if isinstance(resp_symbol, str) and resp_symbol.upper() != symbol.upper():
            raise FactValidationError(
                f"Symbol mismatch: requested '{symbol}', got '{resp_symbol}'",
                field="symbol",
            )

        # Build facts
        facts = GexFacts(
            symbol=symbol.upper(),
            net_gex=float(data["net_gex"]),
            call_gex=float(data["call_gex"]),
            put_gex=float(data["put_gex"]),
            spot=float(data["spot"]),
            zero_gamma_level=_safe_float(data.get("zero_gamma_level")),
            call_wall=_safe_float(data.get("call_wall")),
            put_wall=_safe_float(data.get("put_wall")),
            expiration=data.get("expiration"),
            dte=data.get("dte"),
        )

        # Freshness check
        as_of_raw = data.get("market_data_as_of") or data.get("as_of")
        if as_of_raw is not None:
            try:
                if isinstance(as_of_raw, str):
                    as_of = datetime.fromisoformat(as_of_raw)
                elif isinstance(as_of_raw, datetime):
                    as_of = as_of_raw
                else:
                    as_of = None

                if as_of is not None:
                    if as_of.tzinfo is None:
                        as_of = as_of.replace(tzinfo=UTC)
                    facts.market_data_as_of = as_of
                    age = (datetime.now(tz=UTC) - as_of).total_seconds()
                    if age > self._max_staleness:
                        raise FactValidationError(
                            f"Data is {age:.0f}s old (max {self._max_staleness:.0f}s)",
                            field="market_data_as_of",
                        )
            except (ValueError, TypeError):
                logger.warning("Could not parse market_data_as_of: %s", as_of_raw)

        return facts


def _safe_float(val: object) -> float | None:
    """Convert to float if numeric, else None."""
    if val is None:
        return None
    if isinstance(val, (int, float)) and math.isfinite(val):
        return float(val)
    return None
