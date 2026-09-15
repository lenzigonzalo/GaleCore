"""Dependency injection — builds the runtime stack from configuration."""

from __future__ import annotations

import logging

from galecore_ai.agents.trading_agent import build_trading_agent
from galecore_ai.api.config import AppConfig
from galecore_ai.application.analyze_gex import AnalyzeGexUseCase
from galecore_ai.capabilities.contracts import KNOWN_CAPABILITIES
from galecore_ai.capabilities.dispatcher import CapabilityDispatcher
from galecore_ai.capabilities.registry import CapabilityRegistry
from galecore_ai.conventions.trading_defaults import build_trading_defaults
from galecore_ai.harness.convention_resolver import ConventionResolver
from galecore_ai.harness.protocol_loader import ProtocolLoader
from galecore_ai.harness.runtime import CognitiveRuntime
from galecore_ai.harness.skill_loader import SkillLoader
from galecore_ai.models.gateway import ModelProvider
from galecore_ai.protocols.facts_discipline import build_facts_discipline_protocol
from galecore_ai.skills.gex_analysis.skill import build_gex_interpretation_skill

logger = logging.getLogger(__name__)


class AppDependencies:
    """Singleton holding all wired-up dependencies."""

    def __init__(self, config: AppConfig) -> None:
        self.config = config

        # Registry
        self.registry = CapabilityRegistry()
        self.registry.register_many(KNOWN_CAPABILITIES)

        # Loaders
        self.skill_loader = SkillLoader()
        skill = build_gex_interpretation_skill()
        self.skill_loader.register(skill)

        self.protocol_loader = ProtocolLoader()
        proto = build_facts_discipline_protocol()
        self.protocol_loader.register(proto)

        # Conventions
        self.convention_resolver = ConventionResolver()
        self.convention_resolver.load(build_trading_defaults())

        # Provider
        self.provider = self._build_provider(config)

        # Runtime
        self.runtime = CognitiveRuntime(
            provider=self.provider,
            skill_loader=self.skill_loader,
            protocol_loader=self.protocol_loader,
            convention_resolver=self.convention_resolver,
            capability_registry=self.registry,
        )

        # Dispatcher
        self.dispatcher = CapabilityDispatcher(
            base_url=config.galecore_base_url,
            registry=self.registry,
            api_key=config.galecore_api_key,
        )

        # Use case
        self.gex_use_case = AnalyzeGexUseCase(
            runtime=self.runtime,
            dispatcher=self.dispatcher,
        )

        # Agent definition
        self.trading_agent = build_trading_agent()

        logger.info(
            "Dependencies initialized: provider=%s, base_url=%s, local_validation=%s",
            self.provider.provider_name,
            config.galecore_base_url,
            config.local_validation,
        )

    @staticmethod
    def _build_provider(config: AppConfig) -> ModelProvider:
        if config.provider_mode == "anthropic":
            if not config.anthropic_api_key:
                raise ValueError("ANTHROPIC_API_KEY required when PROVIDER_MODE=anthropic")
            from galecore_ai.models.providers.anthropic import AnthropicProvider

            return AnthropicProvider(
                api_key=config.anthropic_api_key,
                model=config.anthropic_model,
            )

        from galecore_ai.models.providers.fake import FakeProvider

        return FakeProvider()
