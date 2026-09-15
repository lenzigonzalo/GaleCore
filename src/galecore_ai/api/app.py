"""FastAPI application factory."""

from __future__ import annotations

import logging

from fastapi import FastAPI

from galecore_ai.api.config import AppConfig
from galecore_ai.api.dependencies import AppDependencies
from galecore_ai.api.routes import agent_runs, health

logger = logging.getLogger(__name__)


def create_app(config: AppConfig | None = None) -> FastAPI:
    """Create and configure the FastAPI application."""
    if config is None:
        config = AppConfig()

    app = FastAPI(
        title="GaleCore-AI",
        description="Cognitive infrastructure for GaleCore",
        version="0.1.0",
    )

    # Wire up dependencies
    app.state.deps = AppDependencies(config)

    # Register routes
    app.include_router(health.router)
    app.include_router(agent_runs.router)

    logger.info("GaleCore-AI app created (provider=%s)", config.provider_mode)
    return app
