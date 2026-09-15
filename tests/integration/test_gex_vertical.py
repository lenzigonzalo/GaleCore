"""Controlled integration test — full GEX-SPY vertical with FakeProvider + mock dispatcher.

Tests the complete flow:
  REST request → AnalyzeGexUseCase → CapabilityDispatcher (mock)
  → parse GaleCore DTO → validate → map to GexFacts → CognitiveRuntime
  → FakeProvider → structured output → guardrails → trace → REST response

No real GaleCore or Anthropic calls. All deterministic.
This is a controlled integration test, NOT an E2E test.
"""

import json
import os
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from galecore_ai.api.app import create_app
from galecore_ai.api.config import AppConfig
from galecore_ai.application.analyze_gex import GEX_CAPABILITY_ID
from galecore_ai.capabilities.dispatcher import CapabilityResult
from galecore_ai.models.providers.fake import clear_canned_responses, register_canned_response

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures" / "galecore"


@pytest.fixture(autouse=True)
def _clean():
    clear_canned_responses()
    yield
    clear_canned_responses()


def _load_fixture(name: str = "gex_analysis_spy.json") -> dict:
    fixture = json.loads((FIXTURES_DIR / name).read_text())
    # Set timestamp to now so freshness check passes
    fixture["timestamp"] = datetime.now(tz=UTC).isoformat()
    return fixture


def _make_app_with_mock_galecore(galecore_response: dict | None, cap_error: str | None = None):
    """Create an app where the dispatcher is patched to return mock data."""
    os.environ["LOCAL_VALIDATION"] = "true"
    os.environ["PROVIDER_MODE"] = "fake"
    os.environ["GALECORE_BASE_URL"] = "http://localhost:5000"
    config = AppConfig()
    app = create_app(config)

    # Allow unknown freshness for integration tests unless fixture has timestamp
    app.state.deps.gex_use_case._allow_unknown_freshness = True

    # Patch the dispatcher's invoke
    async def mock_invoke(capability_id, parameters, *, agent_allowed=None):
        if capability_id == GEX_CAPABILITY_ID:
            if cap_error:
                return CapabilityResult(capability_id, error=cap_error, latency_ms=1)
            return CapabilityResult(capability_id, data=galecore_response, latency_ms=5)
        return CapabilityResult(capability_id, error="not mocked", latency_ms=0)

    app.state.deps.dispatcher.invoke = mock_invoke
    return app


class TestGexVerticalSuccess:
    def test_full_vertical_success(self):
        """SUCCESS case: valid GEX data → FakeProvider → structured output → guardrails pass."""
        register_canned_response("GexInterpretation", {
            "regime": "positive_gamma",
            "observations": ["net_gex is positive at 1500.0, dealers are long gamma"],
            "implications": ["Mean reversion expected around spot 450.5"],
            "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is positive at 1500.0"}],
            "limitations": ["Based on current open interest snapshot"],
        })

        fixture = _load_fixture()
        app = _make_app_with_mock_galecore(fixture)
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
        assert any(s["skill_id"] == "gex_interpretation" for s in trace["skills"])
        assert any(p["protocol_id"] == "facts_discipline" for p in trace["protocols"])
        assert trace["latency_ms"] >= 0
        assert trace["started_at"] is not None
        assert trace["completed_at"] is not None

        # Capability invocation recorded
        cap_invocations = trace["capabilities_invoked"]
        gex_cap = [c for c in cap_invocations if c["capability_id"] == GEX_CAPABILITY_ID]
        assert len(gex_cap) >= 1
        assert gex_cap[0]["outcome"] == "ok"


class TestGexVerticalInsufficientData:
    def test_no_galecore_data(self):
        """INSUFFICIENT_DATA case: GaleCore returns error → model not called → result=null."""
        app = _make_app_with_mock_galecore(None, cap_error="Connection refused")
        client = TestClient(app)

        response = client.post(
            "/api/v1/agent-runs/gex-analysis",
            json={"symbol": "SPY"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "INSUFFICIENT_DATA"
        assert data["result"] is None
        assert "Capability fetch failed" in data["error_detail"]

    def test_incomplete_galecore_data(self):
        """INSUFFICIENT_DATA case: GaleCore returns incomplete data (empty symbol)."""
        # Empty response → DTO parses with defaults → spot=0 → rejected
        app = _make_app_with_mock_galecore({"symbol": "SPY", "gex": {"global": {"spot": 0}}})
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
            "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is positive"}],
            "limitations": ["Snapshot only"],
        })

        fixture = _load_fixture()
        app = _make_app_with_mock_galecore(fixture)
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
            "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is positive"}],
            "limitations": ["snapshot only"],
        })

        fixture = _load_fixture()
        app = _make_app_with_mock_galecore(fixture)
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
