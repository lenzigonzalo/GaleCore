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


# ── Quantitative metric contract ─────────────────────────────────────
#
# Closed technical contract for GEX quantitative claims.
# Units are derived from GaleCore source code (not configurable):
#   - net_gex: billions USD  (GammaExposureResponse.NetGEX = (CallGEX+PutGEX)/1000)
#   - spot, zero_gamma_level, call_wall, put_wall: USD (price levels)
#
# call_gex and put_gex are NOT enabled because GaleCore does not formally
# publish their unit in the HTTP contract. They are in millions USD per
# source code inspection, but enabling them requires either:
#   (a) GaleCore adding unit metadata to GexScope, or
#   (b) a dedicated contractual test verifying the scale.
# Tracked as future work item.


class GexMetric(str, Enum):
    """Quantitative metrics the host may claim in a GEX interpretation.

    Closed allowlist — unknown metrics are rejected by schema validation.
    """

    NET_GEX = "net_gex"
    SPOT = "spot"
    ZERO_GAMMA_LEVEL = "zero_gamma_level"
    CALL_WALL = "call_wall"
    PUT_WALL = "put_wall"


class GexUnit(str, Enum):
    """Units for GEX quantitative claims.

    Closed allowlist — unknown units are rejected by schema validation.
    """

    BILLION_USD = "billion_usd"
    USD = "usd"


class _MetricSpec:
    """Internal specification for a quantitative metric."""

    __slots__ = ("fact_path", "unit")

    def __init__(self, fact_path: str, unit: GexUnit) -> None:
        self.fact_path = fact_path
        self.unit = unit


# Validator-owned mapping: metric → expected fact_path → expected unit.
# The host does NOT control fact_path; the validator derives it from metric.
METRIC_REGISTRY: dict[GexMetric, _MetricSpec] = {
    GexMetric.NET_GEX: _MetricSpec("facts.net_gex", GexUnit.BILLION_USD),
    GexMetric.SPOT: _MetricSpec("facts.spot", GexUnit.USD),
    GexMetric.ZERO_GAMMA_LEVEL: _MetricSpec("facts.zero_gamma_level", GexUnit.USD),
    GexMetric.CALL_WALL: _MetricSpec("facts.call_wall", GexUnit.USD),
    GexMetric.PUT_WALL: _MetricSpec("facts.put_wall", GexUnit.USD),
}


# ── Model output contracts ───────────────────────────────────────────


class GexRegime(str, Enum):
    """Gamma exposure regime classification."""

    POSITIVE_GAMMA = "positive_gamma"
    NEGATIVE_GAMMA = "negative_gamma"
    NEAR_ZERO = "near_zero"


class QuantitativeClaim(BaseModel):
    """A structured, deterministically validatable quantitative claim.

    The host provides metric, value, and unit.
    The validator derives the expected fact_path and unit from the metric
    via METRIC_REGISTRY and verifies:
      - fact_path resolves to a scalar in facts
      - value equals the authoritative fact exactly (no tolerance, no scaling)
      - unit matches the expected unit for this metric

    value is strict: a JSON string such as "1500" is rejected by schema.
    """

    metric: GexMetric
    value: float = Field(strict=True)
    unit: GexUnit

    model_config = {"extra": "forbid"}


class EvidenceRef(BaseModel):
    """A qualitative reference from interpretation to a specific fact.

    Links a qualitative claim to a fact_path. Validates that the path exists
    and resolves to a scalar, but does NOT prove semantic entailment —
    the validator cannot verify that the prose accurately describes the fact.
    """

    fact_path: str  # e.g. "facts.net_gex", "facts.spot"
    claim: str  # e.g. "Dealers are long gamma" (qualitative, no numbers)

    model_config = {"extra": "forbid"}


class GexInterpretation(BaseModel):
    """Model-generated interpretation of GEX facts.

    Structured for grounding validation:
    - regime: enum-constrained classification
    - observations: qualitative prose — numbers are forbidden (fail-closed)
    - implications: qualitative prose — numbers are forbidden (fail-closed)
    - quantitative_claims: structured numeric claims, deterministically validated
    - evidence: qualitative references linking prose claims to facts
    - limitations: conditions, caveats, data quality notes
    """

    # Mandatory lists are required, not defaulted: Pydantic does not validate
    # defaults, so `default_factory=list` + `min_length=1` would let an omitted
    # field through. Omission and emptiness are both schema rejections.
    regime: GexRegime
    observations: list[str] = Field(min_length=1)
    implications: list[str] = Field(default_factory=list)
    quantitative_claims: list[QuantitativeClaim] = Field(min_length=1)
    evidence: list[EvidenceRef] = Field(min_length=1)
    limitations: list[str] = Field(min_length=1)

    model_config = {"extra": "forbid", "validate_default": True}
