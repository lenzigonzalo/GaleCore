"""File store for evidence: ``<knowledge>/evidence/<id>.json``.

JSON rather than Markdown because the payload is a source response kept verbatim;
the investigation that cites it is the readable note. Create-only: an existing id
is never overwritten, and every read re-checks the hash, so an edited file is
reported as INTEGRITY_FAILED instead of being used. Removing a file or rewriting
it with a recomputed hash shows only in the knowledge base's git history.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import ValidationError

from galecore_ai.adapters.knowledge_base import RESEARCH_ID_RE
from galecore_ai.contracts.evidence import EvidenceDocument, compute_evidence_hash

EVIDENCE_ID_RE = RESEARCH_ID_RE  # <YYYY-MM-DD>-<slug>


class EvidenceStoreError(Exception):
    """The store cannot be used or a write was refused."""


class EvidenceIntegrityError(Exception):
    def __init__(self, path: Path, problems: list[str]) -> None:
        super().__init__(f"{path}: " + "; ".join(problems))
        self.path = path
        self.problems = problems


def _render(document: EvidenceDocument) -> str:
    return json.dumps(document.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n"


class FileEvidenceStore:
    def __init__(self, knowledge_base: Path) -> None:
        self._kb = knowledge_base.resolve()
        self._dir = self._kb / "evidence"

    def path_for(self, evidence_id: str) -> Path:
        if not EVIDENCE_ID_RE.fullmatch(evidence_id):
            raise EvidenceStoreError(f"Invalid evidence id: {evidence_id!r} (expected YYYY-MM-DD-slug)")
        return self._dir / f"{evidence_id}.json"

    def ids(self) -> list[str]:
        if not self._dir.is_dir():
            return []
        return sorted(p.stem for p in self._dir.glob("*.json") if EVIDENCE_ID_RE.fullmatch(p.stem))

    def load(self, evidence_id: str) -> EvidenceDocument | None:
        path = self.path_for(evidence_id)
        if not path.is_file():
            return None
        try:
            text = path.read_text(encoding="utf-8")
            document = EvidenceDocument.model_validate(json.loads(text))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise EvidenceIntegrityError(path, [f"unreadable: {exc}"]) from exc
        except ValidationError as exc:
            raise EvidenceIntegrityError(path, [f"does not match the evidence contract: {exc}"]) from exc
        problems = []
        if compute_evidence_hash(document.hashable_content()) != document.content_hash:
            problems.append("content_hash mismatch")
        if document.id != evidence_id:
            problems.append(f"document id {document.id!r} does not match file name {evidence_id!r}")
        if problems:
            raise EvidenceIntegrityError(path, problems)
        return document

    def create(self, document: EvidenceDocument) -> Path:
        path = self.path_for(document.id)
        if compute_evidence_hash(document.hashable_content()) != document.content_hash:
            raise EvidenceStoreError("Refusing to write evidence whose hash does not match its content")
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            # Exclusive creation: two writers of the same id cannot both succeed. A write interrupted
            # halfway leaves a file whose hash fails on read (INTEGRITY_FAILED), never a silent overwrite.
            with path.open("x", encoding="utf-8", newline="\n") as fh:
                fh.write(_render(document))
        except FileExistsError as exc:
            raise EvidenceStoreError(
                f"evidence:{document.id} already exists; a new reading is a new item") from exc
        return path
