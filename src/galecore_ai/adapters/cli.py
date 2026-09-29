"""CLI JSON adapter — prepare, accept, record and query via stdin/stdout.

Usage:
    python -m galecore_ai.adapters.cli prepare --symbol SPY [--skill gex|regime]
    python -m galecore_ai.adapters.cli accept [--record --prompt "..."] < request.json
    python -m galecore_ai.adapters.cli record outcome --symbol SPY --date YYYY-MM-DD [--run-id ID]
    python -m galecore_ai.adapters.cli record review --symbol SPY --date YYYY-MM-DD --run-id ID \\
        --verdict agree|partial|disagree --comment "..."
    python -m galecore_ai.adapters.cli query --symbol SPY --since YYYY-MM-DD [--until YYYY-MM-DD]
    python -m galecore_ai.adapters.cli catalog
    python -m galecore_ai.adapters.cli kb search [--text "..."] [--kind research|regime|evidence] [--status S] [--symbol SPY]
    python -m galecore_ai.adapters.cli kb show <ref>
    python -m galecore_ai.adapters.cli research save --slug SLUG --prompt "..." [--capability C] < request.json
    python -m galecore_ai.adapters.cli research revise --id ID --reason R --note "..." --prompt "..."         [--capability C] < request.json
    python -m galecore_ai.adapters.cli evidence add --slug SLUG --prompt "..." < request.json
    python -m galecore_ai.adapters.cli sources list
    python -m galecore_ai.adapters.cli sources query --need "TEXT"
    python -m galecore_ai.adapters.cli sources check [--source galecore|fred]
    python -m galecore_ai.adapters.cli sources declare --source ID --state available|denied|limited|down         --note "..." --observed-at ISO8601 --host-model MODEL [--category CAT] [--evidence REF]
    python -m galecore_ai.adapters.cli strategy check --spec PATH < proposal.json
    python -m galecore_ai.adapters.cli strategy save --spec PATH --prompt "..." < request.json
    python -m galecore_ai.adapters.cli strategy approve --ref strategy:NAME/VERSION --spec-hash sha256:...         --owner-words "..." --host-model MODEL
    python -m galecore_ai.adapters.cli strategy deploy-check --ref strategy:NAME/VERSION --galecore-hash sha256:...
    python -m galecore_ai.adapters.cli strategy hash --spec PATH
    python -m galecore_ai.adapters.cli followup run --strategy NAME --prompt "..." --host-model MODEL [--task ID]
    python -m galecore_ai.adapters.cli followup history --strategy NAME [--limit N]
    python -m galecore_ai.adapters.cli task create --id ID --strategy NAME --objective "..." --expected "..."         --source "..." [--source ...] --frequency daily|weekdays|every_minutes [--time HH:MM | --minutes N]         --timezone TZ --prompt "..."
    python -m galecore_ai.adapters.cli task list | status ID | history ID [--limit N] | run ID
    python -m galecore_ai.adapters.cli task set-frequency ID --frequency ... [--time HH:MM | --minutes N] --timezone TZ --prompt "..."
    python -m galecore_ai.adapters.cli task pause|resume|cancel ID --prompt "..."
    python -m galecore_ai.adapters.cli task rebind ID --code-path CHECKOUT --prompt "..."

Exit codes:
    0  SUCCESS
    1  PREPARE_FAILED / RECORD_FAILED / INTERNAL_ERROR
    2  INSUFFICIENT_DATA
    3  VALIDATION_ERROR (also: argument errors, and query with INTEGRITY_FAILED records)

All output is JSON. Errors go to stdout as JSON with an "error" key.
stderr is reserved for optional diagnostic logging only.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from datetime import UTC, date, datetime
from pathlib import Path

from pydantic import ValidationError

from galecore_ai.adapters.knowledge_base import KnowledgeBaseError, knowledge_dir
from galecore_ai.adapters.record_store import (
    FileRecordStore,
    RecordStoreError,
    default_records_dir,
)
from galecore_ai.adapters.research_store import FileResearchStore
from galecore_ai.adapters.snapshot_store import FileSnapshotStore, SnapshotNotFoundError
from galecore_ai.adapters.source_registry_store import SourceRegistryError, load_source_registry
from galecore_ai.adapters.source_status_store import (
    FileSourceStatusStore,
    SourceStatusIntegrityError,
    SourceStatusStoreError,
    default_source_status_dir,
)
from galecore_ai.application.accept_interpretation import accept_interpretation
from galecore_ai.application.knowledge import (
    KnowledgeBase,
    KnowledgeError,
    resolve_ref,
    revise_research,
    save_evidence,
    save_research,
)
from galecore_ai.application.knowledge import search as kb_search
from galecore_ai.application.knowledge import show as kb_show
from galecore_ai.application.prepare_gex import PrepareError, prepare_gex_snapshot
from galecore_ai.application.prepare_regime import fetch_regime_facts, prepare_regime_snapshot
from galecore_ai.application.record_regime import (
    RecordError,
    query_records,
    record_accepted,
    record_outcome,
    record_review,
)
from galecore_ai.application.source_probe import probe_fred, probe_galecore
from galecore_ai.application.source_query import catalog_summary, query_sources
from galecore_ai.application.strategy import (
    approve as strategy_approve,
)
from galecore_ai.application.strategy import (
    check_proposal,
    deploy_check,
    galecore_spec_hash,
    save_proposal,
    strategy_key,
)
from galecore_ai.capabilities.contracts import KNOWN_CAPABILITIES
from galecore_ai.capabilities.dispatcher import CapabilityDispatcher
from galecore_ai.capabilities.registry import CapabilityRegistry
from galecore_ai.contracts.agent_run import RunStatus
from galecore_ai.contracts.evidence import EvidenceContent
from galecore_ai.contracts.prepared_analysis import AcceptanceRequest
from galecore_ai.contracts.regime_record import RecordHost, ReviewVerdict
from galecore_ai.contracts.research import ResearchContent, ResearchStatus, RevisionReason
from galecore_ai.contracts.source_status import (
    AccessState,
    ObservationOrigin,
    SourceStatusDocument,
    SourceStatusObservation,
)
from galecore_ai.contracts.strategy import ProposalContent
from galecore_ai.harness.catalog import CatalogError, describe, load_catalog

logger = logging.getLogger(__name__)

_EXIT_SUCCESS = 0
_EXIT_PREPARE_FAILED = 1
_EXIT_INSUFFICIENT_DATA = 2
_EXIT_VALIDATION_ERROR = 3
_EXIT_INTERNAL_ERROR = 1
_EXIT_RECORD_FAILED = 1

_STATUS_EXIT_MAP = {
    RunStatus.SUCCESS: _EXIT_SUCCESS,
    RunStatus.INSUFFICIENT_DATA: _EXIT_INSUFFICIENT_DATA,
    RunStatus.VALIDATION_ERROR: _EXIT_VALIDATION_ERROR,
    RunStatus.MODEL_ERROR: _EXIT_INTERNAL_ERROR,
    RunStatus.TIMEOUT: _EXIT_INTERNAL_ERROR,
    RunStatus.INTERNAL_ERROR: _EXIT_INTERNAL_ERROR,
}

_SKILLS = {"gex": prepare_gex_snapshot, "regime": prepare_regime_snapshot}


def _read_stdin() -> str:
    """stdin as UTF-8 regardless of the console code page (Windows defaults to cp1252).

    Hosts pipe UTF-8; decoding it with the locale turned accents into mojibake that was
    then hashed and stored (GC-AI-0005, revision 1 of the first real investigation).
    """
    return sys.stdin.buffer.read().decode("utf-8-sig")


def _json_out(data: dict, *, exit_code: int = 0) -> None:
    """Print JSON to stdout and exit."""
    print(json.dumps(data, indent=2, default=str))
    sys.exit(exit_code)


def _error_out(message: str, *, exit_code: int = 1) -> None:
    """Print an error as JSON to stdout and exit."""
    _json_out({"error": message, "timestamp": datetime.now(UTC).isoformat()}, exit_code=exit_code)


class _JsonArgumentParser(argparse.ArgumentParser):
    """ArgumentParser that outputs JSON errors instead of plain-text usage."""

    def error(self, message: str) -> None:  # type: ignore[override]
        _error_out(f"Argument error: {message}", exit_code=_EXIT_VALIDATION_ERROR)


def _build_dispatcher() -> CapabilityDispatcher:
    base_url = os.environ.get("GALECORE_BASE_URL", "http://localhost:5000")
    api_key = os.environ.get("GALECORE_API_KEY")

    local_mode = os.environ.get("LOCAL_VALIDATION", "true").lower() == "true"
    if local_mode:
        from urllib.parse import urlparse
        host = urlparse(base_url).hostname or ""
        if host not in ("localhost", "127.0.0.1", "::1"):
            _error_out(f"LOCAL_VALIDATION=true but host is '{host}'")

    registry = CapabilityRegistry()
    registry.register_many(KNOWN_CAPABILITIES)

    timeout = int(os.environ.get("GALECORE_TIMEOUT_SECONDS", "120"))
    return CapabilityDispatcher(base_url=base_url, registry=registry, api_key=api_key, timeout=timeout)


def _build_store() -> FileSnapshotStore:
    ttl = float(os.environ.get("SNAPSHOT_TTL_SECONDS", "3600"))
    return FileSnapshotStore(ttl_seconds=ttl)


def _build_record_store() -> FileRecordStore:
    try:
        return FileRecordStore(default_records_dir())
    except (RecordStoreError, OSError) as exc:
        _error_out(f"Record store unavailable: {exc}", exit_code=_EXIT_RECORD_FAILED)
        raise AssertionError("unreachable") from exc


def _build_source_status_store() -> FileSourceStatusStore:
    try:
        return FileSourceStatusStore(default_source_status_dir())
    except (SourceStatusStoreError, OSError) as exc:
        _error_out(f"Source status store unavailable: {exc}", exit_code=_EXIT_RECORD_FAILED)
        raise AssertionError("unreachable") from exc


def _max_staleness() -> float:
    return float(os.environ.get("MAX_STALENESS_SECONDS", "300"))


def _allow_unknown() -> bool:
    return os.environ.get("ALLOW_UNKNOWN_FRESHNESS", "false").lower() == "true"


def _parse_date(value: str, *, flag: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        _error_out(f"Argument error: {flag} must be YYYY-MM-DD, got {value!r}",
                   exit_code=_EXIT_VALIDATION_ERROR)
        raise AssertionError("unreachable")


async def _cmd_prepare(args: argparse.Namespace) -> None:
    dispatcher = _build_dispatcher()
    store = _build_store()
    prepare = _SKILLS[args.skill]

    try:
        view = await prepare(
            symbol=args.symbol,
            dispatcher=dispatcher,
            store=store,
            max_staleness_seconds=_max_staleness(),
            allow_unknown_freshness=_allow_unknown(),
        )
    except PrepareError as exc:
        _error_out(str(exc), exit_code=_EXIT_PREPARE_FAILED)

    _json_out(view.model_dump(mode="json"))


async def _cmd_accept(args: argparse.Namespace) -> None:
    if args.record and not (args.prompt and args.prompt.strip()):
        _error_out("Argument error: --record requires a non-empty --prompt",
                   exit_code=_EXIT_VALIDATION_ERROR)

    try:
        raw = _read_stdin()
    except (OSError, UnicodeDecodeError) as exc:
        _error_out(f"Failed to read stdin: {exc}")
        return  # unreachable but satisfies type checker

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        _error_out(f"Invalid JSON input: {exc}", exit_code=_EXIT_VALIDATION_ERROR)
        return

    if not isinstance(payload, dict):
        _error_out("Input must be a JSON object", exit_code=_EXIT_VALIDATION_ERROR)
        return

    # Require run_id and interpretation
    if "run_id" not in payload or "interpretation" not in payload:
        _error_out(
            "Input must contain 'run_id' and 'interpretation' keys",
            exit_code=_EXIT_VALIDATION_ERROR,
        )
        return

    try:
        request = AcceptanceRequest(
            run_id=payload["run_id"],
            interpretation=payload["interpretation"],
            host_provider=payload.get("host_provider"),
            host_model=payload.get("host_model"),
        )
    except (ValueError, TypeError, KeyError) as exc:
        _error_out(f"Invalid acceptance request: {exc}", exit_code=_EXIT_VALIDATION_ERROR)
        return

    store = _build_store()
    # The record store is resolved before validation so a misconfigured
    # records directory is reported without consuming the run.
    record_store = _build_record_store() if args.record else None

    result = accept_interpretation(
        store=store,
        request=request,
        allow_unknown_freshness=_allow_unknown(),
    )
    out = result.model_dump(mode="json")
    exit_code = _STATUS_EXIT_MAP.get(result.status, _EXIT_INTERNAL_ERROR)

    if record_store is not None and result.status == RunStatus.SUCCESS:
        try:
            snapshot = store.get(request.run_id)
            entry, path = record_accepted(
                store=record_store, snapshot=snapshot, result=result, prompt=args.prompt,
            )
        except (RecordError, SnapshotNotFoundError) as exc:
            out["record"] = {"status": "RECORD_FAILED", "error": str(exc)}
            _json_out(out, exit_code=_EXIT_RECORD_FAILED)
        out["record"] = {
            "status": "RECORDED",
            "path": path,
            "date": path.replace("\\", "/").rsplit("/", 1)[-1].removesuffix(".md"),
            "entry_id": entry.entry_id,
            "entry_hash": entry.entry_hash,
        }
    elif record_store is not None:
        out["record"] = {"status": "NOT_RECORDED", "error": "Only SUCCESS results are recorded"}

    _json_out(out, exit_code=exit_code)


async def _cmd_record_outcome(args: argparse.Namespace) -> None:
    _parse_date(args.date, flag="--date")
    record_store = _build_record_store()
    dispatcher = _build_dispatcher()
    try:
        fetched = await fetch_regime_facts(
            symbol=args.symbol, dispatcher=dispatcher, max_staleness_seconds=_max_staleness(),
        )
    except PrepareError as exc:
        _error_out(f"Outcome fetch failed: {exc}", exit_code=_EXIT_PREPARE_FAILED)
        return
    observed_at = datetime.now(UTC)
    try:
        entry_ids, path = record_outcome(
            store=record_store, symbol=args.symbol, day=args.date, fetched=fetched,
            run_id=args.run_id, observed_at=observed_at,
        )
    except RecordError as exc:
        _error_out(str(exc), exit_code=_EXIT_RECORD_FAILED)
        return
    _json_out({
        "status": "RECORDED", "kind": "outcome", "path": path, "entry_ids": entry_ids,
        "observed_facts": fetched.facts.model_dump(mode="json", exclude_none=True),
        "observed_at": observed_at.isoformat(),
    })


async def _cmd_record_review(args: argparse.Namespace) -> None:
    _parse_date(args.date, flag="--date")
    record_store = _build_record_store()
    reviewed_at = datetime.now(UTC)
    try:
        entry_id, path = record_review(
            store=record_store, symbol=args.symbol, day=args.date, run_id=args.run_id,
            verdict=ReviewVerdict(args.verdict), comment=args.comment, reviewed_at=reviewed_at,
        )
    except RecordError as exc:
        _error_out(str(exc), exit_code=_EXIT_RECORD_FAILED)
        return
    _json_out({
        "status": "RECORDED", "kind": "review", "path": path, "entry_id": entry_id,
        "verdict": args.verdict, "reviewed_at": reviewed_at.isoformat(),
    })


async def _cmd_query(args: argparse.Namespace) -> None:
    since = _parse_date(args.since, flag="--since")
    until = _parse_date(args.until, flag="--until") if args.until else None
    record_store = _build_record_store()
    try:
        records = query_records(store=record_store, symbol=args.symbol, since=since, until=until)
    except RecordError as exc:
        _error_out(str(exc), exit_code=_EXIT_VALIDATION_ERROR)
        return
    failed = [r["date"] for r in records if r["status"] == "INTEGRITY_FAILED"]
    _json_out(
        {
            "symbol": args.symbol.upper(),
            "since": since.isoformat(),
            "until": until.isoformat() if until else None,
            "records_dir": str(record_store.base_dir),
            "count": len(records),
            "integrity_failed": failed,
            "records": records,
            "queried_at": datetime.now(UTC).isoformat(),
        },
        exit_code=_EXIT_VALIDATION_ERROR if failed else _EXIT_SUCCESS,
    )


def _build_knowledge_base() -> KnowledgeBase:
    try:
        base = knowledge_dir()
        return KnowledgeBase(base=base, records=FileRecordStore(default_records_dir()),
                             research=FileResearchStore(base))
    except (KnowledgeBaseError, RecordStoreError, OSError) as exc:
        _error_out(f"Knowledge base unavailable: {exc}", exit_code=_EXIT_RECORD_FAILED)
        raise AssertionError("unreachable") from exc


def _read_research_request() -> tuple[ResearchContent, RecordHost]:
    try:
        payload = json.loads(_read_stdin())
    except (json.JSONDecodeError, OSError, UnicodeDecodeError) as exc:
        _error_out(f"Invalid JSON input: {exc}", exit_code=_EXIT_VALIDATION_ERROR)
        raise AssertionError("unreachable") from exc
    if not isinstance(payload, dict) or "content" not in payload:
        _error_out("Input must be a JSON object with a 'content' key", exit_code=_EXIT_VALIDATION_ERROR)
    try:
        content = ResearchContent.model_validate(payload["content"])
    except ValueError as exc:
        _error_out(f"Invalid research content: {exc}", exit_code=_EXIT_VALIDATION_ERROR)
        raise AssertionError("unreachable") from exc
    host = RecordHost(provider=payload.get("host_provider"), model=payload.get("host_model"))
    return content, host


def _read_evidence_request() -> tuple[EvidenceContent, RecordHost]:
    try:
        payload = json.loads(_read_stdin())
    except (json.JSONDecodeError, OSError, UnicodeDecodeError) as exc:
        _error_out(f"Invalid JSON input: {exc}", exit_code=_EXIT_VALIDATION_ERROR)
        raise AssertionError("unreachable") from exc
    if not isinstance(payload, dict) or "content" not in payload:
        _error_out("Input must be a JSON object with a 'content' key", exit_code=_EXIT_VALIDATION_ERROR)
    try:
        content = EvidenceContent.model_validate(payload["content"])
    except ValueError as exc:
        _error_out(f"Invalid evidence content: {exc}", exit_code=_EXIT_VALIDATION_ERROR)
        raise AssertionError("unreachable") from exc
    host = RecordHost(provider=payload.get("host_provider"), model=payload.get("host_model"))
    return content, host


def _knowledge_error_out(exc: KnowledgeError) -> None:
    _json_out({"status": "REJECTED", "error": str(exc), "problems": exc.problems,
               "timestamp": datetime.now(UTC).isoformat()}, exit_code=_EXIT_VALIDATION_ERROR)


async def _cmd_catalog(args: argparse.Namespace) -> None:
    try:
        catalog = load_catalog()
    except CatalogError as exc:
        _error_out(str(exc), exit_code=_EXIT_INTERNAL_ERROR)
        return
    try:
        kb_status = {"path": str(knowledge_dir()), "available": True}
    except KnowledgeBaseError as exc:
        kb_status = {"available": False, "error": str(exc)}
    entries = describe(catalog)
    _json_out(
        {"catalog_version": catalog.catalog_version, "knowledge_base": kb_status, "entries": entries},
        exit_code=_EXIT_SUCCESS if all(e["available"] for e in entries) else _EXIT_INTERNAL_ERROR,
    )


async def _cmd_kb_search(args: argparse.Namespace) -> None:
    kb = _build_knowledge_base()
    result = kb_search(kb, text=args.text or "", kind=args.kind, status=args.status, symbol=args.symbol)
    result["knowledge_base"] = str(kb.base)
    result["searched_at"] = datetime.now(UTC).isoformat()
    _json_out(result, exit_code=_EXIT_VALIDATION_ERROR if result["integrity_failed"] else _EXIT_SUCCESS)


async def _cmd_kb_show(args: argparse.Namespace) -> None:
    kb = _build_knowledge_base()
    try:
        _json_out(kb_show(kb, args.ref))
    except KnowledgeError as exc:
        _knowledge_error_out(exc)


async def _cmd_research_save(args: argparse.Namespace) -> None:
    kb = _build_knowledge_base()
    content, host = _read_research_request()
    try:
        document, path = save_research(kb=kb, slug=args.slug, prompt=args.prompt, host=host, content=content,
                                       capability=args.capability)
    except KnowledgeError as exc:
        _knowledge_error_out(exc)
        return
    rev = document.current
    _json_out({"status": "RECORDED", "ref": f"research:{document.id}", "path": str(path),
               "revision": rev.revision, "content_hash": rev.content_hash,
               "resolved_refs": [r.model_dump(mode="json") for r in rev.resolved_refs]})


async def _cmd_research_revise(args: argparse.Namespace) -> None:
    kb = _build_knowledge_base()
    content, host = _read_research_request()
    try:
        document, path = revise_research(kb=kb, research_id=args.id, reason=RevisionReason(args.reason),
                                         note=args.note, prompt=args.prompt, host=host, content=content,
                                         capability=args.capability)
    except KnowledgeError as exc:
        _knowledge_error_out(exc)
        return
    rev = document.current
    _json_out({"status": "RECORDED", "ref": f"research:{document.id}", "path": str(path),
               "revision": rev.revision, "reason": rev.reason.value, "content_hash": rev.content_hash,
               "previous_revisions": len(document.revisions) - 1,
               "resolved_refs": [r.model_dump(mode="json") for r in rev.resolved_refs]})


async def _cmd_evidence_add(args: argparse.Namespace) -> None:
    kb = _build_knowledge_base()
    content, host = _read_evidence_request()
    try:
        document, path = save_evidence(kb=kb, slug=args.slug, prompt=args.prompt, host=host, content=content)
    except KnowledgeError as exc:
        _knowledge_error_out(exc)
        return
    _json_out({"status": "RECORDED", "ref": f"evidence:{document.id}", "path": str(path),
               "provenance": document.provenance, "content_hash": document.content_hash})


def _append_observation(store: FileSourceStatusStore, source_id: str,
                        observation: SourceStatusObservation) -> Path:
    existing = store.load(source_id)
    observations = [*(existing.observations if existing else []), observation]
    document = SourceStatusDocument(source_id=source_id, observations=observations)
    return store.append(source_id, document)


def _parse_observed_at(value: str, *, flag: str = "--observed-at") -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        _error_out(f"Argument error: {flag} must be an ISO 8601 UTC timestamp, got {value!r}",
                  exit_code=_EXIT_VALIDATION_ERROR)
        raise AssertionError("unreachable") from None
    if parsed.tzinfo is None:
        _error_out(f"Argument error: {flag} needs a timezone (e.g. a trailing Z)",
                  exit_code=_EXIT_VALIDATION_ERROR)
        raise AssertionError("unreachable")
    return parsed


async def _cmd_sources(args: argparse.Namespace) -> None:
    try:
        registry = load_source_registry()
    except SourceRegistryError as exc:
        _error_out(str(exc), exit_code=_EXIT_INTERNAL_ERROR)
        return
    status_store = _build_source_status_store()

    if args.sources_command == "list":
        summary = catalog_summary(registry, status_store)
        _json_out({"status_dir": str(status_store.base_dir), **summary.model_dump(mode="json")})
        return

    if args.sources_command == "query":
        result = query_sources(args.need, registry, status_store)
        _json_out(result.model_dump(mode="json"),
                  exit_code=_EXIT_INSUFFICIENT_DATA if result.missing else _EXIT_SUCCESS)
        return

    if args.sources_command == "check":
        targets = [args.source] if args.source else ["galecore", "fred"]
        checked = {}
        for source_id in targets:
            source = registry.get(source_id)
            if source is None or source.probe.command is None:
                _error_out(f"{source_id}: not a source this code can probe; use 'sources declare'",
                          exit_code=_EXIT_VALIDATION_ERROR)
                return
            observation = await probe_galecore(_build_dispatcher()) if source_id == "galecore" else probe_fred()
            try:
                path = _append_observation(status_store, source_id, observation)
            except (SourceStatusStoreError, SourceStatusIntegrityError) as exc:
                _error_out(f"{source_id}: {exc}", exit_code=_EXIT_VALIDATION_ERROR)
                return
            checked[source_id] = {"path": str(path), **observation.model_dump(mode="json")}
        _json_out({"checked": checked})
        return

    # declare
    source = registry.get(args.source)
    if source is None:
        _error_out(f"Unknown source: {args.source}", exit_code=_EXIT_VALIDATION_ERROR)
        return
    if source.access_type.value != "host_connector":
        _error_out(f"{args.source}: not a host_connector; run 'sources check' instead",
                   exit_code=_EXIT_VALIDATION_ERROR)
        return
    if args.category is not None and args.category not in {c.category for c in source.covers}:
        _error_out(f"{args.source}: unknown category {args.category!r}; it covers "
                   f"{sorted({c.category for c in source.covers})}", exit_code=_EXIT_VALIDATION_ERROR)
        return
    if args.evidence:
        kb = _build_knowledge_base()
        try:
            resolve_ref(args.evidence, kb)
        except KnowledgeError as exc:
            _knowledge_error_out(exc)
            return
    try:
        observation = SourceStatusObservation(
            observed_at=_parse_observed_at(args.observed_at),
            state=AccessState(args.state),
            origin=ObservationOrigin.HOST_DECLARED,
            note=args.note,
            evidence=args.evidence,
            category=args.category,
            host=RecordHost(provider=args.host_provider, model=args.host_model),
        )
    except ValidationError as exc:
        # Pydantic's default str(exc) echoes the rejected value (input_value=...); a note
        # rejected for carrying a credential must not then leak that credential into the error.
        messages = "; ".join(e["msg"] for e in exc.errors())
        _error_out(f"Invalid observation: {messages}", exit_code=_EXIT_VALIDATION_ERROR)
        return
    try:
        path = _append_observation(status_store, args.source, observation)
    except (SourceStatusStoreError, SourceStatusIntegrityError) as exc:
        _error_out(str(exc), exit_code=_EXIT_VALIDATION_ERROR)
        return
    _json_out({"status": "RECORDED", "source": args.source, "path": str(path),
               **observation.model_dump(mode="json")})


def _read_spec(path: str) -> tuple[str, str]:
    try:
        return Path(path).read_bytes().decode("utf-8-sig"), Path(path).name
    except (OSError, UnicodeDecodeError) as exc:
        _error_out(f"Cannot read spec {path}: {exc}", exit_code=_EXIT_VALIDATION_ERROR)
        raise AssertionError("unreachable") from exc


def _read_proposal_request() -> tuple[ProposalContent, RecordHost]:
    try:
        payload = json.loads(_read_stdin())
    except (json.JSONDecodeError, OSError, UnicodeDecodeError) as exc:
        _error_out(f"Invalid JSON input: {exc}", exit_code=_EXIT_VALIDATION_ERROR)
        raise AssertionError("unreachable") from exc
    if not isinstance(payload, dict) or "content" not in payload:
        _error_out("Input must be a JSON object with a 'content' key", exit_code=_EXIT_VALIDATION_ERROR)
    try:
        content = ProposalContent.model_validate(payload["content"])
    except ValueError as exc:
        _error_out(f"Invalid proposal: {exc}", exit_code=_EXIT_VALIDATION_ERROR)
        raise AssertionError("unreachable") from exc
    return content, RecordHost(provider=payload.get("host_provider"), model=payload.get("host_model"))


async def _cmd_strategy(args: argparse.Namespace) -> None:
    if args.strategy_command == "hash":
        text, name = _read_spec(args.spec)
        _json_out({"spec_file": name, "spec_hash": galecore_spec_hash(text)})
    if args.strategy_command == "check":
        content, _ = _read_proposal_request()
        text, name = _read_spec(args.spec)
        report = check_proposal(content, text, name)
        _json_out({**report.model_dump(mode="json"), "spec_hash": galecore_spec_hash(text)},
                  exit_code=_EXIT_VALIDATION_ERROR if report.verdict == "INVALID" else _EXIT_SUCCESS)
    kb = _build_knowledge_base()
    try:
        if args.strategy_command == "save":
            content, host = _read_proposal_request()
            text, name = _read_spec(args.spec)
            doc, path = save_proposal(kb=kb, prompt=args.prompt, host=host, content=content,
                                      spec_json=text, spec_file=name)
            _json_out({"status": "RECORDED", "ref": f"strategy:{doc.name}/{doc.version}", "path": path,
                       "spec_hash": doc.spec_hash, "check": doc.check.verdict,
                       "declared_gaps": doc.check.declared_gaps, "content_hash": doc.content_hash})
        key = strategy_key(args.ref)
        if args.strategy_command == "approve":
            approval, path = strategy_approve(kb=kb, key=key, spec_hash=args.spec_hash, owner_words=args.owner_words,
                                              host=RecordHost(provider=args.host_provider, model=args.host_model))
            _json_out({"status": "APPROVED", "ref": approval.strategy_ref, "path": path,
                       "spec_hash": approval.spec_hash, "scope": approval.scope,
                       "content_hash": approval.content_hash})
        if args.strategy_command == "deploy-check":
            _json_out(deploy_check(kb=kb, key=key, galecore_hash=args.galecore_hash))
    except KnowledgeError as exc:
        _knowledge_error_out(exc)


async def _cmd_followup(args: argparse.Namespace) -> None:
    from galecore_ai.application.followup import FollowupError, history, run_followup
    kb = _build_knowledge_base()
    try:
        if args.followup_command == "run":
            rec, path = run_followup(kb=kb, strategy=args.strategy, prompt=args.prompt, task_id=args.task,
                                     host=RecordHost(provider=args.host_provider, model=args.host_model))
            _json_out({"status": "RECORDED", "path": str(path), "latest": str(path.parent / "LATEST.md"),
                       **rec.model_dump(mode="json")},
                      exit_code=_EXIT_SUCCESS if rec.status != "ERROR" else _EXIT_RECORD_FAILED)
        records = history(kb, args.strategy, limit=args.limit)
        _json_out({"strategy": args.strategy, "count": len(records),
                   "records": [r.model_dump(mode="json") for r in records]})
    except (FollowupError, KnowledgeError) as exc:
        _json_out({"status": "REJECTED", "error": str(exc)}, exit_code=_EXIT_VALIDATION_ERROR)


async def _cmd_task(args: argparse.Namespace) -> None:
    from galecore_ai.application import tasks as t
    from galecore_ai.contracts.task import Schedule
    kb = _build_knowledge_base()
    sch = t.WindowsScheduler()
    c = args.task_command

    def schedule() -> Schedule:
        return Schedule(frequency=args.frequency, time=args.time, minutes=args.minutes, timezone=args.timezone)
    try:
        if c == "create":
            task = t.create(kb=kb, scheduler=sch, task_id=args.id, strategy=args.strategy, objective=args.objective,
                            expected_result=args.expected, sources=args.source, schedule=schedule(), prompt=args.prompt)
            _json_out({"status": "CREATED", "task": task.model_dump(mode="json"), "schedule": task.schedule.describe(),
                       "scheduler": sch.query(task.scheduler_name)})
        elif c == "list":
            _json_out({"tasks": t.list_tasks(kb)})
        elif c == "status":
            _json_out(t.status(kb=kb, scheduler=sch, task_id=args.id))
        elif c == "history":
            task = t.load(kb, args.id)
            _json_out({"task": args.id, "runs": [r.model_dump(mode="json") for r in t.runs(kb, task, args.limit)],
                       "events": t.events(kb, args.id)[-(args.limit * 4):]})
        elif c == "run":
            _json_out(t.run(kb=kb, task_id=args.id, scheduler=sch))
        elif c == "set-frequency":
            task = t.set_frequency(kb=kb, scheduler=sch, task_id=args.id, schedule=schedule(), prompt=args.prompt)
            _json_out({"status": "CHANGED", "schedule": task.schedule.describe(), "scheduler": sch.query(task.scheduler_name)})
        elif c == "rebind":
            task = t.rebind(kb=kb, scheduler=sch, task_id=args.id, code_path=Path(args.code_path), prompt=args.prompt)
            _json_out({"status": "REBOUND", "code_path": task.code_path, "scheduler": sch.query(task.scheduler_name)})
        else:
            fn = {"pause": t.pause, "resume": t.resume, "cancel": t.cancel}[c]
            task = fn(kb=kb, scheduler=sch, task_id=args.id, prompt=args.prompt)
            _json_out({"status": task.status.upper(), "task": args.id,
                       "scheduler": sch.query(task.scheduler_name) if task.status != "cancelled" else {"registered": False}})
    except (t.TaskError, KnowledgeError, ValueError) as exc:
        _json_out({"status": "REJECTED", "error": str(exc)}, exit_code=_EXIT_VALIDATION_ERROR)


def main() -> None:
    parser = _JsonArgumentParser(
        prog="galecore-ai-cli",
        description="Interactive host adapter: prepare facts, accept interpretations, keep records",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_prepare = sub.add_parser("prepare", help="Fetch facts and produce a snapshot")
    p_prepare.add_argument("--symbol", required=True, help="Ticker symbol (e.g. SPY)")
    p_prepare.add_argument("--skill", choices=sorted(_SKILLS), default="gex",
                           help="gex (GEX only) or regime (GEX + put skew + VIX/VVIX)")

    p_accept = sub.add_parser("accept", help="Validate interpretation against stored snapshot (stdin)")
    p_accept.add_argument("--record", action="store_true",
                          help="On SUCCESS, append the run to the evaluable record (regime skill)")
    p_accept.add_argument("--prompt", help="What the user asked; required with --record")

    p_record = sub.add_parser("record", help="Append later facts or a human verdict to a record")
    rec_sub = p_record.add_subparsers(dest="record_command", required=True)
    p_outcome = rec_sub.add_parser("outcome", help="Fetch regime facts now and attach them as outcome")
    p_outcome.add_argument("--symbol", required=True)
    p_outcome.add_argument("--date", required=True, help="Record date YYYY-MM-DD")
    p_outcome.add_argument("--run-id", dest="run_id", help="Only this entry (default: all of the day)")
    p_review = rec_sub.add_parser("review", help="Attach the human's verdict to one entry")
    p_review.add_argument("--symbol", required=True)
    p_review.add_argument("--date", required=True, help="Record date YYYY-MM-DD")
    p_review.add_argument("--run-id", dest="run_id", required=True)
    p_review.add_argument("--verdict", required=True, choices=[v.value for v in ReviewVerdict])
    p_review.add_argument("--comment", required=True)

    p_query = sub.add_parser("query", help="Read records back as JSON (no model call)")
    p_query.add_argument("--symbol", required=True)
    p_query.add_argument("--since", required=True, help="YYYY-MM-DD inclusive")
    p_query.add_argument("--until", help="YYYY-MM-DD inclusive")

    sub.add_parser("catalog", help="What the host can ask for: capabilities, skills, flows, controls")

    p_kb = sub.add_parser("kb", help="Search and read the knowledge base (no model call)")
    kb_sub = p_kb.add_subparsers(dest="kb_command", required=True)
    p_search = kb_sub.add_parser("search", help="Items matching the terms, best first")
    p_search.add_argument("--text", help="Terms to look for (empty lists everything)")
    p_search.add_argument("--kind", choices=["research", "regime", "evidence", "strategy"])
    p_search.add_argument("--status", choices=["unfinished", *[s.value for s in ResearchStatus]],
                          help="unfinished = open or test_planned")
    p_search.add_argument("--symbol")
    p_show = kb_sub.add_parser("show", help="One item by reference, with what cites it")
    p_show.add_argument("ref", help="regime:<SYMBOL>/<YYYY-MM-DD>, research:<id>, evidence:<id>, "
                                    "strategy:<name>/<version> or file:<path>")

    p_fu = sub.add_parser("followup", help="What a strategy did in GaleCore, tied to its version (read-only)")
    fu_sub = p_fu.add_subparsers(dest="followup_command", required=True)
    p_fu_run = fu_sub.add_parser("run", help="Read GaleCore now and record the follow-up")
    p_fu_run.add_argument("--strategy", required=True)
    p_fu_run.add_argument("--prompt", required=True, help="What the user asked (or the task objective)")
    p_fu_run.add_argument("--task", help="Recurring task id, when a task runs it")
    p_fu_run.add_argument("--host-provider", dest="host_provider", default="claude-code")
    p_fu_run.add_argument("--host-model", dest="host_model", required=True)
    p_fu_hist = fu_sub.add_parser("history", help="Recorded follow-ups, newest first")
    p_fu_hist.add_argument("--strategy", required=True)
    p_fu_hist.add_argument("--limit", type=int, default=10)

    p_task = sub.add_parser("task", help="Recurring follow-up run by the Windows Task Scheduler (read-only)")
    t_sub = p_task.add_subparsers(dest="task_command", required=True)

    def schedule_args(p):
        p.add_argument("--frequency", required=True, choices=["daily", "weekdays", "every_minutes"])
        p.add_argument("--time", help="HH:MM in --timezone (daily, weekdays)")
        p.add_argument("--minutes", type=int, help="period for every_minutes (15..1440)")
        p.add_argument("--timezone", required=True, help="IANA name, e.g. America/New_York")
        p.add_argument("--prompt", required=True, help="What the user asked")
    p_tc = t_sub.add_parser("create", help="Create and schedule a follow-up task")
    p_tc.add_argument("--id", required=True)
    p_tc.add_argument("--strategy", required=True)
    p_tc.add_argument("--objective", required=True)
    p_tc.add_argument("--expected", required=True, help="What each run must leave")
    p_tc.add_argument("--source", action="append", required=True)
    schedule_args(p_tc)
    t_sub.add_parser("list", help="All tasks")
    for name in ("status", "run"):
        t_sub.add_parser(name).add_argument("id")
    p_th = t_sub.add_parser("history", help="Runs (follow-up records) and events of a task")
    p_th.add_argument("id")
    p_th.add_argument("--limit", type=int, default=10)
    p_tf = t_sub.add_parser("set-frequency", help="Change the schedule")
    p_tf.add_argument("id")
    schedule_args(p_tf)
    p_tr = t_sub.add_parser("rebind", help="Run the task from another checkout, keeping its id and history")
    p_tr.add_argument("id")
    p_tr.add_argument("--code-path", dest="code_path", required=True, help="GaleCore-AI checkout with tools/task_runner.py")
    p_tr.add_argument("--prompt", required=True)
    for name in ("pause", "resume", "cancel"):
        p = t_sub.add_parser(name)
        p.add_argument("id")
        p.add_argument("--prompt", required=True)

    p_strategy = sub.add_parser("strategy", help="Proposal -> spec check -> approval -> deploy check")
    st_sub = p_strategy.add_subparsers(dest="strategy_command", required=True)
    p_st_hash = st_sub.add_parser("hash", help="GaleCore's content_hash of a spec file")
    p_st_hash.add_argument("--spec", required=True)
    p_st_check = st_sub.add_parser("check", help="Check a proposal (stdin) against a spec and the runtime")
    p_st_check.add_argument("--spec", required=True)
    p_st_save = st_sub.add_parser("save", help="Check and store a version (create-only)")
    p_st_save.add_argument("--spec", required=True)
    p_st_save.add_argument("--prompt", required=True, help="What the user asked")
    p_st_approve = st_sub.add_parser("approve", help="Record the owner's approval of an exact version and hash")
    p_st_approve.add_argument("--ref", required=True, help="strategy:<name>/<version>")
    p_st_approve.add_argument("--spec-hash", dest="spec_hash", required=True, help="the hash the owner approved")
    p_st_approve.add_argument("--owner-words", dest="owner_words", required=True,
                              help="the owner's approval, verbatim")
    p_st_approve.add_argument("--host-provider", dest="host_provider", default="claude-code")
    p_st_approve.add_argument("--host-model", dest="host_model", required=True)
    p_st_deploy = st_sub.add_parser("deploy-check", help="Allow a deploy only with an approval of GaleCore's hash")
    p_st_deploy.add_argument("--ref", required=True, help="strategy:<name>/<version>")
    p_st_deploy.add_argument("--galecore-hash", dest="galecore_hash", required=True,
                             help="contentHash that App/Runtime/Specs/<name> reports")

    p_evidence = sub.add_parser("evidence", help="Keep a source response with its provenance (content on stdin)")
    ev_sub = p_evidence.add_subparsers(dest="evidence_command", required=True)
    p_ev_add = ev_sub.add_parser("add", help="Store one response; never overwrites (HOST_DECLARED)")
    p_ev_add.add_argument("--slug", required=True, help="Short name; the id is <date>-<slug>")
    p_ev_add.add_argument("--prompt", required=True, help="What the user asked")

    p_sources = sub.add_parser(
        "sources", help="Data source registry: what's known, its last checked access, and what covers a need")
    src_sub = p_sources.add_subparsers(dest="sources_command", required=True)
    src_sub.add_parser("list", help="Registry grouped by category, with each source's last known status")
    p_src_query = src_sub.add_parser("query", help="Sources covering a need, ordered by preference then cost")
    p_src_query.add_argument("--need", required=True, help="What data is needed, in free text")
    p_src_check = src_sub.add_parser("check", help="Run the minimal probe this code can run (GaleCore, FRED)")
    p_src_check.add_argument("--source", choices=["galecore", "fred"], help="Default: both")
    p_src_declare = src_sub.add_parser("declare", help="Record what the host observed on a host_connector source")
    p_src_declare.add_argument("--source", required=True)
    p_src_declare.add_argument("--state", required=True, choices=[s.value for s in AccessState])
    p_src_declare.add_argument("--note", required=True)
    p_src_declare.add_argument("--observed-at", dest="observed_at", required=True,
                               help="ISO 8601 UTC timestamp of when the access was actually observed "
                                    "(e.g. an evidence item's retrieved_at) — never the time of this command")
    p_src_declare.add_argument("--category", help="the coverage category this observation is about "
                                                   "(default: the whole source)")
    p_src_declare.add_argument("--evidence", help="evidence:<id> or file:<path> backing this observation")
    p_src_declare.add_argument("--host-provider", dest="host_provider", default="claude-code")
    p_src_declare.add_argument("--host-model", dest="host_model", required=True)

    p_research = sub.add_parser("research", help="Save or continue an investigation (content on stdin)")
    res_sub = p_research.add_subparsers(dest="research_command", required=True)
    p_save = res_sub.add_parser("save", help="Start a new investigation")
    p_save.add_argument("--slug", required=True, help="Short name; the id is <date>-<slug>")
    p_save.add_argument("--prompt", required=True, help="What the user asked")
    p_save.add_argument("--capability", default="research",
                        help="Catalog entry whose method was followed (research, context_research)")
    p_revise = res_sub.add_parser("revise", help="Append a revision; earlier ones stay readable")
    p_revise.add_argument("--id", required=True)
    p_revise.add_argument("--reason", required=True,
                          choices=[r.value for r in RevisionReason if r != RevisionReason.INITIAL])
    p_revise.add_argument("--note", required=True, help="What this revision changes")
    p_revise.add_argument("--prompt", required=True, help="What the user asked")
    p_revise.add_argument("--capability", default="research",
                          help="Catalog entry whose method was followed (research, context_research)")

    args = parser.parse_args()

    try:
        if args.command == "prepare":
            asyncio.run(_cmd_prepare(args))
        elif args.command == "accept":
            asyncio.run(_cmd_accept(args))
        elif args.command == "record" and args.record_command == "outcome":
            asyncio.run(_cmd_record_outcome(args))
        elif args.command == "record" and args.record_command == "review":
            asyncio.run(_cmd_record_review(args))
        elif args.command == "query":
            asyncio.run(_cmd_query(args))
        elif args.command == "catalog":
            asyncio.run(_cmd_catalog(args))
        elif args.command == "kb" and args.kb_command == "search":
            asyncio.run(_cmd_kb_search(args))
        elif args.command == "kb" and args.kb_command == "show":
            asyncio.run(_cmd_kb_show(args))
        elif args.command == "research" and args.research_command == "save":
            asyncio.run(_cmd_research_save(args))
        elif args.command == "research" and args.research_command == "revise":
            asyncio.run(_cmd_research_revise(args))
        elif args.command == "evidence" and args.evidence_command == "add":
            asyncio.run(_cmd_evidence_add(args))
        elif args.command == "sources":
            asyncio.run(_cmd_sources(args))
        elif args.command == "strategy":
            asyncio.run(_cmd_strategy(args))
        elif args.command == "followup":
            asyncio.run(_cmd_followup(args))
        elif args.command == "task":
            asyncio.run(_cmd_task(args))
    except SystemExit:
        raise
    except (OSError, ValueError, RuntimeError) as exc:
        _error_out(f"Internal error: {exc}")


if __name__ == "__main__":
    main()
