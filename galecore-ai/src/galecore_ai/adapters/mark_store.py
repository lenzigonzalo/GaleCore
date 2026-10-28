"""File store for marks: ``<knowledge>/marks/<id>.json`` (P1-08).

Same rules as the feedback store: create-only, and every read re-checks the hash, so
an edited file is reported as INTEGRITY_FAILED instead of being used.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import ValidationError

from galecore_ai.adapters.knowledge_base import RESEARCH_ID_RE
from galecore_ai.contracts.mark import MarkDocument, compute_mark_hash

MARK_ID_RE = RESEARCH_ID_RE  # <YYYY-MM-DD>-<slug>


class MarkStoreError(Exception):
    """The store cannot be used or a write was refused."""


class MarkIntegrityError(Exception):
    def __init__(self, path: Path, problems: list[str]) -> None:
        super().__init__(f"{path}: " + "; ".join(problems))
        self.path = path
        self.problems = problems


class FileMarkStore:
    def __init__(self, knowledge_base: Path) -> None:
        self._dir = knowledge_base.resolve() / "marks"

    def path_for(self, mark_id: str) -> Path:
        if not MARK_ID_RE.fullmatch(mark_id):
            raise MarkStoreError(f"Invalid mark id: {mark_id!r} (expected YYYY-MM-DD-slug)")
        return self._dir / f"{mark_id}.json"

    def ids(self) -> list[str]:
        if not self._dir.is_dir():
            return []
        return sorted(p.stem for p in self._dir.glob("*.json") if MARK_ID_RE.fullmatch(p.stem))

    def load(self, mark_id: str) -> MarkDocument | None:
        path = self.path_for(mark_id)
        if not path.is_file():
            return None
        try:
            document = MarkDocument.model_validate(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise MarkIntegrityError(path, [f"unreadable: {exc}"]) from exc
        except ValidationError as exc:
            raise MarkIntegrityError(path, [f"does not match the mark contract: {exc}"]) from exc
        problems = []
        if compute_mark_hash(document.hashable_content()) != document.content_hash:
            problems.append("content_hash mismatch")
        if document.id != mark_id:
            problems.append(f"document id {document.id!r} does not match file name {mark_id!r}")
        if problems:
            raise MarkIntegrityError(path, problems)
        return document

    def create(self, document: MarkDocument) -> Path:
        path = self.path_for(document.id)
        if compute_mark_hash(document.hashable_content()) != document.content_hash:
            raise MarkStoreError("Refusing to write a mark whose hash does not match its content")
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with path.open("x", encoding="utf-8", newline="\n") as fh:
                fh.write(json.dumps(document.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n")
        except FileExistsError as exc:
            raise MarkStoreError(f"mark {document.id} already exists; use another slug") from exc
        return path
