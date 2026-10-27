"""Regime mapper — assembles RegimeFacts from three GaleCore responses.

Responsibilities:
- Parse the PutSkew and Trade payloads into their DTOs
- Validate structural completeness and finiteness
- Determine per-source freshness from GaleCore's own timestamps
- Combine the GEX facts (already mapped by gex_mapper) with skew and index prints

Does NOT:
- Recalculate, combine or threshold any value
- Fill a missing source with a default (a missing source is a mapping error)
"""

from __future__ import annotations

import math
from datetime import UTC, datetime

from pydantic import ValidationError

from galecore_ai.capabilities.galecore_dtos import (
    GaleCorePutSkewResponse,
    GaleCoreTradeResponse,
)
from galecore_ai.capabilities.gex_mapper import GexMappingError
from galecore_ai.contracts.gex_analysis import FreshnessStatus, GexFacts
from galecore_ai.contracts.prepared_analysis import Provenance
from galecore_ai.contracts.regime_analysis import (
    RegimeFacts,
    RegimeSource,
    SourceFreshnessBasis,
)
from galecore_ai.harness.freshness import freshness_error

GEX_CAPABILITY_ID = "compute.gex_analysis"
PUT_SKEW_CAPABILITY_ID = "compute.put_skew"
TRADE_CAPABILITY_ID = "market_data.trade"

GEX_ENDPOINT = "/App/Gex/Analysis"
PUT_SKEW_ENDPOINT = "/App.Analytics/PutSkew"
TRADE_ENDPOINT = "/Data/Tastytrade/MarketData/Trade"

# Worst-first ordering for the snapshot-level status
_STATUS_RANK = {FreshnessStatus.STALE: 2, FreshnessStatus.UNKNOWN: 1, FreshnessStatus.VALID: 0}


def parse_put_skew_response(raw: dict | list | None) -> GaleCorePutSkewResponse:
    if not isinstance(raw, dict):
        raise GexMappingError(
            f"PutSkew: expected dict payload, got {type(raw).__name__}", field="put_skew"
        )
    try:
        return GaleCorePutSkewResponse.model_validate(raw)
    except ValidationError as exc:
        raise GexMappingError(f"Invalid PutSkew response structure: {exc}", field="put_skew") from exc


def parse_trade_response(raw: dict | list | None) -> GaleCoreTradeResponse:
    if not isinstance(raw, dict):
        raise GexMappingError(
            f"Trade: expected dict payload, got {type(raw).__name__}", field="trade"
        )
    try:
        return GaleCoreTradeResponse.model_validate(raw)
    except ValidationError as exc:
        raise GexMappingError(f"Invalid Trade response structure: {exc}", field="trade") from exc


def trade_print(dto: GaleCoreTradeResponse, *, expected_symbol: str) -> tuple[float, datetime]:
    """Price and UTC time of the first Trade event for ``expected_symbol``."""
    if not dto.data:
        raise GexMappingError(f"Trade: no events for {expected_symbol}", field="trade")
    event = dto.data[0]
    if event.event_symbol.upper() != expected_symbol.upper():
        raise GexMappingError(
            f"Trade: expected symbol {expected_symbol}, got {event.event_symbol!r}", field="trade"
        )
    if not math.isfinite(event.price) or event.price <= 0:
        raise GexMappingError(
            f"Trade: price for {expected_symbol} is not a positive finite number: {event.price}",
            field="trade",
        )
    if event.time <= 0:
        raise GexMappingError(f"Trade: missing print time for {expected_symbol}", field="trade")
    return event.price, datetime.fromtimestamp(event.time / 1000.0, tz=UTC)


def _status_for(ts: datetime | None, *, now: datetime, max_staleness_seconds: float) -> FreshnessStatus:
    if ts is None:
        return FreshnessStatus.UNKNOWN
    error = freshness_error(ts, max_age_seconds=max_staleness_seconds, now=now)
    if error and error != "Data is stale":
        raise GexMappingError(error, field="timestamp")
    return FreshnessStatus.STALE if error else FreshnessStatus.VALID


