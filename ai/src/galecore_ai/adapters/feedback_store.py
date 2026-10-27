"""File store for feedback: ``<knowledge>/feedback/<id>.json`` (GC-AI-0016).

Same rules as the evidence store: create-only, and every read re-checks the hash, so
an edited file is reported as INTEGRITY_FAILED instead of being used.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import ValidationError

from galecore_ai.adapters.knowledge_base import RESEARCH_ID_RE
from galecore_ai.contracts.feedback import FeedbackDocument, compute_feedback_hash

FEEDBACK_ID_RE = RESEARCH_ID_RE  # <YYYY-MM-DD>-<slug>


class FeedbackStoreError(Exception):
    """The store cannot be used or a write was refused."""


class FeedbackIntegrityError(Exception):
    def __init__(self, path: Path, problems: list[str]) -> None:
        super().__init__(f"{path}: " + "; ".join(problems))
        self.path = path
        self.problems = problems


class FileFeedbackStore:
    def __init__(self, knowledge_base: Path) -> None:
        self._dir = knowledge_base.resolve() / "feedback"

    def path_for(self, feedback_id: str) -> Path:
        if not FEEDBACK_ID_RE.fullmatch(feedback_id):
            raise FeedbackStoreError(f"Invalid feedback id: {feedback_id!r} (expected YYYY-MM-DD-slug)")
        return self._dir / f"{feedback_id}.json"

    def ids(self) -> list[str]:
        if not self._dir.is_dir():
            return []
        return sorted(p.stem for p in self._dir.glob("*.json") if FEEDBACK_ID_RE.fullmatch(p.stem))

    def load(self, feedback_id: str) -> FeedbackDocument | None:
        path = self.path_for(feedback_id)
        if not path.is_file():
            return None
        try:
            document = FeedbackDocument.model_validate(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise FeedbackIntegrityError(path, [f"unreadable: {exc}"]) from exc
        except ValidationError as exc:
            raise FeedbackIntegrityError(path, [f"does not match the feedback contract: {exc}"]) from exc
        problems = []
        if compute_feedback_hash(document.hashable_content()) != document.content_hash:
            problems.append("content_hash mismatch")
        if document.id != feedback_id:
            problems.append(f"document id {document.id!r} does not match file name {feedback_id!r}")
        if problems:
            raise FeedbackIntegrityError(path, problems)
        return document

    def create(self, document: FeedbackDocument) -> Path:
        path = self.path_for(document.id)
        if compute_feedback_hash(document.hashable_content()) != document.content_hash:
            raise FeedbackStoreError("Refusing to write feedback whose hash does not match its content")
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with path.open("x", encoding="utf-8", newline="\n") as fh:
                fh.write(json.dumps(document.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n")
        except FileExistsError as exc:
            raise FeedbackStoreError(f"feedback:{document.id} already exists; a new comment is a new item") from exc
        return path
