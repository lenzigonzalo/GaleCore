"""CLI JSON adapter — prepare, accept, record and query via stdin/stdout.

Usage:
    python -m galecore_ai.adapters.cli prepare --symbol SPY [--skill gex|regime]
    python -m galecore_ai.adapters.cli accept [--record --prompt "..."] < request.json
    python -m galecore_ai.adapters.cli record outcome --symbol SPY --date YYYY-MM-DD [--run-id ID]
    python -m galecore_ai.adapters.cli record review --symbol SPY --date YYYY-MM-DD --run-id ID \\
        --verdict agree|partial|disagree --comment "..."
    python -m galecore_ai.adapters.cli query --symbol SPY --since YYYY-MM-DD [--until YYYY-MM-DD]
    python -m galecore_ai.adapters.cli catalog
    python -m galecore_ai.adapters.cli kb search [--text "..."] [--kind research|regime|evidence|strategy|profile|feedback]         [--status S] [--symbol SPY]
    python -m galecore_ai.adapters.cli kb show <ref>
    python -m galecore_ai.adapters.cli research save --slug SLUG --prompt "..." [--capability C] < request.json
    python -m galecore_ai.adapters.cli research revise --id ID --reason R --note "..." --prompt "..."         [--capability C] < request.json
    python -m galecore_ai.adapters.cli evidence add --slug SLUG --prompt "..." < request.json
    python -m galecore_ai.adapters.cli feedback add --research research:ID --revision N --classification case|preference|method         --slug SLUG --prompt "..." < request.json
    python -m galecore_ai.adapters.cli feedback list [--status pending|applied]
    python -m galecore_ai.adapters.cli sources list
    python -m galecore_ai.adapters.cli sources query --need "TEXT"
    python -m galecore_ai.adapters.cli sources check [--source galecore|fred]
    python -m galecore_ai.adapters.cli sources declare --source ID --state available|denied|limited|down         --note "..." --observed-at ISO8601 --host-model MODEL [--category CAT] [--evidence REF]
    python -m galecore_ai.adapters.cli strategy check --spec PATH < proposal.json
    python -m galecore_ai.adapters.cli strategy save --spec PATH --prompt "..." < request.json
    python -m galecore_ai.adapters.cli strategy approve --ref strategy:NAME/VERSION [--spec-hash sha256:...]         --owner-words "..." --host-model MODEL
    python -m galecore_ai.adapters.cli strategy install-spec --ref strategy:NAME/VERSION
    python -m galecore_ai.adapters.cli strategy critique --ref strategy:NAME/VERSION < critique.json
    python -m galecore_ai.adapters.cli strategy sheet --ref strategy:NAME/VERSION
    python -m galecore_ai.adapters.cli strategy diff --from strategy:NAME/OLD --ref strategy:NAME/NEW
    python -m galecore_ai.adapters.cli strategy deploy-check --ref strategy:NAME/VERSION [--galecore-hash sha256:...]
    python -m galecore_ai.adapters.cli strategy hash --spec PATH
    python -m galecore_ai.adapters.cli followup run --strategy NAME --prompt "..." --host-model MODEL [--task ID]
    python -m galecore_ai.adapters.cli followup history --strategy NAME [--limit N]
    python -m galecore_ai.adapters.cli analyze pack --kind macro|technical|fundamental|flow [--symbol SYM] --prompt "..."
    python -m galecore_ai.adapters.cli galecore list | get CAPABILITY --symbol SYM [--param k=v ...] [--out FILE]
    python -m galecore_ai.adapters.cli space context | list [--kind K] | show K/KEY | put K/KEY --title T [--visibility V] [--format F] < content | delete K/KEY | import
    python -m galecore_ai.adapters.cli profile review
    python -m galecore_ai.adapters.cli inbox add --text "..." [--context "..."] [--ref REF] | list [--status S] | show ID
    python -m galecore_ai.adapters.cli inbox resolve ID --to roadmap|backlog:BL-NNN|work-item:ID|done|discarded --note "..." --prompt "..."
    python -m galecore_ai.adapters.cli contrast pack [--symbol SPY]
    python -m galecore_ai.adapters.cli clock [--at ISO]
    python -m galecore_ai.adapters.cli gap add --need "..." --kind data|calc|analysis|cross|action|api_error [--why "..."] [--instead "..."] [--project P] | list
    python -m galecore_ai.adapters.cli project show strategy:NAME|portfolio
    python -m galecore_ai.adapters.cli project add NAME|portfolio --kind thesis|story|decision|pending|done --text "..." [--ref REF] [--closes HASH] --prompt "..."
    python -m galecore_ai.adapters.cli task create --id ID [--capability ID] [--result-slug SLUG] --strategy NAME --objective "..." --expected "..."         --source "..." [--source ...] --frequency daily|weekdays|every_minutes [--time HH:MM | --minutes N]         --timezone TZ --prompt "..."
    python -m galecore_ai.adapters.cli task list | status ID | history ID [--limit N] | run ID
    python -m galecore_ai.adapters.cli task set-scan ID --symbols SPY,QQQ --iv-rank-min 30 [--quiet-days 3] | --off --prompt "..."
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

from galecore_ai.adapters.knowledge_base import KnowledgeBaseError, _workspace_root, knowledge_dir
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
from galecore_ai.application.catalog_check import check_catalog, cli_commands
from galecore_ai.application.knowledge import (
    KnowledgeBase,
    KnowledgeError,
    check_feedback_citations,
    feedback_status,
    resolve_ref,
    revise_research,
    save_evidence,
    save_feedback,
    save_mark,
    save_research,
)
from galecore_ai.application.knowledge import search as kb_search
from galecore_ai.application.knowledge import show as kb_show
from galecore_ai.application.prepare_gex import PrepareError, prepare_gex_snapshot
from galecore_ai.application.prepare_regime import fetch_regime_facts, prepare_regime_snapshot
from galecore_ai.application.profile import ProfileError, ProfileUnusable, set_profile
from galecore_ai.application.profile import history as profile_history
from galecore_ai.application.profile import review as profile_review
from galecore_ai.application.profile import show as profile_show
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
    load_proposal,
    save_proposal,
    strategy_key,
)
from galecore_ai.capabilities.contracts import KNOWN_CAPABILITIES
from galecore_ai.capabilities.dispatcher import CapabilityDispatcher
from galecore_ai.capabilities.registry import CapabilityRegistry
from galecore_ai.contracts.agent_run import RunStatus
from galecore_ai.contracts.evidence import EvidenceContent
from galecore_ai.contracts.feedback import FeedbackKind
from galecore_ai.contracts.mark import MarkKind
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


async def _cmd_story(args: argparse.Namespace) -> None:
    """The day's market pack for the market story (GC-AI-0024): gathered by code from GaleCore, kept as evidence."""
    from galecore_ai.application import story

    kb = _build_knowledge_base()
    pack = await story.gather(_build_dispatcher(), symbol=args.symbol.upper())
    if not pack["prices"] and not pack["options"]:
        _json_out({"status": "INSUFFICIENT_DATA", "missing": pack["missing"]}, exit_code=_EXIT_INSUFFICIENT_DATA)
        return
    try:
        ref, pack = story.save_pack(kb, pack, prompt=args.prompt,
                                    host=RecordHost(provider="galecore-ai story pack", model=None))
    except KnowledgeError as exc:
        _knowledge_error_out(exc)
        return
    _json_out({"status": "RECORDED", "ref": ref, "pack": pack})


