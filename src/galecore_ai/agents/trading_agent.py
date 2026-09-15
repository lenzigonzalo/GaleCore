"""TradingAgent — the primary agent definition for the Harness.

This module provides the default TradingAgent definition and a factory
to build it. The TradingAgent orchestrates skills, protocols, and
conventions through the Harness infrastructure.

Phase 3: read-only analysis only (GEX interpretation).
"""

from __future__ import annotations

from galecore_ai.harness.definitions import AgentDefinition, ModelPreferences


def build_trading_agent(
    *,
    provider: str = "fake",
    model: str | None = None,
) -> AgentDefinition:
    """Build the default TradingAgent definition."""
    return AgentDefinition(
        agent_id="TradingAgent",
        version="1.0.0",
        display_name="Trading Agent",
        description=(
            "Primary cognitive agent for trading analysis and decision support. "
            "Interprets market data, evaluates opportunities, and provides "
            "structured analysis with evidence-backed reasoning. "
            "All quantitative facts come from GaleCore's deterministic computations — "
            "this agent interprets but never invents numbers."
        ),
        skills=["gex_interpretation"],
        protocols=["facts_discipline"],
        conventions=["trading_defaults"],
        allowed_capabilities=[
            "market_data.quote",
            "compute.gamma_exposure",
            "compute.gex_analysis",
        ],
        model_preferences=ModelPreferences(
            provider=provider,
            model=model,
            temperature=0.0,
            max_tokens=4096,
        ),
    )
