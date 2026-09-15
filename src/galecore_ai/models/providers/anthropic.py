"""AnthropicProvider — stub for future Anthropic integration.

This file defines the interface and constructor but raises NotImplementedError
on actual calls. It will be completed in a later increment when the real
provider is needed.
"""

from __future__ import annotations

from typing import TypeVar

from pydantic import BaseModel

from galecore_ai.models.provider import ModelRequest, ModelResult

T = TypeVar("T", bound=BaseModel)


class AnthropicProvider:
    """Anthropic Claude provider. Stub — not yet active."""

    def __init__(self, *, api_key: str, model: str = "claude-sonnet-4-20250514") -> None:
        self._api_key = api_key
        self._model = model

    @property
    def provider_name(self) -> str:
        return "anthropic"

    @property
    def model_id(self) -> str:
        return self._model

    async def generate_structured(
        self,
        request: ModelRequest,
        output_schema: type[T],
    ) -> ModelResult[T]:
        raise NotImplementedError(
            "AnthropicProvider is a stub. Real implementation comes in a later increment."
        )