async def _cmd_analyze(args: argparse.Namespace) -> None:
    """An on-demand analysis pack (P1-05): macro, technical, fundamental or flow, from GaleCore, kept as evidence."""
    from galecore_ai.application import analysis

    kb = _build_knowledge_base()
    pack = await analysis.gather(_build_dispatcher(), args.kind, symbol=args.symbol.upper())
    if not analysis.has_data(pack):
        _json_out({"status": "INSUFFICIENT_DATA", "missing": pack["missing"]}, exit_code=_EXIT_INSUFFICIENT_DATA)
        return
    try:
        ref, pack = analysis.save_pack(kb, pack, prompt=args.prompt,
                                       host=RecordHost(provider="galecore-ai analyze pack", model=None))
    except KnowledgeError as exc:
        _knowledge_error_out(exc)
        return
    _json_out({"status": "RECORDED", "ref": ref, "pack": pack})


async def _cmd_inventory(args: argparse.Namespace) -> None:
    """What the harness has and what it costs: capabilities and consumption, sources, host connectors (GC-AI-0024)."""
    from galecore_ai.application import inventory

    try:
        catalog, registry = load_catalog(), load_source_registry()
    except (CatalogError, SourceRegistryError) as exc:
        _error_out(str(exc), exit_code=_EXIT_INTERNAL_ERROR)
        return
    try:
        kb = KnowledgeBase(base=knowledge_dir(), records=FileRecordStore(default_records_dir()),
                           research=FileResearchStore(knowledge_dir()))
    except (KnowledgeBaseError, RecordStoreError, OSError):
        kb = None                                   # no knowledge base: no consumption to show, the rest still is
    inv = inventory.build(catalog=catalog, registry=registry, status_store=_build_source_status_store(), kb=kb)
    if args.json:
        _json_out(inv)
        return
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # the Windows console is not UTF-8
    print(inventory.render(inv))


async def _cmd_catalog(args: argparse.Namespace) -> None:
    try:
        catalog = load_catalog()
    except CatalogError as exc:
        _error_out(str(exc), exit_code=_EXIT_INTERNAL_ERROR)
        return
    if getattr(args, "match", None):
        from galecore_ai.application.route import match
        _json_out(match(args.match, catalog))
        return
    try:
        kb_status = {"path": str(knowledge_dir()), "available": True}
    except KnowledgeBaseError as exc:
        kb_status = {"available": False, "error": str(exc)}
    if args.check:
        try:
            registry = load_source_registry()
            workspace = _workspace_root(Path(__file__).resolve())
            if workspace is None:
                raise KnowledgeBaseError("Cannot locate the workspace root from this checkout")
        except (SourceRegistryError, KnowledgeBaseError) as exc:
            _error_out(str(exc), exit_code=_EXIT_INTERNAL_ERROR)
            return
        feedback_check = None
        if kb_status["available"]:
            kb = _build_knowledge_base()

            def feedback_check(refs: list[str], skill_id: str, version: str, owner_decision: str) -> list[str]:
                return check_feedback_citations(kb, refs, kind=FeedbackKind.METHOD, skill_id=skill_id,
                                                applied_version=version, owner_decision=owner_decision)
        result = check_catalog(catalog, commands=cli_commands(build_parser()), workspace=workspace,
                               registry=registry, status_store=_build_source_status_store(),
                               feedback_check=feedback_check)
        _json_out(result, exit_code=_EXIT_SUCCESS if result["complete"] else _EXIT_VALIDATION_ERROR)
        return
    entries = describe(catalog)
    _json_out(
        {"catalog_version": catalog.catalog_version, "knowledge_base": kb_status, "entries": entries},
        exit_code=_EXIT_SUCCESS if all(e["available"] for e in entries) else _EXIT_INTERNAL_ERROR,
    )


async def _cmd_kb_search(args: argparse.Namespace) -> None:
    if args.since:
        try:
            args.since = date.fromisoformat(args.since).isoformat()
        except ValueError:
            _error_out(f"--since {args.since!r}: expected YYYY-MM-DD", exit_code=_EXIT_VALIDATION_ERROR)
    kb = _build_knowledge_base()
    result = kb_search(kb, text=args.text or "", kind=args.kind, status=args.status, symbol=args.symbol,
                       include_marked=args.include_marked, since=args.since)
    result["knowledge_base"] = str(kb.base)
    result["searched_at"] = datetime.now(UTC).isoformat()
    _json_out(result, exit_code=_EXIT_VALIDATION_ERROR if result["integrity_failed"] else _EXIT_SUCCESS)


async def _cmd_kb_mark(args: argparse.Namespace) -> None:
    kb = _build_knowledge_base()
    try:
        document, path = save_mark(kb=kb, slug=args.slug, ref=args.ref, mark=MarkKind(args.mark), reason=args.reason,
                                   by=args.by or "", prompt=args.prompt,
                                   host=RecordHost(provider="claude-code", model=args.host_model))
    except KnowledgeError as exc:
        _knowledge_error_out(exc)
        return
    _json_out({"status": "MARKED", "ref": document.ref, "mark": document.mark.value, "by": document.by or None,
               "id": document.id, "path": str(path), "content_hash": document.content_hash})


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


async def _cmd_galecore(args: argparse.Namespace) -> None:
    """Read-only GaleCore data the harness declares (GC-AI-0019): `list` what can be asked, `get` one capability."""
    if args.galecore_command == "list":
        _json_out({"capabilities": [{"id": c.capability_id, "kind": c.semantic_class.value, "what": c.description,
                                     "params": [p.name for p in c.parameters], "returns": c.returns}
                                    for c in KNOWN_CAPABILITIES]})
        return
    params: dict = {"symbol": args.symbol} if args.symbol else {}
    for item in args.param or []:
        key, sep, value = item.partition("=")
        if not sep or not key:
            _error_out(f"--param must be key=value: {item!r}", exit_code=_EXIT_VALIDATION_ERROR)
        params[key] = value
    result = await _build_dispatcher().invoke(args.capability, params)
    if not result.ok:
        from galecore_ai.application import gap_log
        noted = gap_log.add(knowledge_dir(), need=f"Error de API en {args.capability}", kind="api_error",
                            why=str(result.error)[:300], instead="se siguió con lo disponible", project="")
        first_line = str(result.error).strip().splitlines()[0][:300] if result.error else ""   # no stack trace for the host
        _json_out({"capability": args.capability, "ok": False, "error": first_line,
                   "latency_ms": result.latency_ms, "gap": {"id": noted["id"], "count": noted["count"]}}, exit_code=1)
        return
    body = {"capability": args.capability, "ok": True, "params": params, "latency_ms": result.latency_ms,
            "source": "GALECORE_VERIFIED", "retrieved_at": datetime.now(UTC).isoformat()}
    if args.out:   # big answers (a chain is ~1 MB) go to a file; the host reads only what it needs
        out = Path(args.out).resolve()
        run_dir = os.environ.get("GALECORE_AI_RUN_DIR")   # a scheduled run writes only inside its own directory
        if run_dir and not out.is_relative_to(Path(run_dir).resolve()):
            _error_out(f"--out must be inside {run_dir} in a scheduled run", exit_code=_EXIT_VALIDATION_ERROR)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result.data, ensure_ascii=False), encoding="utf-8")
        keys = list(result.data) if isinstance(result.data, dict) else None
        _json_out({**body, "out": str(out), "bytes": out.stat().st_size, "top_level_keys": keys})
    else:
        _json_out({**body, "data": result.data})


