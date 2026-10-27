"""GaleCore DTOs — typed representations of real GaleCore REST responses.

These DTOs match the exact JSON serialization of GaleCore's .NET controllers.
Field names use Pydantic aliases to map camelCase JSON to Python attributes.

Source of truth: GaleCore C# contracts, NOT these DTOs.
If GaleCore changes a field name, update the alias here.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

# ── GET /App/Gex/Analysis → GexAnalysisResponse ─────────────────


class GaleCoreGexScope(BaseModel):
    """Maps to GaleCore's GexScope (gex.global in JSON)."""

    spot: float = 0.0
    call_gex: float = Field(0.0, alias="callGex")
    put_gex: float = Field(0.0, alias="putGex")
    net_gex: float = Field(0.0, alias="netGex")
    gamma_zero_level: float | None = Field(None, alias="gammaZeroLevel")
    call_wall: float | None = Field(None, alias="callWall")
    put_wall: float | None = Field(None, alias="putWall")
    expirations_included: int = Field(0, alias="expirationsIncluded")
    expirations_requested: int = Field(0, alias="expirationsRequested")
    coverage_pct: float = Field(0.0, alias="coveragePct")

    model_config = {"populate_by_name": True}


class GaleCoreGexExpiryScope(BaseModel):
    """Maps to GaleCore's GexExpiryScope (gex.byExpiry[] in JSON)."""

    expiration: str = ""
    dte: int = 0
    expiration_type: str | None = Field(None, alias="expirationType")
    call_gex: float = Field(0.0, alias="callGex")
    put_gex: float = Field(0.0, alias="putGex")
    net_gex: float = Field(0.0, alias="netGex")
    gamma_zero_level: float | None = Field(None, alias="gammaZeroLevel")
    call_wall: float | None = Field(None, alias="callWall")
    put_wall: float | None = Field(None, alias="putWall")
    atm_iv: float | None = Field(None, alias="atmIv")
    expected_move: float | None = Field(None, alias="expectedMove")

    model_config = {"populate_by_name": True}


class GaleCoreGexScanConfig(BaseModel):
    """Maps to GaleCore's GexScanConfig (gex.config in JSON)."""

    max_dte: int = Field(0, alias="maxDte")
    include_zero_dte: bool = Field(False, alias="includeZeroDte")
    expiration_types: list[str] = Field(default_factory=list, alias="expirationTypes")
    greeks_batch_size: int = Field(0, alias="greeksBatchSize")
    greeks_retries: int = Field(0, alias="greeksRetries")
    cache_seconds: int = Field(0, alias="cacheSeconds")
    cache_min_coverage_pct: float = Field(0.0, alias="cacheMinCoveragePct")

    model_config = {"populate_by_name": True}


class GaleCoreGexPayload(BaseModel):
    """Maps to GaleCore's GexPayload (gex in JSON)."""

    global_scope: GaleCoreGexScope = Field(default_factory=GaleCoreGexScope, alias="global")
    by_expiry: list[GaleCoreGexExpiryScope] = Field(default_factory=list, alias="byExpiry")
    config: GaleCoreGexScanConfig = Field(default_factory=GaleCoreGexScanConfig)

    model_config = {"populate_by_name": True}


class GaleCoreMacroCheckResult(BaseModel):
    """Maps to a single macro regime check result from GaleCore.

    Each check has a `passed` boolean plus check-specific diagnostic fields
    (value, threshold, min, max, etc.) that vary by check type.
    """

    passed: bool = False
    model_config = {"extra": "allow"}


