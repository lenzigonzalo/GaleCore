"""Model provider types — request/result for structured generation.

ModelRequest carries the prompt + context.
ModelResult carries the parsed output or error info.
"""

from __future__ import annotations

from enum import Enum
from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T", bound=BaseModel)


class ModelRole(str, Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"


class ModelMessage(BaseModel):
    role: ModelRole
    content: str


class ModelRequest(BaseModel):
    """Input to a model provider."""

    messages: list[ModelMessage]
    temperature: float = 0.0
    max_tokens: int = 4096
    timeout_seconds: float = 30.0
    metadata: dict = Field(default_factory=dict)


class ModelResult(BaseModel, Generic[T]):
    """Output from a model provider. Either value is set or error is set."""

    value: T | None = None
    raw_text: str | None = None
    error: str | None = None
    provider: str | None = None
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    latency_ms: int | None = None

    @property
    def ok(self) -> bool:
        return self.value is not None and self.error is None
