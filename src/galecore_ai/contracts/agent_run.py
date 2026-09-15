"""AgentRun contracts — request/result of a cognitive run."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum

from pydantic import BaseModel, Field

from galecore_ai.contracts.ids import new_id


class RunStatus(str, Enum):
    SUCCESS = "SUCCESS"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"
    MODEL_ERROR = "MODEL_ERROR"
    TIMEOUT = "TIMEOUT"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    INTERNAL_ERROR = "INTERNAL_ERROR"


# ── Trace sub-models ─────────────────────────────────────────────────


class AgentDefinitionTrace(BaseModel):
    agent_id: str
    version: str
    content_hash: str | None = None  # SHA-256 of definition


class SkillTrace(BaseModel):
    skill_id: str
    version: str
    content_hash: str | None = None


class ProtocolTrace(BaseModel):
    protocol_id: str
    version: str
    content_hash: str | None = None


class ConventionTrace(BaseModel):
    convention_id: str
    version: str
    content_hash: str | None = None


class CapabilityTrace(BaseModel):
    capability_id: str
    semantic_class: str | None = None
    endpoint: str | None = None  # logical endpoint, e.g. "/App/Gex/Analysis"
    transport: str = "REST"
    schema_version: str | None = None  # from GaleCore if provided, else null
    calculation_version: str | None = None  # from GaleCore if provided, else null
    methodology_version: str | None = None  # from GaleCore if provided, else null
    latency_ms: int | None = None
    outcome: str | None = None  # "ok", "error", "timeout"
    error: str | None = None
    response_received_at: datetime | None = None


class FreshnessTrace(BaseModel):
    market_data_as_of: datetime | None = None
    response_received_at: datetime | None = None
    freshness_status: str | None = None
    freshness_age_seconds: float | None = None


class GuardrailTrace(BaseModel):
    guardrail_id: str
    passed: bool
    message: str = ""


# ── Main trace record ────────────────────────────────────────────────


class TraceRecord(BaseModel):
    """Auditable trace of a single agent run. Never records chain-of-thought."""

    # IDs
    trace_id: str = Field(default_factory=new_id)
    correlation_id: str | None = None  # links related runs

    # Timing (all UTC timezone-aware)
    request_timestamp: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    latency_ms: int | None = None

    # Provider
    provider: str | None = None
    model: str | None = None
    model_called: bool = False
    input_tokens: int | None = None
    output_tokens: int | None = None

    # Agent definition
    agent_definition: AgentDefinitionTrace | None = None

    # Skills
    skills: list[SkillTrace] = Field(default_factory=list)

    # Protocols
    protocols: list[ProtocolTrace] = Field(default_factory=list)

    # Conventions
    conventions: list[ConventionTrace] = Field(default_factory=list)

    # Capabilities
    capabilities_invoked: list[CapabilityTrace] = Field(default_factory=list)

    # Freshness
    freshness: FreshnessTrace | None = None

    # Guardrails
    guardrails_executed: list[GuardrailTrace] = Field(default_factory=list)

    # Status
    status: str | None = None
    error: str | None = None  # sanitized, no credentials


# ── Request / Result ─────────────────────────────────────────────────


class AgentRunRequest(BaseModel):
    """Request to execute a cognitive run."""

    run_id: str = Field(default_factory=new_id)
    agent_id: str = "TradingAgent"
    task_type: str  # e.g. "gex_analysis"
    parameters: dict = Field(default_factory=dict)  # e.g. {"symbol": "SPY"}
    requested_at: datetime = Field(default_factory=lambda: datetime.now(tz=UTC))


class AgentRunResult(BaseModel):
    """Result of a cognitive run."""

    run_id: str
    status: RunStatus
    result: dict | None = None
    trace: TraceRecord = Field(default_factory=TraceRecord)
    error_detail: str | None = None
