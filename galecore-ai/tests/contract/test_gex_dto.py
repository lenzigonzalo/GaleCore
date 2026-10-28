"""Contract tests for GaleCore GEX DTOs and mapper.

Verifies:
- Real camelCase JSON from GaleCore parses into the DTO
- DTO maps correctly to internal GexFacts
- Invalid/incomplete payloads are rejected
- Freshness policy works correctly
- No GEX calculations are duplicated
"""

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from galecore_ai.capabilities.gex_mapper import (
    GexMappingError,
    map_to_gex_facts,
    parse_gex_response,
)
from galecore_ai.contracts.gex_analysis import FreshnessStatus

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures" / "galecore"


def _load_fixture(name: str = "gex_analysis_spy.json") -> dict:
    return json.loads((FIXTURES_DIR / name).read_text())


class TestDTOParsing:
    """Verify the DTO parses real camelCase JSON correctly."""

    def test_parse_full_fixture(self):
        raw = _load_fixture()
        dto = parse_gex_response(raw)
        assert dto.symbol == "SPY"
        assert dto.spot_price == 450.50
        assert dto.from_cache is False
        assert dto.elapsed_ms == 2340

    def test_parse_gex_global_scope(self):
        raw = _load_fixture()
        dto = parse_gex_response(raw)
        g = dto.gex.global_scope
        assert g.spot == 450.50
        assert g.call_gex == 2000000.0
        assert g.put_gex == -500000.0
        assert g.net_gex == 1500.0
        assert g.gamma_zero_level == 445.0
        assert g.call_wall == 460.0
        assert g.put_wall == 440.0
        assert g.expirations_included == 8
        assert g.expirations_requested == 12
        assert g.coverage_pct == 85.5

    def test_parse_by_expiry(self):
        raw = _load_fixture()
        dto = parse_gex_response(raw)
        assert len(dto.gex.by_expiry) == 1
        exp = dto.gex.by_expiry[0]
        assert exp.expiration == "2026-10-17"
        assert exp.dte == 32
        assert exp.expiration_type == "Regular"
        assert exp.atm_iv == 0.185

    def test_parse_macro_regime(self):
        raw = _load_fixture()
        dto = parse_gex_response(raw)
        assert dto.macro_regime is not None
        assert dto.macro_regime.signal == "SELL"
        assert dto.macro_regime.passed_count == 4
        assert dto.macro_regime.checks.vix_absolute.passed is True
        assert dto.macro_regime.checks.iv_momentum.passed is False

    def test_parse_config(self):
        raw = _load_fixture()
        dto = parse_gex_response(raw)
        cfg = dto.gex.config
        assert cfg.max_dte == 60
        assert cfg.include_zero_dte is False
        assert cfg.cache_seconds == 120

    def test_parse_timestamp(self):
        raw = _load_fixture()
        dto = parse_gex_response(raw)
        assert dto.timestamp is not None

    def test_null_payload_rejected(self):
        with pytest.raises(GexMappingError, match="Expected dict"):
            parse_gex_response(None)

    def test_list_payload_rejected(self):
        with pytest.raises(GexMappingError, match="Expected dict"):
            parse_gex_response([])

    def test_empty_dict_parses_with_defaults(self):
        """Empty dict should parse (fields have defaults) but will fail mapping."""
        dto = parse_gex_response({})
        assert dto.symbol == ""


