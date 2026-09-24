"""Knowledge base use cases: resolve references, validate and store investigations, search, show.

Controls here are the ones an investigation needs, not the GEX ones: cited
antecedents and sources must resolve to intact items or existing local files, a
statement marked as a fact must cite a source, an open investigation must say
what comes next, and a planned test needs a hypothesis. Numbers in prose, trading
directives and fact-snapshot matching do not apply to this kind of work; the
validator checks structure and references, never whether the reasoning is right.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from galecore_ai.adapters.knowledge_base import KnowledgeBaseError, Ref, parse_ref, ref_path
from galecore_ai.adapters.record_store import (
    FileRecordStore,
    RecordIntegrityError,
    RecordStoreError,
)
from galecore_ai.adapters.research_store import (
    FileResearchStore,
    ResearchIntegrityError,
    ResearchStoreError,
)
from galecore_ai.contracts.prepared_analysis import AssetEntry
from galecore_ai.contracts.regime_record import RecordHost
from galecore_ai.contracts.research import (
    ResearchContent,
    ResearchDocument,
    ResearchRevision,
    ResearchStatus,
    ResolvedRef,
    RevisionReason,
    StatementKind,
    compute_revision_hash,
)
from galecore_ai.harness.assets import definition_hash, load_asset
from galecore_ai.harness.catalog import load_catalog
from galecore_ai.harness.definitions import SkillDefinition


class KnowledgeError(Exception):
    """A knowledge operation was refused; ``problems`` says why."""

    def __init__(self, message: str, problems: list[str] | None = None) -> None:
        super().__init__(message if not problems else f"{message}: " + "; ".join(problems))
        self.problems = problems or []


@dataclass(frozen=True)
class KnowledgeBase:
    base: Path                  # the knowledge directory
    records: FileRecordStore    # regime records (GALECORE_RECORDS_DIR may point elsewhere)
    research: FileResearchStore

    @property
    def workspace(self) -> Path:
        return self.base.parent


def _sha256_file(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def _display_path(path: Path, kb: KnowledgeBase) -> str:
    try:
        return path.resolve().relative_to(kb.workspace.resolve()).as_posix()
    except ValueError:
        return str(path)


# ── references ───────────────────────────────────────────────────


def resolve_ref(text: str, kb: KnowledgeBase) -> ResolvedRef:
    """Resolve a reference to an intact item or an existing file. Raises KnowledgeError."""
    try:
        ref = parse_ref(text)
    except KnowledgeBaseError as exc:
        raise KnowledgeError(str(exc)) from exc
    if ref.kind == "regime":
        symbol, day = ref.key.split("/")
        if kb.records.base_dir != (kb.base / "regime").resolve():
            raise KnowledgeError(f"{ref}: regime records are not in the knowledge base "
                                 f"(GALECORE_RECORDS_DIR points elsewhere); cannot cite them")
        try:
            if kb.records.load(symbol, day) is None:
                raise KnowledgeError(f"{ref}: no such regime record")
        except (RecordIntegrityError, RecordStoreError) as exc:
            raise KnowledgeError(f"{ref}: not usable ({exc})") from exc
        path = kb.records.path_for(symbol, day)
    elif ref.kind == "research":
        try:
            if kb.research.load(ref.key) is None:
                raise KnowledgeError(f"{ref}: no such investigation")
        except (ResearchIntegrityError, ResearchStoreError) as exc:
            raise KnowledgeError(f"{ref}: not usable ({exc})") from exc
        path = kb.research.path_for(ref.key)
    else:
        path = ref_path(ref, kb.base)
        if path.is_relative_to(kb.base.resolve()):
            # Knowledge items are cited by kind so their integrity (and self-citation) is checked.
            raise KnowledgeError(f"{ref}: points inside the knowledge base; cite it as regime: or research:")
        if not path.is_relative_to(kb.workspace.resolve()) or not path.is_file():
            raise KnowledgeError(f"{ref}: no such file inside the workspace")
    return ResolvedRef(ref=str(ref), path=_display_path(path, kb), content_hash=_sha256_file(path))


# ── investigations ───────────────────────────────────────────────


def check_content(content: ResearchContent, kb: KnowledgeBase, *, self_id: str | None = None) -> tuple[
    list[ResolvedRef], list[str]
]:
    """Resolve every cited reference and apply the investigation's controls."""
    problems: list[str] = []
    resolved: dict[str, ResolvedRef] = {}

    def cite(text: str, where: str) -> None:
        try:
            r = resolve_ref(text, kb)
        except KnowledgeError as exc:
            problems.append(f"{where}: {exc}")
            return
        if self_id and r.ref == f"research:{self_id}":
            problems.append(f"{where}: an investigation cannot cite itself")
            return
        resolved.setdefault(r.ref, r)

    for i, a in enumerate(content.antecedents):
        cite(a.ref, f"antecedents[{i}]")
    for i, s in enumerate(content.statements):
        if s.kind == StatementKind.FACT and not s.sources:
            problems.append(f"statements[{i}]: a fact must cite at least one source")
        for src in s.sources:
            cite(src, f"statements[{i}].sources")
    # Blank text is not content: "   " is neither a hypothesis nor a next step (Codex C1 MAJOR).
    if content.hypothesis is not None and not content.hypothesis.strip():
        problems.append("hypothesis is blank; omit it or state it")
    for field in ("missing", "next_steps", "limitations"):
        for i, item in enumerate(getattr(content, field)):
            if not item.strip():
                problems.append(f"{field}[{i}] is blank")
    if content.status in (ResearchStatus.OPEN, ResearchStatus.TEST_PLANNED) and not any(
            s.strip() for s in content.next_steps):
        problems.append(f"status {content.status.value} requires at least one next step")
    if content.status == ResearchStatus.TEST_PLANNED and not (content.hypothesis and content.test_plan):
        problems.append("status test_planned requires a hypothesis and a test plan")
    if content.test_plan and not content.hypothesis:
        problems.append("a test plan needs the hypothesis it tests")
    if not content.limitations:
        problems.append("at least one limitation is required")
    return list(resolved.values()), problems


