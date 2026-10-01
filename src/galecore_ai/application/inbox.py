"""Idea inbox (GC-AI-0018): note an idea in the owner's words now, review it later.

Stored in ``<knowledge>/inbox/<id>.json``. Noting never evaluates the idea; reviewing appends where it went, and the
destination must exist (the backlog item, the work item). Nothing is deleted.
"""

from __future__ import annotations

import json
import os
import re
import unicodedata
from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError

from galecore_ai.application.knowledge import KnowledgeBase, KnowledgeError, resolve_ref
from galecore_ai.contracts.inbox import InboxItem, Resolution, compute_inbox_hash

BACKLOG = Path("GaleCore-AI") / "docs" / "architecture" / "PRODUCT-BACKLOG.md"
WORK_ITEM_DIRS = ("GaleCore-AI/docs/engineering/work-items", "GaleCore/docs/engineering/work-items",
                  ".worktrees/galecore-ai/*/docs/engineering/work-items",
                  ".worktrees/galecore/*/docs/engineering/work-items")
SLUG_WORDS = 6


def _dir(kb: KnowledgeBase) -> Path:
    return kb.base / "inbox"


def slug_of(words: str) -> str:
    """A short slug from the first words (accents removed); the id adds the date."""
    plain = unicodedata.normalize("NFKD", words).encode("ascii", "ignore").decode().lower()
    tokens = re.findall(r"[a-z0-9]+", plain)[:SLUG_WORDS]
    return "-".join(tokens) or "idea"


def load(kb: KnowledgeBase, item_id: str) -> InboxItem:
    path = _dir(kb) / f"{item_id}.json"
    if not path.is_file():
        raise KnowledgeError(f"no idea {item_id} in the inbox")
    try:
        item = InboxItem.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except (ValidationError, json.JSONDecodeError) as exc:
        raise KnowledgeError(f"inbox {item_id} is not readable", [str(exc)[:300]]) from exc
    if compute_inbox_hash(item.hashable_content()) != item.content_hash:
        raise KnowledgeError(f"inbox {item_id}: the noted idea was edited (INTEGRITY_FAILED)")
    return item


def _write(kb: KnowledgeBase, item: InboxItem) -> Path:
    path = _dir(kb) / f"{item.id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(item.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    return path


def add(*, kb: KnowledgeBase, words: str, prompt: str, context: str = "", refs: list[str] | None = None,
        host_model: str | None = None, now: datetime | None = None) -> tuple[InboxItem, Path]:
    """Keep the idea as said. Refs must resolve; the idea itself is not judged."""
    now = now or datetime.now(UTC)
    problems = []
    for ref in refs or []:
        try:
            resolve_ref(ref, kb)
        except KnowledgeError as exc:
            problems.append(f"ref {ref}: {exc}")
    if problems:
        raise KnowledgeError("Refusing to note the idea", problems)
    base_id = f"{now.date().isoformat()}-{slug_of(words)}"
    item_id, n = base_id, 2
    while (_dir(kb) / f"{item_id}.json").exists():
        item_id, n = f"{base_id}-{n}", n + 1
    try:
        draft = InboxItem(id=item_id, recorded_at=now, words=words, context=context, refs=list(refs or []),
                          prompt=prompt, host_model=host_model, content_hash="")
    except ValidationError as exc:
        raise KnowledgeError("Refusing to note the idea", [e["msg"] for e in exc.errors()]) from exc
    item = draft.model_copy(update={"content_hash": compute_inbox_hash(draft.hashable_content())})
    return item, _write(kb, item)


def items(kb: KnowledgeBase, status: str | None = None) -> list[InboxItem]:
    """Oldest first. `status`: pending | resolved | a destination."""
    base = _dir(kb)
    out = sorted((load(kb, p.stem) for p in base.glob("*.json")), key=lambda i: i.recorded_at)         if base.is_dir() else []
    if status == "resolved":
        return [i for i in out if i.status != "pending"]
    return [i for i in out if i.status == status] if status else out


def destination_exists(workspace: Path, to: str) -> str | None:
    """None when the destination exists; otherwise why not."""
    if to in ("roadmap", "done", "discarded"):
        return None
    kind, _, ref = to.partition(":")
    if kind == "backlog":
        backlog = workspace / BACKLOG
        if not backlog.is_file():
            return f"backlog not found at {backlog}"
        if not re.search(rf"^##\s+{re.escape(ref)}\b", backlog.read_text(encoding="utf-8"), re.MULTILINE):
            return f"{ref} is not in {BACKLOG.as_posix()}: create it there first or pick the BL- that contains it"
        return None
    if any(next(workspace.glob(f"{d}/{ref}-*.md"), None) for d in WORK_ITEM_DIRS):
        return None
    return f"no work item {ref} in GaleCore-AI, GaleCore or their worktrees"


def resolve(*, kb: KnowledgeBase, item_id: str, to: str, note: str, prompt: str,
            now: datetime | None = None) -> tuple[InboxItem, Path]:
    """Append where the idea went. A later review can move it again; the history stays."""
    now = now or datetime.now(UTC)
    item = load(kb, item_id)
    try:
        resolution = Resolution(at=now, to=to, note=note, prompt=prompt)
    except ValidationError as exc:
        raise KnowledgeError("Refusing to resolve", [e["msg"] for e in exc.errors()]) from exc
    if why := destination_exists(kb.workspace, to):
        raise KnowledgeError("Refusing to resolve", [why])
    item = item.model_copy(update={"resolutions": [*item.resolutions, resolution]})
    return item, _write(kb, item)


def summary(item: InboxItem) -> dict:
    return {"id": item.id, "status": item.status, "recorded_at": item.recorded_at.isoformat(),
            "words": item.words, "context": item.context}
