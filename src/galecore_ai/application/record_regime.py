"""Evaluable record use cases (Phase 4): record, outcome, review, query.

``record_accepted`` is only reachable with a SUCCESS result produced by
``accept_interpretation`` in the same process against the stored snapshot;
the CLI exposes it as ``accept --record`` so a host cannot hand in a payload
that was never accepted. Later steps append to an entry and never touch the
hashed part. ``query_records`` reads without calling a model and reports a
tampered or corrupt file as ``INTEGRITY_FAILED``.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from galecore_ai.adapters.record_store import (
    FileRecordStore,
    RecordIntegrityError,
    RecordStoreError,
)
from galecore_ai.application.prepare_regime import RegimeFetch
from galecore_ai.contracts.agent_run import AgentRunResult, RunStatus
from galecore_ai.contracts.gex_analysis import FreshnessStatus
from galecore_ai.contracts.prepared_analysis import (
    Provenance,
    StoredPreparedSnapshot,
    compute_facts_hash,
)
from galecore_ai.contracts.regime_analysis import REGIME_SKILL_ID
from galecore_ai.contracts.regime_record import (
    HumanReview,
    RecordHost,
    RecordOutcome,
    RecordRequest,
    RecordSnapshotIdentity,
    RecordTraceSummary,
    RegimeRecordDocument,
    RegimeRecordEntry,
    ReviewVerdict,
    compute_entry_hash,
)


class RecordError(Exception):
    """The record step cannot proceed (fail-closed)."""


def record_date_for(prepared_at: datetime, timezone: str) -> str:
    """Trading-day date of a snapshot in the convention timezone (YYYY-MM-DD)."""
    try:
        tz = ZoneInfo(timezone)
    except (KeyError, ValueError) as exc:
        raise RecordError(f"Unknown convention timezone {timezone!r}") from exc
    return prepared_at.astimezone(tz).date().isoformat()


def _strip_host_declared(value: str | None) -> str | None:
    if value is None:
        return None
    prefix = Provenance.HOST_DECLARED.value + ":"
    return value.removeprefix(prefix)


def record_accepted(
    *,
    store: FileRecordStore,
    snapshot: StoredPreparedSnapshot,
    result: AgentRunResult,
    prompt: str,
) -> tuple[RegimeRecordEntry, str]:
    """Append an accepted regime run to the day's record. Returns (entry, path)."""
    if snapshot.skill_id != REGIME_SKILL_ID:
        raise RecordError(f"Only {REGIME_SKILL_ID} runs are recorded, got {snapshot.skill_id!r}")
    if result.status != RunStatus.SUCCESS or result.result is None:
        raise RecordError(f"Only SUCCESS results are recorded, got {result.status.value}")
    if result.run_id != snapshot.run_id or result.trace.facts_hash != snapshot.facts_hash:
        raise RecordError("Result does not belong to the stored snapshot")
    if result.trace.accepted_at is None or result.trace.facts_provenance is None:
        raise RecordError("Result trace is incomplete (accepted_at / facts_provenance)")
    if not prompt.strip():
        raise RecordError("A non-empty prompt is required to record a run")

    timezone = str(snapshot.resolved_conventions.get("timezone", "UTC"))
    day = record_date_for(snapshot.prepared_at, timezone)

    entry = RegimeRecordEntry(
        entry_id=snapshot.run_id,
        recorded_at=datetime.now(UTC),
        request=RecordRequest(prompt=prompt.strip(), symbol=snapshot.symbol, skill_id=snapshot.skill_id),
        snapshot=RecordSnapshotIdentity(
            run_id=snapshot.run_id,
            prepared_at=snapshot.prepared_at,
            facts_hash=snapshot.facts_hash,
            conventions_hash=snapshot.conventions_hash,
            market_data_as_of=snapshot.market_data_as_of,
            freshness_status=snapshot.freshness_status,
        ),
        facts=snapshot.facts,
        effective_assets=snapshot.effective_assets,
        host=RecordHost(
            provider=_strip_host_declared(result.trace.provider),
            model=_strip_host_declared(result.trace.model),
        ),
        accepted_payload=result.result,
        trace=RecordTraceSummary(
            trace_id=result.trace.trace_id,
            accepted_at=result.trace.accepted_at,
            facts_provenance=result.trace.facts_provenance,
            guardrails=list(result.trace.guardrails_executed),
            capabilities=list(result.trace.capabilities_invoked),
        ),
        entry_hash="sha256:" + "0" * 64,  # placeholder, replaced below
    )
    entry = entry.model_copy(update={"entry_hash": compute_entry_hash(entry.hashable_content())})

    try:
        document = store.load(snapshot.symbol, day)
    except RecordIntegrityError as exc:
        raise RecordError(f"Existing record cannot be trusted; not appending: {exc}") from exc
    if document is None:
        document = RegimeRecordDocument(symbol=snapshot.symbol, date=day)
    if any(e.entry_id == entry.entry_id for e in document.entries):
        raise RecordError(f"run_id {entry.entry_id} is already recorded for {snapshot.symbol} {day}")
    document.entries.append(entry)
    try:
        path = store.save(document)
    except (RecordStoreError, OSError) as exc:
        raise RecordError(f"Record write failed: {exc}") from exc
    return entry, str(path)


