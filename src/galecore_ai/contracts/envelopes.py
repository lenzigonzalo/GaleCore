"""Envelope contracts — P0-CONTRACTS section 3.

Every message crossing boundaries shares BaseEnvelope fields.
Specialized envelopes add domain-specific concerns.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field

from galecore_ai.contracts.ids import new_id


class ActorType(str, Enum):
    HUMAN = "HUMAN"
    AGENT = "AGENT"
    SYSTEM = "SYSTEM"


class Actor(BaseModel):
    actor_type: ActorType
    user_id: str | None = None
    tenant_id: str | None = None
    agent_definition_version: str | None = None


class TemporalContext(BaseModel):
    requested_at: datetime
    market_data_as_of: datetime | None = None


class BaseEnvelope(BaseModel):
    contract_version: str = "1.0"
    message_id: str = Field(default_factory=new_id)
    correlation_id: str = Field(default_factory=new_id)
    causation_id: str | None = None
    trace_id: str = Field(default_factory=new_id)
    actor: Actor
    temporal_context: TemporalContext


class CognitiveEnvelope(BaseEnvelope):
    evidence_refs: list[dict] = Field(default_factory=list)
    capability_versions: dict[str, str] = Field(default_factory=dict)
    model_metadata: dict = Field(default_factory=dict)
    payload_type: str
    payload: dict
