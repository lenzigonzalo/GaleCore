"""Golden case evals — 10 parametrized GEX scenarios covering all three paths.

Tests the full vertical: GaleCore mock → DTO → GexFacts → CognitiveRuntime
→ FakeProvider → guardrails → AgentRunResult.

Scenarios:
  SUCCESS (5 cases):
    1. Positive gamma — net_gex > 0, spot above zero-gamma
    2. Negative gamma — net_gex < 0, dealers short gamma
    3. Near-zero gamma — |net_gex| tiny relative to call+put
    4. No zero-gamma level — optional field absent
    5. High coverage — all expirations, high coverage_pct

  INSUFFICIENT_DATA (3 cases):
    6. GaleCore unavailable — capability fetch error
    7. Spot is zero — invalid data, fail-closed
    8. Stale data — timestamp > max_staleness

  VALIDATION_ERROR (2 cases):
    9. Invented numbers — model output contains unknown numbers
   10. Missing evidence — model output lacks evidence array
"""

from __future__ import annotations

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


def _base_fixture(**overrides) -> dict:
    """Build a GaleCore GEX response with configurable overrides."""
    now = datetime.now(tz=UTC).isoformat()
    gex_global = {
        "spot": 450.50,
        "callGex": 2000000.0,
        "putGex": -500000.0,
        "netGex": 1500.0,
        "gammaZeroLevel": 445.0,
        "callWall": 460.0,
        "putWall": 440.0,
        "expirationsIncluded": 8,
        "expirationsRequested": 12,
        "coveragePct": 85.5,
        "strikes": [],
    }
    gex_global.update(overrides.pop("gex_overrides", {}))

    fixture = {
        "symbol": overrides.pop("symbol", "SPY"),
        "timestamp": overrides.pop("timestamp", now),
        "spotPrice": gex_global["spot"],
        "fromCache": False,
        "switchEnabled": True,
        "frozen": False,
        "elapsedMs": 100,
        "macroRegime": {
            "signal": "SELL",
            "passedCount": 4,
            "totalChecks": 6,
            "checks": {
                "vixAbsolute": {"passed": True, "value": 18.5, "threshold": 30.0},
                "vixTermStructure": {"passed": True, "noData": False},
                "ivRank": {"passed": True, "value": 42.0, "min": 25.0, "max": 65.0},
                "ivMomentum": {"passed": False, "value": 15.3, "threshold": 12.0},
                "gexTotal": {"passed": True, "value": 1500.0, "metric": "billions_usd", "threshold": 0.0},
                "spotVsZgl": {"passed": False, "spot": 450.5, "zgl": 445.0, "bufferPct": 0.005},
            },
        },
        "structureInputs": None,
        "gex": {
            "global": gex_global,
            "byExpiry": [],
            "config": {
                "maxDte": 60,
                "includeZeroDte": False,
                "expirationTypes": ["Regular"],
                "greeksBatchSize": 50,
                "greeksRetries": 2,
                "cacheSeconds": 120,
                "cacheMinCoveragePct": 50.0,
            },
        },
    }
    fixture.update(overrides)
    return fixture


def _make_app(galecore_response: dict | None, cap_error: str | None = None):
    """Create app with mocked GaleCore dispatcher."""
    os.environ["LOCAL_VALIDATION"] = "true"
    os.environ["PROVIDER_MODE"] = "fake"
    os.environ["GALECORE_BASE_URL"] = "http://localhost:5000"
    config = AppConfig()
    app = create_app(config)
    app.state.deps.gex_use_case._allow_unknown_freshness = True

    async def mock_invoke(capability_id, parameters, *, agent_allowed=None):
        if capability_id == GEX_CAPABILITY_ID:
            if cap_error:
                return CapabilityResult(capability_id, error=cap_error, latency_ms=1)
            return CapabilityResult(capability_id, data=galecore_response, latency_ms=5)
        return CapabilityResult(capability_id, error="not mocked", latency_ms=0)

    app.state.deps.dispatcher.invoke = mock_invoke
    return app


