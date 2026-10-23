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
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError

from galecore_ai.adapters.evidence_store import (
    EvidenceIntegrityError,
    EvidenceStoreError,
    FileEvidenceStore,
)
from galecore_ai.adapters.feedback_store import (
    FeedbackIntegrityError,
    FeedbackStoreError,
    FileFeedbackStore,
)
from galecore_ai.adapters.knowledge_base import KnowledgeBaseError, Ref, parse_ref, ref_path
from galecore_ai.adapters.mark_store import FileMarkStore, MarkIntegrityError, MarkStoreError
from galecore_ai.adapters.profile_store import (
    FileProfileStore,
    ProfileIntegrityError,
    ProfileStoreError,
)
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
from galecore_ai.adapters.strategy_store import (
    FileStrategyStore,
    StrategyIntegrityError,
    StrategyStoreError,
)
from galecore_ai.contracts.evidence import EvidenceContent, EvidenceDocument, compute_evidence_hash
from galecore_ai.contracts.feedback import (
    APPLIED_BY,
    FeedbackDocument,
    FeedbackKind,
    FeedbackTarget,
    compute_feedback_hash,
)
from galecore_ai.contracts.mark import MarkDocument, MarkKind, compute_mark_hash
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
from galecore_ai.harness.catalog import CatalogError, load_catalog
from galecore_ai.harness.definitions import SkillDefinition
from galecore_ai.harness.skill_history import SkillHistoryError, load_skill_history


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

    @property
    def evidence(self) -> FileEvidenceStore:
        return FileEvidenceStore(self.base)

    @property
    def strategies(self) -> FileStrategyStore:
        return FileStrategyStore(self.base)

    @property
    def profile(self) -> FileProfileStore:
        return FileProfileStore(self.base)

    @property
    def feedback(self) -> FileFeedbackStore:
        return FileFeedbackStore(self.base)

    @property
    def marks(self) -> FileMarkStore:
        return FileMarkStore(self.base)


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
    elif ref.kind == "evidence":
        try:
            if kb.evidence.load(ref.key) is None:
                raise KnowledgeError(f"{ref}: no such evidence")
        except (EvidenceIntegrityError, EvidenceStoreError) as exc:
            raise KnowledgeError(f"{ref}: not usable ({exc})") from exc
        path = kb.evidence.path_for(ref.key)
    elif ref.kind == "strategy":
        try:
            if kb.strategies.load(ref.key) is None:
                raise KnowledgeError(f"{ref}: no such strategy version")
        except (StrategyIntegrityError, StrategyStoreError) as exc:
            raise KnowledgeError(f"{ref}: not usable ({exc})") from exc
        path = kb.strategies.path_for(ref.key)
    elif ref.kind == "profile":
        try:
            if kb.profile.load(ref.key) is None:
                raise KnowledgeError(f"{ref}: no such profile version")
        except (ProfileIntegrityError, ProfileStoreError) as exc:
            raise KnowledgeError(f"{ref}: not usable ({exc})") from exc
        path = kb.profile.path_for(ref.key)
    elif ref.kind == "feedback":
        load_feedback(kb, str(ref))
        path = kb.feedback.path_for(ref.key)
    elif ref.kind == "project":
        from galecore_ai.application.project import load_log  # project builds on this module
        if not load_log(kb, ref.key).entries:
            raise KnowledgeError(f"{ref}: no entries in that project's log")
        path = ref_path(ref, kb.base)
    else:
        path = ref_path(ref, kb.base)
        if path.is_relative_to(kb.base.resolve()):
            # Knowledge items are cited by kind so their integrity (and self-citation) is checked.
            raise KnowledgeError(f"{ref}: points inside the knowledge base; cite it as regime:, research:, "
                                 "evidence:, strategy:, profile:, feedback: or project:")
        if not path.is_relative_to(kb.workspace.resolve()) or not path.is_file():
            raise KnowledgeError(f"{ref}: no such file inside the workspace")
    return ResolvedRef(ref=str(ref), path=_display_path(path, kb), content_hash=_sha256_file(path))


# ── investigations ───────────────────────────────────────────────


# A statement labelled as the host's own arithmetic (limits vs exposure, stop-loss sums) is never a fact.
_OWN_CALCULATION = re.compile(r"^\W*c[aá]lculo propio\b", re.IGNORECASE)


# The daily contrast's proposal per strategy (U-28, P1-05): «<name>: <proposal> — <reason> … qué la cambiaría: <x>».
CONTRAST_PROPOSALS = ("prender", "mantener", "esperar", "apagar", "sin datos")
_WOULD_CHANGE = re.compile(r"qu[eé] la cambiar[ií]a\s*:\s*(\S.*)", re.IGNORECASE | re.DOTALL)


