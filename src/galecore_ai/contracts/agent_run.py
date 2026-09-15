"""AgentRun contracts — request/result of a cognitive run."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from uuid import uuid4

from pydantic import BaseModel, Field


class RunStatus(str, Enum):
    SUCCESS = "SUCCESS"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"
    MODEL_ERROR = "MODEL_ERROR"
    TIMEOUT = "TIMEOUT"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class TraceRecord(BaseModel):
    """Trace of a single agent run. Records inputs, outputs, versions, calls and times.
    Never records internal chain-of-thought."""

    trace_id: str = Field(default_factory=lambda: str(uuid4()))
    provider: str | None = None
    model: str | None = None
    agent_definition: dict = Field(default_factory=dict)
    skills_used: list[str] = Field(default_factory=list)
    protocols_used: list[str] = Field(default_factory=list)
    capabilities_invoked: list[dict] = Field(default_factory=list)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    latency_ms: int | None = None
    error: str | None = None


class AgentRunRequest(BaseModel):
    """Request to execute a cognitive run."""

    run_id: str = Field(default_factory=lambda: str(uuid4()))
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
