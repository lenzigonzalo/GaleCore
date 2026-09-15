"""Controlled integration test — full GEX-SPY vertical with FakeProvider + mock HTTP.

Tests the complete flow:
  REST request → TradingAgent → GEX Analysis Skill → CapabilityDispatcher
  → mock GaleCore REST → validated GexFacts → FakeProvider → structured output
  → guardrails → trace → REST response

No real GaleCore or Anthropic calls. All deterministic.
"""

import os

import pytest
from fastapi.testclient import TestClient

from galecore_ai.api.app import create_app
from galecore_ai.api.config import AppConfig
from galecore_ai.capabilities.dispatcher import CapabilityResult
from galecore_ai.models.providers.fake import clear_canned_responses, register_canned_response

VALID_GEX_RESPONSE = {
    "symbol": "SPY",
    "net_gex": 1500000.0,
    "call_gex": 2000000.0,
    "put_gex": -500000.0,
    "spot": 450.50,
    "zero_gamma_level": 445.0,
    "call_wall": 460.0,
    "put_wall": 440.0,
}


@pytest.fixture(autouse=True)
def _clean():
    clear_canned_responses()
    yield
    clear_canned_responses()


def _make_app_with_mock_galecore(galecore_response: dict, status_code: int = 200):
    """Create an app where the CapabilityDispatcher is patched to return mock data."""
    os.environ["LOCAL_VALIDATION"] = "true"
    os.environ["PROVIDER_MODE"] = "fake"
    os.environ["GALECORE_BASE_URL"] = "http://localhost:5000"
    config = AppConfig()
    app = create_app(config)

    # Patch the dispatcher's invoke to return mock data
    original_invoke = app.state.deps.dispatcher.invoke

    async def mock_invoke(capability_id, parameters, *, agent_allowed=None):
        if capability_id == "compute.gamma_exposure":
            if status_code != 200:
                return CapabilityResult(
                    capability_id, error=f"HTTP {status_code}", latency_ms=1
                )
            return CapabilityResult(
                capability_id, data=galecore_response, latency_ms=5
            )
        return await original_invoke(capability_id, parameters, agent_allowed=agent_allowed)

    app.state.deps.dispatcher.invoke = mock_invoke
    return app


class TestGexVerticalSuccess:
    def test_full_vertical_success(self):
        """SUCCESS case: valid GEX data → FakeProvider → structured output → guardrails pass."""
        register_canned_response("GexInterpretation", {
            "regime": "positive_gamma",
            "observations": ["net_gex is positive at 1500000.0, dealers are long gamma"],
            "implications": ["Mean reversion expected around spot 450.5"],
            "caveats": ["Based on current open interest snapshot"],
        })

        app = _make_app_with_mock_galecore(VALID_GEX_RESPONSE)
        client = TestClient(app)

        response = client.post(
            "/api/v1/agent-runs/gex-analysis",
            json={"symbol": "SPY"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "SUCCESS"
        assert data["result"] is not None
        assert data["result"]["regime"] == "positive_gamma"
        assert data["error_detail"] is None

        # Trace assertions
        trace = data["trace"]
        assert trace["provider"] == "fake"
        assert "gex_interpretation" in trace["skills_used"]
        assert "facts_discipline" in trace["protocols_used"]
        assert trace["latency_ms"] >= 0
        assert trace["started_at"] is not None
        assert trace["completed_at"] is not None

        # Capability invocation recorded
        cap_invocations = trace["capabilities_invoked"]
        gex_cap = [c for c in cap_invocations if c["capability_id"] == "compute.gamma_exposure"]
        assert len(gex_cap) >= 1
        assert gex_cap[0]["ok"] is True


class TestGexVerticalInsufficientData:
    def test_no_galecore_data(self):
        """INSUFFICIENT_DATA case: GaleCore returns error → model_called=false → result=null."""
        app = _make_app_with_mock_galecore({}, status_code=500)
        client = TestClient(app)

        response = client.post(
            "/api/v1/agent-runs/gex-analysis",
            json={"symbol": "SPY"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "INSUFFICIENT_DATA"
        assert data["result"] is None
        assert data["error_detail"] is not None
        assert "Capability fetch failed" in data["error_detail"]

    def test_incomplete_galecore_data(self):
        """INSUFFICIENT_DATA case: GaleCore returns incomplete data."""
        incomplete = {"symbol": "SPY", "net_gex": 1500000.0}
        app = _make_app_with_mock_galecore(incomplete)
        client = TestClient(app)

        response = client.post(
            "/api/v1/agent-runs/gex-analysis",
            json={"symbol": "SPY"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "INSUFFICIENT_DATA"
        assert data["result"] is None


class TestGexVerticalGuardrails:
    def test_invented_numbers_rejected(self):
        """Guardrail catches invented numbers → VALIDATION_ERROR, result=null."""
        register_canned_response("GexInterpretation", {
            "regime": "positive_gamma",
            "observations": ["Target price 999.99 based on analysis"],
            "implications": [],
            "caveats": [],
        })

        app = _make_app_with_mock_galecore(VALID_GEX_RESPONSE)
        client = TestClient(app)

        response = client.post(
            "/api/v1/agent-runs/gex-analysis",
            json={"symbol": "SPY"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "VALIDATION_ERROR"
        assert data["result"] is None  # fail-closed
        assert "no_invented_numbers" in data["error_detail"]


class TestGexVerticalTrace:
    def test_trace_has_token_usage(self):
        """Trace records input/output tokens from the model."""
        register_canned_response("GexInterpretation", {
            "regime": "positive_gamma",
            "observations": ["net_gex is positive"],
            "implications": ["spot stable"],
            "caveats": ["snapshot only"],
        })

        app = _make_app_with_mock_galecore(VALID_GEX_RESPONSE)
        client = TestClient(app)

        response = client.post(
            "/api/v1/agent-runs/gex-analysis",
            json={"symbol": "SPY"},
        )

        data = response.json()
        assert data["status"] == "SUCCESS"
        trace = data["trace"]
        assert trace.get("input_tokens") is not None
        assert trace.get("output_tokens") is not None
