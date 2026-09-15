"""Unit tests for FakeProvider — deterministic model provider."""

import pytest
from pydantic import BaseModel

from galecore_ai.models.provider import ModelMessage, ModelRequest, ModelRole
from galecore_ai.models.providers.fake import (
    FakeProvider,
    clear_canned_responses,
    register_canned_response,
)


class SampleOutput(BaseModel):
    regime: str = "positive_gamma"
    observations: list[str] = []


class RequiredFieldsOutput(BaseModel):
    symbol: str
    value: float


@pytest.fixture(autouse=True)
def _clean_canned():
    clear_canned_responses()
    yield
    clear_canned_responses()


def _make_request(content: str = "test") -> ModelRequest:
    return ModelRequest(messages=[ModelMessage(role=ModelRole.USER, content=content)])


class TestFakeProviderBasics:
    @pytest.mark.asyncio
    async def test_provider_name_and_model(self):
        p = FakeProvider()
        assert p.provider_name == "fake"
        assert p.model_id == "fake-deterministic-v1"

    @pytest.mark.asyncio
    async def test_generates_default_output(self):
        p = FakeProvider()
        result = await p.generate_structured(_make_request(), SampleOutput)
        assert result.ok
        assert result.value.regime == "positive_gamma"
        assert result.value.observations == []
        assert result.provider == "fake"

    @pytest.mark.asyncio
    async def test_deterministic_across_calls(self):
        p = FakeProvider()
        r1 = await p.generate_structured(_make_request(), SampleOutput)
        r2 = await p.generate_structured(_make_request(), SampleOutput)
        assert r1.value == r2.value


class TestFakeProviderCannedResponses:
    @pytest.mark.asyncio
    async def test_canned_response(self):
        register_canned_response("SampleOutput", {
            "regime": "negative_gamma",
            "observations": ["Spot below zero-gamma level"],
        })
        p = FakeProvider()
        result = await p.generate_structured(_make_request(), SampleOutput)
        assert result.ok
        assert result.value.regime == "negative_gamma"
        assert len(result.value.observations) == 1

    @pytest.mark.asyncio
    async def test_invalid_canned_response_returns_error(self):
        register_canned_response("RequiredFieldsOutput", {"bad_field": True})
        p = FakeProvider()
        result = await p.generate_structured(_make_request(), RequiredFieldsOutput)
        assert not result.ok
        assert "invalid" in result.error.lower()


class TestFakeProviderErrors:
    @pytest.mark.asyncio
    async def test_force_error(self):
        p = FakeProvider(force_error="simulated timeout")
        result = await p.generate_structured(_make_request(), SampleOutput)
        assert not result.ok
        assert result.error == "simulated timeout"

    @pytest.mark.asyncio
    async def test_required_fields_auto_default(self):
        p = FakeProvider()
        result = await p.generate_structured(_make_request(), RequiredFieldsOutput)
        assert result.ok
        assert result.value.symbol == "fake_symbol"
        assert result.value.value == 0


class TestFakeProviderMetadata:
    @pytest.mark.asyncio
    async def test_result_has_token_counts(self):
        p = FakeProvider()
        result = await p.generate_structured(_make_request("analyze SPY"), SampleOutput)
        assert result.ok
        assert result.input_tokens is not None
        assert result.output_tokens is not None
        assert result.latency_ms is not None