def _contrast_problems(content: ResearchContent, kb: KnowledgeBase) -> list[str]:
    """One proposal per known strategy (its exact name), one of CONTRAST_PROPOSALS, saying what would change it."""
    from galecore_ai.application.project import _strategy_names  # lazy: project imports this module

    names = _strategy_names(kb)
    found: dict[str, list[tuple[str, str]]] = {n: [] for n in names}
    for s in content.statements:
        if s.kind != StatementKind.INTERPRETATION:
            continue
        for n in names:
            m = re.match(rf"\s*{re.escape(n)}\s*:\s*(.+?)\s*[—–-]\s", s.text)
            if m:
                found[n].append((m.group(1).strip().lower(), s.text))
    problems = []
    for n, hits in found.items():
        if not hits:
            problems.append(f"no proposal for {n}: «{n}: " + " | ".join(CONTRAST_PROPOSALS)
                            + " — <motivo> … qué la cambiaría: <dato>»")
            continue
        for proposal, text in hits:
            if proposal not in CONTRAST_PROPOSALS:
                problems.append(f"the proposal for {n} is «{proposal}»: use one of {', '.join(CONTRAST_PROPOSALS)}")
            if not _WOULD_CHANGE.search(text):
                problems.append(f"the proposal for {n} must say «qué la cambiaría: <dato y umbral>»")
    return problems


def check_content(content: ResearchContent, kb: KnowledgeBase, *, self_id: str | None = None,
                  capability: str | None = None) -> tuple[list[ResolvedRef], list[str]]:
    """Resolve every cited reference and apply the investigation's controls (and the capability's own, if any)."""
    problems: list[str] = []
    resolved: dict[str, ResolvedRef] = {}
    failed_marks: list[dict] = []
    marked = marks_index(kb, failed_marks)
    problems += [_broken_mark_message(f) for f in failed_marks]

    def cite(text: str, where: str) -> None:
        try:
            r = resolve_ref(text, kb)
        except KnowledgeError as exc:
            problems.append(f"{where}: {exc}")
            return
        if self_id and r.ref == f"research:{self_id}":
            problems.append(f"{where}: an investigation cannot cite itself")
            return
        if r.ref in marked:
            problems.append(f"{where}: {_marked_message(marked[r.ref])}")
            return
        resolved.setdefault(r.ref, r)

    for i, a in enumerate(content.antecedents):
        cite(a.ref, f"antecedents[{i}]")
    for i, s in enumerate(content.statements):
        if s.kind == StatementKind.FACT and not s.sources:
            problems.append(f"statements[{i}]: a fact must cite at least one source (a market or record ref); "
                            "what the owner said or prefers in the conversation is kind 'decision', not a fact")
        if s.kind == StatementKind.FACT and _OWN_CALCULATION.match(s.text):
            # Codex C1 of GC-AI-0015: the skill said so in prose and a fresh session still typed it as a fact.
            problems.append(f"statements[{i}]: own arithmetic ('Cálculo propio') is an interpretation, not a fact")
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
    if capability == "daily_contrast":
        problems += _contrast_problems(content, kb)
    return list(resolved.values()), problems


RESEARCH_CONTRACT = "galecore_ai.contracts.research.ResearchContent"


def research_skill(capability: str = "research") -> AssetEntry:
    """The skill a revision was written with: any catalog entry whose output is an investigation."""
    try:
        entry = load_catalog().get(capability)
    except CatalogError as exc:
        raise KnowledgeError(f"Unknown capability {capability!r}", [str(exc)]) from exc
    if entry.output_contract != RESEARCH_CONTRACT:
        raise KnowledgeError(f"Capability {capability!r} does not produce an investigation",
                             [f"its output contract is {entry.output_contract}"])
    skill = load_asset(entry.skill, SkillDefinition)
    return AssetEntry(asset_id=skill.skill_id, version=skill.version, content_hash=definition_hash(skill))


def _revision(*, number: int, reason: RevisionReason, note: str, prompt: str, host: RecordHost,
              content: ResearchContent, resolved: list[ResolvedRef], now: datetime,
              capability: str) -> ResearchRevision:
    draft = ResearchRevision(
        revision=number, recorded_at=now, reason=reason, note=note, prompt=prompt, host=host,
        skill=research_skill(capability), content=content, resolved_refs=resolved, content_hash="",
    )
    return draft.model_copy(update={"content_hash": compute_revision_hash(draft.hashable_content())})


