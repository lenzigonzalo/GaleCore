"""Evaluable record contracts (Phase 4).

A record is what makes a use case evaluable afterwards: what was asked, with
which facts (hashes), what the host answered and how assurance traced it, what
happened later in the market, and what the human thought.

Immutability rule: everything written at acceptance time is covered by
``entry_hash``. Outcomes and human reviews are appended later and are outside
the hash; they can never alter the accepted payload, and a mismatch on read is
reported as ``INTEGRITY_FAILED`` rather than silently skipped.

Records store no secrets, no raw logs and no chain-of-thought.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator

from galecore_ai.contracts.agent_run import CapabilityTrace, GuardrailTrace
from galecore_ai.contracts.prepared_analysis import AssetManifest

RECORD_SCHEMA_VERSION = "1"


class RecordRequest(BaseModel):
    model_config = {"extra": "forbid"}

    prompt: str
    symbol: str
    skill_id: str


class RecordSnapshotIdentity(BaseModel):
    model_config = {"extra": "forbid"}

    run_id: str
    prepared_at: datetime
    facts_hash: str
    conventions_hash: str
    market_data_as_of: datetime | None = None
    freshness_status: str


class RecordHost(BaseModel):
    """What the host declared about itself. Never verified by the validator."""

    model_config = {"extra": "forbid"}

    provider: str | None = None
    model: str | None = None
    provenance: str = "HOST_DECLARED"


class RecordTraceSummary(BaseModel):
    model_config = {"extra": "forbid"}

    trace_id: str
    accepted_at: datetime
    facts_provenance: str
    guardrails: list[GuardrailTrace]
    capabilities: list[CapabilityTrace]


class RecordOutcome(BaseModel):
    """Facts observed later through the same capabilities, with their own provenance."""

    model_config = {"extra": "forbid"}

    observed_at: datetime
    facts: dict
    facts_hash: str
    facts_provenance: str
    capabilities: list[CapabilityTrace]


class ReviewVerdict(str, Enum):
    AGREE = "agree"
    PARTIAL = "partial"
    DISAGREE = "disagree"


class HumanReview(BaseModel):
    model_config = {"extra": "forbid"}

    reviewed_at: datetime
    verdict: ReviewVerdict
    comment: str


class RegimeRecordEntry(BaseModel):
    """One accepted run of the regime skill and everything learned about it afterwards."""

    model_config = {"extra": "forbid"}

    entry_id: str  # equals run_id
    recorded_at: datetime
    request: RecordRequest
    snapshot: RecordSnapshotIdentity
    facts: dict
    effective_assets: AssetManifest
    host: RecordHost
    accepted_payload: dict
    trace: RecordTraceSummary
    entry_hash: str  # sha256 over every field above (canonical JSON)
    outcomes: list[RecordOutcome] = Field(default_factory=list)
    human_reviews: list[HumanReview] = Field(default_factory=list)

    def hashable_content(self) -> dict:
        data = self.model_dump(mode="json")
        for key in ("entry_hash", "outcomes", "human_reviews"):
            data.pop(key, None)
        return data


class RegimeRecordDocument(BaseModel):
    """All entries of one symbol on one trading day."""

    model_config = {"extra": "forbid"}

    schema_version: str = RECORD_SCHEMA_VERSION
    symbol: str
    date: str  # YYYY-MM-DD in the convention timezone
    entries: list[RegimeRecordEntry] = Field(default_factory=list)

    @field_validator("schema_version")
    @classmethod
    def _known_schema(cls, v: str) -> str:
        if v != RECORD_SCHEMA_VERSION:
            raise ValueError(f"Unknown record schema_version {v!r}; this reader knows {RECORD_SCHEMA_VERSION!r}")
        return v


def compute_entry_hash(content: dict) -> str:
    canonical = json.dumps(content, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