def research_skill() -> AssetEntry:
    entry = load_catalog().get("research")
    skill = load_asset(entry.skill, SkillDefinition)
    return AssetEntry(asset_id=skill.skill_id, version=skill.version, content_hash=definition_hash(skill))


def _revision(*, number: int, reason: RevisionReason, note: str, prompt: str, host: RecordHost,
              content: ResearchContent, resolved: list[ResolvedRef], now: datetime) -> ResearchRevision:
    draft = ResearchRevision(
        revision=number, recorded_at=now, reason=reason, note=note, prompt=prompt, host=host,
        skill=research_skill(), content=content, resolved_refs=resolved, content_hash="",
    )
    return draft.model_copy(update={"content_hash": compute_revision_hash(draft.hashable_content())})


def save_research(*, kb: KnowledgeBase, slug: str, prompt: str, host: RecordHost, content: ResearchContent,
                  now: datetime | None = None) -> tuple[ResearchDocument, Path]:
    now = now or datetime.now(UTC)
    research_id = f"{now.date().isoformat()}-{slug}"
    if not prompt.strip():
        raise KnowledgeError("Refusing to save", ["the user's prompt is required"])
    try:
        kb.research.path_for(research_id)
    except ResearchStoreError as exc:
        raise KnowledgeError("Refusing to save", [str(exc)]) from exc
    resolved, problems = check_content(content, kb, self_id=research_id)
    if problems:
        raise KnowledgeError("Refusing to save", problems)
    revision = _revision(number=1, reason=RevisionReason.INITIAL, note="", prompt=prompt, host=host,
                         content=content, resolved=resolved, now=now)
    document = ResearchDocument(id=research_id, created_at=now, revisions=[revision])
    try:
        path = kb.research.create(document)
    except ResearchStoreError as exc:
        raise KnowledgeError("Refusing to save", [str(exc)]) from exc
    return document, path


