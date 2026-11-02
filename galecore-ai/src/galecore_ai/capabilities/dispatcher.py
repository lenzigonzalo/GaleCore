"""CapabilityDispatcher — invokes GaleCore capabilities via REST.

Maps capability_id to GaleCore REST endpoints and returns structured results.
Phase 3: read-only (PURE_QUERY and COMPUTE only).

Endpoint mapping (from GaleCore controllers):
  market_data.quote         → GET /Data/Tastytrade/MarketData/Quote?symbol={symbol}  (GaleCore requires Symbol; 400 with symbols, 06/10)
  compute.gamma_exposure    → GET /App.Analytics/GammaExposure?symbol={symbol}[&dte={dte}]
  compute.iv_rank           → GET /App.Analytics/IVRank?symbol={symbol}
  compute.implied_volatility → GET /App.Analytics/ImpliedVolatility?symbol={symbol}
  market_data.option_chains → GET /Data/Tastytrade/OptionChains?symbol={symbol}
  market_data.trade         → GET /Data/Tastytrade/MarketData/Trade?symbol={symbol}
  compute.put_skew          → GET /App.Analytics/PutSkew?symbol={symbol}
  market_data.volatility_metrics → GET /Data/Tastytrade/Market-metrics/VolatilityData?symbols={symbol}
  market_data.earnings_history → GET /Data/Tastytrade/Market-metrics/EarningsHistory?symbol={symbol}
  market_data.candles       → GET /Data/Tastytrade/MarketData/Candle?symbol={symbol}&interval=..&fromTime=..
  market_data.option_greeks → GET /Data/Tastytrade/MarketData/Greeks?symbol={OCC option symbol}
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

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
        "param_key": "symbol",
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
    "compute.put_skew": {
        "method": "GET",
        "path": "/App.Analytics/PutSkew",
        "param_key": "symbol",
        "source_param": "symbol",
    },
    "market_data.trade": {
        "method": "GET",
        "path": "/Data/Tastytrade/MarketData/Trade",
        "param_key": "symbol",
        "source_param": "symbol",
    },
    "market_data.volatility_metrics": {
        "method": "GET",
        "path": "/Data/Tastytrade/Market-metrics/VolatilityData",
        "param_key": "symbols",
        "source_param": "symbol",
    },
    "market_data.earnings_history": {
        "method": "GET",
        "path": "/Data/Tastytrade/Market-metrics/EarningsHistory",
        "param_key": "symbol",
        "source_param": "symbol",
    },
    "market_data.candles": {
        "method": "GET",
        "path": "/Data/Tastytrade/MarketData/Candle",
        "param_key": "symbol",
        "source_param": "symbol",
    },
    "calendar.macro_releases": {"method": "GET", "path": "/Data/Fred/ReleaseDates", "param_key": "", "source_param": "",
                                "default_window_days": 60},
    "calendar.fomc_meetings": {"method": "GET", "path": "/Data/Fed/FomcMeetings", "param_key": "", "source_param": ""},
    # WS-0014: fuentes públicas servidas por GaleCore (Data.Sources).
    "history.index_daily": {"method": "GET", "path": "/Data/Cboe/IndexHistory", "param_key": "", "source_param": ""},
    "rates.treasury_curve": {"method": "GET", "path": "/Data/Treasury/YieldCurve", "param_key": "", "source_param": ""},
    "calendar.treasury_auctions": {"method": "GET", "path": "/Data/Treasury/Auctions/Upcoming", "param_key": "", "source_param": ""},
    "macro.fred_series": {"method": "GET", "path": "/Data/Fred/Series", "param_key": "", "source_param": ""},
    "macro.bls_series": {"method": "GET", "path": "/Data/Bls/Series", "param_key": "", "source_param": ""},
    # WS-0077: Argentina (BL-036).
    "argentina.dolares": {"method": "GET", "path": "/Data/Argentina/Dolares", "param_key": "", "source_param": ""},
    "argentina.series": {"method": "GET", "path": "/Data/Argentina/Series", "param_key": "", "source_param": ""},
    "argentina.bcra_variables": {"method": "GET", "path": "/Data/Bcra/Variables", "param_key": "", "source_param": ""},
    "argentina.bcra_series": {"method": "GET", "path": "/Data/Bcra/Series", "param_key": "", "source_param": ""},
    "argentina.bcra_cambiarias": {"method": "GET", "path": "/Data/Bcra/Cambiarias", "param_key": "", "source_param": ""},
    "argentina.indec_series": {"method": "GET", "path": "/Data/Indec/Series", "param_key": "", "source_param": ""},
    "argentina.byma_panel": {"method": "GET", "path": "/Data/Byma/Panel", "param_key": "", "source_param": ""},
    "argentina.a3_cotizaciones": {"method": "GET", "path": "/Data/A3/Cotizaciones", "param_key": "", "source_param": ""},
    "filings.sec_company": {"method": "GET", "path": "/Data/Sec/Company", "param_key": "", "source_param": ""},
    "filings.sec_filings": {"method": "GET", "path": "/Data/Sec/Filings", "param_key": "", "source_param": ""},
    "filings.sec_facts": {"method": "GET", "path": "/Data/Sec/Facts", "param_key": "", "source_param": ""},
    "filings.sec_document": {"method": "GET", "path": "/Data/Sec/Document", "param_key": "", "source_param": ""},
    # WS-0037: cuenta real (sólo lectura) y Macro.
    "account.overview": {"method": "GET", "path": "/App/GaleCore/Account/Overview", "param_key": "", "source_param": ""},
    "account.balances": {"method": "GET", "path": "/Data/Tastytrade/Account/Balances", "param_key": "", "source_param": ""},
    "account.positions": {"method": "GET", "path": "/Data/Tastytrade/Account/Positions", "param_key": "", "source_param": ""},
    "account.spreads": {"method": "GET", "path": "/Data/Tastytrade/Account/Spreads", "param_key": "", "source_param": ""},
    "macro.board": {"method": "GET", "path": "/App/Macro/Board", "param_key": "", "source_param": ""},
    "macro.catalog": {"method": "GET", "path": "/App/Macro/Catalog", "param_key": "", "source_param": ""},
    "market_data.option_greeks": {
        "method": "GET",
        "path": "/Data/Tastytrade/MarketData/Greeks",
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

        if source and source in parameters:
            params[target] = parameters[source]

        # Pass through additional params (e.g. dte for gamma_exposure)
        for k, v in parameters.items():
            if k != source and v is not None:
                params[k] = v

        # Without a range GaleCore answers 500; a calendar asked "from now" gets the next N days (H5/H7: the call came bare).
        days = route.get("default_window_days")
        if days and not {k.lower() for k in params} & {"from", "to"}:
            today = datetime.now(ZoneInfo("America/New_York")).date()
            params["From"], params["To"] = today.isoformat(), (today + timedelta(days=days)).isoformat()
            # Only the market-moving releases (NFP, CPI, PPI, GDP, income/spending, retail): the full list takes ~40 s.
            params.setdefault("ReleaseIds", "50,10,46,53,54,9")

        return params

    def _build_headers(self) -> dict:
        headers: dict = {"Accept": "application/json"}
        if self._api_key:
            headers["X-Api-Key"] = self._api_key
        return headers
