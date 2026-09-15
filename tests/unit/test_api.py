"""Unit tests for the FastAPI REST API using TestClient."""

import os

import pytest
from fastapi.testclient import TestClient

from galecore_ai.api.app import create_app
from galecore_ai.api.config import AppConfig
from galecore_ai.models.providers.fake import clear_canned_responses


@pytest.fixture(autouse=True)
def _clean():
    clear_canned_responses()
    yield
    clear_canned_responses()


def _test_config() -> AppConfig:
    """Config for testing — fake provider, local validation."""
    os.environ["LOCAL_VALIDATION"] = "true"
    os.environ["PROVIDER_MODE"] = "fake"
    os.environ["GALECORE_BASE_URL"] = "http://localhost:5000"
    return AppConfig()


@pytest.fixture
def client():
    config = _test_config()
    app = create_app(config)
    return TestClient(app)


class TestHealthEndpoint:
    def test_health_returns_ok(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["service"] == "galecore-ai"

    def test_health_includes_version(self, client):
        response = client.get("/health")
        data = response.json()
        assert "version" in data


class TestGexAnalysisEndpoint:
    def test_gex_analysis_returns_structured_response(self, client):
        """With FakeProvider + no GaleCore running, we get INSUFFICIENT_DATA
        because the dispatcher can't connect."""
        response = client.post(
            "/api/v1/agent-runs/gex-analysis",
            json={"symbol": "SPY"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] in ("SUCCESS", "INSUFFICIENT_DATA", "MODEL_ERROR")
        assert "run_id" in data
        assert "trace" in data

    def test_gex_analysis_missing_symbol(self, client):
        response = client.post(
            "/api/v1/agent-runs/gex-analysis",
            json={},
        )
        assert response.status_code == 422  # Pydantic validation

    def test_gex_analysis_trace_present(self, client):
        response = client.post(
            "/api/v1/agent-runs/gex-analysis",
            json={"symbol": "SPY"},
        )
        data = response.json()
        assert "trace" in data
        trace = data["trace"]
        assert "capabilities_invoked" in trace


class TestLocalValidation:
    def test_non_local_url_rejected(self):
        os.environ["LOCAL_VALIDATION"] = "true"
        os.environ["GALECORE_BASE_URL"] = "https://api.example.com"
        with pytest.raises(ValueError, match="Only localhost"):
            AppConfig()

    def test_local_url_accepted(self):
        os.environ["LOCAL_VALIDATION"] = "true"
        os.environ["GALECORE_BASE_URL"] = "http://localhost:5000"
        config = AppConfig()
        assert config.galecore_base_url == "http://localhost:5000"

    def test_local_validation_disabled_allows_remote(self):
        os.environ["LOCAL_VALIDATION"] = "false"
        os.environ["GALECORE_BASE_URL"] = "https://api.example.com"
        config = AppConfig()
        assert config.galecore_base_url == "https://api.example.com"
