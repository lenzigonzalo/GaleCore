"""Application configuration — sourced from environment variables.

LOCAL_VALIDATION=true restricts GALECORE_BASE_URL to localhost only.
"""

from __future__ import annotations

import os


class AppConfig:
    """Configuration from environment variables."""

    def __init__(self) -> None:
        self.galecore_base_url: str = os.environ.get(
            "GALECORE_BASE_URL", "http://localhost:5000"
        )
        self.galecore_api_key: str | None = os.environ.get("GALECORE_API_KEY")
        self.anthropic_api_key: str | None = os.environ.get("ANTHROPIC_API_KEY")
        self.anthropic_model: str = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")
        self.local_validation: bool = os.environ.get("LOCAL_VALIDATION", "true").lower() == "true"
        self.provider_mode: str = os.environ.get("PROVIDER_MODE", "fake")

        # Enforce local-only restriction
        if self.local_validation:
            self._enforce_local_url()

    def _enforce_local_url(self) -> None:
        """In LOCAL_VALIDATION mode, only allow localhost URLs."""
        from urllib.parse import urlparse

        parsed = urlparse(self.galecore_base_url)
        hostname = parsed.hostname or ""
        if hostname not in ("localhost", "127.0.0.1", "::1"):
            raise ValueError(
                f"LOCAL_VALIDATION=true but GALECORE_BASE_URL points to '{hostname}'. "
                "Only localhost is allowed in local validation mode."
            )
