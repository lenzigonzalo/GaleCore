"""Idea inbox contracts (GC-AI-0018): what the owner asked to note down, kept as said, reviewed later.

An idea is written once with the owner's words verbatim, when and during what it came up, and optional references.
It is not evaluated when it is noted. Reviewing it appends a resolution saying where it went (roadmap, a backlog
item, a work item) or that it was done or discarded, with why; nothing is ever deleted and the original part is
covered by a hash, so an edit is visible.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from galecore_ai.contracts.evidence import _CREDENTIAL_IN_TEXT

INBOX_SCHEMA_VERSION = "1"
INBOX_ID_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$")
# roadmap | backlog:BL-012 | work-item:GC-AI-0019 | work-item:GC-0006 | done | discarded
DESTINATION_RE = re.compile(r"^(roadmap|done|discarded|backlog:BL-\d{3}|work-item:GC(?:-AI)?-\d{4})$")


def _non_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    return value


def _no_credentials(value: str) -> str:
    if _CREDENTIAL_IN_TEXT.search(value):
        raise ValueError("the text seems to contain a credential; remove it before noting the idea")
    return value


class Resolution(BaseModel):
    """Where the idea went when it was reviewed. Chained: each one hashes the previous link (the idea's
    content_hash for the first), so rewriting or dropping a review is INTEGRITY_FAILED (internal review 30/09)."""

    model_config = {"extra": "forbid"}

    at: datetime
    to: str                  # see DESTINATION_RE
    note: str                # why: what the review decided, in plain words
    prompt: str              # the owner's words in the review
    prev: str                # hash of the previous link
    hash: str = ""           # sha256 over the fields above

    check_not_blank = field_validator("note", "prompt")(_non_blank)
    check_credentials = field_validator("note", "prompt")(_no_credentials)

    def hashable(self) -> dict:
        return self.model_dump(mode="json", exclude={"hash"})

    @field_validator("to")
    @classmethod
    def _destination(cls, v: str) -> str:
        if not DESTINATION_RE.fullmatch(v):
            raise ValueError("to is roadmap, backlog:BL-NNN, work-item:GC-AI-NNNN / GC-NNNN, done or discarded")
        return v


class InboxItem(BaseModel):
    model_config = {"extra": "forbid"}

    schema_version: str = INBOX_SCHEMA_VERSION
    kind: str = "inbox"
    id: str
    recorded_at: datetime
    words: str                                   # the owner's idea, verbatim
    context: str = ""                            # what we were doing when it came up
    refs: list[str] = Field(default_factory=list)  # resolvable references (research:, strategy:, …)
    prompt: str                                  # the owner's request that noted it
    host_model: str | None = None
    content_hash: str                            # sha256 over the fields above (canonical JSON)
    resolutions: list[Resolution] = Field(default_factory=list)  # appended in reviews; the last one is current

    check_not_blank = field_validator("words", "prompt")(_non_blank)
    check_credentials = field_validator("words", "context", "prompt")(_no_credentials)

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        if not INBOX_ID_RE.fullmatch(v):
            raise ValueError("id is <YYYY-MM-DD>-<slug>")
        return v

    @property
    def status(self) -> str:
        """pending until reviewed; then where it went."""
        return self.resolutions[-1].to if self.resolutions else "pending"

    def hashable_content(self) -> dict:
        return self.model_dump(mode="json", exclude={"content_hash", "resolutions"})

    def chain_problems(self) -> list[str]:
        """Where the noted part or the review chain does not match its hashes."""
        problems = [] if compute_inbox_hash(self.hashable_content()) == self.content_hash else [
            "the noted idea was edited"]
        prev = self.content_hash
        for n, r in enumerate(self.resolutions, 1):
            if r.prev != prev or compute_inbox_hash(r.hashable()) != r.hash:
                problems.append(f"review {n} was edited, reordered or a previous one removed")
            prev = r.hash
        return problems


def compute_inbox_hash(content: dict) -> str:
    raw = json.dumps(content, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()
