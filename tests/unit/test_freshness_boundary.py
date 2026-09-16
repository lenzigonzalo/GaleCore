from datetime import UTC, datetime, timedelta

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
    from tests.unit.test_gex_runner import _load_fixture

    raw = _load_fixture()
    raw["timestamp"] = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    with pytest.raises(GexMappingError, match="future"):
        map_to_gex_facts(parse_gex_response(raw), requested_symbol="SPY")


@pytest.mark.asyncio
async def test_data_expiring_during_generation_cannot_succeed(monkeypatch):
    from galecore_ai.application import analyze_gex
    from galecore_ai.contracts.agent_run import AgentRunResult, RunStatus
    from tests.unit.test_gex_runner import _agent, _load_fixture, _mock_use_case

    now = datetime.now(UTC)
    raw = _load_fixture()
    raw["timestamp"] = now.isoformat()
    use_case = _mock_use_case(raw, allow_unknown_freshness=False)

    class LaterClock:
        @staticmethod
        def now(tz):
            return now + timedelta(seconds=301)

    async def delayed_success(request, **kwargs):
        monkeypatch.setattr(analyze_gex, "datetime", LaterClock)
        return AgentRunResult(run_id=request.run_id, status=RunStatus.SUCCESS, result={"ok": True})

    monkeypatch.setattr(use_case._runtime, "execute", delayed_success)
    result = await use_case.run(symbol="SPY", agent_definition=_agent())
    assert result.status == RunStatus.INSUFFICIENT_DATA
    assert result.result is None
    assert result.trace.freshness.freshness_status == "STALE"
