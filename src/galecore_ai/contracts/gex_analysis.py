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


# ── Model output contracts ───────────────────────────────────────────


class GexRegime(str, Enum):
    """Gamma exposure regime classification."""

    POSITIVE_GAMMA = "positive_gamma"
    NEGATIVE_GAMMA = "negative_gamma"
    NEAR_ZERO = "near_zero"


class EvidenceRef(BaseModel):
    """A reference from interpretation to a specific fact.

    Links a claim in the interpretation to the fact that supports it.
    """

    fact_path: str  # e.g. "facts.net_gex", "facts.spot"
    claim: str  # e.g. "Net GEX is negative, indicating short gamma positioning"

    model_config = {"extra": "forbid"}


class GexInterpretation(BaseModel):
    """Model-generated interpretation of GEX facts.

    Structured for grounding validation:
    - regime: enum-constrained classification
    - observations: what the data shows (must reference facts)
    - implications: expected market behavior given the regime
    - evidence: explicit references linking claims to facts
    - limitations: conditions, caveats, data quality notes
    """

    regime: GexRegime
    observations: list[str] = Field(default_factory=list, min_length=1)
    implications: list[str] = Field(default_factory=list)
    evidence: list[EvidenceRef] = Field(default_factory=list, min_length=1)
    limitations: list[str] = Field(default_factory=list)

    model_config = {"extra": "forbid"}