def save_research(*, kb: KnowledgeBase, slug: str, prompt: str, host: RecordHost, content: ResearchContent,
                  now: datetime | None = None, capability: str = "research") -> tuple[ResearchDocument, Path]:
    now = now or datetime.now(UTC)
    research_id = f"{now.date().isoformat()}-{slug}"
    if not prompt.strip():
        raise KnowledgeError("Refusing to save", ["the user's prompt is required"])
    try:
        kb.research.path_for(research_id)
    except ResearchStoreError as exc:
        raise KnowledgeError("Refusing to save", [str(exc)]) from exc
    resolved, problems = check_content(content, kb, self_id=research_id, capability=capability)
    if problems:
        raise KnowledgeError("Refusing to save", problems)
    revision = _revision(number=1, reason=RevisionReason.INITIAL, note="", prompt=prompt, host=host,
                         content=content, resolved=resolved, now=now, capability=capability)
    document = ResearchDocument(id=research_id, created_at=now, revisions=[revision])
    try:
        path = kb.research.create(document)
    except ResearchStoreError as exc:
        raise KnowledgeError("Refusing to save", [str(exc)]) from exc
    return document, path


def revise_research(*, kb: KnowledgeBase, research_id: str, reason: RevisionReason, note: str, prompt: str,
                    host: RecordHost, content: ResearchContent, now: datetime | None = None,
                    capability: str = "research") -> tuple[ResearchDocument, Path]:
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
    resolved, content_problems = check_content(content, kb, self_id=research_id, capability=capability)
    problems += content_problems
    if problems:
        raise KnowledgeError("Refusing to revise", problems)
    revision = _revision(number=len(current.revisions) + 1, reason=reason, note=note, prompt=prompt,
                         host=host, content=content, resolved=resolved, now=now, capability=capability)
    try:
        return kb.research.append(research_id, revision)
    except (ResearchIntegrityError, ResearchStoreError) as exc:
        raise KnowledgeError("Refusing to revise", [str(exc)]) from exc


# ── evidence ─────────────────────────────────────────────────────


def save_evidence(*, kb: KnowledgeBase, slug: str, prompt: str, host: RecordHost, content: EvidenceContent,
                  now: datetime | None = None) -> tuple[EvidenceDocument, Path]:
    """Keep one source response with its provenance. Always HOST_DECLARED; never overwrites."""
    now = now or datetime.now(UTC)
    evidence_id = f"{now.date().isoformat()}-{slug}"
    if not prompt.strip():
        raise KnowledgeError("Refusing to save", ["the user's prompt is required"])
    if content.retrieved_at > now:
        raise KnowledgeError("Refusing to save", ["retrieved_at is in the future"])
    try:
        draft = EvidenceDocument(id=evidence_id, recorded_at=now, host=host, prompt=prompt, content=content,
                                 content_hash="")
    except ValidationError as exc:
        raise KnowledgeError("Refusing to save", [str(exc)]) from exc
    document = draft.model_copy(update={"content_hash": compute_evidence_hash(draft.hashable_content())})
    try:
        path = kb.evidence.create(document)
    except EvidenceStoreError as exc:
        raise KnowledgeError("Refusing to save", [str(exc)]) from exc
    return document, path


def _evidence_items(kb: KnowledgeBase, failed: list[dict]) -> list[tuple[dict, str]]:
    items = []
    for eid in kb.evidence.ids():
        try:
            doc = kb.evidence.load(eid)
        except (EvidenceIntegrityError, EvidenceStoreError) as exc:
            failed.append({"ref": f"evidence:{eid}", "status": "INTEGRITY_FAILED", "problems": [str(exc)]})
            continue
        if doc is None:
            continue
        c = doc.content
        summary = {
            "ref": f"evidence:{eid}", "kind": "evidence", "title": f"{c.source} · {c.tool}",
            "provenance": doc.provenance, "retrieved_at": c.retrieved_at.isoformat(),
            "series": [s.name for s in c.series], "updated_at": doc.recorded_at.isoformat(),
            "path": _display_path(kb.evidence.path_for(eid), kb),
        }
        text = " ".join([eid, c.source, c.tool, *map(str, c.params.values()), *c.access_notes,
                         *[f"{s.name} {s.unit} {s.frequency} {s.revision_note}" for s in c.series]])
        items.append((summary, text))
    return items


# ── marks: corrected, superseded, retired (P1-08) ────────────────


def marks_index(kb: KnowledgeBase, failed: list[dict]) -> dict[str, MarkDocument]:
    """Marked reference → its mark. A broken mark is reported in ``failed``, never ignored."""
    out: dict[str, MarkDocument] = {}
    for mid in kb.marks.ids():
        try:
            doc = kb.marks.load(mid)
        except (MarkIntegrityError, MarkStoreError) as exc:
            failed.append({"ref": f"mark:{mid}", "status": "INTEGRITY_FAILED", "problems": [str(exc)]})
            continue
        if doc is not None:
            out.setdefault(doc.ref, doc)
    return out