async def _cmd_space(args: argparse.Namespace) -> None:
    """The trader's space in GaleCore (GC-AI-0021): read it as the trader, write their pieces, bring the local ones."""
    from galecore_ai.adapters.galecore_space import SpaceClient, SpaceError
    from galecore_ai.application import space

    client = SpaceClient()
    c = args.space_command
    try:
        if c == "context":
            client.login()
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # the Windows console is not UTF-8
            print(space.context(client))
            return
        if c == "list":
            _json_out(client.items(args.kind))
        elif c == "show":
            kind, _, key = args.ref.partition("/")
            data = client.items(kind)
            found = [i for i in data["items"] + data["shared"] if i["key"] == key]
            if not found:
                _error_out(f"no piece {args.ref}", exit_code=_EXIT_VALIDATION_ERROR)
            _json_out({"pieces": found})
        elif c == "put":
            kind, _, key = args.ref.partition("/")
            content = sys.stdin.read()
            _json_out({"status": "SAVED", **client.put(kind, key, title=args.title, content=content, fmt=args.format,
                                                         visibility=args.visibility)})
        elif c == "delete":
            kind, _, key = args.ref.partition("/")
            client.delete(kind, key)
            _json_out({"status": "DELETED", "ref": args.ref})
        elif c == "import":
            from galecore_ai.application.tasks import WindowsScheduler
            kb = _build_knowledge_base()
            pieces, held = space.guard_profile(client, kb, [p for p in space.local_pieces(kb) if p["kind"] != "agent"])
            result = space.sync(client, pieces)
            result["deferred"] = result.get("deferred", []) + held
            agents = space.publish_agents(client, kb, WindowsScheduler())   # agents keep the monitor's requests
            for k in ("created", "updated", "unchanged", "deferred"):
                result[k] = result.get(k, []) + agents[k]
            _json_out({"status": "SYNCED", "user": client.user, "credentials": client.source,
                       "requests": agents["requests"], **result})
        elif c == "pull-profile":
            _json_out(space.pull_profile(client, _build_knowledge_base(),
                                        RecordHost(provider="claude-code", model=args.host_model)))
        elif c == "agents":
            from galecore_ai.application.tasks import (
                SYNC_MINUTES,
                SYNC_TASK,
                WindowsScheduler,
                sync_command,
            )
            if args.install:
                WindowsScheduler().create_every(SYNC_TASK, sync_command(), SYNC_MINUTES)
                _json_out({"status": "INSTALLED", "task": SYNC_TASK, "every_minutes": SYNC_MINUTES})
                return
            result = space.publish_agents(client, _build_knowledge_base(), WindowsScheduler())
            _json_out({"status": "PUBLISHED", "user": client.user, **result})
    except SpaceError as exc:
        _error_out(str(exc), exit_code=1)


def _cmd_clock(args: argparse.Namespace) -> None:
    from galecore_ai.application import market_clock
    at = datetime.fromisoformat(args.at) if args.at else None
    if at is not None and at.tzinfo is None:
        at = at.replace(tzinfo=UTC)
    _json_out(market_clock.status(at).as_dict())


def _cmd_gap(args: argparse.Namespace) -> None:
    from galecore_ai.application import gap_log
    kb = knowledge_dir()
    try:
        if args.gap_command == "add":
            item = gap_log.add(kb, need=args.need, kind=args.kind, why=args.why or "", instead=args.instead or "",
                               project=args.project or "")
            _json_out({"status": "NOTED", "count": item["count"], **gap_log.summary(item)})
        else:
            _json_out({"gaps": [gap_log.summary(i) for i in gap_log.items(kb)]})
    except ValueError as exc:
        _error_out(str(exc), exit_code=3)


async def _cmd_inbox(args: argparse.Namespace) -> None:
    from galecore_ai.application import inbox
    kb = _build_knowledge_base()
    c = args.inbox_command
    try:
        if c == "add":
            item, path = inbox.add(kb=kb, words=args.text, prompt=args.prompt or args.text, context=args.context or "",
                                   refs=args.ref or [], host_model=args.host_model)
            _json_out({"status": "NOTED", "ref": f"inbox:{item.id}", "path": str(path), "words": item.words})
        elif c == "list":
            every, broken = inbox.items(kb)
            listed, _ = inbox.items(kb, args.status) if args.status else (every, broken)
            _json_out({"pending": sum(1 for i in every if i.status == "pending"),
                       "items": [inbox.summary(i) for i in listed], "unreadable": broken},
                      exit_code=_EXIT_VALIDATION_ERROR if broken else _EXIT_SUCCESS)
        elif c == "show":
            item = inbox.load(kb, args.id)
            _json_out(item.model_dump(mode="json") | {"status": item.status})
        else:
            item, path = inbox.resolve(kb=kb, item_id=args.id, to=args.to, note=args.note, prompt=args.prompt)
            _json_out({"status": "RESOLVED", "ref": f"inbox:{item.id}", "to": item.status, "path": str(path),
                       "history": [r.model_dump(mode="json") for r in item.resolutions]})
    except KnowledgeError as exc:
        _knowledge_error_out(exc)


async def _cmd_project(args: argparse.Namespace) -> None:
    from galecore_ai.application import project
    kb = _build_knowledge_base()
    try:
        if args.project_command in ("show", "design"):
            target = args.target
            if args.project_command == "design":
                if not target.startswith("strategy:"):
                    raise KnowledgeError("project design needs strategy:<name>")
                view = project.strategy_design_view(kb, target.split(":", 1)[1])
            elif target == "portfolio":
                state, error = None, None
                try:
                    from galecore_ai.adapters.galecore_space import SpaceClient
                    from galecore_ai.application.space import profile_state
                    state = profile_state(SpaceClient(), kb)
                except Exception as exc:  # noqa: BLE001 - any failure reaching GaleCore is declared, not fatal
                    error = f"{type(exc).__name__}: {str(exc)[:200]}"
                view = project.portfolio_project(kb, state, error)
            elif target.startswith("strategy:"):
                view = project.strategy_project(kb, target.split(":", 1)[1])
            else:
                raise KnowledgeError(f"{target!r}: use strategy:<name> or portfolio")
            _json_out(view, exit_code=_EXIT_VALIDATION_ERROR if view["integrity_failed"] else _EXIT_SUCCESS)
        else:
            entry, path = project.add(kb=kb, name=args.name, kind=args.kind, words=args.text, prompt=args.prompt,
                                      refs=args.ref or [], closes=args.closes or "", host_model=args.host_model)
            _json_out({"status": "RECORDED", "project": args.name, "kind": entry.kind.value,
                       "hash": entry.hash, "path": str(path)})
    except KnowledgeError as exc:
        _knowledge_error_out(exc)


async def _cmd_performance(args: argparse.Namespace) -> None:
    from galecore_ai.application import performance, supervisor
    kb = _build_knowledge_base()
    try:
        try:
            since = datetime.fromisoformat(args.since) if args.since else None
        except ValueError as exc:
            raise KnowledgeError(f"--since {args.since!r}: an ISO date such as 2026-09-29") from exc
        if since and since.tzinfo is None:
            since = since.replace(tzinfo=UTC)
        _json_out(performance.report(kb, supervisor.api_reader(), strategies=args.strategy, since=since))
    except supervisor.SupervisorError as exc:
        _json_out({"status": "ERROR", "error": str(exc)}, exit_code=_EXIT_INTERNAL_ERROR)
    except KnowledgeError as exc:
        _knowledge_error_out(exc)


async def _cmd_state(args: argparse.Namespace) -> None:
    from galecore_ai.application import state, supervisor
    _json_out(state.snapshot(supervisor.api_reader()))


async def _cmd_capital(args: argparse.Namespace) -> None:
    from galecore_ai.application import capital, supervisor
    kb = _build_knowledge_base()
    try:
        out = capital.report(kb, supervisor.api_reader(), capital=args.amount, strategies=args.strategy)
        _json_out(out, exit_code=_EXIT_INSUFFICIENT_DATA if out.get("status") == "MISSING_LIMITS" else 0)
    except supervisor.SupervisorError as exc:
        _json_out({"status": "ERROR", "error": str(exc)}, exit_code=_EXIT_INTERNAL_ERROR)
    except KnowledgeError as exc:
        _knowledge_error_out(exc)


