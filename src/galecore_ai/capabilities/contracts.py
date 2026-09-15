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
        description="Compute gamma exposure (GEX) for a symbol",
        parameters=[
            CapabilityParameter(name="symbol", type="string", description="Underlying symbol"),
            CapabilityParameter(name="dte", type="number", required=False, description="Days to expiration filter"),
        ],
        returns="Net GEX, call/put GEX, zero gamma level, walls",
    ),
]
