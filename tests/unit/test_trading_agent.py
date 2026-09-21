"""Unit tests for TradingAgent definition builder."""

from galecore_ai.agents.trading_agent import build_trading_agent


class TestBuildTradingAgent:
    def test_default_agent(self):
        agent = build_trading_agent()
        assert agent.agent_id == "TradingAgent"
        assert agent.version == "1.1.0"
        assert "gex_interpretation" in agent.skills
        assert "regime_interpretation" in agent.skills
        assert {"compute.put_skew", "market_data.trade"} <= set(agent.allowed_capabilities)
        assert "facts_discipline" in agent.protocols
        assert "trading_defaults" in agent.conventions
        assert agent.model_preferences.provider == "fake"
        assert agent.model_preferences.temperature == 0.0

    def test_custom_provider(self):
        agent = build_trading_agent(provider="anthropic", model="claude-sonnet-4-20250514")
        assert agent.model_preferences.provider == "anthropic"
        assert agent.model_preferences.model == "claude-sonnet-4-20250514"

    def test_allowed_capabilities(self):
        agent = build_trading_agent()
        assert "market_data.quote" in agent.allowed_capabilities
        assert "compute.gamma_exposure" in agent.allowed_capabilities