def map_to_regime_facts(
    *,
    gex: GexFacts,
    put_skew: GaleCorePutSkewResponse,
    vix: GaleCoreTradeResponse,
    vvix: GaleCoreTradeResponse,
    requested_symbol: str,
    received_at: dict[str, datetime],
    max_staleness_seconds: float = 300.0,
) -> RegimeFacts:
    """Combine mapped GEX facts with skew and index prints into RegimeFacts.

    ``received_at`` maps source key (gex, put_skew, vix, vvix) to the UTC time
    the validator received each response.
    """
    now = datetime.now(tz=UTC)
    symbol = requested_symbol.upper()

    if put_skew.symbol.upper() != symbol:
        raise GexMappingError(
            f"PutSkew: symbol mismatch: requested '{symbol}', got '{put_skew.symbol}'",
            field="put_skew",
        )
    if put_skew.put_skew_25d is None or put_skew.level_ok is None:
        raise GexMappingError(
            "PutSkew: putSkew25d or levelOk is null — GaleCore could not compute the skew",
            field="put_skew",
        )
    for name, val in {
        "putSkew25d": put_skew.put_skew_25d,
        "atmIV": put_skew.atm_iv,
        "put25DeltaIV": put_skew.put_25_delta_iv,
        "levelThreshold": put_skew.level_threshold,
    }.items():
        if not math.isfinite(val) or val <= 0:
            raise GexMappingError(
                f"PutSkew: field '{name}' is not a positive finite number: {val}", field=name
            )

    vix_price, vix_ts = trade_print(vix, expected_symbol="VIX")
    vvix_price, vvix_ts = trade_print(vvix, expected_symbol="VVIX")

    sources = {
        "gex": RegimeSource(
            capability_id=GEX_CAPABILITY_ID,
            endpoint=GEX_ENDPOINT,
            provenance=Provenance.GALECORE_VERIFIED.value,
            market_data_as_of=gex.market_data_as_of,
            freshness_basis=(
                SourceFreshnessBasis.GALECORE_TIMESTAMP
                if gex.market_data_as_of is not None
                else SourceFreshnessBasis.NONE
            ),
            freshness_status=gex.freshness_status,
            response_received_at=received_at["gex"],
        ),
        "put_skew": RegimeSource(
            capability_id=PUT_SKEW_CAPABILITY_ID,
            endpoint=PUT_SKEW_ENDPOINT,
            provenance=Provenance.GALECORE_VERIFIED.value,
            market_data_as_of=None,
            freshness_basis=SourceFreshnessBasis.NONE,
            freshness_status=FreshnessStatus.UNKNOWN,
            response_received_at=received_at["put_skew"],
        ),
        "vix": RegimeSource(
            capability_id=TRADE_CAPABILITY_ID,
            endpoint=TRADE_ENDPOINT,
            provenance=Provenance.GALECORE_VERIFIED.value,
            market_data_as_of=vix_ts,
            freshness_basis=SourceFreshnessBasis.GALECORE_TIMESTAMP,
            freshness_status=_status_for(vix_ts, now=now, max_staleness_seconds=max_staleness_seconds),
            response_received_at=received_at["vix"],
        ),
        "vvix": RegimeSource(
            capability_id=TRADE_CAPABILITY_ID,
            endpoint=TRADE_ENDPOINT,
            provenance=Provenance.GALECORE_VERIFIED.value,
            market_data_as_of=vvix_ts,
            freshness_basis=SourceFreshnessBasis.GALECORE_TIMESTAMP,
            freshness_status=_status_for(vvix_ts, now=now, max_staleness_seconds=max_staleness_seconds),
            response_received_at=received_at["vvix"],
        ),
    }

    declared = [s.market_data_as_of for s in sources.values() if s.market_data_as_of is not None]
    overall = max(sources.values(), key=lambda s: _STATUS_RANK[s.freshness_status]).freshness_status

    return RegimeFacts(
        symbol=symbol,
        net_gex=gex.net_gex,
        call_gex=gex.call_gex,
        put_gex=gex.put_gex,
        spot=gex.spot,
        zero_gamma_level=gex.zero_gamma_level,
        call_wall=gex.call_wall,
        put_wall=gex.put_wall,
        coverage_pct=gex.coverage_pct,
        put_skew_ratio=put_skew.put_skew_25d,
        atm_iv=put_skew.atm_iv,
        put_wing_iv=put_skew.put_25_delta_iv,
        put_skew_dte=put_skew.dte,
        put_skew_expiration=put_skew.expiration,
        put_skew_level_ok=put_skew.level_ok,
        put_skew_level_threshold=put_skew.level_threshold,
        vix=vix_price,
        vvix=vvix_price,
        market_data_as_of=min(declared) if declared else None,
        freshness_status=overall,
        sources=sources,
    )
