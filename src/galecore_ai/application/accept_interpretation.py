"""Accept a host-generated interpretation against an internally-stored snapshot.

The host sends run_id + interpretation + metadata. The validator recovers
the authoritative snapshot from its own store and uses internal time.

Provenance:
  - facts: GALECORE_VERIFIED (obtained by controlled integration)
  - checks: VALIDATOR_OBSERVED
  - provider/model: HOST_DECLARED
  - model execution: HOST_DECLARED (validator cannot verify the host called a model)
"""

from __future__ import annotations

from datetime import UTC, datetime

from galecore_ai.adapters.snapshot_store import PreparedSnapshotStore, SnapshotNotFoundError
from galecore_ai.application.validate_interpretation import validate_interpretation
from galecore_ai.contracts.agent_run import (
    AgentDefinitionTrace,
    AgentRunResult,
    ConventionTrace,
    FreshnessTrace,
    GuardrailTrace,
    ProtocolTrace,
    RunStatus,
    SkillTrace,
    TraceRecord,
)
from galecore_ai.contracts.gex_analysis import GexInterpretation
from galecore_ai.contracts.prepared_analysis import (
    AcceptanceRequest,
    Provenance,
    StoredPreparedSnapshot,
    compute_conventions_hash,
    compute_facts_hash,
    compute_snapshot_hash,
)
from galecore_ai.contracts.regime_analysis import REGIME_SKILL_ID, RegimeInterpretation
from galecore_ai.harness.freshness import freshness_error
from galecore_ai.harness.guardrails import GuardrailRunner

# Output contract per prepared skill. A snapshot prepared for an unknown skill
# cannot be accepted: there is no schema to validate against.
_OUTPUT_SCHEMAS: dict[str, type] = {
    "gex_interpretation": GexInterpretation,
    REGIME_SKILL_ID: RegimeInterpretation,
}


def _populate_trace_assets(trace: TraceRecord, snapshot: StoredPreparedSnapshot) -> None:
    """Fill trace with asset identity from the internally-stored snapshot."""
    m = snapshot.effective_assets
    trace.agent_definition = AgentDefinitionTrace(
        agent_id=m.agent.asset_id,
        version=m.agent.version,
        content_hash=m.agent.content_hash,
    )
    trace.skills = [
        SkillTrace(skill_id=e.asset_id, version=e.version, content_hash=e.content_hash)
        for e in m.skills.values()
    ]
    trace.protocols = [
        ProtocolTrace(protocol_id=e.asset_id, version=e.version, content_hash=e.content_hash)
        for e in m.protocols.values()
    ]
    trace.conventions = [
        ConventionTrace(convention_id=e.asset_id, version=e.version, content_hash=e.content_hash)
        for e in m.conventions.values()
    ]


class _MalformedFacts(ValueError):
    """The hashed facts carry a value the validator cannot interpret."""


def _hashed_market_ts(facts: dict) -> datetime | None:
    """market_data_as_of as stored inside the hashed facts (ISO string or absent).

    Raises _MalformedFacts instead of a bare ValueError so acceptance records a
    failed snapshot_integrity entry rather than crashing.
    """
    raw = facts.get("market_data_as_of")
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw
    try:
        ts = datetime.fromisoformat(str(raw))
    except (TypeError, ValueError) as exc:
        raise _MalformedFacts(f"facts.market_data_as_of is not an ISO timestamp: {raw!r}") from exc
    return ts if ts.tzinfo is not None else ts.replace(tzinfo=UTC)


def _freshness_status(error: str | None, stored: str) -> str:
    """Trace the observed freshness outcome, not a blanket STALE."""
    if error is None:
        return stored
    if "UNKNOWN" in error:
        return "UNKNOWN"
    if "future" in error:
        return "FUTURE"
    if "policy" in error or "timezone" in error:
        return "INVALID_POLICY"
    return "STALE"