def revise_research(*, kb: KnowledgeBase, research_id: str, reason: RevisionReason, note: str, prompt: str,
                    host: RecordHost, content: ResearchContent,
                    now: datetime | None = None) -> tuple[ResearchDocument, Path]:
    now = now or datetime.now(UTC)
    problems: list[str] = []
    if reason == RevisionReason.INITIAL:
        problems.append("a revision cannot be 'initial'")
    if not note.strip():
        problems.append("a revision needs a note saying what it changes")
    if not prompt.strip():
        problems.append("the user's prompt is required")
    try:
        current = kb.research.load(research_id)
    except (ResearchIntegrityError, ResearchStoreError) as exc:
        raise KnowledgeError(f"research:{research_id} is not usable", [str(exc)]) from exc
    if current is None:
        raise KnowledgeError(f"research:{research_id} does not exist")
    resolved, content_problems = check_content(content, kb, self_id=research_id)
    problems += content_problems
    if problems:
        raise KnowledgeError("Refusing to revise", problems)
    revision = _revision(number=len(current.revisions) + 1, reason=reason, note=note, prompt=prompt,
                         host=host, content=content, resolved=resolved, now=now)
    try:
        return kb.research.append(research_id, revision)
    except (ResearchIntegrityError, ResearchStoreError) as exc:
        raise KnowledgeError("Refusing to revise", [str(exc)]) from exc


# ── search and show ──────────────────────────────────────────────


def _cited_refs(document: ResearchDocument) -> set[str]:
    c = document.current.content
    refs = {a.ref for a in c.antecedents} | {src for s in c.statements for src in s.sources}
    out: set[str] = set()
    for r in refs:
        try:
            out.add(str(parse_ref(r)))
        except KnowledgeBaseError:
            continue
    return out


def _research_items(kb: KnowledgeBase, failed: list[dict]) -> list[tuple[dict, str, ResearchDocument]]:
    items = []
    for name in kb.research.unrecognised_files():
        failed.append({"ref": f"file:{_display_path(kb.research.knowledge_base / 'research' / name, kb)}",
                       "status": "UNRECOGNISED_NAME",
                       "problems": [f"{name} is not named <YYYY-MM-DD-slug>.md; it is not read as research"]})
    for rid in kb.research.ids():
        try:
            doc = kb.research.load(rid)
        except (ResearchIntegrityError, ResearchStoreError) as exc:
            failed.append({"ref": f"research:{rid}", "status": "INTEGRITY_FAILED", "problems": [str(exc)]})
            continue
        if doc is None:
            continue
        c = doc.current.content
        summary = {
            "ref": f"research:{rid}", "kind": "research", "title": c.title, "status": c.status.value,
            "question": c.question, "hypothesis": c.hypothesis, "next_steps": c.next_steps,
            "missing": c.missing, "revisions": len(doc.revisions),
            "updated_at": doc.current.recorded_at.isoformat(),
            "path": _display_path(kb.research.path_for(rid), kb),
        }
        text = " ".join([c.title, c.question, c.hypothesis or "", *c.next_steps, *c.missing, *c.limitations,
                         *[s.text for s in c.statements], *[a.summary + " " + a.bearing for a in c.antecedents]])
        items.append((summary, text, doc))
    return items


def _regime_items(kb: KnowledgeBase, failed: list[dict], symbol: str | None) -> list[tuple[dict, str]]:
    items = []
    symbols = [symbol.upper()] if symbol else kb.records.symbols()
    for sym in symbols:
        for day in kb.records.dates(sym):
            try:
                doc = kb.records.load(sym, day)
            except (RecordIntegrityError, RecordStoreError) as exc:
                failed.append({"ref": f"regime:{sym}/{day}", "status": "INTEGRITY_FAILED", "problems": [str(exc)]})
                continue
            if doc is None:
                continue
            parts, regimes = [], []
            for e in doc.entries:
                p = e.accepted_payload
                regimes.append(f"{p.get('gamma_regime')}/{p.get('tail_pricing')}")
                parts += [e.request.prompt, str(p.get("gamma_regime")), str(p.get("tail_pricing")),
                          *p.get("observations", []), *p.get("implications", []), *p.get("limitations", []),
                          *[f"{r.verdict.value} {r.comment}" for r in e.human_reviews]]
            summary = {
                "ref": f"regime:{sym}/{day}", "kind": "regime", "title": f"Régimen {sym} {day}: {', '.join(regimes)}",
                "entries": len(doc.entries),
                "outcomes": sum(len(e.outcomes) for e in doc.entries),
                "reviews": [r.verdict.value for e in doc.entries for r in e.human_reviews],
                "path": _display_path(kb.records.path_for(sym, day), kb),
            }
            items.append((summary, " ".join([sym, day, *parts])))
    return items


UNFINISHED = {ResearchStatus.OPEN.value, ResearchStatus.TEST_PLANNED.value}


