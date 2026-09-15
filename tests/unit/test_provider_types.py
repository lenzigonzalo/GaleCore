"""Unit tests for ModelRequest, ModelResult, and ModelMessage types."""

from galecore_ai.models.provider import ModelMessage, ModelRequest, ModelResult, ModelRole


class TestModelMessage:
    def test_create_system_message(self):
        msg = ModelMessage(role=ModelRole.SYSTEM, content="You are a trading analyst.")
        assert msg.role == ModelRole.SYSTEM
        assert msg.content == "You are a trading analyst."

    def test_create_user_message(self):
        msg = ModelMessage(role=ModelRole.USER, content="Analyze GEX for SPY")
        assert msg.role == ModelRole.USER


class TestModelRequest:
    def test_defaults(self):
        req = ModelRequest(messages=[ModelMessage(role=ModelRole.USER, content="test")])
        assert req.temperature == 0.0
        assert req.max_tokens == 4096
        assert req.timeout_seconds == 30.0
        assert req.metadata == {}

    def test_custom_values(self):
        req = ModelRequest(
            messages=[ModelMessage(role=ModelRole.USER, content="test")],
            temperature=0.7,
            max_tokens=1024,
            timeout_seconds=10.0,
            metadata={"skill": "gex_analysis"},
        )
        assert req.temperature == 0.7
        assert req.max_tokens == 1024


class TestModelResult:
    def test_ok_result(self):
        class FakeOutput(ModelResult):
            pass

        result = ModelResult(value=None, error=None)
        # value is None so ok is False
        assert not result.ok

    def test_error_result(self):
        result = ModelResult(error="timeout", provider="fake", model="fake-v1")
        assert not result.ok
        assert result.error == "timeout"
        assert result.provider == "fake"

    def test_successful_result(self):
        from pydantic import BaseModel

        class SimpleOutput(BaseModel):
            answer: str = "test"

        out = SimpleOutput()
        result = ModelResult(value=out, raw_text='{"answer":"test"}', provider="fake")
        assert result.ok
        assert result.value.answer == "test"
