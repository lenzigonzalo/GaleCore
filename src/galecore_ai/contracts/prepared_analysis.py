"""Prepared analysis contracts — trust boundary between validator and host.

StoredPreparedSnapshot: internal, frozen, never leaves the validator.
PreparedAnalysisView: read-only projection the host receives.
AcceptanceRequest: what the host sends back (run_id + interpretation + metadata).

The host never receives or returns the authoritative snapshot.
A facts_hash detects content changes but does not authenticate origin.
A conventions_hash binds the convention values resolved at prepare time to the
snapshot, so a mutation between prepare and accept is detected. Neither hash
authenticates origin.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import UTC, datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator, model_validator

from galecore_ai.contracts.agent_run import CapabilityTrace
from galecore_ai.contracts.ids import new_id

_HASH_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
_MAX_FRESHNESS_AGE = 86400.0  # 24 hours hard cap


class Provenance(str, Enum):
    """Trust level for a piece of data or metadata."""

    GALECORE_VERIFIED = "GALECORE_VERIFIED"
    VALIDATOR_OBSERVED = "VALIDATOR_OBSERVED"
    HOST_DECLARED = "HOST_DECLARED"
    UNKNOWN = "UNKNOWN"


class AssetEntry(BaseModel):
    """Single cognitive asset with identity and content hash."""

    model_config = {"frozen": True, "extra": "forbid"}

    asset_id: str
    version: str
    content_hash: str

    @field_validator("content_hash")
    @classmethod
    def _valid_hash(cls, v: str) -> str:
        if not _HASH_RE.match(v):
            raise ValueError(f"Invalid hash format: {v}")
        return v


class AssetManifest(BaseModel):
    """Effective cognitive definitions loaded at prepare time.

    Each entry carries asset_id, version and content_hash so the trace
    can identify exactly which definitions were active.
    """

    model_config = {"frozen": True, "extra": "forbid"}

    agent: AssetEntry
    skills: dict[str, AssetEntry]
    protocols: dict[str, AssetEntry]
    conventions: dict[str, AssetEntry]


class StoredPreparedSnapshot(BaseModel):
    """Internal authoritative snapshot. Never leaves the validator."""

    model_config = {"frozen": True, "extra": "forbid"}

    run_id: str = Field(default_factory=new_id)
    symbol: str
    facts: dict
    facts_hash: str
    prepared_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    market_data_as_of: datetime | None = None
    freshness_status: str
    freshness_max_age_seconds: float
    capability_trace: CapabilityTrace
    effective_assets: AssetManifest
    # Convention values resolved at prepare time from the same YAML read that
    # produced effective_assets.conventions. Stored so accept_interpretation
    # reads them without re-loading YAML. Keys are convention entry keys.
    resolved_conventions: dict[str, float | int | str | bool]
    # sha256 of the canonical serialization of resolved_conventions. Required:
    # a snapshot without it is invalid, there is no default and no grace period.
    conventions_hash: str

    @field_validator("symbol")
    @classmethod
    def _symbol_nonempty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Symbol must be non-empty")
        return v.upper()

    @field_validator("facts_hash", "conventions_hash")
    @classmethod
    def _valid_hash_format(cls, v: str) -> str:
        if not _HASH_RE.match(v):
            raise ValueError(f"Invalid hash format: {v}")
        return v

    @field_validator("freshness_max_age_seconds")
    @classmethod
    def _valid_max_age(cls, v: float) -> float:
        if not math.isfinite(v) or v <= 0 or v > _MAX_FRESHNESS_AGE:
            raise ValueError(f"freshness_max_age_seconds must be in (0, {_MAX_FRESHNESS_AGE}], got {v}")
        return v

    @field_validator("prepared_at", "market_data_as_of")
    @classmethod
    def _tz_aware(cls, v: datetime | None) -> datetime | None:
        if v is not None and v.tzinfo is None:
            raise ValueError("Timestamp must be timezone-aware")
        return v


class PreparedAnalysisView(BaseModel):
    """Read-only projection the host receives. Does not contain the authoritative snapshot."""

    model_config = {"frozen": True, "extra": "forbid"}

    run_id: str
    symbol: str
    facts: dict
    facts_hash: str
    prepared_at: datetime
    market_data_as_of: datetime | None = None
    freshness_status: str
    freshness_max_age_seconds: float
    effective_assets: AssetManifest
    conventions_hash: str


class AcceptanceRequest(BaseModel):
    """What the host sends back. No snapshot, no accepted_at, no facts_hash."""

    model_config = {"extra": "forbid"}

    run_id: str
    interpretation: dict
    host_provider: str | None = None
    host_model: str | None = None

    @model_validator(mode="after")
    def _run_id_nonempty(self) -> AcceptanceRequest:
        if not self.run_id or not self.run_id.strip():
            raise ValueError("run_id must be non-empty")
        return self


def _canonical_sha256(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def compute_facts_hash(facts: dict) -> str:
    """Deterministic hash of facts content. Does not authenticate origin."""
    return _canonical_sha256(facts)


def compute_conventions_hash(resolved_conventions: dict[str, float | int | str | bool]) -> str:
    """Deterministic hash of the effective convention values used by a snapshot.

    Same canonical serialization and format as facts_hash. Covers exactly the
    resolved values; a change to any value or key changes the hash.
    """
    return _canonical_sha256(resolved_conventions)


def snapshot_to_view(snapshot: StoredPreparedSnapshot) -> PreparedAnalysisView:
    """Project an internal snapshot to the host-facing view."""
    return PreparedAnalysisView(
        run_id=snapshot.run_id,
        symbol=snapshot.symbol,
        facts=snapshot.facts,
        facts_hash=snapshot.facts_hash,
        prepared_at=snapshot.prepared_at,
        market_data_as_of=snapshot.market_data_as_of,
        freshness_status=snapshot.freshness_status,
        freshness_max_age_seconds=snapshot.freshness_max_age_seconds,
        effective_assets=snapshot.effective_assets,
        conventions_hash=snapshot.conventions_hash,
    )