def _broken_mark_message(failed: dict) -> str:
    return (f"marks: {failed['ref']} is not usable ({'; '.join(failed['problems'])}); restore that file from the "
            "knowledge base's git (git -C knowledge checkout -- marks/<id>.json): until then nothing can be checked "
            "against the marks")


def _marked_message(mark: MarkDocument) -> str:
    by = f"; use {mark.by}" if mark.by else ""
    return f"{mark.ref} is {mark.mark.value} ({mark.recorded_at.date().isoformat()}: {mark.reason}){by}"


def _mark_summary(mark: MarkDocument) -> dict:
    return {"mark": mark.mark.value, "reason": mark.reason, "by": mark.by or None,
            "marked_at": mark.recorded_at.isoformat(), "id": mark.id}


def save_mark(*, kb: KnowledgeBase, slug: str, ref: str, mark: MarkKind, reason: str, by: str, prompt: str,
              host: RecordHost, now: datetime | None = None) -> tuple[MarkDocument, Path]:
    """Mark an intact item as corrected, superseded or retired; it is kept but no longer cited or listed."""
    now = now or datetime.now(UTC)
    problems: list[str] = []
    if ref.strip().startswith("profile:"):
        raise KnowledgeError("Refusing to mark", [("a profile version is replaced by a new one (profile set), not "
                                                   "marked: every result must cite the version in force")])
    try:
        target = resolve_ref(ref, kb)
    except KnowledgeError as exc:
        raise KnowledgeError("Refusing to mark", [str(exc)]) from exc
    failed: list[dict] = []
    marked = marks_index(kb, failed)
    problems += [_broken_mark_message(f) for f in failed]
    if target.ref in marked:
        problems.append(f"{target.ref} is already marked: {_marked_message(marked[target.ref])}")
    by_ref = ""
    if by.strip():
        try:
            by_ref = resolve_ref(by, kb).ref
        except KnowledgeError as exc:
            problems.append(f"by: {exc}")
        else:
            if by_ref in marked:
                problems.append(f"by: {_marked_message(marked[by_ref])}")
    if problems:
        raise KnowledgeError("Refusing to mark", problems)
    try:
        draft = MarkDocument(id=f"{now.date().isoformat()}-{slug}", recorded_at=now, host=host, ref=target.ref,
                             ref_hash=target.content_hash, mark=mark, reason=reason, by=by_ref, prompt=prompt,
                             content_hash="")
    except ValidationError as exc:
        raise KnowledgeError("Refusing to mark", [f"{'.'.join(map(str, e['loc'])) or 'mark'}: {e['msg']}"
                                                  for e in exc.errors()]) from exc
    document = draft.model_copy(update={"content_hash": compute_mark_hash(draft.hashable_content())})
    try:
        path = kb.marks.create(document)
    except MarkStoreError as exc:
        raise KnowledgeError("Refusing to mark", [str(exc)]) from exc
    return document, path


# ── feedback ─────────────────────────────────────────────────────


def load_feedback(kb: KnowledgeBase, ref_text: str) -> FeedbackDocument:
    """An intact feedback item, or KnowledgeError."""
    try:
        ref = parse_ref(ref_text)
    except KnowledgeBaseError as exc:
        raise KnowledgeError(str(exc)) from exc
    if ref.kind != "feedback":
        raise KnowledgeError(f"{ref}: not a feedback reference (expected feedback:<id>)")
    try:
        doc = kb.feedback.load(ref.key)
    except (FeedbackIntegrityError, FeedbackStoreError) as exc:
        raise KnowledgeError(f"{ref}: not usable ({exc})") from exc
    if doc is None:
        raise KnowledgeError(f"{ref}: no such feedback")
    return doc


def _version_key(version: str) -> tuple[int, ...] | None:
    """MAJOR.MINOR.PATCH as a comparable tuple; None when it is not that shape."""
    parts = version.split(".")
    return tuple(int(p) for p in parts) if len(parts) == 3 and all(p.isdigit() for p in parts) else None


def is_later_version(applied: str, about: str) -> bool:
    """True when ``applied`` is a later version than the one the feedback is about."""
    a, b = _version_key(applied), _version_key(about)
    return a is not None and b is not None and a > b


MIN_CASES_FOR_A_RULE = 2  # §1.6.4: one result does not become a rule without repetition or the owner's decision