async def _cmd_supervise(args: argparse.Namespace) -> None:
    from datetime import date as _date
    from datetime import datetime as _dt

    from galecore_ai.application import supervisor
    kb = _build_knowledge_base()
    try:
        c = args.supervise_command
        if c == "scan":
            try:
                _json_out(supervisor.scan(kb, supervisor.api_reader()))
            except supervisor.SupervisorError as exc:
                _json_out({"status": "ERROR", "error": str(exc)}, exit_code=_EXIT_INTERNAL_ERROR)
        elif c == "list":
            _json_out({"alerts": supervisor.view(kb, args.limit)})
        elif c == "exposure":
            try:
                _json_out(supervisor.event_exposure(kb, supervisor.api_reader(), symbol=args.symbol, event=args.event))
            except supervisor.SupervisorError as exc:
                _json_out({"status": "ERROR", "error": str(exc)}, exit_code=_EXIT_INTERNAL_ERROR)
        elif c == "watch":
            from galecore_ai.application import watch
            try:
                until = _dt.fromisoformat(args.until) if args.until else None
            except ValueError as exc:
                raise KnowledgeError(f"--until {args.until!r}: an ISO date such as 2026-10-31") from exc
            rule = watch.add(kb, symbol=args.symbol, metric=args.metric,
                             condition="below" if args.below is not None else "above",
                             threshold=args.below if args.below is not None else args.above, words=args.text,
                             prompt=args.prompt, until=until, host_model=args.host_model,
                             thesis=args.thesis or "", strategies=args.strategy)
            _json_out({"status": "WATCHING", "rule": rule.id, "watches": watch.describe(rule),
                       "note": "El supervisor la revisa cada 5 minutos en la sesión regular y avisa una vez en el monitor."})
        elif c == "remind":
            from galecore_ai.application import watch
            try:
                on = _date.fromisoformat(args.on) if args.on else None
            except ValueError as exc:
                raise KnowledgeError(f"--on {args.on!r}: a date such as 2026-10-23") from exc
            rule = watch.remind(kb, words=args.text, prompt=args.prompt, on=on, instance_id=args.when_closed or "",
                                decision=args.decision, host_model=args.host_model)
            _json_out({"status": "REMINDING", "rule": rule.id, "watches": watch.describe(rule),
                       "note": "El supervisor la revisa cada 5 minutos en la sesión regular y avisa una vez en el monitor."})
        elif c == "watches":
            from galecore_ai.application import watch
            _json_out({"rules": watch.view(kb)})
        elif c == "unwatch":
            from galecore_ai.application import watch
            mark = watch.cancel(kb, args.rule, words=args.text or "", prompt=args.prompt)
            _json_out({"status": "CANCELLED", "rule": mark.rule})
        elif c == "analyze":
            from galecore_ai.application import alert_analysis, model_run
            requested = _dt.fromisoformat(args.requested_at) if args.requested_at else _dt.now(UTC)
            a = alert_analysis.analyze(kb, args.alert, supervisor.api_reader(), model_run.ClaudeCodeClient(),
                                       requested_at=requested, requested_by=args.source, prompt=args.prompt)
            _json_out({"status": a.status.value.upper(), "alert": a.alert, "summary": a.summary, "detail": a.detail,
                       "missing": a.missing, "model": a.model, "route": a.route, "tokens": a.tokens,
                       "error": a.error}, exit_code=_EXIT_SUCCESS if a.error is None else _EXIT_INTERNAL_ERROR)
        elif c == "context":
            from galecore_ai.application import alert_analysis
            alert = supervisor.load_alert(kb, args.alert)
            ctx, sources, missing = alert_analysis.gather(kb, alert, supervisor.api_reader(),
                                                          supervisor.decisions(kb).get(args.alert))
            _json_out({"alert": args.alert, "context": ctx, "sources": sources, "missing": missing})
        elif c == "analyses":
            from galecore_ai.application import alert_analysis
            _json_out({"analyses": [{"alert": a.alert, "status": a.status.value, "at": a.finished_at.isoformat(),
                                     "summary": a.summary, "model": a.model, "error": a.error}
                                    for a in alert_analysis.analyses(kb)]})
        else:
            out = supervisor.decide(kb=kb, alert_id=args.alert, choice=args.choice, words=args.text or "",
                                    expected=args.expected or "",
                                    review_by=_date.fromisoformat(args.review_by) if args.review_by else None,
                                    source="session", prompt=args.prompt, host_model=args.host_model)
            _json_out({"status": "RECORDED", **out})
    except KnowledgeError as exc:
        _knowledge_error_out(exc)


async def _cmd_contrast(args: argparse.Namespace) -> None:
    from galecore_ai.application import contrast
    kb = _build_knowledge_base()
    state, error = None, None
    try:
        from galecore_ai.adapters.galecore_space import SpaceClient
        from galecore_ai.application.space import profile_state
        state = profile_state(SpaceClient(), kb)
    except Exception as exc:  # noqa: BLE001 - any failure reaching GaleCore is declared, not fatal
        error = f"{type(exc).__name__}: {str(exc)[:200]}"
    try:
        view = contrast.pack(kb, symbol=args.symbol, space_state=state, space_error=error)
    except KnowledgeError as exc:
        _knowledge_error_out(exc)
        return
    _json_out(view, exit_code=_EXIT_VALIDATION_ERROR if view["integrity_failed"] else _EXIT_SUCCESS)


async def _cmd_feedback(args: argparse.Namespace) -> None:
    kb = _build_knowledge_base()
    if args.feedback_command == "list":
        result = feedback_status(kb)
        if args.status:
            result["feedback"] = [i for i in result["feedback"] if i["status"] == args.status]
        _json_out(result, exit_code=_EXIT_VALIDATION_ERROR if result["integrity_failed"] else _EXIT_SUCCESS)
        return
    try:
        payload = json.loads(_read_stdin())
    except (json.JSONDecodeError, OSError, UnicodeDecodeError) as exc:
        _error_out(f"Invalid JSON input: {exc}", exit_code=_EXIT_VALIDATION_ERROR)
        raise AssertionError("unreachable") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("words"), str):
        _error_out("Input must be a JSON object with the user's 'words' (and optionally 'formulation')",
                   exit_code=_EXIT_VALIDATION_ERROR)
    try:
        document, path = save_feedback(
            kb=kb, slug=args.slug, words=payload["words"], formulation=str(payload.get("formulation") or ""),
            classification=FeedbackKind(args.classification), research=args.research, revision=args.revision,
            prompt=args.prompt, host=RecordHost(provider=payload.get("host_provider"), model=payload.get("host_model")))
    except KnowledgeError as exc:
        _knowledge_error_out(exc)
        return
    _json_out({"status": "RECORDED", "ref": document.ref, "path": str(path),
               "classification": document.classification.value, "target": document.target.model_dump(mode="json"),
               "content_hash": document.content_hash})