def _post_gex(app, symbol: str = "SPY") -> dict:
    """POST to the GEX analysis endpoint and return response JSON."""
    client = TestClient(app)
    resp = client.post("/api/v1/agent-runs/gex-analysis", json={"symbol": symbol})
    assert resp.status_code == 200
    return resp.json()


# ── SUCCESS cases ─────────────────────────────────────────────────


class TestGoldenSuccess:
    """Cases 1-5: valid data → model called → guardrails pass → result non-null."""

    def _register_valid_response(self, regime: str, net_gex: float, spot: float):
        """Register a canned response that references the given fact values."""
        register_canned_response("GexInterpretation", {
            "regime": regime,
            "observations": [f"Net GEX is {net_gex}, spot at {spot}"],
            "implications": ["Price behavior consistent with regime"],
            "evidence": [{"fact_path": "facts.net_gex", "claim": f"Net GEX is {net_gex}"}],
            "limitations": ["Point-in-time snapshot of open interest"],
        })

    def test_case_1_positive_gamma(self):
        """Positive gamma: net_gex > 0, spot above zero-gamma level."""
        self._register_valid_response("positive_gamma", 1500.0, 450.5)
        fixture = _base_fixture()
        data = _post_gex(_make_app(fixture))

        assert data["status"] == "SUCCESS"
        assert data["result"]["regime"] == "positive_gamma"
        assert data["result"]["evidence"][0]["fact_path"] == "facts.net_gex"
        assert data["trace"]["model_called"] is True
        assert data["error_detail"] is None

    def test_case_2_negative_gamma(self):
        """Negative gamma: net_gex < 0, dealers short gamma."""
        net_gex = -1584.1
        spot = 430.2
        self._register_valid_response("negative_gamma", net_gex, spot)
        fixture = _base_fixture(gex_overrides={
            "spot": spot,
            "netGex": net_gex,
            "callGex": 500000.0,
            "putGex": -2084100.0,
            "gammaZeroLevel": 435.0,
        })
        fixture["spotPrice"] = spot

        data = _post_gex(_make_app(fixture))

        assert data["status"] == "SUCCESS"
        assert data["result"]["regime"] == "negative_gamma"
        assert data["trace"]["model_called"] is True

    def test_case_3_near_zero_gamma(self):
        """Near-zero gamma: |net_gex| tiny relative to call+put totals."""
        net_gex = 0.5
        spot = 448.0
        self._register_valid_response("near_zero", net_gex, spot)
        fixture = _base_fixture(gex_overrides={
            "spot": spot,
            "netGex": net_gex,
            "callGex": 1000000.0,
            "putGex": -999999.5,
        })
        fixture["spotPrice"] = spot

        data = _post_gex(_make_app(fixture))

        assert data["status"] == "SUCCESS"
        assert data["result"]["regime"] == "near_zero"

    def test_case_4_no_zero_gamma_level(self):
        """Optional field absent: zero_gamma_level is null."""
        self._register_valid_response("positive_gamma", 1500.0, 450.5)
        fixture = _base_fixture(gex_overrides={"gammaZeroLevel": None})

        data = _post_gex(_make_app(fixture))

        assert data["status"] == "SUCCESS"
        assert data["result"] is not None

    def test_case_5_high_coverage(self):
        """High coverage: all expirations included, coverage near 100%."""
        self._register_valid_response("positive_gamma", 1500.0, 450.5)
        fixture = _base_fixture(gex_overrides={
            "expirationsIncluded": 12,
            "expirationsRequested": 12,
            "coveragePct": 99.8,
        })

        data = _post_gex(_make_app(fixture))

        assert data["status"] == "SUCCESS"
        # Trace shows capability was invoked
        caps = data["trace"]["capabilities_invoked"]
        assert any(c["capability_id"] == GEX_CAPABILITY_ID for c in caps)


# ── INSUFFICIENT_DATA cases ──────────────────────────────────────


