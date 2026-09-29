"""File store for source access status: ``<knowledge>/sources/<source_id>.md``.

One file per source, its YAML frontmatter the authoritative
``SourceStatusDocument`` (GC-AI-0012, AC-02). Observations are append-only,
oldest first: writing checks that the new document's observations start with
every observation already on file, in the same order, byte for byte; anything
else is refused rather than silently overwriting history.

Same trust boundary and rendering discipline as ``record_store``: the Markdown
body is a deterministic summary re-derived from the frontmatter on every write
and compared on every read, so an edited file is reported as
``INTEGRITY_FAILED`` instead of being used.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from pydantic import ValidationError

from galecore_ai.adapters import frontmatter
from galecore_ai.adapters.knowledge_base import KnowledgeBaseError, knowledge_dir
from galecore_ai.contracts.source_status import SourceStatusDocument

_SOURCE_ID_RE = re.compile(r"^[a-z][a-z0-9_]{1,31}$")
SOURCE_STATUS_DIR_ENV = "GALECORE_SOURCE_STATUS_DIR"


class SourceStatusStoreError(Exception):
    """The store cannot be used (bad path, bad id, I/O failure, or a non-append write)."""


class SourceStatusIntegrityError(Exception):
    def __init__(self, path: Path, problems: list[str]) -> None:
        super().__init__(f"{path}: " + "; ".join(problems))
        self.path = path
        self.problems = problems


def default_source_status_dir() -> Path:
    """``GALECORE_SOURCE_STATUS_DIR`` or ``sources/`` inside the knowledge base."""
    configured = os.environ.get(SOURCE_STATUS_DIR_ENV)
    if configured:
        return Path(configured).expanduser().resolve()
    try:
        return (knowledge_dir() / "sources").resolve()
    except KnowledgeBaseError as exc:
        raise SourceStatusStoreError(f"{exc}; or set {SOURCE_STATUS_DIR_ENV}") from exc


class FileSourceStatusStore:
    def __init__(self, base_dir: Path) -> None:
        self._base_dir = base_dir.resolve()
        self._base_dir.mkdir(parents=True, exist_ok=True)

    @property
    def base_dir(self) -> Path:
        return self._base_dir

    def path_for(self, source_id: str) -> Path:
        if not _SOURCE_ID_RE.fullmatch(source_id):
            raise SourceStatusStoreError(f"Invalid source id: {source_id!r}")
        return self._base_dir / f"{source_id}.md"

    def load(self, source_id: str) -> SourceStatusDocument | None:
        path = self.path_for(source_id)
        if not path.is_file():
            return None
        return self.load_path(path)

    def load_path(self, path: Path) -> SourceStatusDocument:
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            raise SourceStatusIntegrityError(path, [f"unreadable: {exc}"]) from exc
        document = parse_document(text, path)
        if text != render_markdown(document):
            raise SourceStatusIntegrityError(path, ["markdown body disagrees with the frontmatter record"])
        if path.stem != document.source_id:
            raise SourceStatusIntegrityError(
                path, [f"document source_id {document.source_id!r} does not match file name {path.stem!r}"])
        return document

    def append(self, source_id: str, document: SourceStatusDocument) -> Path:
        """Write ``document`` for ``source_id``, refusing anything but a pure append.

        ``document`` must already contain every existing observation, unchanged, followed
        by the new one(s); this is what makes the write a genuine append rather than a
        rewrite of history.
        """
        if document.source_id != source_id:
            raise SourceStatusStoreError(f"document.source_id {document.source_id!r} != {source_id!r}")
        path = self.path_for(source_id)
        existing = self.load(source_id)
        if existing is not None:
            n = len(existing.observations)
            if document.observations[:n] != existing.observations:
                raise SourceStatusStoreError(
                    f"sources:{source_id}: refusing a write that is not a pure append of observations")
            if len(document.observations) <= n:
                raise SourceStatusStoreError(f"sources:{source_id}: append must add at least one observation")
        text = render_markdown(document)
        if parse_document(text, path) != document:
            raise SourceStatusStoreError("Rendered status document does not round-trip; refusing to write")
        frontmatter.atomic_write(path, text)
        return path


# ── parsing ──────────────────────────────────────────────────────


def parse_document(text: str, path: Path) -> SourceStatusDocument:
    try:
        data = frontmatter.read_frontmatter(text)
    except frontmatter.FrontmatterError as exc:
        raise SourceStatusIntegrityError(path, [str(exc)]) from exc
    try:
        return SourceStatusDocument.model_validate(data)
    except ValidationError as exc:
        raise SourceStatusIntegrityError(path, [f"frontmatter does not match the source status contract: {exc}"]) from exc


# ── rendering ────────────────────────────────────────────────────


def render_frontmatter(document: SourceStatusDocument) -> str:
    return frontmatter.render_frontmatter(document.model_dump(mode="json"))


def render_markdown(document: SourceStatusDocument) -> str:
    lines = [
        render_frontmatter(document).rstrip("\n"),
        "",
        f"# Estado de acceso — {document.source_id}",
        "",
        (f"_{len(document.observations)} observación(es); resumen derivado por galecore-ai del "
         "frontmatter de arriba, que es el registro autoritativo._"),
        "",
    ]
    for obs in document.observations:
        category = f" [{obs.category}]" if obs.category else ""
        lines += [
            f"- **{obs.observed_at.isoformat()}**{category} — `{obs.state.value}` ({obs.origin.value}): {obs.note}",
        ]
        if obs.evidence:
            lines[-1] += f" — evidencia: `{obs.evidence}`"
        if obs.host is not None:
            lines[-1] += f" — host: {obs.host.provider}/{obs.host.model}"
    lines.append("")
    return "\n".join(lines) + "\n"
