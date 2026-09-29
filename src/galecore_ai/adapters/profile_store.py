"""File store for the user profile: ``<knowledge>/profile/v<N>.json``, create-only.

Same rules as the strategy store: a version is written once, a change is a new
version, and every read re-checks the hash so an edited file is INTEGRITY_FAILED
instead of being applied or cited.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import ValidationError

from galecore_ai.contracts.profile import PROFILE_VERSION_RE, ProfileVersion, compute_profile_hash


class ProfileStoreError(Exception):
    """The store cannot be used or a write was refused."""


class ProfileIntegrityError(Exception):
    def __init__(self, path: Path, problems: list[str]) -> None:
        super().__init__(f"{path}: " + "; ".join(problems))
        self.path = path
        self.problems = problems


def version_number(key: str) -> int:
    """``v3`` → 3. Raises ProfileStoreError."""
    m = PROFILE_VERSION_RE.fullmatch(key)
    if not m:
        raise ProfileStoreError(f"Invalid profile version {key!r}: expected v<N>")
    return int(m[1])


class FileProfileStore:
    def __init__(self, knowledge_base: Path) -> None:
        self._dir = knowledge_base.resolve() / "profile"

    def path_for(self, key: str) -> Path:
        return self._dir / f"v{version_number(key)}.json"

    def versions(self) -> list[str]:
        if not self._dir.is_dir():
            return []
        found = []
        for p in self._dir.glob("v*.json"):
            if PROFILE_VERSION_RE.fullmatch(p.stem):
                found.append(int(p.stem[1:]))
        return [f"v{n}" for n in sorted(found)]

    def load(self, key: str) -> ProfileVersion | None:
        path = self.path_for(key)
        if not path.is_file():
            return None
        try:
            doc = ProfileVersion.model_validate(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ProfileIntegrityError(path, [f"unreadable: {exc}"]) from exc
        except ValidationError as exc:
            raise ProfileIntegrityError(path, [f"does not match the contract: {exc}"]) from exc
        if compute_profile_hash(doc.hashable_content()) != doc.content_hash:
            raise ProfileIntegrityError(path, ["content_hash mismatch"])
        if doc.version != version_number(key):
            raise ProfileIntegrityError(path, [f"document is v{doc.version}, not {key}"])
        return doc

    def latest(self) -> ProfileVersion | None:
        versions = self.versions()
        return self.load(versions[-1]) if versions else None

    def create(self, doc: ProfileVersion) -> Path:
        if compute_profile_hash(doc.hashable_content()) != doc.content_hash:
            raise ProfileStoreError("Refusing to write a profile whose hash does not match its content")
        path = self.path_for(f"v{doc.version}")
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with path.open("x", encoding="utf-8", newline="\n") as fh:
                fh.write(json.dumps(doc.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n")
        except FileExistsError as exc:
            raise ProfileStoreError(f"{path.name} already exists; a change is a new version") from exc
        return path