def check_feedback_citations(kb: KnowledgeBase, refs: list[str], *, kind: FeedbackKind,
                             skill_id: str | None = None, applied_version: str | None = None,
                             owner_decision: str = "") -> list[str]:
    """Problems with citing ``refs`` where a feedback of ``kind`` is applied (profile or skill history).

    For a skill, the feedback must be about that skill and about an earlier result: a
    version cannot be the correction of a result it produced itself. And one case is not a
    rule: a method change needs comments on at least MIN_CASES_FOR_A_RULE different results,
    or the owner's explicit decision (their words) in the version note.
    """
    problems = []
    results: set[str] = set()
    failed_marks: list[dict] = []
    marked = marks_index(kb, failed_marks)
    problems += [_broken_mark_message(f) for f in failed_marks]
    for text in refs:
        try:
            doc = load_feedback(kb, text)
        except KnowledgeError as exc:
            problems.append(str(exc))
            continue
        if doc.ref in marked:
            problems.append(_marked_message(marked[doc.ref]))
        elif doc.classification != kind:
            problems.append(f"{doc.ref} is classified as {doc.classification.value}; it is applied in "
                            f"{APPLIED_BY[doc.classification]}, not here")
        elif skill_id is not None and doc.target.skill.asset_id != skill_id:
            problems.append(f"{doc.ref} is about skill {doc.target.skill.asset_id}, not {skill_id}")
        elif applied_version is not None and not is_later_version(applied_version, doc.target.skill.version):
            problems.append(f"{doc.ref} is about a result of version {doc.target.skill.version}; only a later "
                            f"version can apply it, not {applied_version}")
        else:
            results.add(doc.target.research)
    if kind == FeedbackKind.METHOD and refs and len(results) < MIN_CASES_FOR_A_RULE and not owner_decision.strip():
        problems.append(f"one case is not a rule: a method change needs feedback on at least {MIN_CASES_FOR_A_RULE} "
                        "different results, or the owner's explicit decision (owner_decision, their words)")
    return problems


def save_feedback(*, kb: KnowledgeBase, slug: str, words: str, classification: FeedbackKind, research: str,
                  revision: int, prompt: str, host: RecordHost, formulation: str = "",
                  now: datetime | None = None) -> tuple[FeedbackDocument, Path]:
    """Keep the user's comment tied to one stored revision; skill and version come from that revision."""
    now = now or datetime.now(UTC)
    feedback_id = f"{now.date().isoformat()}-{slug}"
    try:
        ref = parse_ref(research)
    except KnowledgeBaseError as exc:
        raise KnowledgeError("Refusing to save", [str(exc)]) from exc
    if ref.kind != "research":
        raise KnowledgeError("Refusing to save", [f"{ref}: feedback is about a stored result (research:<id>)"])
    try:
        doc = kb.research.load(ref.key)
    except (ResearchIntegrityError, ResearchStoreError) as exc:
        raise KnowledgeError("Refusing to save", [f"{ref}: not usable ({exc})"]) from exc
    if doc is None:
        raise KnowledgeError("Refusing to save", [f"{ref}: no such investigation"])
    rev = next((r for r in doc.revisions if r.revision == revision), None)
    if rev is None:
        raise KnowledgeError("Refusing to save", [f"{ref} has no revision {revision} (it has {len(doc.revisions)})"])
    target = FeedbackTarget(research=str(ref), revision=rev.revision, revision_hash=rev.content_hash,
                            skill=rev.skill)
    try:
        draft = FeedbackDocument(id=feedback_id, recorded_at=now, host=host, words=words, formulation=formulation,
                                 classification=classification, target=target, prompt=prompt, content_hash="")
    except ValidationError as exc:
        # loc + msg only: the rejected text may carry a credential.
        raise KnowledgeError("Refusing to save", [f"{'.'.join(map(str, e['loc']))}: {e['msg']}"
                                                  for e in exc.errors()]) from exc
    document = draft.model_copy(update={"content_hash": compute_feedback_hash(draft.hashable_content())})
    try:
        path = kb.feedback.create(document)
    except FeedbackStoreError as exc:
        raise KnowledgeError("Refusing to save", [str(exc)]) from exc
    return document, path


def _skill_citations(failed: list[dict]) -> dict[str, list[dict]]:
    """feedback:<id> → skill versions whose history cites it."""
    out: dict[str, list[dict]] = {}
    try:
        entries = load_catalog().entries
    except CatalogError as exc:
        failed.append({"ref": "catalog", "status": "UNUSABLE", "problems": [str(exc)]})
        return out
    for entry in entries:
        try:
            history = load_skill_history(entry.skill)
        except SkillHistoryError as exc:
            failed.append({"ref": f"skill:{entry.id}", "status": "UNUSABLE", "problems": [str(exc)]})
            continue
        for note in history.versions:
            for ref in note.feedback:
                out.setdefault(ref, []).append({"where": "skill", "skill": history.skill_id,
                                                "version": note.version, "changes": note.changes})
    return out


