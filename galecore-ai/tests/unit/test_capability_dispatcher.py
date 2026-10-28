"""Unit tests for CapabilityDispatcher.

Uses httpx mock transport to test dispatch logic without real HTTP calls.
"""

import httpx
import pytest

from galecore_ai.capabilities.contracts import (
    KNOWN_CAPABILITIES,
    CapabilityDefinition,
    SemanticClass,
)
from galecore_ai.capabilities.dispatcher import _ROUTE_TABLE, CapabilityDispatcher
from galecore_ai.capabilities.registry import CapabilityRegistry


def _registry_with_known() -> CapabilityRegistry:
    reg = CapabilityRegistry()
    reg.register_many(KNOWN_CAPABILITIES)
    return reg


def _dispatcher(registry: CapabilityRegistry | None = None) -> CapabilityDispatcher:
    return CapabilityDispatcher(
        base_url="http://localhost:5000",
        registry=registry or _registry_with_known(),
    )


class TestRouteTable:
    def test_market_data_quote_route_exists(self):
        assert "market_data.quote" in _ROUTE_TABLE
        assert _ROUTE_TABLE["market_data.quote"]["path"] == "/Data/Tastytrade/MarketData/Quote"

    def test_gamma_exposure_route_exists(self):
        assert "compute.gamma_exposure" in _ROUTE_TABLE
        assert _ROUTE_TABLE["compute.gamma_exposure"]["path"] == "/App.Analytics/GammaExposure"

    def test_all_known_capabilities_have_routes(self):
        for cap in KNOWN_CAPABILITIES:
            assert cap.capability_id in _ROUTE_TABLE, f"No route for {cap.capability_id}"


class TestDispatcherValidation:
    @pytest.mark.asyncio
    async def test_unknown_capability_returns_error(self):
        d = _dispatcher()
        result = await d.invoke("nonexistent.cap", {"symbol": "SPY"})
        assert not result.ok
        assert "not found" in result.error.lower()

    @pytest.mark.asyncio
    async def test_mutation_blocked(self):
        reg = CapabilityRegistry()
        reg.register(CapabilityDefinition(
            capability_id="test.mutate",
            semantic_class=SemanticClass.STATE_MUTATION,
            description="test",
        ))
        d = CapabilityDispatcher(base_url="http://localhost:5000", registry=reg)
        result = await d.invoke("test.mutate", {})
        assert not result.ok
        assert "STATE_MUTATION" in result.error

    @pytest.mark.asyncio
    async def test_agent_allowlist_enforced(self):
        d = _dispatcher()
        result = await d.invoke(
            "market_data.quote",
            {"symbol": "SPY"},
            agent_allowed=["compute.gamma_exposure"],  # quote NOT in list
        )
        assert not result.ok
        assert "not allowed" in result.error.lower()


class TestDispatcherHTTP:
    @pytest.mark.asyncio
    async def test_successful_quote_dispatch(self):
        mock_response = {"symbol": "SPY", "bid": 450.0, "ask": 450.5}

        transport = httpx.MockTransport(
            lambda request: httpx.Response(200, json=mock_response)
        )

        d = _dispatcher()
        # Patch the invoke to use our mock transport
        async with httpx.AsyncClient(transport=transport) as client:
            url = f"{d._base_url}/Data/Tastytrade/MarketData/Quote"
            response = await client.get(url, params={"symbol": "SPY"})
            assert response.status_code == 200
            data = response.json()
            assert data["symbol"] == "SPY"

    @pytest.mark.asyncio
    async def test_query_params_built_correctly(self):
        """Verify query params mapping for gamma_exposure with dte."""
        d = _dispatcher()
        route = _ROUTE_TABLE["compute.gamma_exposure"]
        params = d._build_query_params(route, {"symbol": "SPY", "dte": 30})
        assert params["symbol"] == "SPY"
        assert params["dte"] == 30

    @pytest.mark.asyncio
    async def test_query_params_quote_uses_symbol_key(self):
        """market_data.quote sends 'symbol': GaleCore answers 400 «The Symbol field is required» to 'symbols' (06/10)."""
        d = _dispatcher()
        route = _ROUTE_TABLE["market_data.quote"]
        params = d._build_query_params(route, {"symbol": "VIX"})
        assert params == {"symbol": "VIX"}

    @pytest.mark.asyncio
    async def test_headers_include_api_key(self):
        d = CapabilityDispatcher(
            base_url="http://localhost:5000",
            registry=_registry_with_known(),
            api_key="test-key-123",
        )
        headers = d._build_headers()
        assert headers["X-Api-Key"] == "test-key-123"
        assert headers["Accept"] == "application/json"

    @pytest.mark.asyncio
    async def test_headers_no_api_key(self):
        d = _dispatcher()
        headers = d._build_headers()
        assert "X-Api-Key" not in headers

    @pytest.mark.asyncio
    async def test_connection_refused_returns_error(self):
        """Dispatcher should return error result, not raise, on connection failure."""
        d = CapabilityDispatcher(
            base_url="http://localhost:19999",  # nothing listening
            registry=_registry_with_known(),
            timeout=1.0,
        )
        result = await d.invoke("market_data.quote", {"symbol": "SPY"})
        assert not result.ok
        assert result.error is not None
        assert result.latency_ms >= 0


class TestCapabilityResult:
    @pytest.mark.asyncio
    async def test_ok_result(self):
        from galecore_ai.capabilities.dispatcher import CapabilityResult

        r = CapabilityResult("test", data={"value": 42}, latency_ms=5)
        assert r.ok
        assert r.data == {"value": 42}

    @pytest.mark.asyncio
    async def test_error_result(self):
        from galecore_ai.capabilities.dispatcher import CapabilityResult

        r = CapabilityResult("test", error="timeout")
        assert not r.ok
        assert r.data is None
