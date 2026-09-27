"""File store for strategies: ``<knowledge>/strategies/<name>/<version>.{proposal,approval}.json``.

Create-only like evidence: a version is written once; a change is a new version. Every read
re-checks the hash, so an edited file is INTEGRITY_FAILED instead of being deployed or cited.
Removing a file, or rewriting it with a recomputed hash, shows only in the knowledge base's git.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, ValidationError

from galecore_ai.contracts.strategy import (
    STRATEGY_NAME_RE,
    STRATEGY_VERSION_RE,
    ApprovalDocument,
    StrategyDocument,
    compute_document_hash,
)


class StrategyStoreError(Exception):
    """The store cannot be used or a write was refused."""


class StrategyIntegrityError(Exception):
    def __init__(self, path: Path, problems: list[str]) -> None:
        super().__init__(f"{path}: " + "; ".join(problems))
        self.path = path
        self.problems = problems


def split_key(key: str) -> tuple[str, str]:
    """``<name>/<version>`` → (name, version). Raises StrategyStoreError."""
    name, sep, version = key.partition("/")
    if not sep or not STRATEGY_NAME_RE.fullmatch(name) or not STRATEGY_VERSION_RE.fullmatch(version):
        raise StrategyStoreError(f"Invalid strategy key {key!r}: expected <name>/<MAJOR.MINOR.PATCH>")
    return name, version


class FileStrategyStore:
    def __init__(self, knowledge_base: Path) -> None:
        self._dir = knowledge_base.resolve() / "strategies"

    def path_for(self, key: str, what: str = "proposal") -> Path:
        name, version = split_key(key)
        return self._dir / name / f"{version}.{what}.json"

    def versions(self) -> list[str]:
        if not self._dir.is_dir():
            return []
        out = []
        for p in sorted(self._dir.glob("*/*.proposal.json")):
            key = f"{p.parent.name}/{p.name.removesuffix('.proposal.json')}"
            try:
                split_key(key)
            except StrategyStoreError:
                continue
            out.append(key)
        return out

    def _load(self, path: Path, model: type[BaseModel]) -> BaseModel | None:
        if not path.is_file():
            return None
        try:
            doc = model.model_validate(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise StrategyIntegrityError(path, [f"unreadable: {exc}"]) from exc
        except ValidationError as exc:
            raise StrategyIntegrityError(path, [f"does not match the contract: {exc}"]) from exc
        if compute_document_hash(doc.hashable_content()) != doc.content_hash:
            raise StrategyIntegrityError(path, ["content_hash mismatch"])
        return doc

    def load(self, key: str) -> StrategyDocument | None:
        doc = self._load(self.path_for(key), StrategyDocument)
        if doc is not None and f"{doc.name}/{doc.version}" != key:
            raise StrategyIntegrityError(self.path_for(key), [f"document is {doc.name}/{doc.version}, not {key}"])
        return doc

    def load_approval(self, key: str) -> ApprovalDocument | None:
        doc = self._load(self.path_for(key, "approval"), ApprovalDocument)
        if doc is not None and doc.strategy_ref != f"strategy:{key}":
            raise StrategyIntegrityError(self.path_for(key, "approval"), [f"approval is for {doc.strategy_ref}"])
        return doc

    def _create(self, path: Path, doc: BaseModel, what: str) -> Path:
        if compute_document_hash(doc.hashable_content()) != doc.content_hash:
            raise StrategyStoreError(f"Refusing to write a {what} whose hash does not match its content")
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with path.open("x", encoding="utf-8", newline="\n") as fh:
                fh.write(json.dumps(doc.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n")
        except FileExistsError as exc:
            raise StrategyStoreError(f"{path.name} already exists; a change is a new version") from exc
        return path

    def create(self, doc: StrategyDocument) -> Path:
        return self._create(self.path_for(f"{doc.name}/{doc.version}"), doc, "proposal")

    def create_approval(self, key: str, doc: ApprovalDocument) -> Path:
        return self._create(self.path_for(key, "approval"), doc, "approval")