def feedback_status(kb: KnowledgeBase) -> dict:
    """Every feedback item: applied or pending, and where it was cited.

    Applied means cited where its classification is applied: a revision of the same
    investigation (case), a profile version (preference) or the history of the skill
    that produced the result (method). A citation elsewhere is listed but does not count.
    """
    failed: list[dict] = []
    citations: dict[str, list[dict]] = _skill_citations(failed)
    for key in kb.profile.versions():
        try:
            pv = kb.profile.load(key)
        except (ProfileIntegrityError, ProfileStoreError) as exc:
            failed.append({"ref": f"profile:{key}", "status": "INTEGRITY_FAILED", "problems": [str(exc)]})
            continue
        for ref in pv.feedback if pv else []:
            citations.setdefault(ref, []).append({"where": "profile", "ref": pv.ref, "note": pv.note})
    for summary, _, doc in _research_items(kb, failed):
        for rev in doc.revisions:
            for r in rev.resolved_refs:
                if r.ref.startswith("feedback:"):
                    citations.setdefault(r.ref, []).append({"where": "research", "ref": summary["ref"],
                                                            "revision": rev.revision, "note": rev.note})
    marked = marks_index(kb, failed)
    docs = []
    for fid in kb.feedback.ids():
        try:
            fb = kb.feedback.load(fid)
        except (FeedbackIntegrityError, FeedbackStoreError) as exc:
            failed.append({"ref": f"feedback:{fid}", "status": "INTEGRITY_FAILED", "problems": [str(exc)]})
            continue
        if fb is not None:
            docs.append(fb)
    def applied(fb: FeedbackDocument) -> list[dict]:
        return [c for c in citations.get(fb.ref, []) if c["where"] == APPLIED_BY[fb.classification] and (
            c["where"] == "profile"
            or (c["where"] == "research" and c["ref"] == fb.target.research)
            or (c["where"] == "skill" and c["skill"] == fb.target.skill.asset_id
                and is_later_version(c["version"], fb.target.skill.version)))]

    pending = {fb.ref for fb in docs if fb.ref not in marked and not applied(fb)}
    items = []
    for fb in docs:
        cited = citations.get(fb.ref, [])
        applied_in = applied(fb)
        status = marked[fb.ref].mark.value if fb.ref in marked else "applied" if applied_in else "pending"
        item = {"ref": fb.ref, "classification": fb.classification.value, "words": fb.words,
                "formulation": fb.formulation, "about": f"{fb.target.research} r{fb.target.revision}",
                "skill": f"{fb.target.skill.asset_id} {fb.target.skill.version}",
                "status": status, "applied_in": applied_in,
                "cited_elsewhere": [c for c in cited if c not in applied_in],
                "recorded_at": fb.recorded_at.isoformat()}
        if status == "pending" and fb.classification == FeedbackKind.METHOD:
            # One case is not a rule (§1.6.4): which other pending comments on the same skill repeat it.
            item["same_skill_pending"] = [
                o.ref for o in docs if o.ref != fb.ref and o.ref in pending
                and o.classification == FeedbackKind.METHOD and o.target.skill.asset_id == fb.target.skill.asset_id
                and o.target.research != fb.target.research]
        items.append(item)
    return {"count": len(items), "pending": sum(i["status"] == "pending" for i in items), "feedback": items,
            "integrity_failed": failed}


def _feedback_items(kb: KnowledgeBase, failed: list[dict]) -> list[tuple[dict, str]]:
    items = []
    for fid in kb.feedback.ids():
        try:
            fb = kb.feedback.load(fid)
        except (FeedbackIntegrityError, FeedbackStoreError) as exc:
            failed.append({"ref": f"feedback:{fid}", "status": "INTEGRITY_FAILED", "problems": [str(exc)]})
            continue
        if fb is None:
            continue
        summary = {"ref": fb.ref, "kind": "feedback", "title": f"Feedback ({fb.classification.value}): {fb.words}",
                   "about": f"{fb.target.research} r{fb.target.revision}",
                   "skill": f"{fb.target.skill.asset_id} {fb.target.skill.version}",
                   "updated_at": fb.recorded_at.isoformat(), "path": _display_path(kb.feedback.path_for(fid), kb)}
        text = (f"feedback comentario {fb.words} {fb.formulation} {fb.classification.value} "
                f"{fb.target.research} {fb.target.skill.asset_id}")
        items.append((summary, text))
    return items


# ── search and show ──────────────────────────────────────────────