async def _cmd_profile(args: argparse.Namespace) -> None:
    kb = _build_knowledge_base()
    store = kb.profile
    try:
        if args.profile_command == "show":
            _json_out(profile_show(store))
        elif args.profile_command == "history":
            _json_out({"versions": profile_history(store)})
        elif args.profile_command == "review":
            _json_out(profile_review(kb))
        else:
            try:
                payload = json.loads(_read_stdin())
            except (json.JSONDecodeError, OSError, UnicodeDecodeError) as exc:
                _error_out(f"Invalid JSON input: {exc}", exit_code=_EXIT_VALIDATION_ERROR)
                raise AssertionError("unreachable") from exc
            if not isinstance(payload, dict) or not isinstance(payload.get("changes"), dict) or not payload["changes"]:
                _error_out("Input must be a JSON object with a non-empty 'changes' object",
                           exit_code=_EXIT_VALIDATION_ERROR)
            problems = check_feedback_citations(kb, args.feedback, kind=FeedbackKind.PREFERENCE)
            if problems:
                raise ProfileError("Refusing to change the profile", problems)
            doc, path = set_profile(store, changes=payload["changes"], note=args.note, prompt=args.prompt,
                                    host=RecordHost(provider=args.host_provider, model=args.host_model),
                                    feedback=args.feedback)
            if path is None:
                _json_out({"status": "UNCHANGED", "ref": doc.ref, "missing": doc.content.missing()})
            else:
                _json_out({"status": "RECORDED", "ref": doc.ref, "path": str(path),
                           "content": doc.content.model_dump(mode="json"), "missing": doc.content.missing(),
                           "content_hash": doc.content_hash})
    except ProfileError as exc:
        _json_out({"status": "INTEGRITY_FAILED" if isinstance(exc, ProfileUnusable) else "REJECTED",
                   "error": str(exc), "problems": exc.problems,
                   "timestamp": datetime.now(UTC).isoformat()}, exit_code=_EXIT_VALIDATION_ERROR)


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
            probe = probe_galecore if source_id == "galecore" else probe_fred
            observation = await probe(_build_dispatcher())
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


def _runtime_specs_dir() -> Path:
    """Where GaleCore Dev loads specs from: ``GALECORE_RUNTIME_SPECS_DIR`` or the sibling GaleCore checkout."""
    configured = os.environ.get("GALECORE_RUNTIME_SPECS_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return (Path(__file__).resolve().parents[4] / "GaleCore" / "source" / "galecore-datafeed" / "DataFeed.Api"
            / "Files" / "Runtime")


async def _cmd_strategy(args: argparse.Namespace) -> None:
    if args.strategy_command == "hash":
        text, name = _read_spec(args.spec)
        _json_out({"spec_file": name, "spec_hash": galecore_spec_hash(text)})
    if args.strategy_command == "check":
        content, _ = _read_proposal_request()
        text, name = _read_spec(args.spec)
        report = check_proposal(content, text, name)
        from galecore_ai.contracts.strategy import design_gaps
        _json_out({**report.model_dump(mode="json"), "spec_hash": galecore_spec_hash(text),
                   "design_gaps": design_gaps(content)},
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
        if args.strategy_command == "install-spec":
            from galecore_ai.application.strategy import install_spec
            _json_out(install_spec(kb=kb, key=key, target_dir=_runtime_specs_dir()))
        if args.strategy_command == "critique":
            from galecore_ai.application.strategy import critique as strategy_critique
            from galecore_ai.contracts.strategy import CritiqueContent
            try:
                payload = json.loads(_read_stdin())
                content = CritiqueContent.model_validate(payload["content"])
            except (json.JSONDecodeError, OSError, UnicodeDecodeError, TypeError, KeyError, ValueError) as exc:
                _error_out(f"Invalid critique (stdin is {{content, host_provider, host_model}}): {exc}",
                           exit_code=_EXIT_VALIDATION_ERROR)
                raise AssertionError("unreachable") from exc
            review, path = strategy_critique(
                kb=kb, key=key, content=content,
                host=RecordHost(provider=payload.get("host_provider"), model=payload.get("host_model")))
            _json_out({"status": "RECORDED", "ref": review.strategy_ref, "path": path,
                       "verdict": review.content.verdict.value, "content_hash": review.content_hash})
        if args.strategy_command == "controls":
            from galecore_ai.application.controls import classify
            doc = kb.strategies.load(key)
            if doc is None:
                raise KnowledgeError(f"no strategy {args.ref}")
            _json_out(classify(doc))
        if args.strategy_command == "sheet":
            from galecore_ai.application import supervisor
            from galecore_ai.application.strategy_sheet import sheet
            _json_out(sheet(kb, key, None if args.offline else supervisor.api_reader()))
        if args.strategy_command == "diff":
            from galecore_ai.application.strategy_sheet import diff
            _json_out(diff(kb, strategy_key(args.from_ref), key))
        if args.strategy_command == "deploy-check":
            galecore_hash = args.galecore_hash
            if galecore_hash is None:
                from galecore_ai.application import supervisor
                spec_name = Path(load_proposal(kb, key).spec_file).stem
                listed = supervisor.api_reader()("/App/Runtime/Specs")
                galecore_hash = next((x.get("contentHash") for x in listed if x.get("name") == spec_name), None)
                if galecore_hash is None:
                    raise KnowledgeError(f"GaleCore Dev does not list {spec_name} yet (it loads specs at start: "
                                         "restart the Dev API)")
            _json_out(deploy_check(kb=kb, key=key, galecore_hash=galecore_hash))
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
                            expected_result=args.expected, sources=args.source, schedule=schedule(), prompt=args.prompt,
                            capability=args.capability, result_slug=args.result_slug)
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
        elif c == "set-scan":
            from galecore_ai.contracts.task import ScanRule
            if not args.off and (not args.symbols or args.iv_rank_min is None):
                raise ValueError("set-scan needs --symbols and --iv-rank-min (or --off)")
            rule = None if args.off else ScanRule(symbols=args.symbols.split(","), iv_rank_min=args.iv_rank_min,
                                                  quiet_business_days=args.quiet_days)
            task = t.set_scan(kb=kb, task_id=args.id, rule=rule, prompt=args.prompt)
            _json_out({"status": "CHANGED", "task": args.id, "scan": task.scan.model_dump() if task.scan else None,
                       "task_status": task.status})
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


