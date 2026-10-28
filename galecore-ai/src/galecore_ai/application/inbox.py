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

from galecore_ai.adapters.knowledge_base import PRODUCT_ROOT
from galecore_ai.application.knowledge import KnowledgeBase, KnowledgeError, resolve_ref
from galecore_ai.contracts.inbox import (
    DESTINATION_RE,
    INBOX_ID_RE,
    InboxItem,
    Resolution,
    compute_inbox_hash,
)

# Dev-only references: when the root has no backlog / work-items folders, a destination is accepted unchecked.
BACKLOG = Path("galecore-ai") / "docs" / "architecture" / "PRODUCT-BACKLOG.md"
WORK_ITEM_DIRS = ("galecore-ai/docs/engineering/work-items", "galecore-app/docs/engineering/work-items")
SLUG_WORDS = 6


def _dir(kb: KnowledgeBase) -> Path:
    return kb.base / "inbox"


def slug_of(words: str) -> str:
    """A short slug from the first words (accents removed); the id adds the date."""
    plain = unicodedata.normalize("NFKD", words).encode("ascii", "ignore").decode().lower()
    tokens = re.findall(r"[a-z0-9]+", plain)[:SLUG_WORDS]
    return "-".join(tokens) or "idea"


def load(kb: KnowledgeBase, item_id: str) -> InboxItem:
    if not INBOX_ID_RE.fullmatch(item_id):
        raise KnowledgeError(f"{item_id!r} is not an inbox id (<YYYY-MM-DD>-<slug>)")
    path = _dir(kb) / f"{item_id}.json"
    if not path.is_file():
        raise KnowledgeError(f"no idea {item_id} in the inbox")
    try:
        item = InboxItem.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except (ValidationError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise KnowledgeError(f"inbox {item_id} is not readable", [str(exc)[:300]]) from exc
    problems = item.chain_problems() + ([] if item.id == item_id else [f"the file holds idea {item.id}"])
    if problems:
        raise KnowledgeError(f"inbox {item_id}: INTEGRITY_FAILED", problems)
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


STATUSES = ("pending", "resolved")


def items(kb: KnowledgeBase, status: str | None = None) -> tuple[list[InboxItem], list[dict]]:
    """Ideas oldest first, and the files that could not be read (reported, never skipped silently).
    `status`: pending | resolved | a destination."""
    if status and status not in STATUSES and not DESTINATION_RE.fullmatch(status):
        raise KnowledgeError(f"status is pending, resolved or a destination, got {status!r}")
    base = _dir(kb)
    found, broken = [], []
    for path in base.glob("*.json") if base.is_dir() else []:
        try:
            found.append(load(kb, path.stem))
        except KnowledgeError as exc:
            broken.append({"file": path.name, "error": str(exc), "problems": exc.problems})
    found.sort(key=lambda i: i.recorded_at)
    if status == "resolved":
        found = [i for i in found if i.status != "pending"]
    elif status:
        found = [i for i in found if i.status == status]
    return found, broken


def destination_exists(root: Path, to: str) -> str | None:
    """None when the destination exists (or cannot be checked here); otherwise why not."""
    if to in ("roadmap", "done", "discarded"):
        return None
    kind, _, ref = to.partition(":")
    if kind == "backlog":
        backlog = root / BACKLOG
        if not backlog.is_file():
            return None
        if not re.search(rf"^##\s+{re.escape(ref)}\b", backlog.read_text(encoding="utf-8"), re.MULTILINE):
            return f"{ref} is not in the product backlog: create it there first or pick the BL- that contains it"
        return None
    dirs = [root / d for d in WORK_ITEM_DIRS if (root / d).is_dir()]
    if not dirs or any(next(d.glob(f"{ref}-*.md"), None) for d in dirs):
        return None
    return f"no work item {ref} in galecore-ai/ or galecore-app/"


def resolve(*, kb: KnowledgeBase, item_id: str, to: str, note: str, prompt: str,
            now: datetime | None = None) -> tuple[InboxItem, Path]:
    """Append where the idea went. A later review can move it again; the history stays."""
    now = now or datetime.now(UTC)
    item = load(kb, item_id)
    prev = item.resolutions[-1].hash if item.resolutions else item.content_hash
    try:
        draft = Resolution(at=now, to=to, note=note, prompt=prompt, prev=prev)
    except ValidationError as exc:
        raise KnowledgeError("Refusing to resolve", [e["msg"] for e in exc.errors()]) from exc
    resolution = draft.model_copy(update={"hash": compute_inbox_hash(draft.hashable())})
    if why := destination_exists(PRODUCT_ROOT, to):
        raise KnowledgeError("Refusing to resolve", [why])
    item = item.model_copy(update={"resolutions": [*item.resolutions, resolution]})
    return item, _write(kb, item)


def summary(item: InboxItem) -> dict:
    return {"id": item.id, "status": item.status, "recorded_at": item.recorded_at.isoformat(),
            "words": item.words, "context": item.context}