def _strategy_items(kb: KnowledgeBase, failed: list[dict]) -> list[tuple[dict, str]]:
    items = []
    for key in kb.strategies.versions():
        try:
            doc = kb.strategies.load(key)
            approval = kb.strategies.load_approval(key)
        except (StrategyIntegrityError, StrategyStoreError) as exc:
            failed.append({"ref": f"strategy:{key}", "status": "INTEGRITY_FAILED", "problems": [str(exc)]})
            continue
        if doc is None:
            continue
        c = doc.content
        summary = {
            "ref": f"strategy:{key}", "kind": "strategy", "title": c.display_name, "purpose": c.purpose,
            "spec_hash": doc.spec_hash, "check": doc.check.verdict, "approved": approval is not None,
            "updated_at": (approval.recorded_at if approval else doc.recorded_at).isoformat(),
            "path": _display_path(kb.strategies.path_for(key), kb),
        }
        body = " ".join([c.name, c.display_name, c.purpose, c.hypothesis.mechanism, *(r.text for r in c.rules)])
        items.append((summary, body))
    return items


def _profile_items(kb: KnowledgeBase, failed: list[dict]) -> list[tuple[dict, str]]:
    items = []
    for key in kb.profile.versions():
        try:
            doc = kb.profile.load(key)
        except (ProfileIntegrityError, ProfileStoreError) as exc:
            failed.append({"ref": f"profile:{key}", "status": "INTEGRITY_FAILED", "problems": [str(exc)]})
            continue
        if doc is None:
            continue
        summary = {"ref": doc.ref, "kind": "profile", "title": f"Perfil {key}: {doc.note}",
                   "missing": doc.content.missing(), "updated_at": doc.recorded_at.isoformat(),
                   "path": _display_path(kb.profile.path_for(key), kb)}
        items.append((summary, " ".join(["perfil profile", doc.note, doc.prompt,
                                         json.dumps(doc.content.model_dump(mode="json"), ensure_ascii=False)])))
    return items


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
_DAY = re.compile(r"\d{4}-\d{2}-\d{2}")


def _item_day(summary: dict) -> str | None:
    """YYYY-MM-DD the item was last updated (a regime record: its day); None when it has no date."""
    text = summary.get("updated_at") or (summary["ref"].rsplit("/", 1)[-1] if summary["kind"] == "regime" else "")
    return text[:10] if _DAY.match(text) else None


def _project_names(kb: KnowledgeBase) -> list[str]:
    """Lab projects (``strategies/<p>``, ``workspaces/<p>``): a research is theirs when its slug ends in the name."""
    return sorted({d.name for sub in ("strategies", "workspaces") if (kb.base / sub).is_dir()
                   for d in (kb.base / sub).iterdir() if d.is_dir()}, key=len, reverse=True)


def _research_project(ref: str, projects: list[str]) -> str | None:
    tail = ref.split(":", 1)[-1].split("-", 3)[-1]
    return next((p for p in projects if tail == p.replace("_", "-") or tail.endswith("-" + p.replace("_", "-"))), None)


def search(kb: KnowledgeBase, *, text: str = "", kind: str | None = None, status: str | None = None,
           symbol: str | None = None, include_marked: bool = False, since: str | None = None) -> dict:
    """Items whose text contains the query terms, best match first. Broken items are reported, never skipped.

    Marked items (corrected, superseded, retired) are left out unless ``include_marked``; ``since``
    (YYYY-MM-DD) keeps the items updated on or after that day.
    """
    terms = [t for t in text.lower().split() if t]
    failed: list[dict] = []
    marked = marks_index(kb, failed)
    candidates: list[tuple[dict, str]] = []
    wanted = UNFINISHED if status == "unfinished" else {status}
    if kind in (None, "research"):
        projects = _project_names(kb)
        candidates += [({**s, "project": _research_project(s["ref"], projects)}, t)
                       for s, t, _ in _research_items(kb, failed) if status is None or s["status"] in wanted]
    if kind in (None, "regime") and status is None:
        candidates += _regime_items(kb, failed, symbol)
    if kind in (None, "evidence") and status is None:
        candidates += _evidence_items(kb, failed)
    if kind in (None, "strategy") and status is None:
        candidates += _strategy_items(kb, failed)
    if kind in (None, "profile") and status is None:
        candidates += _profile_items(kb, failed)
    if kind in (None, "feedback") and status is None:
        candidates += _feedback_items(kb, failed)
    if kind in (None, "project") and status is None:
        from galecore_ai.application.project import search_items  # project builds on this module
        candidates += search_items(kb, failed)
    results = []
    left_out = 0
    for summary, body in candidates:
        lowered = body.lower()
        score = sum(1 for t in terms if t in lowered)
        if terms and score == 0:
            continue
        if since and _item_day(summary) and _item_day(summary) < since:
            continue
        if summary["ref"] in marked:
            if not include_marked:
                left_out += 1
                continue
            summary = {**summary, "marked": _mark_summary(marked[summary["ref"]])}
        results.append({**summary, "matched_terms": score})
    # Most recent first (research: last revision; regime: the record's day), then best match first.
    results.sort(key=lambda r: r.get("updated_at") or r["ref"].rsplit("/", 1)[-1], reverse=True)
    results.sort(key=lambda r: -r["matched_terms"])
    return {"query": text, "count": len(results), "results": results, "marked_left_out": left_out,
            "integrity_failed": failed}


