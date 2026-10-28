"""Mark contracts (P1-08): an old item marked as corrected, superseded or retired, with its reason.

Nothing in the knowledge base is deleted. When the owner says "esto ya no vale", the item
gets a mark: what happened to it (corrected, superseded, retired), why, when, and what
replaces it when something does. From then on a new investigation cannot cite it and
``kb search`` leaves it out unless asked; the item itself and its history stay readable.

Immutability rule: one mark per item, written once and hashed.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, field_validator, model_validator

from galecore_ai.contracts.evidence import _CREDENTIAL_IN_TEXT
from galecore_ai.contracts.regime_record import RecordHost

MARK_SCHEMA_VERSION = "1"


class MarkKind(str, Enum):
    CORRECTED = "corrected"    # it was wrong; ``by`` is the correction
    SUPERSEDED = "superseded"  # something newer does it better; ``by`` is the replacement
    RETIRED = "retired"        # no longer used, nothing replaces it


# Kinds that must name what takes the item's place.
NEEDS_REPLACEMENT = {MarkKind.CORRECTED, MarkKind.SUPERSEDED}


class MarkDocument(BaseModel):
    model_config = {"extra": "forbid"}

    schema_version: str = MARK_SCHEMA_VERSION
    kind: str = "mark"
    id: str                        # <YYYY-MM-DD>-<slug>
    recorded_at: datetime
    host: RecordHost
    ref: str                       # the item marked (normalised reference)
    ref_hash: str                  # that item's content hash when it was marked
    mark: MarkKind
    reason: str                    # why, in plain words
    by: str = ""                   # the correction or replacement (a reference) — required unless retired
    prompt: str                    # the owner's words that asked for it
    content_hash: str              # sha256 over every field above (canonical JSON)

    @field_validator("reason", "prompt")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be blank")
        return v

    @field_validator("reason", "prompt")
    @classmethod
    def _no_credentials(cls, v: str) -> str:
        if _CREDENTIAL_IN_TEXT.search(v):
            raise ValueError("the text seems to contain a credential; remove it before storing")
        return v

    @field_validator("schema_version")
    @classmethod
    def _known_schema(cls, v: str) -> str:
        if v != MARK_SCHEMA_VERSION:
            raise ValueError(f"Unknown mark schema_version {v!r}; this reader knows {MARK_SCHEMA_VERSION!r}")
        return v

    @field_validator("kind")
    @classmethod
    def _is_mark(cls, v: str) -> str:
        if v != "mark":
            raise ValueError(f"kind must be 'mark', got {v!r}")
        return v

    @field_validator("recorded_at")
    @classmethod
    def _aware(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("recorded_at needs a timezone (UTC)")
        return v

    @model_validator(mode="after")
    def _replacement(self) -> MarkDocument:
        if self.mark in NEEDS_REPLACEMENT and not self.by.strip():
            raise ValueError(f"a {self.mark.value} item must say what replaces it (by)")
        if self.mark == MarkKind.RETIRED and self.by.strip():
            raise ValueError("a retired item has no replacement; use superseded")
        if self.by.strip() == self.ref:
            raise ValueError("an item cannot replace itself")
        return self

    def hashable_content(self) -> dict:
        data = self.model_dump(mode="json")
        data.pop("content_hash", None)
        return data


def compute_mark_hash(content: dict) -> str:
    canonical = json.dumps(content, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
