"""ModelProvider protocol — provider-agnostic interface for structured generation.

Every provider (Anthropic, OpenAI, Fake, etc.) implements this protocol.
The harness never imports a concrete provider directly.
"""

from __future__ import annotations

from typing import Protocol, TypeVar, runtime_checkable

from pydantic import BaseModel

from galecore_ai.models.provider import ModelRequest, ModelResult

T = TypeVar("T", bound=BaseModel)


@runtime_checkable
class ModelProvider(Protocol):
    """Provider-agnostic interface for structured LLM output."""

    @property
    def provider_name(self) -> str: ...

    @property
    def model_id(self) -> str: ...

    async def generate_structured(
        self,
        request: ModelRequest,
        output_schema: type[T],
    ) -> ModelResult[T]: ...