class GaleCoreMacroRegimeCheck(BaseModel):
    """Maps to GaleCore's MacroRegimeChecks.

    Each check is an object with {passed, ...diagnostics}, not a simple boolean.
    """

    vix_absolute: GaleCoreMacroCheckResult = Field(
        default_factory=GaleCoreMacroCheckResult, alias="vixAbsolute"
    )
    vix_term_structure: GaleCoreMacroCheckResult = Field(
        default_factory=GaleCoreMacroCheckResult, alias="vixTermStructure"
    )
    iv_rank: GaleCoreMacroCheckResult = Field(
        default_factory=GaleCoreMacroCheckResult, alias="ivRank"
    )
    iv_momentum: GaleCoreMacroCheckResult = Field(
        default_factory=GaleCoreMacroCheckResult, alias="ivMomentum"
    )
    gex_total: GaleCoreMacroCheckResult = Field(
        default_factory=GaleCoreMacroCheckResult, alias="gexTotal"
    )
    spot_vs_zgl: GaleCoreMacroCheckResult = Field(
        default_factory=GaleCoreMacroCheckResult, alias="spotVsZgl"
    )

    model_config = {"populate_by_name": True}


class GaleCoreMacroRegime(BaseModel):
    """Maps to GaleCore's MacroRegimeResult."""

    signal: str = ""
    passed_count: int = Field(0, alias="passedCount")
    total_checks: int = Field(0, alias="totalChecks")
    checks: GaleCoreMacroRegimeCheck = Field(default_factory=GaleCoreMacroRegimeCheck)

    model_config = {"populate_by_name": True}


class GaleCoreGexAnalysisResponse(BaseModel):
    """Maps to GaleCore's GexAnalysisResponse from GET /App/Gex/Analysis.

    This is the external DTO — it represents GaleCore's contract faithfully.
    Do NOT add fields that GaleCore doesn't return.
    """

    symbol: str = ""
    timestamp: datetime | None = None
    spot_price: float = Field(0.0, alias="spotPrice")
    from_cache: bool = Field(False, alias="fromCache")
    switch_enabled: bool = Field(True, alias="switchEnabled")
    frozen: bool = False
    elapsed_ms: int = Field(0, alias="elapsedMs")
    macro_regime: GaleCoreMacroRegime | None = Field(None, alias="macroRegime")
    gex: GaleCoreGexPayload = Field(default_factory=GaleCoreGexPayload)

    model_config = {"populate_by_name": True}


# ── GET /App.Analytics/PutSkew → PutSkewResponse ─────────────────


class GaleCorePutSkewResponse(BaseModel):
    """Maps to GaleCore's PutSkewResponse (DataFeed.Application.App.PutSkew).

    GaleCore computes the snapshot on request and publishes no as-of timestamp;
    ``roc5d`` and ``percentile252d`` are null until GaleCore persists IV history.
    """

    symbol: str = ""
    spot: float = 0.0
    dte: int = 0
    expiration: str = ""
    target_delta: float = Field(0.0, alias="targetDelta")
    atm_strike: float = Field(0.0, alias="atmStrike")
    atm_iv: float = Field(0.0, alias="atmIV")
    put_25_delta_strike: float = Field(0.0, alias="put25DeltaStrike")
    put_25_delta_actual_delta: float = Field(0.0, alias="put25DeltaActualDelta")
    put_25_delta_iv: float = Field(0.0, alias="put25DeltaIV")
    put_skew_25d: float | None = Field(None, alias="putSkew25d")
    level_ok: bool | None = Field(None, alias="levelOk")
    level_threshold: float = Field(0.0, alias="levelThreshold")
    roc5d: float | None = None
    percentile252d: float | None = None
    note: str | None = None

    model_config = {"populate_by_name": True}


# ── GET /Data/Tastytrade/MarketData/Trade → MarketDataTradeResponse ──


class GaleCoreTradeEvent(BaseModel):
    """One dxFeed Trade event as relayed by GaleCore.

    Only the fields the regime skill needs are typed; GaleCore serializes
    absent numerics as the string "NaN", so unrelated fields are left open.
    """

    event_symbol: str = Field("", alias="eventSymbol")
    time: int = 0  # epoch milliseconds of the print
    price: float = 0.0

    model_config = {"populate_by_name": True, "extra": "allow"}


class GaleCoreTradeResponse(BaseModel):
    """Maps to GaleCore's MarketDataTradeResponse."""

    type: str = ""
    channel: int = 0
    data: list[GaleCoreTradeEvent] = Field(default_factory=list)

    model_config = {"populate_by_name": True}
