"""Unit tests for model error types."""

from galecore_ai.models.errors import (
    ModelAuthError,
    ModelError,
    ModelRateLimitError,
    ModelTimeoutError,
    ModelValidationError,
)


class TestModelErrors:
    def test_base_error(self):
        err = ModelError("something broke", provider="fake", retryable=False)
        assert str(err) == "something broke"
        assert err.provider == "fake"
        assert not err.retryable

    def test_timeout_is_retryable(self):
        err = ModelTimeoutError()
        assert err.retryable
        assert "timed out" in str(err).lower()

    def test_rate_limit_has_retry_after(self):
        err = ModelRateLimitError(retry_after_seconds=30.0, provider="anthropic")
        assert err.retryable
        assert err.retry_after_seconds == 30.0
        assert err.provider == "anthropic"

    def test_validation_error_not_retryable(self):
        err = ModelValidationError(
            "bad output",
            validation_errors=["field 'regime' missing"],
        )
        assert not err.retryable
        assert len(err.validation_errors) == 1

    def test_auth_error_not_retryable(self):
        err = ModelAuthError(provider="anthropic")
        assert not err.retryable
