"""FakeProvider — deterministic provider for testing.

Returns canned responses that match the requested output_schema.
No network calls. Fully deterministic. Sufficient for Increment 1 validation.
"""

from __future__ import annotations

import time
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from galecore_ai.models.provider import ModelRequest, ModelResult

T = TypeVar("T", bound=BaseModel)

# Registry of canned responses keyed by schema class name.
# Tests can register custom responses via register_canned_response().
_CANNED_RESPONSES: dict[str, dict] = {}


def register_canned_response(schema_name: str, data: dict) -> None:
    """Register a canned response dict for a given schema class name."""
    _CANNED_RESPONSES[schema_name] = data


def clear_canned_responses() -> None:
    """Clear all registered canned responses."""
    _CANNED_RESPONSES.clear()


class FakeProvider:
    """Deterministic model provider for testing."""

    def __init__(
        self,
        *,
        latency_ms: int = 5,
        force_error: str | None = None,
    ) -> None:
        self._latency_ms = latency_ms
        self._force_error = force_error

    @property
    def provider_name(self) -> str:
        return "fake"

    @property
    def model_id(self) -> str:
        return "fake-deterministic-v1"

    async def generate_structured(
        self,
        request: ModelRequest,
        output_schema: type[T],
    ) -> ModelResult[T]:
        t0 = time.monotonic()

        if self._force_error:
            return ModelResult(
                error=self._force_error,
                provider=self.provider_name,
                model=self.model_id,
                latency_ms=self._latency_ms,
            )

        schema_name = output_schema.__name__
        canned = _CANNED_RESPONSES.get(schema_name)

        if canned is None:
            # Build a minimal valid instance from schema defaults
            try:
                value = _build_default(output_schema)
            except (ValueError, TypeError, KeyError) as exc:
                return ModelResult(
                    error=f"FakeProvider: cannot build default for {schema_name}: {exc}",
                    provider=self.provider_name,
                    model=self.model_id,
                    latency_ms=int((time.monotonic() - t0) * 1000),
                )
        else:
            try:
                value = output_schema.model_validate(canned)
            except ValidationError as exc:
                return ModelResult(
                    error=f"FakeProvider: canned response invalid for {schema_name}: {exc}",
                    provider=self.provider_name,
                    model=self.model_id,
                    latency_ms=int((time.monotonic() - t0) * 1000),
                )

        elapsed = int((time.monotonic() - t0) * 1000) or self._latency_ms
        raw = value.model_dump_json()

        return ModelResult(
            value=value,
            raw_text=raw,
            provider=self.provider_name,
            model=self.model_id,
            input_tokens=len(str(request.messages)),
            output_tokens=len(raw),
            latency_ms=elapsed,
        )


def _build_default(schema: type[T]) -> T:
    """Attempt to construct a schema instance using only defaults and minimal required values."""
    from pydantic_core import PydanticUndefined

    fields = schema.model_fields
    kwargs: dict = {}
    for name, info in fields.items():
        if info.default is not PydanticUndefined:
            continue
        if info.default_factory is not None:
            continue
        if not info.is_required():
            continue
        # Required field with no default — provide minimal value by annotation
        ann = info.annotation
        if ann is str or (hasattr(ann, "__origin__") and ann.__origin__ is str):
            kwargs[name] = f"fake_{name}"
        elif ann is int or ann is float:
            kwargs[name] = 0
        elif ann is bool:
            kwargs[name] = False
        elif ann is list or (hasattr(ann, "__origin__") and getattr(ann, "__origin__", None) is list):
            kwargs[name] = []
        elif ann is dict or (hasattr(ann, "__origin__") and getattr(ann, "__origin__", None) is dict):
            kwargs[name] = {}
    return schema(**kwargs)
