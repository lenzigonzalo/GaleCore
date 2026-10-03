"""Capability contracts — defines what GaleCore capabilities the AI layer can invoke.

Phase 3 is read-only: only PURE_QUERY and COMPUTE capabilities.
No STATE_MUTATION, no EXTERNAL_ACTION.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class SemanticClass(str, Enum):
    """Capability classification per P0-CONTRACTS §4."""

    PURE_QUERY = "PURE_QUERY"
    COMPUTE = "COMPUTE"
    STATE_MUTATION = "STATE_MUTATION"
    EXTERNAL_ACTION = "EXTERNAL_ACTION"


# Phase 3 allowlist — only these semantic classes are permitted
PHASE3_ALLOWED_CLASSES = frozenset({SemanticClass.PURE_QUERY, SemanticClass.COMPUTE})


class CapabilityParameter(BaseModel):
    """A single parameter for a capability."""

    name: str
    type: str  # e.g. "string", "number", "boolean"
    required: bool = True
    description: str = ""


class CapabilityDefinition(BaseModel):
    """Definition of a GaleCore capability that can be invoked from the AI layer."""

    capability_id: str  # e.g. "market_data.quote"
    semantic_class: SemanticClass
    description: str
    parameters: list[CapabilityParameter] = Field(default_factory=list)
    returns: str = ""  # description of return type
    version: str = "1.0"

    def is_phase3_allowed(self) -> bool:
        """Check if this capability is allowed in Phase 3 (read-only)."""
        return self.semantic_class in PHASE3_ALLOWED_CLASSES


# Known capability definitions for Phase 3
KNOWN_CAPABILITIES: list[CapabilityDefinition] = [
    CapabilityDefinition(
        capability_id="market_data.quote",
        semantic_class=SemanticClass.PURE_QUERY,
        description="Get current market quote for a symbol",
        parameters=[
            CapabilityParameter(name="symbol", type="string", description="Ticker symbol"),
        ],
        returns="Quote with bid, ask, last, volume",
    ),
    CapabilityDefinition(
        capability_id="compute.gamma_exposure",
        semantic_class=SemanticClass.COMPUTE,
        description="Compute gamma exposure (GEX) for a symbol (single expiration)",
        parameters=[
            CapabilityParameter(name="symbol", type="string", description="Underlying symbol"),
            CapabilityParameter(name="dte", type="number", required=False, description="Days to expiration filter"),
        ],
        returns="Net GEX, call/put GEX, zero gamma level, walls, strikes",
    ),
    CapabilityDefinition(
        capability_id="compute.gex_analysis",
        semantic_class=SemanticClass.COMPUTE,
        description="Global GEX analysis across all expirations with macro regime context",
        parameters=[
            CapabilityParameter(name="symbol", type="string", description="Underlying symbol"),
        ],
        returns="Global GEX scope (net/call/put, walls, coverage), macro regime, config",
    ),
    CapabilityDefinition(
        capability_id="compute.put_skew",
        semantic_class=SemanticClass.COMPUTE,
        description="25-delta put skew snapshot (iv_put_25delta / iv_atm) for a symbol",
        parameters=[
            CapabilityParameter(name="symbol", type="string", description="Underlying symbol"),
        ],
        returns="Spot, ATM IV, 25-delta put IV, putSkew25d ratio, GaleCore level semaphore",
    ),
    CapabilityDefinition(
        capability_id="market_data.trade",
        semantic_class=SemanticClass.PURE_QUERY,
        description="Last trade print for a symbol or index (e.g. VIX, VVIX)",
        parameters=[
            CapabilityParameter(name="symbol", type="string", description="Symbol or index"),
        ],
        returns="Trade events with price and epoch-millisecond time",
    ),
    # GC-AI-0019: what GaleCore already served and the harness could not ask for (probed on GaleCore Dev, 03/10).
    CapabilityDefinition(
        capability_id="market_data.option_chains",
        semantic_class=SemanticClass.PURE_QUERY,
        description="Option chain of an underlying: every expiration with its strikes and OCC symbols (~1 MB for SPY)",
        parameters=[CapabilityParameter(name="symbol", type="string", description="Underlying symbol")],
        returns="symbol, expirations[expirationDate, daysToExpiration, settlementType, strikes[strikePrice, call, put]]",
    ),
    CapabilityDefinition(
        capability_id="compute.iv_rank",
        semantic_class=SemanticClass.COMPUTE,
        description="IV rank and IV percentile of an underlying over GaleCore's stored daily IV history",
        parameters=[CapabilityParameter(name="symbol", type="string", description="Underlying symbol")],
        returns="currentIV, ivRank, ivPercentile, tradingDays, history[date, iv]",
    ),
    CapabilityDefinition(
        capability_id="compute.implied_volatility",
        semantic_class=SemanticClass.COMPUTE,
        description="IV term structure (IV30 at 0/5/9/30/90 days) and expected daily move of an underlying",
        parameters=[CapabilityParameter(name="symbol", type="string", description="Underlying symbol")],
        returns="spot, iV30_0d..iV30_90d, dailyMove, dailyMoveDollar",
    ),
    CapabilityDefinition(
        capability_id="market_data.volatility_metrics",
        semantic_class=SemanticClass.PURE_QUERY,
        description="Tastytrade market metrics: IV index and its changes, IV percentile, HV, beta, liquidity, earnings",
        parameters=[CapabilityParameter(name="symbol", type="string", description="One or more symbols, comma-separated")],
        returns="items[symbol, impliedVolatilityIndex, impliedVolatilityPercentile, ...]",
    ),
    CapabilityDefinition(
        capability_id="market_data.candles",
        semantic_class=SemanticClass.PURE_QUERY,
        description="OHLCV candles of a symbol from a start time (interval e.g. 1d, 1h, 5m)",
        parameters=[
            CapabilityParameter(name="symbol", type="string", description="Underlying symbol"),
            CapabilityParameter(name="interval", type="string", description="Candle period: 1d, 1h, 5m, ..."),
            CapabilityParameter(name="fromTime", type="string", description="ISO 8601 start (UTC)"),
            CapabilityParameter(name="toTime", type="string", required=False, description="ISO 8601 end (UTC)"),
        ],
        returns="DXLink FEED_DATA: data[Candle with time, open, high, low, close, volume]",
    ),
    CapabilityDefinition(
        capability_id="market_data.option_greeks",
        semantic_class=SemanticClass.PURE_QUERY,
        description="Greeks of ONE option contract (OCC symbol, 21 chars, e.g. from market_data.option_chains)",
        parameters=[CapabilityParameter(name="symbol", type="string", description="OCC option symbol")],
        returns="DXLink Greeks event: price, volatility, delta, gamma, theta, rho, vega",
    ),
]