class TestGexMapper:
    """Verify mapping from DTO to internal GexFacts."""

    def test_maps_all_fields(self):
        raw = _load_fixture()
        dto = parse_gex_response(raw)
        facts = map_to_gex_facts(dto, requested_symbol="SPY", max_staleness_seconds=999999)
        assert facts.symbol == "SPY"
        assert facts.net_gex == 1500.0
        assert facts.call_gex == 2000000.0
        assert facts.put_gex == -500000.0
        assert facts.spot == 450.50
        assert facts.zero_gamma_level == 445.0
        assert facts.call_wall == 460.0
        assert facts.put_wall == 440.0
        assert facts.expirations_included == 8
        assert facts.expirations_requested == 12
        assert facts.coverage_pct == 85.5
        assert facts.from_cache is False

    def test_symbol_mismatch_rejected(self):
        raw = _load_fixture()
        dto = parse_gex_response(raw)
        with pytest.raises(GexMappingError, match="mismatch"):
            map_to_gex_facts(dto, requested_symbol="QQQ")

    def test_nan_in_spot_rejected(self):
        raw = _load_fixture()
        raw["gex"]["global"]["spot"] = float("nan")
        dto = parse_gex_response(raw)
        with pytest.raises(GexMappingError, match="not finite"):
            map_to_gex_facts(dto, requested_symbol="SPY")

    def test_inf_in_net_gex_rejected(self):
        raw = _load_fixture()
        raw["gex"]["global"]["netGex"] = float("inf")
        dto = parse_gex_response(raw)
        with pytest.raises(GexMappingError, match="not finite"):
            map_to_gex_facts(dto, requested_symbol="SPY")

    def test_zero_spot_rejected(self):
        raw = _load_fixture()
        raw["gex"]["global"]["spot"] = 0.0
        dto = parse_gex_response(raw)
        with pytest.raises(GexMappingError, match="positive"):
            map_to_gex_facts(dto, requested_symbol="SPY")

    def test_negative_spot_rejected(self):
        raw = _load_fixture()
        raw["gex"]["global"]["spot"] = -10.0
        dto = parse_gex_response(raw)
        with pytest.raises(GexMappingError, match="positive"):
            map_to_gex_facts(dto, requested_symbol="SPY")

    def test_nan_in_optional_field_rejected(self):
        raw = _load_fixture()
        raw["gex"]["global"]["gammaZeroLevel"] = float("nan")
        dto = parse_gex_response(raw)
        with pytest.raises(GexMappingError, match="not finite"):
            map_to_gex_facts(dto, requested_symbol="SPY")

    def test_no_gex_recalculation(self):
        """Mapper must NOT recalculate netGex from callGex + putGex.
        It takes the value GaleCore provides as-is."""
        raw = _load_fixture()
        # Set netGex to a value that != callGex + putGex
        raw["gex"]["global"]["netGex"] = 42.0
        dto = parse_gex_response(raw)
        facts = map_to_gex_facts(dto, requested_symbol="SPY", max_staleness_seconds=999999)
        assert facts.net_gex == 42.0  # NOT recalculated


class TestFreshnessPolicy:
    def test_valid_freshness(self):
        raw = _load_fixture()
        # Set timestamp to now
        raw["timestamp"] = datetime.now(tz=UTC).isoformat()
        dto = parse_gex_response(raw)
        facts = map_to_gex_facts(dto, requested_symbol="SPY", max_staleness_seconds=300)
        assert facts.freshness_status == FreshnessStatus.VALID

    def test_stale_freshness(self):
        raw = _load_fixture()
        raw["timestamp"] = "2020-01-01T00:00:00"
        dto = parse_gex_response(raw)
        facts = map_to_gex_facts(dto, requested_symbol="SPY", max_staleness_seconds=300)
        assert facts.freshness_status == FreshnessStatus.STALE

    def test_unknown_freshness_when_no_timestamp(self):
        raw = _load_fixture()
        raw["timestamp"] = None
        dto = parse_gex_response(raw)
        facts = map_to_gex_facts(dto, requested_symbol="SPY")
        assert facts.freshness_status == FreshnessStatus.UNKNOWN
        assert facts.market_data_as_of is None

    def test_response_received_at_always_set(self):
        raw = _load_fixture()
        dto = parse_gex_response(raw)
        facts = map_to_gex_facts(dto, requested_symbol="SPY", max_staleness_seconds=999999)
        assert facts.response_received_at is not None

    def test_freshness_distinguishes_valid_from_stale(self):
        """Valid timestamp within staleness window → VALID."""
        raw = _load_fixture()
        raw["timestamp"] = datetime.now(tz=UTC).isoformat()
        dto = parse_gex_response(raw)

        facts_valid = map_to_gex_facts(dto, requested_symbol="SPY", max_staleness_seconds=300)
        assert facts_valid.freshness_status == FreshnessStatus.VALID

        facts_strict = map_to_gex_facts(dto, requested_symbol="SPY", max_staleness_seconds=0)
        # With 0 seconds staleness, even a just-now timestamp is borderline
        assert facts_strict.freshness_status in (FreshnessStatus.VALID, FreshnessStatus.STALE)
