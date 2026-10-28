"""Investigation contracts (GC-AI-0005): a question worked on, and how to resume it.

An investigation is not an interpretation of one fact snapshot. It starts from a
question, gathers antecedents (earlier records, earlier investigations, local
files), separates what is a fact from what is interpreted, hypothesised or
decided, and ends in a test plan and next steps that another session can pick up.

Storing an investigation does not make it true: statements carry their kind, and
a hypothesis stays a hypothesis until a later ``result`` revision says otherwise.

Immutability rule: an investigation is a list of revisions. Each revision is
hashed at write time and never rewritten; a continuation, correction or later
result is a new revision that keeps the earlier ones readable.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator

from galecore_ai.contracts.prepared_analysis import AssetEntry
from galecore_ai.contracts.regime_record import RecordHost

RESEARCH_SCHEMA_VERSION = "1"


def _non_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    return value


class ResearchStatus(str, Enum):
    OPEN = "open"                  # question being worked; next steps pending
    TEST_PLANNED = "test_planned"  # hypothesis and a test plan exist; the test has not run
    CONCLUDED = "concluded"        # a conclusion was reached (supported, weakened or insufficient evidence)
    ABANDONED = "abandoned"        # dropped, with the reason in the revision note


class StatementKind(str, Enum):
    FACT = "fact"                    # observable, and must cite at least one source
    INTERPRETATION = "interpretation"
    HYPOTHESIS = "hypothesis"
    DECISION = "decision"            # something the owner or the work decided


class Antecedent(BaseModel):
    """Earlier work or a local source, and what it changes for this investigation."""

    model_config = {"extra": "forbid"}

    ref: str
    summary: str      # what the antecedent says
    bearing: str      # how it affects the hypothesis or the plan

    check_not_blank = field_validator("ref", "summary", "bearing")(_non_blank)


class Statement(BaseModel):
    model_config = {"extra": "forbid"}

    kind: StatementKind
    text: str
    sources: list[str] = Field(default_factory=list)

    check_not_blank = field_validator("text")(_non_blank)


class TestStep(BaseModel):
    model_config = {"extra": "forbid"}
    __test__ = False  # not a pytest class

    step: str
    data_needed: str
    supports_if: str   # observation that would support the hypothesis
    weakens_if: str    # observation that would weaken or refute it

    check_not_blank = field_validator("step", "data_needed", "supports_if", "weakens_if")(_non_blank)


class ResearchContent(BaseModel):
    """What the host writes for one revision. The validator checks it before storing."""

    model_config = {"extra": "forbid"}

    title: str
    question: str
    status: ResearchStatus
    antecedents: list[Antecedent] = Field(default_factory=list)
    statements: list[Statement] = Field(default_factory=list)
    hypothesis: str | None = None
    test_plan: list[TestStep] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)      # data or decisions still lacking
    next_steps: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)

    check_not_blank = field_validator("title", "question")(_non_blank)


class RevisionReason(str, Enum):
    INITIAL = "initial"
    CONTINUATION = "continuation"  # work resumed from the pending next steps
    CORRECTION = "correction"      # an earlier revision was wrong; the note says what
    RESULT = "result"              # a test or later observation came in


class ResolvedRef(BaseModel):
    """What a cited reference pointed to at write time (so a later change is visible)."""

    model_config = {"extra": "forbid"}

    ref: str
    path: str        # relative to the knowledge base's parent (the workspace root)
    content_hash: str


class ResearchRevision(BaseModel):
    model_config = {"extra": "forbid"}

    revision: int
    recorded_at: datetime
    reason: RevisionReason
    note: str                     # what this revision changes ("" only for the initial one)
    prompt: str                   # what the user asked in the session that produced it
    host: RecordHost
    skill: AssetEntry
    content: ResearchContent
    resolved_refs: list[ResolvedRef] = Field(default_factory=list)
    content_hash: str             # sha256 over every field above (canonical JSON)

    def hashable_content(self) -> dict:
        data = self.model_dump(mode="json")
        data.pop("content_hash", None)
        return data


class ResearchDocument(BaseModel):
    model_config = {"extra": "forbid"}

    schema_version: str = RESEARCH_SCHEMA_VERSION
    kind: str = "research"
    id: str
    created_at: datetime
    project: str | None = None    # Lab project it was saved from (the first one); None outside a project
    revisions: list[ResearchRevision] = Field(default_factory=list)

    @field_validator("schema_version")
    @classmethod
    def _known_schema(cls, v: str) -> str:
        if v != RESEARCH_SCHEMA_VERSION:
            raise ValueError(f"Unknown research schema_version {v!r}; this reader knows {RESEARCH_SCHEMA_VERSION!r}")
        return v

    @field_validator("kind")
    @classmethod
    def _is_research(cls, v: str) -> str:
        if v != "research":
            raise ValueError(f"kind must be 'research', got {v!r}")
        return v

    @property
    def current(self) -> ResearchRevision:
        return self.revisions[-1]


def compute_revision_hash(content: dict) -> str:
    canonical = json.dumps(content, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