class TestGoldenInsufficientData:
    """Cases 6-8: data unavailable/invalid → model NOT called → result=null."""

    def test_case_6_galecore_unavailable(self):
        """GaleCore returns error → INSUFFICIENT_DATA."""
        data = _post_gex(_make_app(None, cap_error="Connection refused"))

        assert data["status"] == "INSUFFICIENT_DATA"
        assert data["result"] is None
        assert data["trace"]["model_called"] is False
        assert "Capability fetch failed" in data["error_detail"]

    def test_case_7_spot_is_zero(self):
        """Spot price is 0 → facts validation rejects → INSUFFICIENT_DATA."""
        fixture = _base_fixture(gex_overrides={"spot": 0.0})
        fixture["spotPrice"] = 0.0

        data = _post_gex(_make_app(fixture))

        assert data["status"] == "INSUFFICIENT_DATA"
        assert data["result"] is None
        assert data["trace"]["model_called"] is False

    def test_case_8_stale_data(self):
        """Timestamp is old → freshness check fails → INSUFFICIENT_DATA."""
        stale_ts = "2026-09-15T00:00:00+00:00"  # many hours old
        fixture = _base_fixture(timestamp=stale_ts)

        # Use strict freshness (don't allow unknown)
        os.environ["LOCAL_VALIDATION"] = "true"
        os.environ["PROVIDER_MODE"] = "fake"
        os.environ["GALECORE_BASE_URL"] = "http://localhost:5000"
        os.environ["MAX_STALENESS_SECONDS"] = "300"
        config = AppConfig()
        app = create_app(config)

        # Do NOT set _allow_unknown_freshness — let it be strict
        async def mock_invoke(capability_id, parameters, *, agent_allowed=None):
            if capability_id == GEX_CAPABILITY_ID:
                return CapabilityResult(capability_id, data=fixture, latency_ms=5)
            return CapabilityResult(capability_id, error="not mocked", latency_ms=0)

        app.state.deps.dispatcher.invoke = mock_invoke

        data = _post_gex(app)

        assert data["status"] == "INSUFFICIENT_DATA"
        assert data["result"] is None
        assert data["trace"]["model_called"] is False


# ── VALIDATION_ERROR cases ───────────────────────────────────────


class TestGoldenValidationError:
    """Cases 9-10: model output fails guardrails → result=null."""

    def test_case_9_invented_numbers(self):
        """Model output contains number not in facts → guardrail rejects."""
        register_canned_response("GexInterpretation", {
            "regime": "positive_gamma",
            "observations": ["Price target 999.99 based on momentum"],
            "implications": ["Breakout to 1200.0 expected"],
            "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is positive"}],
            "limitations": ["Snapshot only"],
        })

        fixture = _base_fixture()
        data = _post_gex(_make_app(fixture))

        assert data["status"] == "VALIDATION_ERROR"
        assert data["result"] is None
        assert data["trace"]["model_called"] is True
        # Guardrail that caught it
        guardrails = data["trace"].get("guardrails_executed", [])
        failed = [g for g in guardrails if not g["passed"]]
        assert len(failed) >= 1
        assert any("no_invented_numbers" in g["guardrail_id"] for g in failed)

    def test_case_10_ungrounded_output(self):
        """Model output references no facts → facts_match_source guardrail fails."""
        register_canned_response("GexInterpretation", {
            "regime": "positive_gamma",
            "observations": ["The market looks bullish today"],
            "implications": ["Everything is going up"],
            "evidence": [{"fact_path": "facts.nonexistent_field", "claim": "Made up claim"}],
            "limitations": ["None"],
        })

        fixture = _base_fixture()
        data = _post_gex(_make_app(fixture))

        assert data["status"] == "VALIDATION_ERROR"
        assert data["result"] is None
        checks = data["trace"]["guardrails_executed"]
        assert any(c["guardrail_id"] == "facts_match_source" and not c["passed"] for c in checks)