def _load_for_update(store: FileRecordStore, symbol: str, day: str) -> RegimeRecordDocument:
    try:
        document = store.load(symbol, day)
    except (RecordIntegrityError, RecordStoreError) as exc:
        raise RecordError(f"Record cannot be trusted; not modifying: {exc}") from exc
    if document is None:
        raise RecordError(f"No record for {symbol.upper()} on {day}")
    return document


def _select_entries(document: RegimeRecordDocument, run_id: str | None) -> list[RegimeRecordEntry]:
    if run_id is None:
        return list(document.entries)
    selected = [e for e in document.entries if e.entry_id == run_id]
    if not selected:
        raise RecordError(f"run_id {run_id} not found in {document.symbol} {document.date}")
    return selected


def record_outcome(
    *,
    store: FileRecordStore,
    symbol: str,
    day: str,
    fetched: RegimeFetch,
    run_id: str | None = None,
) -> tuple[list[str], str]:
    """Append a later observation (facts fetched now) to the day's entries.

    Fail-closed like prepare: a STALE source is rejected, not recorded with a label.
    UNKNOWN (PutSkew has no timestamp) is accepted and stays visible per source.
    """
    document = _load_for_update(store, symbol, day)
    stale = [k for k, s in fetched.facts.sources.items() if s.freshness_status == FreshnessStatus.STALE]
    if stale:
        raise RecordError(f"Outcome facts are stale for source(s) {stale}; nothing recorded")
    facts = fetched.facts.model_dump(mode="json", exclude_none=True)
    outcome = RecordOutcome(
        observed_at=datetime.now(UTC),
        facts=facts,
        facts_hash=compute_facts_hash(facts),
        facts_provenance=Provenance.GALECORE_VERIFIED.value,
        capabilities=list(fetched.traces),
    )
    targets = _select_entries(document, run_id)
    for entry in targets:
        entry.outcomes.append(outcome)
    try:
        path = store.save(document)
    except (RecordStoreError, OSError) as exc:
        raise RecordError(f"Record write failed: {exc}") from exc
    return [e.entry_id for e in targets], str(path)


def record_review(
    *,
    store: FileRecordStore,
    symbol: str,
    day: str,
    run_id: str,
    verdict: ReviewVerdict,
    comment: str,
) -> tuple[str, str]:
    """Append the human's verdict to one entry."""
    if not comment.strip():
        raise RecordError("A non-empty comment is required for a review")
    document = _load_for_update(store, symbol, day)
    entry = _select_entries(document, run_id)[0]
    entry.human_reviews.append(
        HumanReview(reviewed_at=datetime.now(UTC), verdict=verdict, comment=comment.strip())
    )
    try:
        path = store.save(document)
    except (RecordStoreError, OSError) as exc:
        raise RecordError(f"Record write failed: {exc}") from exc
    return entry.entry_id, str(path)


def query_records(
    *,
    store: FileRecordStore,
    symbol: str,
    since: date,
    until: date | None = None,
) -> list[dict]:
    """Records of ``symbol`` between ``since`` and ``until`` (inclusive), oldest first.

    Each item is either ``{"date", "status": "OK", "entries": [...]}`` or
    ``{"date", "status": "INTEGRITY_FAILED", "problems": [...]}``. Nothing is
    skipped silently and no model is called.
    """
    items: list[dict] = []
    try:
        days = store.dates(symbol)
    except RecordStoreError as exc:
        raise RecordError(str(exc)) from exc
    for day in days:
        d = date.fromisoformat(day)
        if d < since or (until is not None and d > until):
            continue
        try:
            document = store.load(symbol, day)
        except RecordIntegrityError as exc:
            items.append({
                "date": day, "status": "INTEGRITY_FAILED",
                "path": str(exc.path), "problems": exc.problems,
            })
            continue
        except RecordStoreError as exc:
            raise RecordError(str(exc)) from exc
        if document is None:
            continue
        items.append({
            "date": day,
            "status": "OK",
            "path": str(store.path_for(symbol, day)),
            "entries": [
                {
                    "run_id": e.entry_id,
                    "prompt": e.request.prompt,
                    "accepted_at": e.trace.accepted_at.isoformat(),
                    "facts_hash": e.snapshot.facts_hash,
                    "facts": e.facts,
                    "host": e.host.model_dump(mode="json"),
                    "accepted_payload": e.accepted_payload,
                    "outcomes": [o.model_dump(mode="json") for o in e.outcomes],
                    "human_reviews": [r.model_dump(mode="json") for r in e.human_reviews],
                }
                for e in document.entries
            ],
        })
    return items