def build_parser() -> _JsonArgumentParser:
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

    p_catalog = sub.add_parser("catalog", help="What the host can ask for: capabilities, skills, flows, controls")
    p_catalog.add_argument("--check", action="store_true",
                           help="Validate every entry: skill, contract, flow commands, data needs, controls")
    p_catalog.add_argument("--match", metavar="PEDIDO",
                           help="Which capabilities serve this request, in the user's words (GC-AI-0022)")

    p_an = sub.add_parser("analyze", help="On-demand analysis: macro, technical, fundamental or flow (P1-05)")
    an_sub = p_an.add_subparsers(dest="analyze_command", required=True)
    p_an_pack = an_sub.add_parser("pack", help="Gather the analysis from GaleCore (code, no model) and keep it as "
                                               "evidence")
    p_an_pack.add_argument("--kind", required=True, choices=["macro", "technical", "fundamental", "flow"])
    p_an_pack.add_argument("--symbol", default="SPY", help="Ignored for macro")
    p_an_pack.add_argument("--prompt", required=True, help="The user's request, verbatim")

    p_story = sub.add_parser("story", help="The market story (GC-AI-0024)")
    st_sub = p_story.add_subparsers(dest="story_command", required=True)
    p_st_pack = st_sub.add_parser("pack", help="Gather the day's market pack from GaleCore (code, no model), compare "
                                               "it with the previous one and keep it as evidence")
    p_st_pack.add_argument("--symbol", default="SPY")
    p_st_pack.add_argument("--prompt", required=True, help="The user's request, verbatim")

    p_inv = sub.add_parser("inventory", help="What the harness has and what it costs: capabilities with their model "
                                             "and consumption, data sources, host connectors (GC-AI-0024)")
    p_inv.add_argument("--json", action="store_true", help="JSON instead of the readable tables")

    p_kb = sub.add_parser("kb", help="Search and read the knowledge base (no model call)")
    kb_sub = p_kb.add_subparsers(dest="kb_command", required=True)
    p_search = kb_sub.add_parser("search", help="Items matching the terms, best first")
    p_search.add_argument("--text", help="Terms to look for (empty lists everything)")
    p_search.add_argument("--kind", choices=["research", "regime", "evidence", "strategy", "profile", "feedback",
                                             "project"])
    p_search.add_argument("--status", choices=["unfinished", *[s.value for s in ResearchStatus]],
                          help="unfinished = open or test_planned")
    p_search.add_argument("--symbol")
    p_search.add_argument("--since", help="YYYY-MM-DD: only items updated on or after that day")
    p_search.add_argument("--include-marked", dest="include_marked", action="store_true",
                          help="Also list items marked corrected, superseded or retired (left out by default)")
    p_show = kb_sub.add_parser("show", help="One item by reference, with what cites it")
    p_show.add_argument("ref", help="regime:<SYMBOL>/<YYYY-MM-DD>, research:<id>, evidence:<id>, "
                                    "strategy:<name>/<version>, profile:v<N>, feedback:<id>, project:<name> or file:<path>")
    p_mark = kb_sub.add_parser("mark", help="«Esto ya no vale»: mark an item corrected, superseded or retired, with "
                                            "the reason; it is kept but no longer cited or listed (P1-08)")
    p_mark.add_argument("ref", help="The item to mark (same references as kb show)")
    p_mark.add_argument("--as", dest="mark", required=True, choices=[k.value for k in MarkKind])
    p_mark.add_argument("--reason", required=True, help="Why, in plain words")
    p_mark.add_argument("--by", help="The correction or replacement (required for corrected and superseded)")
    p_mark.add_argument("--slug", required=True, help="Short name; the id is <date>-<slug>")
    p_mark.add_argument("--prompt", required=True, help="The owner's words that asked for it")
    p_mark.add_argument("--host-model", dest="host_model")

    p_profile = sub.add_parser("profile", help="Your profile: objectives, capital, horizon, limits, format")
    prof_sub = p_profile.add_subparsers(dest="profile_command", required=True)
    prof_sub.add_parser("show", help="Current version and what is still missing")
    prof_sub.add_parser("history", help="All versions, newest first")
    prof_sub.add_parser("review", help="What is missing, vague or provisional in your criteria and mandate, "
                                       "and what your strategies leave open")
    p_prof_set = prof_sub.add_parser("set", help="Change fields ({\"changes\": {...}} on stdin); a new version")
    p_prof_set.add_argument("--note", required=True, help="What this version changes")
    p_prof_set.add_argument("--prompt", required=True, help="The user's words that asked for it")
    p_prof_set.add_argument("--host-provider", dest="host_provider", default="claude-code")
    p_prof_set.add_argument("--host-model", dest="host_model", required=True)
    p_prof_set.add_argument("--feedback", action="append", default=[],
                            help="feedback:<id> (classified preference) that this version applies; repeatable")

    p_feedback = sub.add_parser("feedback", help="Your comment on a stored result, and whether it was applied")
    fb_sub = p_feedback.add_subparsers(dest="feedback_command", required=True)
    p_fb_add = fb_sub.add_parser("add", help="Keep a comment ({\"words\": ...} on stdin) tied to one revision")
    p_fb_add.add_argument("--research", required=True, help="research:<id> the comment is about")
    p_fb_add.add_argument("--revision", required=True, type=int, help="the revision the comment is about")
    p_fb_add.add_argument("--classification", required=True, choices=[k.value for k in FeedbackKind],
                          help="case: fix that result · preference: new profile version · method: new skill version")
    p_fb_add.add_argument("--slug", required=True, help="Short name; the id is <date>-<slug>")
    p_fb_add.add_argument("--prompt", required=True, help="What the user asked")
    p_gc = sub.add_parser("galecore", help="Read-only GaleCore data: what can be asked and one answer (GC-AI-0019)")
    gc_sub = p_gc.add_subparsers(dest="galecore_command", required=True)
    gc_sub.add_parser("list", help="Every GaleCore capability the harness can ask for, with its parameters")
    p_gc_get = gc_sub.add_parser("get", help="Ask one capability; JSON on stdout, or the payload to --out")
    p_gc_get.add_argument("capability", choices=[c.capability_id for c in KNOWN_CAPABILITIES])
    p_gc_get.add_argument("--symbol", help="Symbol (an OCC option symbol for option_greeks); calendars take none")
    p_gc_get.add_argument("--param", action="append", help="Extra parameter key=value (e.g. interval=1d)")
    p_gc_get.add_argument("--out", help="Write the payload to this file and print only a summary")

    p_space = sub.add_parser("space", help="Your space in GaleCore: profile, objectives, conventions, memory, skills, "
                                           "agents, data; own or shared (GC-AI-0021)")
    sp_sub = p_space.add_subparsers(dest="space_command", required=True)
    sp_sub.add_parser("context", help="Short summary to start a session with")
    p_sp_list = sp_sub.add_parser("list", help="Your pieces and the ones shared with you")
    p_sp_list.add_argument("--kind", choices=["profile", "objective", "convention", "memory", "skill", "agent", "data"])
    sp_sub.add_parser("show", help="One piece").add_argument("ref", help="kind/key, e.g. agent/oportunidades")
    p_sp_put = sp_sub.add_parser("put", help="Create or replace one of your pieces (content on stdin)")
    p_sp_put.add_argument("ref", help="kind/key")
    p_sp_put.add_argument("--title", required=True)
    p_sp_put.add_argument("--format", default="markdown", choices=["markdown", "json"])
    p_sp_put.add_argument("--visibility", default="private", choices=["private", "shared"])
    sp_sub.add_parser("delete", help="Delete one of your pieces").add_argument("ref", help="kind/key")
    sp_sub.add_parser("import", help="Bring the local profile, objectives, conventions, agents and skills (only changes)")
    p_sp_pull = sp_sub.add_parser("pull-profile", help="Bring a profile edited in the monitor as a new local version "
                                                       "(GC-AI-0026: the space rules)")
    p_sp_pull.add_argument("--host-model", dest="host_model")
    p_sp_agents = sp_sub.add_parser("agents", help="Apply the monitor's on/off requests and publish each agent's state, "
                                                   "last run and findings (GC-AI-0023)")
    p_sp_agents.add_argument("--install", action="store_true",
                             help="Register the Windows task that does it every 5 minutes")

    p_project = sub.add_parser("project", help="A strategy or the portfolio as a project: everything in one view "
                                               "and the owner's log (GC-AI-0026)")
    pj_sub = p_project.add_subparsers(dest="project_command", required=True)
    pj_sub.add_parser("show", help="strategy:<name> or portfolio").add_argument("target")
    pj_sub.add_parser("design", help="Verified local design only, without research or market queries").add_argument("target")
    p_pj_add = pj_sub.add_parser("add", help="Append the owner's words: thesis, story, decision, pending or done")
    p_pj_add.add_argument("name", help="Strategy name or portfolio")
    p_pj_add.add_argument("--kind", required=True, choices=["thesis", "story", "decision", "pending", "done"])
    p_pj_add.add_argument("--text", required=True, help="The owner's words, verbatim")
    p_pj_add.add_argument("--ref", action="append", help="A resolvable reference (regime:, research:, …)")
    p_pj_add.add_argument("--closes", help="done only: hash (or unique prefix) of the open item it closes")
    p_pj_add.add_argument("--prompt", required=True, help="The owner's request")
    p_pj_add.add_argument("--host-model", dest="host_model")

    p_perf = sub.add_parser("performance", help="«¿Cómo viene la estrategia / mi cartera contra el objetivo? ¿Edge o "
                                                "suerte?» Performance por estrategia, versión y regla, y revisión de "
                                                "cada cierre con su decisión (P1-03)")
    p_perf.add_argument("--strategy", action="append", help="Limit to this strategy (repeatable); default: all known")
    p_perf.add_argument("--since", help="Only closes (and their review) from this ISO date on, e.g. the week")

    sub.add_parser("state", help="State read now from GaleCore: switch, instances, open positions, supported "
                                 "structures, and data health as connectivity, freshness and coverage (WS-0023)")
    p_cap = sub.add_parser("capital", help="«¿Qué capital tengo disponible? ¿Estoy concentrado? Tengo X USD, ¿qué "
                                           "hago?» Exposición contra límites y reparto con reserva y escalera (P1-04)")
    p_cap.add_argument("--amount", type=float, help="Capital to split (USD); default: the profile's reference capital")
    p_cap.add_argument("--strategy", action="append", help="Split among these strategies (repeatable); default: all known")

    p_supervise = sub.add_parser("supervise", help="Supervisor of SHADOW: alerts on existing rules and the owner's "
                                                   "decisions with their context (WS-0007)")
    sv_sub = p_supervise.add_subparsers(dest="supervise_command", required=True)
    sv_sub.add_parser("scan", help="Read GaleCore's runtime and raise the new alerts (the 5-minute task does it)")
    sv_sub.add_parser("list", help="Latest alerts with their decision").add_argument("--limit", type=int, default=20)
    p_sv_exp = sv_sub.add_parser("exposure", help="«¿Las dejo abiertas antes del CPI?»: per open SHADOW position, the "
                                                  "loss if the stop runs, the maximum if it gaps, and the next event "
                                                  "(figures computed here, WS-0027)")
    p_sv_exp.add_argument("--symbol", help="Only this underlying, e.g. SPY")
    p_sv_exp.add_argument("--event", help="Only events whose name contains this text, e.g. Consumer Price")
    p_sv_decide = sv_sub.add_parser("decide", help="Record the owner's answer to an alert in the strategy's project")
    p_sv_decide.add_argument("--alert", required=True, help="Alert id (supervise list)")
    p_sv_decide.add_argument("--choice", required=True, help="One of the alert's options")
    p_sv_decide.add_argument("--text", help="The owner's words, verbatim")
    p_sv_decide.add_argument("--expected", help="What the owner expects, in their words")
    p_sv_decide.add_argument("--review-by", dest="review_by", help="YYYY-MM-DD: when to look at it again")
    p_sv_decide.add_argument("--prompt", required=True, help="The owner's request")
    p_sv_decide.add_argument("--host-model", dest="host_model")
    p_sv_watch = sv_sub.add_parser("watch", help="«Avisame si SPY baja a 760»: store a rule the supervisor checks "
                                                 "every 5 minutes in session and alerts once (P1-01b)")
    p_sv_watch.add_argument("--symbol", required=True, help="Ticker, e.g. SPY")
    p_sv_watch.add_argument("--metric", default="price", choices=["price", "gamma_zero", "call_wall", "put_wall",
                                                                   "iv_rank"])
    side = p_sv_watch.add_mutually_exclusive_group(required=True)
    side.add_argument("--below", type=float, help="Alert when the number is at or below this")
    side.add_argument("--above", type=float, help="Alert when the number is at or above this")
    p_sv_watch.add_argument("--until", help="ISO date or datetime after which it is no longer watched")
    p_sv_watch.add_argument("--text", required=True, help="The owner's words, verbatim")
    p_sv_watch.add_argument("--prompt", required=True, help="The owner's request")
    p_sv_watch.add_argument("--host-model", dest="host_model")
    p_sv_watch.add_argument("--thesis", help="The thesis this condition invalidates (U-65); needs --strategy")
    p_sv_watch.add_argument("--strategy", action="append", help="A strategy that depends on that thesis (repeatable)")
    p_sv_remind = sv_sub.add_parser("remind", help="«Revisalo el 23/10» / «reanudá cuando cierren»: a reminder of a "
                                                   "decision the supervisor checks and alerts once (WS-0023)")
    when = p_sv_remind.add_mutually_exclusive_group(required=True)
    when.add_argument("--on", help="Date (YYYY-MM-DD, New York) to alert on")
    when.add_argument("--when-closed", dest="when_closed", help="Instance id: alert when it has no open position")
    p_sv_remind.add_argument("--decision", default="", help="The decision it comes from (words or project ref)")
    p_sv_remind.add_argument("--text", required=True, help="The owner's words, verbatim")
    p_sv_remind.add_argument("--prompt", required=True, help="The owner's request")
    p_sv_remind.add_argument("--host-model", dest="host_model")
    sv_sub.add_parser("watches", help="The owner's rules and their state (active, met, cancelled, expired)")
    p_sv_unwatch = sv_sub.add_parser("unwatch", help="Cancel an active rule")
    p_sv_unwatch.add_argument("rule", help="Rule id (supervise watches)")
    p_sv_unwatch.add_argument("--text", help="The owner's words, verbatim")
    p_sv_unwatch.add_argument("--prompt", required=True, help="The owner's request")
    p_sv_analyze = sv_sub.add_parser("analyze", help="«Analizá este aviso»: one model run (the policy's model, no "
                                                     "tools) with the alert's context from GaleCore (P1-01b, U-70)")
    p_sv_analyze.add_argument("alert", help="Alert id (supervise list)")
    p_sv_analyze.add_argument("--prompt", required=True, help="The owner's request")
    p_sv_analyze.add_argument("--source", default="session", choices=["session", "monitor"])
    p_sv_analyze.add_argument("--requested-at", dest="requested_at", help="ISO datetime of the request (monitor)")
    sv_sub.add_parser("analyses", help="Analyses of alerts, newest first (done or failed, with why)")
    sv_sub.add_parser("context", help="The alert's context, by code and without a model: the alert, the position, "
                                      "the strategy's exits and limit, today's numbers (P1-01c: the monitor's "
                                      "terminal)").add_argument("alert", help="Alert id (supervise list)")

    p_contrast = sub.add_parser("contrast", help="Today's market story against each strategy and the portfolio "
                                                 "(GC-AI-0027)")
    ct_sub = p_contrast.add_subparsers(dest="contrast_command", required=True)
    ct_sub.add_parser("pack", help="Gather the contrast by code: story, strategies as projects, profile")         .add_argument("--symbol", default="SPY")

    sub.add_parser("clock", help="What time it is and whether the US market is open, with the last close and "
                                 "the next open (BL-020)").add_argument("--at", help="ISO time (default: now)")
    p_gap = sub.add_parser("gap", help="Log what was asked and GaleCore does not cover, for GaleCore's development (BL-022)")
    gap_sub = p_gap.add_subparsers(dest="gap_command", required=True)
    p_gap_add = gap_sub.add_parser("add", help="Note a missing data/calculation/analysis/cross/action or an API error")
    p_gap_add.add_argument("--need", required=True, help="What was asked, in plain words")
    p_gap_add.add_argument("--kind", required=True, help="data | calc | analysis | cross | action | api_error")
    p_gap_add.add_argument("--why", help="What the user needed it for")
    p_gap_add.add_argument("--instead", help="What was done in its place")
    p_gap_add.add_argument("--project")
    gap_sub.add_parser("list", help="Gaps by frequency")

    p_inbox = sub.add_parser("inbox", help="Idea inbox: note the owner's idea now, review it later (GC-AI-0018)")
    in_sub = p_inbox.add_subparsers(dest="inbox_command", required=True)
    p_in_add = in_sub.add_parser("add", help="Note an idea with the owner's words, verbatim; it is not evaluated")
    p_in_add.add_argument("--text", required=True, help="The idea, in the owner's words")
    p_in_add.add_argument("--context", help="What we were doing when it came up")
    p_in_add.add_argument("--ref", action="append", help="A resolvable reference (research:, strategy:, …)")
    p_in_add.add_argument("--prompt", help="The owner's request (default: the idea itself)")
    p_in_add.add_argument("--host-model", dest="host_model")
    p_in_list = in_sub.add_parser("list", help="Ideas, oldest first")
    p_in_list.add_argument("--status", help="pending | resolved | a destination (roadmap, backlog:BL-NNN, …)")
    in_sub.add_parser("show", help="One idea with its review history").add_argument("id")
    p_in_res = in_sub.add_parser("resolve", help="Where the idea went: roadmap, backlog:BL-NNN, work-item:<id>, "
                                                 "done or discarded")
    p_in_res.add_argument("id")
    p_in_res.add_argument("--to", required=True)
    p_in_res.add_argument("--note", required=True, help="Why, in plain words")
    p_in_res.add_argument("--prompt", required=True, help="The owner's words in the review")
    p_fb_list = fb_sub.add_parser("list", help="Every comment, applied or pending, and where it was applied")
    p_fb_list.add_argument("--status", choices=["pending", "applied"])

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

    p_task = sub.add_parser("task", help="Recurring read-only capability run by the Windows Task Scheduler")
    t_sub = p_task.add_subparsers(dest="task_command", required=True)

    def schedule_args(p):
        p.add_argument("--frequency", required=True, choices=["daily", "weekdays", "every_minutes", "market_hours"])
        p.add_argument("--time", help="HH:MM in --timezone (daily, weekdays)")
        p.add_argument("--minutes", type=int, help="period for every_minutes (15..1440) or market_hours (15..240, "
                                                   "Mon-Fri 09:30-16:00 America/New_York)")
        p.add_argument("--timezone", required=True, help="IANA name, e.g. America/New_York")
        p.add_argument("--prompt", required=True, help="What the user asked")
    p_tc = t_sub.add_parser("create", help="Create and schedule a task that runs a schedulable capability")
    p_tc.add_argument("--id", required=True)
    p_tc.add_argument("--capability", default="strategy_followup", help="Catalog id declared schedulable")
    p_tc.add_argument("--result-slug", dest="result_slug",
                      help="Model runs: the investigation each run revises (default <capability>-<strategy>)")
    p_tc.add_argument("--strategy", help="Strategy followed; an agent that watches the market has none")
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
    p_ts = t_sub.add_parser("set-scan", help="Screen a market agent by code; the model only with a finding (P1-05)")
    p_ts.add_argument("id")
    p_ts.add_argument("--symbols", help="Comma-separated tickers, e.g. SPY,QQQ,IWM")
    p_ts.add_argument("--iv-rank-min", dest="iv_rank_min", type=float)
    p_ts.add_argument("--quiet-days", dest="quiet_days", type=int, default=3,
                      help="Business days ahead without employment, CPI or FOMC")
    p_ts.add_argument("--off", action="store_true", help="Remove the screen: every run calls the model again")
    p_ts.add_argument("--prompt", required=True)
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
    p_st_approve.add_argument("--spec-hash", dest="spec_hash", default=None,
                              help="optional: the owner's yes to the named version is enough; if given, it must match")
    p_st_approve.add_argument("--owner-words", dest="owner_words", required=True,
                              help="the owner's approval, verbatim")
    p_st_approve.add_argument("--host-provider", dest="host_provider", default="claude-code")
    p_st_approve.add_argument("--host-model", dest="host_model", required=True)
    p_st_inst = st_sub.add_parser("install-spec", help="Copy the approved spec into GaleCore Dev's Files/Runtime")
    p_st_inst.add_argument("--ref", required=True, help="strategy:<name>/<version>")
    p_st_crit = st_sub.add_parser("critique", help="Record the critique of an exact version (stdin; one per version)")
    p_st_crit.add_argument("--ref", required=True, help="strategy:<name>/<version>")
    p_st_ctl = st_sub.add_parser("controls", help="Which rules the runtime executes, the supervisor watches (alerts) or "
                                              "are only declared; indispensable controls and whether to recommend "
                                              "approval (WS-0023)")
    p_st_ctl.add_argument("--ref", required=True, help="strategy:<name>/<version>")
    p_st_sheet = st_sub.add_parser("sheet", help="One-page sheet: parameters, management, gaps, decisions, critique")
    p_st_sheet.add_argument("--ref", required=True, help="strategy:<name>/<version>")
    p_st_sheet.add_argument("--offline", action="store_true", help="do not ask GaleCore what is open in SHADOW")
    p_st_diff = st_sub.add_parser("diff", help="What changed between two versions and why (by code)")
    p_st_diff.add_argument("--from", dest="from_ref", required=True, help="strategy:<name>/<older version>")
    p_st_diff.add_argument("--ref", required=True, help="strategy:<name>/<newer version>")
    p_st_deploy = st_sub.add_parser("deploy-check", help="Allow a deploy only with an approval of GaleCore's hash")
    p_st_deploy.add_argument("--ref", required=True, help="strategy:<name>/<version>")
    p_st_deploy.add_argument("--galecore-hash", dest="galecore_hash", default=None,
                             help="contentHash that App/Runtime/Specs/<name> reports (default: asked to GaleCore)")

    p_evidence = sub.add_parser("evidence", help="Keep a source response with its provenance (content on stdin)")
    ev_sub = p_evidence.add_subparsers(dest="evidence_command", required=True)
    p_ev_add = ev_sub.add_parser("add", help="Store one response; never overwrites (HOST_DECLARED)")
    p_ev_add.add_argument("--slug", required=True, help="Short name; the id is <date>-<slug>")
    p_ev_add.add_argument("--prompt", required=True, help="What the user asked")

    p_sources = sub.add_parser(
        "sources", help="Data source registry: what's known, its last checked access, and what covers a need")
    src_sub = p_sources.add_subparsers(dest="sources_command", required=True)
    src_sub.add_parser("list", help="Registry grouped by category, with each source's last known status")
    p_src_query = src_sub.add_parser("query", help="Sources covering a need, ordered by usage (free, own, daily quota, plan) then preference")
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

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    try:
        if args.command == "prepare":
            asyncio.run(_cmd_prepare(args))
        elif args.command == "galecore":
            asyncio.run(_cmd_galecore(args))
        elif args.command == "space":
            asyncio.run(_cmd_space(args))
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
        elif args.command == "story":
            asyncio.run(_cmd_story(args))
        elif args.command == "analyze":
            asyncio.run(_cmd_analyze(args))
        elif args.command == "inventory":
            asyncio.run(_cmd_inventory(args))
        elif args.command == "kb" and args.kb_command == "search":
            asyncio.run(_cmd_kb_search(args))
        elif args.command == "kb" and args.kb_command == "show":
            asyncio.run(_cmd_kb_show(args))
        elif args.command == "kb" and args.kb_command == "mark":
            asyncio.run(_cmd_kb_mark(args))
        elif args.command == "research" and args.research_command == "save":
            asyncio.run(_cmd_research_save(args))
        elif args.command == "research" and args.research_command == "revise":
            asyncio.run(_cmd_research_revise(args))
        elif args.command == "evidence" and args.evidence_command == "add":
            asyncio.run(_cmd_evidence_add(args))
        elif args.command == "sources":
            asyncio.run(_cmd_sources(args))
        elif args.command == "profile":
            asyncio.run(_cmd_profile(args))
        elif args.command == "feedback":
            asyncio.run(_cmd_feedback(args))
        elif args.command == "clock":
            _cmd_clock(args)
        elif args.command == "gap":
            _cmd_gap(args)
        elif args.command == "inbox":
            asyncio.run(_cmd_inbox(args))
        elif args.command == "project":
            asyncio.run(_cmd_project(args))
        elif args.command == "supervise":
            asyncio.run(_cmd_supervise(args))
        elif args.command == "performance":
            asyncio.run(_cmd_performance(args))
        elif args.command == "state":
            asyncio.run(_cmd_state(args))
        elif args.command == "capital":
            asyncio.run(_cmd_capital(args))
        elif args.command == "contrast":
            asyncio.run(_cmd_contrast(args))
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
