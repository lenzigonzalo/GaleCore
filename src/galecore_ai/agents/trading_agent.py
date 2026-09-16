"""TradingAgent definition loaded from the canonical cognitive asset."""

from galecore_ai.harness.assets import load_asset
from galecore_ai.harness.definitions import AgentDefinition


def build_trading_agent(*, provider: str = "fake", model: str | None = None) -> AgentDefinition:
    agent = load_asset("agents/trading-agent.yaml", AgentDefinition)
    agent.model_preferences.provider = provider
    agent.model_preferences.model = model
    return agent
