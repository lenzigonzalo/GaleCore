"""Prepared analysis snapshot — immutable identified facts for deferred acceptance.

The snapshot freezes facts at preparation time. Acceptance re-validates freshness
and assurance against exactly this snapshot, without repeating live queries.

A facts_hash detects content changes but does not authenticate origin.
Provenance is HOST_DECLARED unless independently verified.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime

from pydantic import BaseModel, Field

from galecore_ai.contracts.agent_run import CapabilityTrace
from galecore_ai.contracts.ids import new_id


class AssetManifest(BaseModel):
    """Hashes of effective cognitive definitions loaded at prepare time."""

    agent_hash: str | None = None
    skill_hashes: dict[str, str] = Field(default_factory=dict)
    protocol_hashes: dict[str, str] = Field(default_factory=dict)
    convention_hashes: dict[str, str] = Field(default_factory=dict)


class PreparedSnapshot(BaseModel):
    """Immutable identified snapshot of validated facts ready for acceptance."""

    run_id: str = Field(default_factory=new_id)
    symbol: str
    facts: dict
    facts_hash: str  # sha256 of canonical facts JSON
    prepared_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    market_data_as_of: datetime | None = None
    freshness_status: str
    freshness_max_age_seconds: float
    capability_trace: CapabilityTrace
    effective_assets: AssetManifest = Field(default_factory=AssetManifest)


def compute_facts_hash(facts: dict) -> str:
    """Deterministic hash of facts content. Does not authenticate origin."""
    canonical = json.dumps(facts, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class AcceptanceRequest(BaseModel):
    """Request to validate a host-generated interpretation against a snapshot."""

    run_id: str  # must match snapshot
    interpretation: dict  # model output to validate
    host_provider: str | None = None  # HOST_DECLARED
    host_model: str | None = None  # HOST_DECLARED
    accepted_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
