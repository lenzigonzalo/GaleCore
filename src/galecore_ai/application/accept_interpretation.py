"""Accept a host-generated interpretation against a prepared snapshot.

Validates freshness, integrity, and assurance without repeating the original
query or invoking a model. Provenance of host-declared metadata is recorded
but not independently verified.
"""

from __future__ import annotations

from datetime import UTC, datetime

from galecore_ai.application.validate_interpretation import validate_interpretation
from galecore_ai.contracts.agent_run import (
    AgentRunResult,
    FreshnessTrace,
    GuardrailTrace,
    RunStatus,
    TraceRecord,
)
from galecore_ai.contracts.gex_analysis import GexInterpretation
from galecore_ai.contracts.prepared_analysis import (
    AcceptanceRequest,
    PreparedSnapshot,
    compute_facts_hash,
)
from galecore_ai.harness.freshness import freshness_error
from galecore_ai.harness.guardrails import GuardrailRunner


def accept_gex_interpretation(
    *,
    snapshot: PreparedSnapshot,
    request: AcceptanceRequest,
    guardrail_ids: list[str] | None = None,
    guardrail_runner: GuardrailRunner | None = None,
    allow_unknown_freshness: bool = False,
) -> AgentRunResult:
    """Validate a host interpretation against the original snapshot.

    Steps:
      1. Verify run_id matches
      2. Verify facts_hash integrity
      3. Re-check freshness at acceptance time
      4. Run validate_interpretation (schema + guardrails + sign)
      5. Return accepted result + trace
    """
    now = request.accepted_at or datetime.now(UTC)
    trace = TraceRecord(started_at=now)
    trace.capabilities_invoked.append(snapshot.capability_trace)

    # Host metadata is HOST_DECLARED — recorded, not verified
    trace.provider = f"HOST_DECLARED:{request.host_provider}" if request.host_provider else None
    trace.model = f"HOST_DECLARED:{request.host_model}" if request.host_model else None
    trace.model_called = True  # the host called a model, not us

    # ── 1. Run ID match ──────────────────────────────────────────
    if request.run_id != snapshot.run_id:
        trace.error = f"run_id mismatch: request={request.run_id}, snapshot={snapshot.run_id}"
        trace.status = RunStatus.VALIDATION_ERROR.value
        trace.completed_at = now
        return AgentRunResult(
            run_id=request.run_id,
            status=RunStatus.VALIDATION_ERROR,
            error_detail=trace.error,
            trace=trace,
        )

    # ── 2. Facts integrity ───────────────────────────────────────
    current_hash = compute_facts_hash(snapshot.facts)
    if current_hash != snapshot.facts_hash:
        trace.error = "Snapshot facts_hash mismatch — facts may have been tampered"
        trace.status = RunStatus.VALIDATION_ERROR.value
        trace.completed_at = now
        return AgentRunResult(
            run_id=request.run_id,
            status=RunStatus.VALIDATION_ERROR,
            error_detail=trace.error,
            trace=trace,
        )

    # ── 3. Freshness re-check at acceptance time ─────────────────
    market_ts = snapshot.market_data_as_of
    error = freshness_error(
        market_ts,
        max_age_seconds=snapshot.freshness_max_age_seconds,
        now=now,
        allow_unknown=allow_unknown_freshness,
    )
    freshness_age = None
    if market_ts is not None:
        freshness_age = (now - market_ts).total_seconds()

    trace.freshness = FreshnessTrace(
        market_data_as_of=market_ts,
        freshness_status="STALE" if error else snapshot.freshness_status,
        freshness_age_seconds=freshness_age,
    )

    if error:
        trace.error = f"Freshness at acceptance: {error}"
        trace.status = RunStatus.INSUFFICIENT_DATA.value
        trace.completed_at = now
        return AgentRunResult(
            run_id=request.run_id,
            status=RunStatus.INSUFFICIENT_DATA,
            error_detail=trace.error,
            trace=trace,
        )

    # ── 4. Validate interpretation ───────────────────────────────
    ids = guardrail_ids or ["no_invented_numbers", "facts_match_source"]
    validation = validate_interpretation(
        interpretation=request.interpretation,
        facts=snapshot.facts,
        output_schema=GexInterpretation,
        guardrail_ids=ids,
        guardrail_runner=guardrail_runner,
    )

    trace.guardrails_executed = [
        GuardrailTrace(
            guardrail_id=c.guardrail_id,
            passed=c.passed,
            message=c.message,
        )
        for c in validation.checks
    ]

    if not validation.accepted:
        detail = "; ".join(validation.errors)
        trace.error = f"Guardrail failure: {detail}"
        trace.status = RunStatus.VALIDATION_ERROR.value
        trace.completed_at = now
        return AgentRunResult(
            run_id=request.run_id,
            status=RunStatus.VALIDATION_ERROR,
            error_detail=f"Guardrail failure: {detail}",
            trace=trace,
        )

    # ── 5. Accepted ──────────────────────────────────────────────
    trace.status = RunStatus.SUCCESS.value
    trace.completed_at = now

    return AgentRunResult(
        run_id=request.run_id,
        status=RunStatus.SUCCESS,
        result=validation.result,
        trace=trace,
    )
