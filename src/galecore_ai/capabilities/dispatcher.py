"""CapabilityDispatcher — invokes GaleCore capabilities via REST.

Maps capability_id to GaleCore REST endpoints and returns structured results.
Phase 3: read-only (PURE_QUERY and COMPUTE only).

Endpoint mapping (from GaleCore controllers):
  market_data.quote         → GET /Data/Tastytrade/MarketData/Quote?symbols={symbol}
  compute.gamma_exposure    → GET /App.Analytics/GammaExposure?symbol={symbol}[&dte={dte}]
  compute.iv_rank           → GET /App.Analytics/IVRank?symbol={symbol}
  compute.implied_volatility → GET /App.Analytics/ImpliedVolatility?symbol={symbol}
  market_data.option_chains → GET /Data/Tastytrade/OptionChains?symbol={symbol}
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from galecore_ai.capabilities.registry import (
    CapabilityNotAllowedError,
    CapabilityNotFoundError,
    CapabilityRegistry,
)

logger = logging.getLogger(__name__)


class DispatchError(Exception):
    """Error during capability dispatch."""

    def __init__(self, message: str, *, capability_id: str, status_code: int | None = None):
        super().__init__(message)
        self.capability_id = capability_id
        self.status_code = status_code


class CapabilityResult:
    """Result of a capability invocation."""

    __slots__ = ("capability_id", "data", "error", "latency_ms")

    def __init__(
        self,
        capability_id: str,
        *,
        data: dict | list | None = None,
        latency_ms: int = 0,
        error: str | None = None,
    ):
        self.capability_id = capability_id
        self.data = data
        self.latency_ms = latency_ms
        self.error = error

    @property
    def ok(self) -> bool:
        return self.error is None and self.data is not None


# ── Endpoint routing ──────────────────────────────────────────────

_ROUTE_TABLE: dict[str, dict[str, str]] = {
    "market_data.quote": {
        "method": "GET",
        "path": "/Data/Tastytrade/MarketData/Quote",
        "param_key": "symbols",
        "source_param": "symbol",
    },
    "market_data.option_chains": {
        "method": "GET",
        "path": "/Data/Tastytrade/OptionChains",
        "param_key": "symbol",
        "source_param": "symbol",
    },
    "compute.gamma_exposure": {
        "method": "GET",
        "path": "/App.Analytics/GammaExposure",
        "param_key": "symbol",
        "source_param": "symbol",
    },
    "compute.gex_analysis": {
        "method": "GET",
        "path": "/App/Gex/Analysis",
        "param_key": "symbol",
        "source_param": "symbol",
    },
    "compute.iv_rank": {
        "method": "GET",
        "path": "/App.Analytics/IVRank",
        "param_key": "symbol",
        "source_param": "symbol",
    },
    "compute.implied_volatility": {
        "method": "GET",
        "path": "/App.Analytics/ImpliedVolatility",
        "param_key": "symbol",
        "source_param": "symbol",
    },
}


class CapabilityDispatcher:
    """Dispatches capability invocations to GaleCore REST endpoints.

    Args:
        base_url: GaleCore API base URL (e.g. "http://localhost:5000")
        registry: CapabilityRegistry for validation
        api_key: Optional API key for GaleCore authentication
        timeout: HTTP timeout in seconds
    """

    def __init__(
        self,
        *,
        base_url: str,
        registry: CapabilityRegistry,
        api_key: str | None = None,
        timeout: float = 15.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._registry = registry
        self._api_key = api_key
        self._timeout = timeout

    async def invoke(
        self,
        capability_id: str,
        parameters: dict[str, Any],
        *,
        agent_allowed: list[str] | None = None,
    ) -> CapabilityResult:
        """Invoke a GaleCore capability via REST.

        Args:
            capability_id: The capability to invoke (e.g. "market_data.quote")
            parameters: Capability parameters (e.g. {"symbol": "SPY"})
            agent_allowed: Optional agent-level allowlist for validation
        """
        t0 = time.monotonic()

        # Validate access
        try:
            self._registry.validate_access(capability_id, agent_allowed=agent_allowed)
        except (CapabilityNotFoundError, CapabilityNotAllowedError) as exc:
            return CapabilityResult(
                capability_id,
                error=str(exc),
                latency_ms=int((time.monotonic() - t0) * 1000),
            )

        # Resolve route
        route = _ROUTE_TABLE.get(capability_id)
        if route is None:
            return CapabilityResult(
                capability_id,
                error=f"No route configured for capability: {capability_id}",
                latency_ms=int((time.monotonic() - t0) * 1000),
            )

        # Build request
        url = f"{self._base_url}{route['path']}"
        query_params = self._build_query_params(route, parameters)
        headers = self._build_headers()

        # Execute
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.get(url, params=query_params, headers=headers)

            elapsed = int((time.monotonic() - t0) * 1000)

            if response.status_code != 200:
                return CapabilityResult(
                    capability_id,
                    error=f"HTTP {response.status_code}: {response.text[:500]}",
                    latency_ms=elapsed,
                )

            data = response.json()
            return CapabilityResult(capability_id, data=data, latency_ms=elapsed)

        except httpx.TimeoutException:
            return CapabilityResult(
                capability_id,
                error=f"Timeout after {self._timeout}s calling {capability_id}",
                latency_ms=int((time.monotonic() - t0) * 1000),
            )
        except httpx.HTTPError as exc:
            return CapabilityResult(
                capability_id,
                error=f"HTTP error calling {capability_id}: {exc}",
                latency_ms=int((time.monotonic() - t0) * 1000),
            )
        except (ValueError, KeyError, TypeError) as exc:
            return CapabilityResult(
                capability_id,
                error=f"Unexpected error calling {capability_id}: {exc}",
                latency_ms=int((time.monotonic() - t0) * 1000),
            )

    def _build_query_params(self, route: dict, parameters: dict) -> dict:
        """Map capability parameters to query parameters for the REST call."""
        params: dict = {}
        source = route.get("source_param", "symbol")
        target = route.get("param_key", "symbol")

        if source in parameters:
            params[target] = parameters[source]

        # Pass through additional params (e.g. dte for gamma_exposure)
        for k, v in parameters.items():
            if k != source and v is not None:
                params[k] = v

        return params

    def _build_headers(self) -> dict:
        headers: dict = {"Accept": "application/json"}
        if self._api_key:
            headers["X-Api-Key"] = self._api_key
        return headers
