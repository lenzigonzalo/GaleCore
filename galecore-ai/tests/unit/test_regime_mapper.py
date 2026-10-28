"""Regime mapper: real GaleCore shapes, per-source freshness, fail-closed on bad sources."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from galecore_ai.capabilities.gex_mapper import (
    GexMappingError,
    map_to_gex_facts,
    parse_gex_response,
)
from galecore_ai.capabilities.regime_mapper import (
    map_to_regime_facts,
    parse_put_skew_response,
    parse_trade_response,
    trade_print,
)
from galecore_ai.contracts.gex_analysis import FreshnessStatus
from tests.unit.regime_support import (
    gex_payload,
    load_fixture,
    put_skew_payload,
    stale,
    trade_payload,
)

NOW = datetime.now(UTC)
RECEIVED = {k: NOW for k in ("gex", "put_skew", "vix", "vvix")}


def _gex(**kw):
    return map_to_gex_facts(parse_gex_response(gex_payload(**kw)), requested_symbol="SPY",
                            max_staleness_seconds=600)


def _map(**kw):
    args = {
        "gex": _gex(),
        "put_skew": parse_put_skew_response(put_skew_payload()),
        "vix": parse_trade_response(trade_payload("VIX", price=17.71)),
        "vvix": parse_trade_response(trade_payload("VVIX", price=95.41)),
        "requested_symbol": "SPY",
        "received_at": RECEIVED,
        "max_staleness_seconds": 600,
    }
    args.update(kw)
    return map_to_regime_facts(**args)


class TestRealShapes:
    def test_put_skew_fixture_parses(self):
        dto = parse_put_skew_response(load_fixture("put_skew_spy.json"))
        assert dto.symbol == "SPY"
        assert dto.put_skew_25d is not None and dto.level_ok is not None
        assert dto.roc5d is None  # GaleCore has no IV history yet

    def test_trade_fixture_with_nan_strings_parses(self):
        raw = load_fixture("trade_vix.json")
        assert raw["data"][0]["size"] == "NaN"  # GaleCore serializes absent numerics as strings
        price, ts = trade_print(parse_trade_response(raw), expected_symbol="VIX")
        assert price > 0 and ts.tzinfo is not None

    def test_facts_carry_every_source_unchanged(self):
        facts = _map()
        assert facts.net_gex == -1473.4 and facts.spot == 757.43
        assert facts.put_skew_ratio == 1.1951 and facts.put_skew_level_ok is True
        assert facts.vix == 17.71 and facts.vvix == 95.41
        assert set(facts.sources) == {"gex", "put_skew", "vix", "vvix"}
        assert all(s.provenance == "GALECORE_VERIFIED" for s in facts.sources.values())

    def test_metric_fact_names_have_no_digits(self):
        """The no_invented_numbers guardrail scans serialized keys; digits would read as claims."""
        facts = _map().model_dump(mode="json", exclude_none=True)
        assert not any(ch.isdigit() for key in facts if key != "sources" for ch in key)


class TestFreshness:
    def test_put_skew_has_no_timestamp_so_snapshot_is_unknown(self):
        facts = _map()
        assert facts.sources["put_skew"].freshness_status == FreshnessStatus.UNKNOWN
        assert facts.sources["put_skew"].freshness_basis.value == "none"
        assert facts.sources["vix"].freshness_status == FreshnessStatus.VALID
        assert facts.freshness_status == FreshnessStatus.UNKNOWN

    def test_stale_index_print_marks_source_and_snapshot_stale(self):
        facts = _map(vix=parse_trade_response(trade_payload("VIX", price=17.71, at=stale(3600))))
        assert facts.sources["vix"].freshness_status == FreshnessStatus.STALE
        assert facts.freshness_status == FreshnessStatus.STALE

    def test_snapshot_timestamp_is_oldest_declared(self):
        old = stale(120)
        facts = _map(vvix=parse_trade_response(trade_payload("VVIX", price=95.41, at=old)))
        assert facts.market_data_as_of is not None
        assert abs((facts.market_data_as_of - old).total_seconds()) < 1

    def test_future_print_is_rejected(self):
        future = datetime.now(UTC).replace(year=NOW.year + 1)
        with pytest.raises(GexMappingError):
            _map(vix=parse_trade_response(trade_payload("VIX", price=17.71, at=future)))


class TestFailClosed:
    def test_wrong_index_symbol_rejected(self):
        with pytest.raises(GexMappingError, match="expected symbol VIX"):
            _map(vix=parse_trade_response(trade_payload("VIX9D", price=17.0)))

    def test_empty_trade_events_rejected(self):
        raw = trade_payload("VIX", price=17.71)
        raw["data"] = []
        with pytest.raises(GexMappingError, match="no events"):
            _map(vix=parse_trade_response(raw))

    @pytest.mark.parametrize("price", [0.0, -1.0, float("nan")])
    def test_non_positive_print_rejected(self, price):
        with pytest.raises(GexMappingError):
            _map(vix=parse_trade_response(trade_payload("VIX", price=price)))

    def test_null_skew_rejected(self):
        raw = put_skew_payload()
        raw["putSkew25d"] = None
        with pytest.raises(GexMappingError, match="null"):
            _map(put_skew=parse_put_skew_response(raw))

    def test_null_level_ok_rejected(self):
        raw = put_skew_payload()
        raw["levelOk"] = None
        with pytest.raises(GexMappingError, match="null"):
            _map(put_skew=parse_put_skew_response(raw))

    def test_skew_symbol_mismatch_rejected(self):
        raw = put_skew_payload()
        raw["symbol"] = "QQQ"
        with pytest.raises(GexMappingError, match="symbol mismatch"):
            _map(put_skew=parse_put_skew_response(raw))

    def test_non_dict_payloads_rejected(self):
        with pytest.raises(GexMappingError):
            parse_put_skew_response([1, 2])
        with pytest.raises(GexMappingError):
            parse_trade_response(None)