def accept_interpretation(
    *,
    store: PreparedSnapshotStore,
    request: AcceptanceRequest,
    guardrail_ids: list[str] | None = None,
    guardrail_runner: GuardrailRunner | None = None,
    allow_unknown_freshness: bool = False,
) -> AgentRunResult:
    """Validate a host interpretation against the internally-stored snapshot.

    The snapshot's ``skill_id`` selects the output contract (GEX or regime).

    Steps:
      1. Recover snapshot from store by run_id (fail-closed if missing/expired)
      2. Verify facts_hash and conventions_hash integrity
      3. Re-check freshness at acceptance time (internal clock)
      4. Run validate_interpretation (schema + guardrails + sign)
      5. Return accepted result + trace with provenance
    """
    now = datetime.now(UTC)
    trace = TraceRecord(started_at=now)

    # Host metadata is HOST_DECLARED — recorded, not verified
    trace.provider = f"{Provenance.HOST_DECLARED.value}:{request.host_provider}" if request.host_provider else None
    trace.model = f"{Provenance.HOST_DECLARED.value}:{request.host_model}" if request.host_model else None
    # Validator never calls a model in the interactive host path
    trace.validator_called_model = False
    # Host claims about model use are unverifiable — recorded as HOST_DECLARED
    trace.host_model_execution = "HOST_DECLARED"

    # ── 1. Recover snapshot from store ───────────────────────────
    try:
        snapshot = store.get(request.run_id)
    except SnapshotNotFoundError as exc:
        trace.guardrails_executed.append(GuardrailTrace(
            guardrail_id="snapshot_lookup", passed=False, message=str(exc),
        ))
        trace.error = f"Snapshot not found or expired: {exc}"
        trace.status = RunStatus.VALIDATION_ERROR.value
        trace.completed_at = datetime.now(UTC)
        return AgentRunResult(
            run_id=request.run_id,
            status=RunStatus.VALIDATION_ERROR,
            error_detail=trace.error,
            trace=trace,
        )

    # Populate trace from internal snapshot (never from host data)
    trace.facts_hash = snapshot.facts_hash
    trace.conventions_hash = snapshot.conventions_hash
    trace.prepared_at = snapshot.prepared_at
    trace.facts_provenance = Provenance.GALECORE_VERIFIED.value
    trace.capabilities_invoked.extend(snapshot.capability_traces or [snapshot.capability_trace])
    _populate_trace_assets(trace, snapshot)

    # ── 2. Snapshot integrity (facts and conventions) ────────────
    # Both hashes are recomputed from the stored content. A mismatch means
    # the store changed between prepare and accept; no cognitive validation
    # runs on a snapshot whose integrity is not established.
    # The freshness timestamp used for acceptance must be the one inside the
    # hashed facts: the outer snapshot field is convenience metadata and is
    # not covered by facts_hash, so it is only trusted if it equals the hashed one.
    # snapshot_hash covers the acceptance-critical metadata (skill_id, freshness
    # window, assets, capabilities...): an edited store file cannot pick a laxer
    # contract or a wider freshness window than the one prepare sealed.
    integrity_error: str | None = None
    if compute_facts_hash(snapshot.facts) != snapshot.facts_hash:
        integrity_error = "Internal facts_hash mismatch — store may be corrupted"
    elif compute_conventions_hash(snapshot.resolved_conventions) != snapshot.conventions_hash:
        integrity_error = "Internal conventions_hash mismatch — resolved conventions changed after prepare"
    else:
        try:
            if _hashed_market_ts(snapshot.facts) != snapshot.market_data_as_of:
                integrity_error = (
                    "Internal market_data_as_of mismatch — snapshot metadata disagrees with the hashed facts"
                )
        except _MalformedFacts as exc:
            integrity_error = f"Internal facts malformed — {exc}"
    if integrity_error is None:
        if snapshot.snapshot_hash is None:
            integrity_error = "Internal snapshot_hash missing — snapshot was not sealed at prepare time"
        elif compute_snapshot_hash(snapshot) != snapshot.snapshot_hash:
            integrity_error = "Internal snapshot_hash mismatch — acceptance metadata changed after prepare"
        elif snapshot.skill_id not in snapshot.effective_assets.skills:
            integrity_error = (
                f"Internal skill mismatch — skill_id {snapshot.skill_id!r} is not among the loaded skills "
                f"{sorted(snapshot.effective_assets.skills)}"
            )
    trace.guardrails_executed.append(GuardrailTrace(
        guardrail_id="snapshot_integrity",
        passed=integrity_error is None,
        message=integrity_error or "snapshot_hash, facts_hash and conventions_hash recomputed and match",
    ))
    if integrity_error:
        trace.error = integrity_error
        trace.status = RunStatus.INTERNAL_ERROR.value
        trace.completed_at = datetime.now(UTC)
        return AgentRunResult(
            run_id=request.run_id,
            status=RunStatus.INTERNAL_ERROR,
            error_detail=trace.error,
            trace=trace,
        )

    # Output contract is chosen only after the snapshot metadata is proven intact.
    output_schema = _OUTPUT_SCHEMAS.get(snapshot.skill_id)
    if output_schema is None:
        trace.error = f"No output contract for skill {snapshot.skill_id!r}"
        trace.status = RunStatus.INTERNAL_ERROR.value
        trace.completed_at = datetime.now(UTC)
        return AgentRunResult(
            run_id=request.run_id,
            status=RunStatus.INTERNAL_ERROR,
            error_detail=trace.error,
            trace=trace,
        )

    # ── 3. Freshness re-check at acceptance time (internal clock) ─
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
        freshness_status=_freshness_status(error, snapshot.freshness_status),
        freshness_age_seconds=freshness_age,
    )

    if error:
        trace.error = f"Freshness at acceptance: {error}"
        trace.status = RunStatus.INSUFFICIENT_DATA.value
        trace.completed_at = datetime.now(UTC)
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
        output_schema=output_schema,
        guardrail_ids=ids,
        guardrail_runner=guardrail_runner,
    )

    trace.guardrails_executed.extend(
        GuardrailTrace(
            guardrail_id=c.guardrail_id,
            passed=c.passed,
            message=c.message,
        )
        for c in validation.checks
    )

    if not validation.accepted:
        detail = "; ".join(validation.errors)
        trace.error = f"Guardrail failure: {detail}"
        trace.status = RunStatus.VALIDATION_ERROR.value
        trace.completed_at = datetime.now(UTC)
        return AgentRunResult(
            run_id=request.run_id,
            status=RunStatus.VALIDATION_ERROR,
            error_detail=f"Guardrail failure: {detail}",
            trace=trace,
        )

    # ── 5. Accepted ──────────────────────────────────────────────
    accepted_now = datetime.now(UTC)
    trace.status = RunStatus.SUCCESS.value
    trace.completed_at = accepted_now
    trace.accepted_at = accepted_now

    return AgentRunResult(
        run_id=request.run_id,
        status=RunStatus.SUCCESS,
        result=validation.result,
        trace=trace,
    )


# Historical name of the GEX entry point; the skill is now read from the snapshot.
accept_gex_interpretation = accept_interpretation