def search(kb: KnowledgeBase, *, text: str = "", kind: str | None = None, status: str | None = None,
           symbol: str | None = None) -> dict:
    """Items whose text contains the query terms, best match first. Broken items are reported, never skipped."""
    terms = [t for t in text.lower().split() if t]
    failed: list[dict] = []
    candidates: list[tuple[dict, str]] = []
    wanted = UNFINISHED if status == "unfinished" else {status}
    if kind in (None, "research"):
        candidates += [(s, t) for s, t, _ in _research_items(kb, failed)
                       if status is None or s["status"] in wanted]
    if kind in (None, "regime") and status is None:
        candidates += _regime_items(kb, failed, symbol)
    results = []
    for summary, body in candidates:
        lowered = body.lower()
        score = sum(1 for t in terms if t in lowered)
        if terms and score == 0:
            continue
        results.append({**summary, "matched_terms": score})
    # Most recent first (research: last revision; regime: the record's day), then best match first.
    results.sort(key=lambda r: r.get("updated_at") or r["ref"].rsplit("/", 1)[-1], reverse=True)
    results.sort(key=lambda r: -r["matched_terms"])
    return {"query": text, "count": len(results), "results": results, "integrity_failed": failed}


def cited_by(kb: KnowledgeBase, ref: Ref) -> list[str]:
    """Investigations whose current revision cites ``ref`` (backlinks)."""
    failed: list[dict] = []
    return [s["ref"] for s, _, doc in _research_items(kb, failed) if str(ref) in _cited_refs(doc)]


def show(kb: KnowledgeBase, ref_text: str) -> dict:
    try:
        ref = parse_ref(ref_text)
    except KnowledgeBaseError as exc:
        raise KnowledgeError(str(exc)) from exc
    if ref.kind == "research":
        try:
            doc = kb.research.load(ref.key)
        except (ResearchIntegrityError, ResearchStoreError) as exc:
            raise KnowledgeError(f"{ref}: INTEGRITY_FAILED", [str(exc)]) from exc
        if doc is None:
            raise KnowledgeError(f"{ref}: no such investigation")
        cur = doc.current
        return {
            "ref": str(ref), "kind": "research", "path": _display_path(kb.research.path_for(ref.key), kb),
            "current": {
                "revision": cur.revision, "reason": cur.reason.value, "note": cur.note,
                "recorded_at": cur.recorded_at.isoformat(), "content": cur.content.model_dump(mode="json"),
                "resolved_refs": [r.model_dump(mode="json") for r in cur.resolved_refs],
            },
            "pending": {"status": cur.content.status.value, "next_steps": cur.content.next_steps,
                        "missing": cur.content.missing},
            "history": [{"revision": r.revision, "recorded_at": r.recorded_at.isoformat(), "reason": r.reason.value,
                         "note": r.note, "prompt": r.prompt, "host": r.host.model_dump(mode="json"),
                         "content_hash": r.content_hash} for r in doc.revisions],
            "cited_by": cited_by(kb, ref),
        }
    if ref.kind == "regime":
        symbol, day = ref.key.split("/")
        try:
            doc = kb.records.load(symbol, day)
        except (RecordIntegrityError, RecordStoreError) as exc:
            raise KnowledgeError(f"{ref}: INTEGRITY_FAILED", [str(exc)]) from exc
        if doc is None:
            raise KnowledgeError(f"{ref}: no such regime record")
        return {
            "ref": str(ref), "kind": "regime", "path": _display_path(kb.records.path_for(symbol, day), kb),
            "entries": [{
                "entry_id": e.entry_id, "prompt": e.request.prompt, "accepted_at": e.trace.accepted_at.isoformat(),
                "facts": e.facts, "accepted_payload": e.accepted_payload,
                "outcomes": [{"observed_at": o.observed_at.isoformat(), "facts": o.facts} for o in e.outcomes],
                "human_reviews": [r.model_dump(mode="json") for r in e.human_reviews],
            } for e in doc.entries],
            "cited_by": cited_by(kb, ref),
        }
    resolved = resolve_ref(str(ref), kb)
    return {"ref": str(ref), "kind": "file", "path": resolved.path, "content_hash": resolved.content_hash,
            "cited_by": cited_by(kb, ref)}