def cited_by(kb: KnowledgeBase, ref: Ref) -> list[str]:
    """Investigations whose current revision cites ``ref`` (backlinks)."""
    failed: list[dict] = []
    return [s["ref"] for s, _, doc in _research_items(kb, failed) if str(ref) in _cited_refs(doc)]


def show(kb: KnowledgeBase, ref_text: str) -> dict:
    """One item with what cites it, and its mark when it was corrected, superseded or retired."""
    result = _show(kb, ref_text)
    failed: list[dict] = []
    mark = marks_index(kb, failed).get(result["ref"])
    result["marked"] = _mark_summary(mark) if mark else None
    if failed:
        result["marks_integrity_failed"] = failed
    return result


def _show(kb: KnowledgeBase, ref_text: str) -> dict:
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
    if ref.kind == "evidence":
        try:
            doc = kb.evidence.load(ref.key)
        except (EvidenceIntegrityError, EvidenceStoreError) as exc:
            raise KnowledgeError(f"{ref}: INTEGRITY_FAILED", [str(exc)]) from exc
        if doc is None:
            raise KnowledgeError(f"{ref}: no such evidence")
        return {"ref": str(ref), "kind": "evidence", "path": _display_path(kb.evidence.path_for(ref.key), kb),
                **doc.model_dump(mode="json"), "cited_by": cited_by(kb, ref)}
    if ref.kind == "strategy":
        try:
            doc = kb.strategies.load(ref.key)
            approval = kb.strategies.load_approval(ref.key)
        except (StrategyIntegrityError, StrategyStoreError) as exc:
            raise KnowledgeError(f"{ref}: INTEGRITY_FAILED", [str(exc)]) from exc
        if doc is None:
            raise KnowledgeError(f"{ref}: no such strategy version")
        return {"ref": str(ref), "kind": "strategy", "path": _display_path(kb.strategies.path_for(ref.key), kb),
                **doc.model_dump(mode="json"),
                "approval": approval.model_dump(mode="json") if approval else None,
                "cited_by": cited_by(kb, ref)}
    if ref.kind == "profile":
        try:
            doc = kb.profile.load(ref.key)
        except (ProfileIntegrityError, ProfileStoreError) as exc:
            raise KnowledgeError(f"{ref}: INTEGRITY_FAILED", [str(exc)]) from exc
        if doc is None:
            raise KnowledgeError(f"{ref}: no such profile version")
        return {"ref": str(ref), "kind": "profile", "path": _display_path(kb.profile.path_for(ref.key), kb),
                **doc.model_dump(mode="json"), "missing": doc.content.missing(), "cited_by": cited_by(kb, ref)}
    if ref.kind == "feedback":
        try:
            doc = kb.feedback.load(ref.key)
        except (FeedbackIntegrityError, FeedbackStoreError) as exc:
            raise KnowledgeError(f"{ref}: INTEGRITY_FAILED", [str(exc)]) from exc
        if doc is None:
            raise KnowledgeError(f"{ref}: no such feedback")
        state = next((i for i in feedback_status(kb)["feedback"] if i["ref"] == str(ref)), {})
        return {"ref": str(ref), "kind": "feedback", "path": _display_path(kb.feedback.path_for(ref.key), kb),
                **doc.model_dump(mode="json"), "status": state.get("status"),
                "applied_in": state.get("applied_in", []), "cited_by": cited_by(kb, ref)}
    if ref.kind == "project":
        from galecore_ai.application.project import load_log  # project builds on this module
        log = load_log(kb, ref.key)
        return {"ref": str(ref), "kind": "project", "path": _display_path(ref_path(ref, kb.base), kb),
                **log.model_dump(mode="json"), "cited_by": cited_by(kb, ref)}
    resolved = resolve_ref(str(ref), kb)
    return {"ref": str(ref), "kind": "file", "path": resolved.path, "content_hash": resolved.content_hash,
            "cited_by": cited_by(kb, ref)}
