"""GEX Mapper — transforms GaleCore DTO to internal GexFacts.

Responsibilities:
- Parse raw JSON dict into GaleCoreGexAnalysisResponse (DTO)
- Validate structural completeness
- Map to GexFacts (internal canonical model)
- Determine freshness status from GaleCore's timestamp
- Report coverage quality

Does NOT:
- Recalculate GEX values
- Derive walls from strikes
- Add fields not present in GaleCore's response
"""

from __future__ import annotations

import math
from datetime import UTC, datetime

from pydantic import ValidationError

from galecore_ai.capabilities.galecore_dtos import GaleCoreGexAnalysisResponse
from galecore_ai.contracts.gex_analysis import FreshnessStatus, GexFacts
from galecore_ai.harness.freshness import freshness_error


class GexMappingError(Exception):
    """Error mapping GaleCore response to GexFacts."""

    def __init__(self, message: str, *, field: str | None = None):
        super().__init__(message)
        self.field = field


def parse_gex_response(raw: dict | list | None) -> GaleCoreGexAnalysisResponse:
    """Parse raw JSON into the GaleCore DTO. Raises GexMappingError on failure."""
    if not isinstance(raw, dict):
        raise GexMappingError(
            f"Expected dict payload, got {type(raw).__name__}",
            field="payload",
        )
    try:
        return GaleCoreGexAnalysisResponse.model_validate(raw)
    except ValidationError as exc:
        raise GexMappingError(
            f"Invalid GaleCore response structure: {exc}",
            field="structure",
        ) from exc


def map_to_gex_facts(
    dto: GaleCoreGexAnalysisResponse,
    *,
    requested_symbol: str,
    max_staleness_seconds: float = 300.0,
) -> GexFacts:
    """Map validated GaleCore DTO to internal GexFacts.

    Validations:
    - Symbol matches request
    - Required numeric fields are finite
    - Freshness from GaleCore's timestamp
    - Coverage from gex.global.coveragePct

    Raises GexMappingError on validation failure.
    """
    now = datetime.now(tz=UTC)
    policy_error = freshness_error(None, max_age_seconds=max_staleness_seconds, allow_unknown=True)
    if policy_error:
        raise GexMappingError(policy_error, field="freshness_policy")

    # Symbol check
    if dto.symbol.upper() != requested_symbol.upper():
        raise GexMappingError(
            f"Symbol mismatch: requested '{requested_symbol}', got '{dto.symbol}'",
            field="symbol",
        )

    g = dto.gex.global_scope

    # Validate required numeric fields are finite
    required_fields = {
        "spot": g.spot,
        "netGex": g.net_gex,
        "callGex": g.call_gex,
        "putGex": g.put_gex,
    }
    for name, val in required_fields.items():
        if not math.isfinite(val):
            raise GexMappingError(
                f"Field 'gex.global.{name}' is not finite: {val}",
                field=name,
            )

    # Spot must be positive
    if g.spot <= 0:
        raise GexMappingError(
            f"Spot price must be positive, got {g.spot}",
            field="spot",
        )

    # Freshness from GaleCore's timestamp
    freshness_status = FreshnessStatus.UNKNOWN
    market_data_as_of: datetime | None = None

    if dto.timestamp is not None:
        market_data_as_of = dto.timestamp
        if market_data_as_of.tzinfo is None:
            market_data_as_of = market_data_as_of.replace(tzinfo=UTC)
        error = freshness_error(
            market_data_as_of, max_age_seconds=max_staleness_seconds, now=now,
        )
        if error and error != "Data is stale":
            raise GexMappingError(error, field="timestamp")
        age_seconds = (now - market_data_as_of).total_seconds()
        if age_seconds <= max_staleness_seconds:
            freshness_status = FreshnessStatus.VALID
        else:
            freshness_status = FreshnessStatus.STALE

    # Validate optional float fields for finiteness
    optional_floats = {
        "gammaZeroLevel": g.gamma_zero_level,
        "callWall": g.call_wall,
        "putWall": g.put_wall,
    }
    for name, val in optional_floats.items():
        if val is not None and not math.isfinite(val):
            raise GexMappingError(
                f"Field 'gex.global.{name}' is not finite: {val}",
                field=name,
            )

    return GexFacts(
        symbol=dto.symbol.upper(),
        net_gex=g.net_gex,
        call_gex=g.call_gex,
        put_gex=g.put_gex,
        spot=g.spot,
        zero_gamma_level=g.gamma_zero_level,
        call_wall=g.call_wall,
        put_wall=g.put_wall,
        expirations_included=g.expirations_included,
        expirations_requested=g.expirations_requested,
        coverage_pct=g.coverage_pct,
        market_data_as_of=market_data_as_of,
        freshness_status=freshness_status,
        response_received_at=now,
        from_cache=dto.from_cache,
    )
