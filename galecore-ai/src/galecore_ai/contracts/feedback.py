"""Feedback contracts (GC-AI-0016): the user's comment tied to the exact result it is about.

A comment on a result is kept once, with the user's own words, the investigation and
revision it refers to, and what it changes:

- ``case``: the data or the reading of that result was wrong → a revision of that
  investigation corrects it;
- ``preference``: how the user wants things (format, limits, sources) → a new
  profile version;
- ``method``: what the capability should always do → a new version of its skill,
  whose history cites the feedback.

The skill and version that produced the result are copied from the stored revision by
the code, never declared by the host. Immutability rule: written once and hashed; a
later comment is a new item.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, field_validator

from galecore_ai.contracts.evidence import _CREDENTIAL_IN_TEXT
from galecore_ai.contracts.prepared_analysis import AssetEntry
from galecore_ai.contracts.regime_record import RecordHost

FEEDBACK_SCHEMA_VERSION = "1"


class FeedbackKind(str, Enum):
    CASE = "case"              # corrects that result → revision of the investigation
    PREFERENCE = "preference"  # how the user wants things → profile version
    METHOD = "method"          # what the capability always does → skill version


# Where each kind is applied (what `feedback list` accepts as "applied").
APPLIED_BY = {FeedbackKind.CASE: "research", FeedbackKind.PREFERENCE: "profile", FeedbackKind.METHOD: "skill"}


def _non_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    return value


class FeedbackTarget(BaseModel):
    """The exact result the comment is about, copied from the stored revision."""

    model_config = {"extra": "forbid"}

    research: str             # research:<id>
    revision: int             # the revision the user commented on
    revision_hash: str        # that revision's content_hash
    skill: AssetEntry         # the skill (id, version, hash) that produced it


class FeedbackDocument(BaseModel):
    model_config = {"extra": "forbid"}

    schema_version: str = FEEDBACK_SCHEMA_VERSION
    kind: str = "feedback"
    id: str
    recorded_at: datetime
    host: RecordHost
    words: str                     # the user's words, verbatim
    formulation: str = ""          # the reading of those words the user accepted as the comment ("" if none)
    classification: FeedbackKind
    target: FeedbackTarget
    prompt: str                    # what the user asked in the session that recorded it
    content_hash: str              # sha256 over every field above (canonical JSON)

    check_not_blank = field_validator("words", "prompt")(_non_blank)

    @field_validator("schema_version")
    @classmethod
    def _known_schema(cls, v: str) -> str:
        if v != FEEDBACK_SCHEMA_VERSION:
            raise ValueError(f"Unknown feedback schema_version {v!r}; this reader knows {FEEDBACK_SCHEMA_VERSION!r}")
        return v

    @field_validator("kind")
    @classmethod
    def _is_feedback(cls, v: str) -> str:
        if v != "feedback":
            raise ValueError(f"kind must be 'feedback', got {v!r}")
        return v

    @field_validator("words", "formulation", "prompt")
    @classmethod
    def _no_credentials(cls, v: str) -> str:
        if _CREDENTIAL_IN_TEXT.search(v):
            raise ValueError("the text seems to contain a credential; remove it before storing")
        return v

    @field_validator("recorded_at")
    @classmethod
    def _aware(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("recorded_at needs a timezone (UTC)")
        return v

    @property
    def ref(self) -> str:
        return f"feedback:{self.id}"

    def hashable_content(self) -> dict:
        data = self.model_dump(mode="json")
        data.pop("content_hash", None)
        return data


def compute_feedback_hash(content: dict) -> str:
    canonical = json.dumps(content, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
