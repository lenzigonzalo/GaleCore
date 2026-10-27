"""Regime analysis contracts — facts and output for the daily regime skill (Phase 4, UC-1).

Facts are the union of three GaleCore sources fetched by the validator through
controlled capabilities: GEX (``compute.gex_analysis``), 25-delta put skew
(``compute.put_skew``) and index prints for VIX/VVIX (``market_data.trade``).
GaleCore-AI does not derive, combine or threshold any of them: the only
deterministic checks are sign of ``net_gex`` and GaleCore's own
``put_skew_level_ok`` flag.

Metric values live flat at the top level of the facts so the quantitative
claim registry resolves them with the same rule as the GEX skill; per-source
provenance and freshness live under ``sources``.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field

from galecore_ai.contracts.gex_analysis import EvidenceRef, FreshnessStatus, GexRegime

REGIME_SKILL_ID = "regime_interpretation"


class SourceFreshnessBasis(str, Enum):
    """Where a source's timestamp comes from."""

    GALECORE_TIMESTAMP = "galecore_timestamp"  # GaleCore published an as-of time
    NONE = "none"  # GaleCore publishes no timestamp for this source


class RegimeSource(BaseModel):
    """Provenance and freshness of one fact source inside a regime snapshot."""

    model_config = {"extra": "forbid"}

    capability_id: str
    endpoint: str
    provenance: str  # Provenance value, GALECORE_VERIFIED for capability fetches
    market_data_as_of: datetime | None = None
    freshness_basis: SourceFreshnessBasis
    freshness_status: FreshnessStatus
    response_received_at: datetime


class RegimeFacts(BaseModel):
    """Deterministic regime facts. Every value comes from GaleCore unchanged."""

    model_config = {"extra": "forbid"}

    symbol: str

    # GEX (compute.gex_analysis) — same fields and units as GexFacts
    net_gex: float
    call_gex: float
    put_gex: float
    spot: float
    zero_gamma_level: float | None = None
    call_wall: float | None = None
    put_wall: float | None = None
    coverage_pct: float | None = None

    # 25-delta put skew (compute.put_skew). Names carry no digits on purpose:
    # the no_invented_numbers guardrail scans the serialized interpretation,
    # so a metric called "put_skew_25d" would read as an invented "25".
    put_skew_ratio: float  # PutSkewResponse.putSkew25d = iv_put_25delta / iv_atm
    atm_iv: float
    put_wing_iv: float  # PutSkewResponse.put25DeltaIV
    put_skew_dte: int
    put_skew_expiration: str
    put_skew_level_ok: bool
    put_skew_level_threshold: float

    # Index prints (market_data.trade)
    vix: float
    vvix: float

    # Snapshot-level freshness: the oldest GaleCore-declared timestamp across
    # sources, and the worst per-source status (STALE > UNKNOWN > VALID).
    market_data_as_of: datetime | None = None
    freshness_status: FreshnessStatus = FreshnessStatus.UNKNOWN

    sources: dict[str, RegimeSource]


# ── Quantitative metric contract ─────────────────────────────────────


class RegimeMetric(str, Enum):
    """Metrics the host may claim in a regime interpretation (closed allowlist)."""

    NET_GEX = "net_gex"
    SPOT = "spot"
    ZERO_GAMMA_LEVEL = "zero_gamma_level"
    CALL_WALL = "call_wall"
    PUT_WALL = "put_wall"
    PUT_SKEW_RATIO = "put_skew_ratio"
    ATM_IV = "atm_iv"
    PUT_WING_IV = "put_wing_iv"
    VIX = "vix"
    VVIX = "vvix"


class RegimeUnit(str, Enum):
    """Units for regime quantitative claims (closed allowlist).

    - billion_usd: net_gex (GammaExposureResponse.NetGEX = (CallGEX+PutGEX)/1000)
    - usd: price levels
    - ratio: put_skew_ratio = iv_put_25delta / iv_atm (PutSkewResponse.putSkew25d)
    - iv_decimal: implied volatility as a decimal fraction (0.1433 = 14.33%)
    - index_points: VIX / VVIX last print
    """

    BILLION_USD = "billion_usd"
    USD = "usd"
    RATIO = "ratio"
    IV_DECIMAL = "iv_decimal"
    INDEX_POINTS = "index_points"


class RegimeMetricSpec(BaseModel):
    model_config = {"frozen": True}

    fact_path: str
    unit: RegimeUnit


REGIME_METRIC_REGISTRY: dict[RegimeMetric, RegimeMetricSpec] = {
    RegimeMetric.NET_GEX: RegimeMetricSpec(fact_path="facts.net_gex", unit=RegimeUnit.BILLION_USD),
    RegimeMetric.SPOT: RegimeMetricSpec(fact_path="facts.spot", unit=RegimeUnit.USD),
    RegimeMetric.ZERO_GAMMA_LEVEL: RegimeMetricSpec(
        fact_path="facts.zero_gamma_level", unit=RegimeUnit.USD
    ),
    RegimeMetric.CALL_WALL: RegimeMetricSpec(fact_path="facts.call_wall", unit=RegimeUnit.USD),
    RegimeMetric.PUT_WALL: RegimeMetricSpec(fact_path="facts.put_wall", unit=RegimeUnit.USD),
    RegimeMetric.PUT_SKEW_RATIO: RegimeMetricSpec(
        fact_path="facts.put_skew_ratio", unit=RegimeUnit.RATIO
    ),
    RegimeMetric.ATM_IV: RegimeMetricSpec(fact_path="facts.atm_iv", unit=RegimeUnit.IV_DECIMAL),
    RegimeMetric.PUT_WING_IV: RegimeMetricSpec(
        fact_path="facts.put_wing_iv", unit=RegimeUnit.IV_DECIMAL
    ),
    RegimeMetric.VIX: RegimeMetricSpec(fact_path="facts.vix", unit=RegimeUnit.INDEX_POINTS),
    RegimeMetric.VVIX: RegimeMetricSpec(fact_path="facts.vvix", unit=RegimeUnit.INDEX_POINTS),
}


# ── Model output contract ────────────────────────────────────────────


class TailPricing(str, Enum):
    """GaleCore's own level semaphore for the 25-delta put skew.

    ``calm`` requires facts.put_skew_level_ok == true, ``elevated`` requires
    false. The threshold is GaleCore's (``put_skew_level_threshold``); the host
    does not decide it.
    """

    CALM = "calm"
    ELEVATED = "elevated"


class RegimeQuantitativeClaim(BaseModel):
    """Structured numeric claim; value must equal the fact exactly."""

    model_config = {"extra": "forbid"}

    metric: RegimeMetric
    value: float = Field(strict=True)
    unit: RegimeUnit


class RegimeInterpretation(BaseModel):
    """Host-generated interpretation of the daily regime.

    - gamma_regime: sign of net_gex (near_zero is always rejected, as in GEX)
    - tail_pricing: GaleCore's skew level semaphore
    - observations / implications: qualitative prose, no digits
    - quantitative_claims: the only place for numbers, validated exactly
    - evidence: fact_path references for qualitative claims
    - limitations: caveats (at least one)
    """

    model_config = {"extra": "forbid", "validate_default": True}

    gamma_regime: GexRegime
    tail_pricing: TailPricing
    observations: list[str] = Field(min_length=1)
    implications: list[str] = Field(default_factory=list)
    quantitative_claims: list[RegimeQuantitativeClaim] = Field(min_length=1)
    evidence: list[EvidenceRef] = Field(min_length=1)
    limitations: list[str] = Field(min_length=1)
