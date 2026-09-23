"""File store for investigations: ``<knowledge>/research/<id>.md``.

Same shape as the regime record store: the YAML frontmatter is the authoritative
``ResearchDocument``; the Markdown body is derived from it on every write and
compared on every read, so what a human (or Obsidian) sees cannot disagree with
the record. Links in the body are relative, so they resolve in any Markdown
reader.

Revisions are append-only: ``append`` re-reads the file, requires every stored
revision to be intact and unchanged, and only then adds the new one.
"""

from __future__ import annotations

import os
from pathlib import Path

from pydantic import ValidationError

from galecore_ai.adapters import frontmatter
from galecore_ai.adapters.knowledge_base import (
    RESEARCH_ID_RE,
    KnowledgeBaseError,
    parse_ref,
    ref_path,
)
from galecore_ai.contracts.research import (
    ResearchDocument,
    ResearchRevision,
    StatementKind,
    compute_revision_hash,
)


class ResearchStoreError(Exception):
    """The store cannot be used or a write was refused."""


class ResearchIntegrityError(Exception):
    def __init__(self, path: Path, problems: list[str]) -> None:
        super().__init__(f"{path}: " + "; ".join(problems))
        self.path = path
        self.problems = problems


def verify_revision(revision: ResearchRevision, expected_number: int) -> list[str]:
    problems: list[str] = []
    if revision.revision != expected_number:
        problems.append(f"revision {revision.revision}: expected number {expected_number}")
    if compute_revision_hash(revision.hashable_content()) != revision.content_hash:
        problems.append(f"revision {revision.revision}: content_hash mismatch")
    return problems


def verify_document(document: ResearchDocument) -> list[str]:
    if not document.revisions:
        return ["document has no revisions"]
    return [p for i, rev in enumerate(document.revisions, 1) for p in verify_revision(rev, i)]


class FileResearchStore:
    def __init__(self, knowledge_base: Path) -> None:
        self._kb = knowledge_base.resolve()
        self._dir = self._kb / "research"

    @property
    def knowledge_base(self) -> Path:
        return self._kb

    def path_for(self, research_id: str) -> Path:
        if not RESEARCH_ID_RE.match(research_id):
            raise ResearchStoreError(f"Invalid research id: {research_id!r} (expected YYYY-MM-DD-slug)")
        return self._dir / f"{research_id}.md"

    def ids(self) -> list[str]:
        if not self._dir.is_dir():
            return []
        return sorted(p.stem for p in self._dir.glob("*.md") if RESEARCH_ID_RE.match(p.stem))

    # ── read ──────────────────────────────────────────────────────

    def load(self, research_id: str) -> ResearchDocument | None:
        path = self.path_for(research_id)
        if not path.is_file():
            return None
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            raise ResearchIntegrityError(path, [f"unreadable: {exc}"]) from exc
        try:
            document = ResearchDocument.model_validate(frontmatter.read_frontmatter(text))
        except frontmatter.FrontmatterError as exc:
            raise ResearchIntegrityError(path, [str(exc)]) from exc
        except ValidationError as exc:
            raise ResearchIntegrityError(path, [f"frontmatter does not match the research contract: {exc}"]) from exc
        problems = verify_document(document)
        if document.id != research_id:
            problems.append(f"document id {document.id!r} does not match file name {research_id!r}")
        if text != self.render(document):
            problems.append("markdown body disagrees with the frontmatter record")
        if problems:
            raise ResearchIntegrityError(path, problems)
        return document

    # ── write ─────────────────────────────────────────────────────

    def create(self, document: ResearchDocument) -> Path:
        path = self.path_for(document.id)
        if path.exists():
            raise ResearchStoreError(f"research:{document.id} already exists; use a revision to continue it")
        self._write(document, path)
        return path

    def append(self, research_id: str, revision: ResearchRevision) -> tuple[ResearchDocument, Path]:
        current = self.load(research_id)
        if current is None:
            raise ResearchStoreError(f"research:{research_id} does not exist")
        updated = current.model_copy(update={"revisions": [*current.revisions, revision]})
        path = self.path_for(research_id)
        self._write(updated, path)
        return updated, path

    def _write(self, document: ResearchDocument, path: Path) -> None:
        problems = verify_document(document)
        if problems:
            raise ResearchStoreError("Refusing to write an inconsistent document: " + "; ".join(problems))
        text = self.render(document)
        if ResearchDocument.model_validate(frontmatter.read_frontmatter(text)) != document:
            raise ResearchStoreError("Rendered research does not round-trip; refusing to write")
        frontmatter.atomic_write(path, text)

    # ── rendering ─────────────────────────────────────────────────

    def _link(self, ref_text: str, from_path: Path) -> str:
        """Markdown link to a reference, relative to the note (plain text if it cannot be a link)."""
        try:
            target = ref_path(parse_ref(ref_text), self._kb)
        except KnowledgeBaseError:
            return f"`{ref_text}`"
        rel = os.path.relpath(target, from_path.parent).replace("\\", "/")
        return f"[`{ref_text}`]({rel.replace(' ', '%20')})"

    def render(self, document: ResearchDocument) -> str:
        path = self.path_for(document.id)
        rev = document.current
        c = rev.content
        link = lambda r: self._link(r, path)

        lines = [
            frontmatter.render_frontmatter(document.model_dump(mode="json")).rstrip("\n"),
            "",
            f"# {c.title}",
            "",
            (f"_Investigación `research:{document.id}` · estado **{c.status.value}** · revisión {rev.revision} "
             f"({rev.reason.value}) · {rev.recorded_at.isoformat()}. Resumen derivado del frontmatter, que es el "
             "registro autoritativo._"),
            "",
            "## Pregunta",
            "",
            c.question,
            "",
        ]
        if c.hypothesis:
            lines += ["## Hipótesis", "", c.hypothesis, ""]
        if c.antecedents:
            lines += ["## Antecedentes", ""]
            for a in c.antecedents:
                lines.append(f"- {link(a.ref)} — {a.summary} **Efecto:** {a.bearing}")
            lines.append("")
        headings = {
            StatementKind.FACT: "Hechos",
            StatementKind.INTERPRETATION: "Interpretaciones",
            StatementKind.HYPOTHESIS: "Hipótesis de trabajo",
            StatementKind.DECISION: "Decisiones",
        }
        for kind, heading in headings.items():
            items = [s for s in c.statements if s.kind == kind]
            if items:
                lines += [f"## {heading}", ""]
                for s in items:
                    src = f" ({', '.join(link(r) for r in s.sources)})" if s.sources else ""
                    lines.append(f"- {s.text}{src}")
                lines.append("")
        if c.test_plan:
            lines += ["## Plan de prueba", ""]
            for i, t in enumerate(c.test_plan, 1):
                lines += [
                    f"{i}. {t.step}",
                    f"   - Datos: {t.data_needed}",
                    f"   - La apoya si: {t.supports_if}",
                    f"   - La debilita si: {t.weakens_if}",
                ]
            lines.append("")
        for heading, items in (("Falta", c.missing), ("Siguientes pasos", c.next_steps),
                               ("Limitaciones", c.limitations)):
            if items:
                lines += [f"## {heading}", "", *[f"- {i}" for i in items], ""]
        lines += ["## Historial", ""]
        for r in document.revisions:
            note = f": {r.note}" if r.note else ""
            lines.append(f"- r{r.revision} · {r.recorded_at.isoformat()} · {r.reason.value}{note}")
        return "\n".join(lines) + "\n"
