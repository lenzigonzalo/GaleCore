"""See and change the user profile (GC-AI-0013, AC-01/AC-02).

``set_profile`` applies partial changes on top of the current version: only the
fields present in ``changes`` are replaced (``null`` clears one back to "not
declared"). No real change, no new version. Preferred sources must exist in the
source registry (GC-AI-0012), so the profile never points at a source the harness
does not know. A field the user sets again stops being provisional unless the same
change says otherwise.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError

from galecore_ai.adapters.profile_store import (
    FileProfileStore,
    ProfileIntegrityError,
    ProfileStoreError,
)
from galecore_ai.adapters.source_registry_store import SourceRegistryError, load_source_registry
from galecore_ai.contracts.profile import ProfileContent, ProfileVersion, compute_profile_hash
from galecore_ai.contracts.regime_record import RecordHost


class ProfileError(Exception):
    """A profile operation was refused; ``problems`` says why."""

    def __init__(self, message: str, problems: list[str] | None = None) -> None:
        super().__init__(message if not problems else f"{message}: " + "; ".join(problems))
        self.problems = problems or []


class ProfileUnusable(ProfileError):
    """A stored version failed its integrity check."""


# Only identifier-like names are echoed back; anything else the user sent may be a credential.
_NAME = re.compile(r"^[a-z][a-z0-9_]{0,40}$")


def _safe(part: object) -> str:
    return str(part) if isinstance(part, int) or _NAME.fullmatch(str(part)) else "<unrecognised>"


def _errors(exc: ValidationError) -> list[str]:
    # loc + msg only: str(ValidationError) would echo the rejected input (e.g. a credential).
    return [f"{'.'.join(_safe(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()]


def _view(doc: ProfileVersion, store: FileProfileStore) -> dict:
    return {"ref": doc.ref, "version": doc.version, "recorded_at": doc.recorded_at.isoformat(),
            "note": doc.note, "content": doc.content.model_dump(mode="json"), "missing": doc.content.missing(),
            "provisional": doc.content.provisional,
            "content_hash": doc.content_hash, "path": str(store.path_for(f"v{doc.version}"))}


def _current(store: FileProfileStore) -> ProfileVersion | None:
    try:
        return store.latest()
    except (ProfileIntegrityError, ProfileStoreError) as exc:
        raise ProfileUnusable("The profile is not usable", [str(exc)]) from exc


def show(store: FileProfileStore) -> dict:
    """Current version and what is still missing; an empty profile says so instead of guessing."""
    doc = _current(store)
    if doc is None:
        return {"ref": None, "version": None, "content": None, "missing": ProfileContent.declared_fields(),
                "provisional": [], "note": "no profile yet: every field is missing"}
    return _view(doc, store)


def history(store: FileProfileStore) -> list[dict]:
    out = []
    for key in reversed(store.versions()):
        try:
            doc = store.load(key)
        except (ProfileIntegrityError, ProfileStoreError) as exc:
            out.append({"ref": f"profile:{key}", "status": "INTEGRITY_FAILED", "problems": [str(exc)]})
            continue
        out.append({"ref": doc.ref, "recorded_at": doc.recorded_at.isoformat(), "note": doc.note,
                    "prompt": doc.prompt, "content_hash": doc.content_hash})
    return out


def _check_sources(ids: list[str]) -> list[str]:
    try:
        registry = load_source_registry()
    except SourceRegistryError as exc:
        return [f"preferred_sources cannot be checked: {exc}"]
    return [f"preferred_sources: {_safe(sid)} is not in config/sources.yaml" for sid in ids if registry.get(sid) is None]


def set_profile(store: FileProfileStore, *, changes: dict, note: str, prompt: str, host: RecordHost,
                now: datetime | None = None) -> tuple[ProfileVersion, Path | None]:
    """New version with ``changes`` applied; (current, None) when nothing actually changes."""
    unknown = sorted(set(changes) - set(ProfileContent.model_fields))
    if unknown:
        raise ProfileError("Refusing to change the profile", [f"unknown fields: {', '.join(map(_safe, unknown))}"])
    current = _current(store)
    base = current.content.model_dump(mode="json") if current else {}
    if "provisional" not in changes and base.get("provisional"):
        base["provisional"] = [f for f in base["provisional"] if f not in changes]
    try:
        content = ProfileContent.model_validate({**base, **changes})
    except ValidationError as exc:
        raise ProfileError("Refusing to change the profile", _errors(exc)) from exc
    try:
        draft = ProfileVersion(version=(current.version + 1) if current else 1, recorded_at=now or datetime.now(UTC),
                               note=note, prompt=prompt, host=host, content=content, content_hash="")
    except ValidationError as exc:
        raise ProfileError("Refusing to change the profile", _errors(exc)) from exc
    problems = _check_sources(content.preferred_sources)
    if problems:
        raise ProfileError("Refusing to change the profile", problems)
    if current is not None and content == current.content:
        return current, None
    doc = draft.model_copy(update={"content_hash": compute_profile_hash(draft.hashable_content())})
    try:
        return doc, store.create(doc)
    except ProfileStoreError as exc:
        raise ProfileError("Refusing to change the profile", [str(exc)]) from exc
