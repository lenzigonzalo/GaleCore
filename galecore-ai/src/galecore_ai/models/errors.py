"""Model-layer error types and timeout/rate-limit handling."""

from __future__ import annotations


class ModelError(Exception):
    """Base error for model provider operations."""

    def __init__(self, message: str, *, provider: str | None = None, retryable: bool = False):
        super().__init__(message)
        self.provider = provider
        self.retryable = retryable


class ModelTimeoutError(ModelError):
    """Request exceeded timeout_seconds."""

    def __init__(self, message: str = "Model request timed out", **kwargs):
        super().__init__(message, retryable=True, **kwargs)


class ModelRateLimitError(ModelError):
    """Provider returned a rate-limit response."""

    def __init__(
        self,
        message: str = "Rate limit exceeded",
        *,
        retry_after_seconds: float | None = None,
        **kwargs,
    ):
        super().__init__(message, retryable=True, **kwargs)
        self.retry_after_seconds = retry_after_seconds


class ModelValidationError(ModelError):
    """Model output failed schema validation."""

    def __init__(self, message: str, *, validation_errors: list[str] | None = None, **kwargs):
        super().__init__(message, retryable=False, **kwargs)
        self.validation_errors = validation_errors or []


class ModelAuthError(ModelError):
    """Authentication/authorization failure with provider."""

    def __init__(self, message: str = "Authentication failed", **kwargs):
        super().__init__(message, retryable=False, **kwargs)
