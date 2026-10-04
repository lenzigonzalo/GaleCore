"""Project contracts (GC-AI-0026): what the owner said about a strategy or the portfolio, kept in their words.

A project is the strategy (or the portfolio) seen as a whole. Most of it already lives elsewhere — versions and
approvals, follow-ups, investigations, feedback — and the project view reads it from there. This log keeps only what
had no place: the thesis as the owner tells it, decisions, open items and the market story in which the strategy
works. Entries are appended, never edited; each one hashes the previous link, so rewriting or dropping one is
INTEGRITY_FAILED. Closing an open item is a new entry that points to it.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator

from galecore_ai.contracts.evidence import _CREDENTIAL_IN_TEXT
from galecore_ai.contracts.strategy import STRATEGY_NAME_RE

PROJECT_SCHEMA_VERSION = "1"
PORTFOLIO = "portfolio"
HASH_RE = re.compile(r"^sha256:[0-9a-f]{64}$")


def project_name_ok(name: str) -> bool:
    return name == PORTFOLIO or bool(STRATEGY_NAME_RE.fullmatch(name))


class EntryKind(str, Enum):
    THESIS = "thesis"        # why the strategy should work, as the owner tells it
    DECISION = "decision"    # what the owner decided and why
    PENDING = "pending"      # something open
    DONE = "done"            # closes a pending entry (``closes`` = its hash)
    STORY = "story"          # the market story in which the strategy works (or does not)


def _non_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    return value


def _no_credentials(value: str) -> str:
    if _CREDENTIAL_IN_TEXT.search(value):
        raise ValueError("the text seems to contain a credential; remove it")
    return value


class ProjectEntry(BaseModel):
    model_config = {"extra": "forbid"}

    at: datetime
    kind: EntryKind
    words: str                                     # the owner's words, verbatim
    refs: list[str] = Field(default_factory=list)  # resolvable references (regime:, research:, strategy:, …)
    closes: str = ""                               # DONE only: hash of the pending entry it closes
    prompt: str                                    # the owner's request that recorded it
    host_model: str | None = None
    prev: str                                      # hash of the previous entry ("" for the first)
    hash: str = ""                                 # sha256 over the fields above

    check_not_blank = field_validator("words", "prompt")(_non_blank)
    check_credentials = field_validator("words", "prompt")(_no_credentials)

    def hashable(self) -> dict:
        return self.model_dump(mode="json", exclude={"hash"})


class ProjectLog(BaseModel):
    model_config = {"extra": "forbid"}

    schema_version: str = PROJECT_SCHEMA_VERSION
    kind: str = "project"
    name: str                                      # a strategy name or "portfolio"
    entries: list[ProjectEntry] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        if not project_name_ok(v):
            raise ValueError("name is a strategy name (lowercase, digits, _) or 'portfolio'")
        return v

    def chain_problems(self) -> list[str]:
        problems, prev = [], ""
        for n, e in enumerate(self.entries, 1):
            if e.prev != prev or compute_project_hash(e.hashable()) != e.hash:
                problems.append(f"entry {n} was edited, reordered or a previous one removed")
            prev = e.hash
        return problems

    def open_items(self) -> list[ProjectEntry]:
        closed = {e.closes for e in self.entries if e.kind == EntryKind.DONE}
        return [e for e in self.entries if e.kind == EntryKind.PENDING and e.hash not in closed]


def compute_project_hash(content: dict) -> str:
    raw = json.dumps(content, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()
