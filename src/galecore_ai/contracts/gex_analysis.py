"""GEX Analysis output contract — structured output for the GEX interpretation skill.

Rule: facts come from GaleCore deterministic data. interpretation comes from the model.
The model must not recalculate or invent quantitative observations.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class FreshnessStatus(str, Enum):
    """Whether we have an authoritative timestamp from GaleCore."""

    VALID = "VALID"
    STALE = "STALE"
    UNKNOWN = "UNKNOWN"


class GexFacts(BaseModel):
    """Deterministic facts from GaleCore's GEX analysis capability.

    All values come from GaleCore. GaleCore-AI does not recalculate or derive them.
    """

    symbol: str
    net_gex: float
    call_gex: float
    put_gex: float
    spot: float
    zero_gamma_level: float | None = None
    call_wall: float | None = None
    put_wall: float | None = None

    # Coverage / quality metadata from GaleCore
    expirations_included: int | None = None
    expirations_requested: int | None = None
    coverage_pct: float | None = None

    # Freshness — only set when GaleCore provides an authoritative timestamp
    market_data_as_of: datetime | None = None
    freshness_status: FreshnessStatus = FreshnessStatus.UNKNOWN
    response_received_at: datetime | None = None

    # Cache metadata
    from_cache: bool | None = None


class GexInterpretation(BaseModel):
    """Model-generated interpretation of GEX facts. No invented numbers."""

    regime: str  # e.g. "positive_gamma", "negative_gamma", "near_zero"
    observations: list[str] = Field(default_factory=list)
    implications: list[str] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)


class GexAnalysisResult(BaseModel):
    """Complete GEX analysis: facts + interpretation."""

    status: str = "SUCCESS"
    symbol: str
    analysis_type: str = "CURRENT_GEX"
    facts: GexFacts
    interpretation: GexInterpretation
    evidence: list[dict] = Field(default_factory=list)
