import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from galecore_ai.capabilities.gex_mapper import (
    GexMappingError,
    map_to_gex_facts,
    parse_gex_response,
)
from galecore_ai.harness.freshness import freshness_error


def test_freshness_rejects_future_and_expired_timestamps():
    now = datetime.now(UTC)
    assert freshness_error(now + timedelta(seconds=60), max_age_seconds=300, now=now)
    assert freshness_error(now - timedelta(seconds=301), max_age_seconds=300, now=now)
    assert freshness_error(now, max_age_seconds=300, now=now) is None


def test_mapper_rejects_future_market_data():
    raw = json.loads((Path(__file__).parent.parent / "fixtures" / "galecore" / "gex_analysis_spy.json").read_text())
    raw["timestamp"] = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    with pytest.raises(GexMappingError, match="future"):
        map_to_gex_facts(parse_gex_response(raw), requested_symbol="SPY")

