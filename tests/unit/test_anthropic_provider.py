"""Unit tests for AnthropicProvider — no real API calls."""

import pytest

from galecore_ai.models.providers.anthropic import AnthropicProvider


class TestAnthropicProviderInit:
    def test_provider_name(self):
        provider = AnthropicProvider(api_key="test-key")
        assert provider.provider_name == "anthropic"

    def test_model_id_default(self):
        provider = AnthropicProvider(api_key="test-key")
        assert "claude" in provider.model_id

    def test_model_id_custom(self):
        provider = AnthropicProvider(api_key="test-key", model="claude-opus-4-20250514")
        assert provider.model_id == "claude-opus-4-20250514"

    def test_implements_protocol(self):
        from galecore_ai.models.gateway import ModelProvider

        provider = AnthropicProvider(api_key="test-key")
        assert isinstance(provider, ModelProvider)


class TestAnthropicProviderErrors:
    @pytest.mark.asyncio
    async def test_invalid_api_key_returns_error(self):
        """With a bad key, the API call should return an error result (not raise)."""
        from galecore_ai.contracts.gex_analysis import GexInterpretation
        from galecore_ai.models.provider import ModelMessage, ModelRequest, ModelRole

        provider = AnthropicProvider(api_key="sk-invalid-key", timeout=5.0)
        request = ModelRequest(
            messages=[
                ModelMessage(role=ModelRole.SYSTEM, content="You are a test."),
                ModelMessage(role=ModelRole.USER, content="Classify regime."),
            ],
            max_tokens=100,
        )
        result = await provider.generate_structured(request, GexInterpretation)
        assert not result.ok
        assert result.error is not None
        assert result.provider == "anthropic"
