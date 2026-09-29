"""AnthropicProvider — real provider using the Anthropic Claude API.

Uses tool_use to extract structured output matching the requested Pydantic schema.
API key from constructor (typically sourced from environment).
"""

from __future__ import annotations

import json
import logging
import time
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from galecore_ai.models.provider import ModelRequest, ModelResult, ModelRole

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


class AnthropicProvider:
    """Anthropic Claude provider for structured generation via tool_use."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str = "claude-sonnet-4-6",
        max_retries: int = 1,
        timeout: float = 60.0,
        workspace_id: str | None = None,
    ) -> None:
        try:
            import anthropic
        except ImportError as exc:
            raise ImportError(
                "anthropic package required. Install with: pip install 'galecore-ai[anthropic]'"
            ) from exc

        headers: dict[str, str] = {}
        if workspace_id:
            headers["anthropic-workspace-id"] = workspace_id

        self._client = anthropic.AsyncAnthropic(
            api_key=api_key,
            max_retries=max_retries,
            timeout=timeout,
            default_headers=headers or None,
        )
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
        """Generate structured output by defining a tool matching the output schema.

        Strategy: define a single tool whose input_schema is the Pydantic JSON Schema,
        force tool_choice to that tool, and parse the tool_use block.
        """
        t0 = time.monotonic()

        # Build the tool definition from the Pydantic schema
        schema_json = output_schema.model_json_schema()
        tool_name = f"output_{output_schema.__name__}"

        tool_def = {
            "name": tool_name,
            "description": f"Return structured {output_schema.__name__} output",
            "input_schema": schema_json,
        }

        # Build messages for Claude API
        system_text = ""
        api_messages: list[dict] = []

        for msg in request.messages:
            if msg.role == ModelRole.SYSTEM:
                system_text += msg.content + "\n"
            else:
                api_messages.append({
                    "role": msg.role.value,
                    "content": msg.content,
                })

        try:
            import anthropic as _anthropic

            # Split system into stable prefix (cacheable) + volatile facts block.
            # Render order is tools → system → messages; cache_control on the last
            # stable block caches both the tool definition and the system prefix.
            _FACTS_MARKER = "# Facts"
            if system_text and _FACTS_MARKER in system_text:
                stable, _, volatile = system_text.partition(_FACTS_MARKER)
                system_param: list[dict] | str = [
                    {
                        "type": "text",
                        "text": stable.strip(),
                        "cache_control": {"type": "ephemeral"},
                    },
                    {"type": "text", "text": _FACTS_MARKER + volatile},
                ]
            else:
                system_param = [
                    {
                        "type": "text",
                        "text": system_text.strip(),
                        "cache_control": {"type": "ephemeral"},
                    }
                ] if system_text else ""

            response = await self._client.messages.create(
                model=self._model,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
                system=system_param,
                messages=api_messages,
                tools=[tool_def],
                tool_choice={"type": "tool", "name": tool_name},
            )
        except (
            _anthropic.APIError,
            _anthropic.APIConnectionError,
            _anthropic.APITimeoutError,
        ) as exc:
            elapsed = int((time.monotonic() - t0) * 1000)
            logger.error("Anthropic API error: %s", exc)
            return ModelResult(
                error=f"Anthropic API error: {exc}",
                provider=self.provider_name,
                model=self.model_id,
                latency_ms=elapsed,
            )

        elapsed = int((time.monotonic() - t0) * 1000)
        usage = response.usage
        _usage_kwargs = {
            "input_tokens": usage.input_tokens,
            "output_tokens": usage.output_tokens,
            "cache_read_tokens": getattr(usage, "cache_read_input_tokens", None),
            "cache_creation_tokens": getattr(usage, "cache_creation_input_tokens", None),
            "latency_ms": elapsed,
        }

        # Extract tool_use block
        tool_input = None
        for block in response.content:
            if block.type == "tool_use" and block.name == tool_name:
                tool_input = block.input
                break

        if tool_input is None:
            return ModelResult(
                error="No tool_use block in response",
                provider=self.provider_name,
                model=self.model_id,
                **_usage_kwargs,
            )

        # Parse into the output schema
        try:
            value = output_schema.model_validate(tool_input)
        except ValidationError as exc:
            return ModelResult(
                error=f"Output validation failed: {exc}",
                raw_text=json.dumps(tool_input, default=str),
                provider=self.provider_name,
                model=self.model_id,
                **_usage_kwargs,
            )

        raw_text = json.dumps(tool_input, default=str)
        return ModelResult(
            value=value,
            raw_text=raw_text,
            provider=self.provider_name,
            model=self.model_id,
            **_usage_kwargs,
        )
