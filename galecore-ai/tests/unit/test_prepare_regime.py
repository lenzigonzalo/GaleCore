"""prepare_regime_snapshot: four fetches, one snapshot, no partial regime."""

from __future__ import annotations

import pytest

from galecore_ai.adapters.snapshot_store import FileSnapshotStore
from galecore_ai.application.prepare_gex import PrepareError
from galecore_ai.application.prepare_regime import fetch_regime_facts, prepare_regime_snapshot
from galecore_ai.contracts.regime_analysis import REGIME_SKILL_ID
from tests.unit.regime_support import RegimeFakeDispatcher, stale, trade_payload


@pytest.fixture
def store(tmp_path):
    return FileSnapshotStore(base_dir=tmp_path / "snapshots")


async def _prepare(store, dispatcher, **kw):
    args = {"symbol": "SPY", "dispatcher": dispatcher, "store": store,
            "max_staleness_seconds": 600, "allow_unknown_freshness": True}
    args.update(kw)
    return await prepare_regime_snapshot(**args)


class TestSuccess:
    async def test_view_and_snapshot_identify_the_regime_skill(self, store):
        dispatcher = RegimeFakeDispatcher()
        view = await _prepare(store, dispatcher)

        assert view.skill_id == REGIME_SKILL_ID
        assert set(dispatcher.calls) == {
            ("compute.gex_analysis", "SPY"), ("compute.put_skew", "SPY"),
            ("market_data.trade", "VIX"), ("market_data.trade", "VVIX"),
        }
        snapshot = store.get(view.run_id)
        assert snapshot.skill_id == REGIME_SKILL_ID
        assert [t.capability_id for t in snapshot.capability_traces] == [
            "compute.gex_analysis", "compute.put_skew", "market_data.trade", "market_data.trade",
        ]
        assert snapshot.capability_trace == snapshot.capability_traces[0]
        assert list(snapshot.effective_assets.skills) == [REGIME_SKILL_ID]
        assert snapshot.facts["put_skew_level_ok"] is True
        assert snapshot.facts["vix"] == 17.71

    async def test_view_freshness_is_unknown_because_skew_has_no_timestamp(self, store):
        view = await _prepare(store, RegimeFakeDispatcher())
        assert view.freshness_status == "UNKNOWN"
        assert view.facts["sources"]["put_skew"]["freshness_status"] == "UNKNOWN"


class TestFailClosed:
    async def test_one_failing_source_aborts_without_storing(self, store, tmp_path):
        dispatcher = RegimeFakeDispatcher(errors={("compute.put_skew", "SPY"): "HTTP 500: boom"})
        with pytest.raises(PrepareError, match="put_skew: HTTP 500"):
            await _prepare(store, dispatcher)
        assert not list((tmp_path / "snapshots").glob("*.json"))

    async def test_missing_index_payload_aborts(self, store):
        dispatcher = RegimeFakeDispatcher()
        dispatcher.responses[("market_data.trade", "VVIX")] = None
        with pytest.raises(PrepareError, match="vvix"):
            await _prepare(store, dispatcher)

    async def test_stale_source_aborts(self, store):
        dispatcher = RegimeFakeDispatcher()
        dispatcher.responses[("market_data.trade", "VIX")] = trade_payload("VIX", price=17.71, at=stale(3600))
        with pytest.raises(PrepareError, match=r"stale for source\(s\) \['vix'\]"):
            await _prepare(store, dispatcher)

    async def test_unknown_freshness_rejected_unless_allowed(self, store):
        with pytest.raises(PrepareError, match="UNKNOWN for source\\(s\\) \\['put_skew'\\]"):
            await _prepare(store, RegimeFakeDispatcher(), allow_unknown_freshness=False)

    async def test_malformed_skew_aborts(self, store):
        dispatcher = RegimeFakeDispatcher()
        dispatcher.responses[("compute.put_skew", "SPY")]["putSkew25d"] = None
        with pytest.raises(PrepareError, match="Fact validation failed"):
            await _prepare(store, dispatcher)

    async def test_missing_regime_skill_asset_aborts(self, store, monkeypatch, tmp_path):
        from galecore_ai.harness import assets

        monkeypatch.setattr(assets, "asset_root", lambda: tmp_path / "no-assets")
        with pytest.raises(PrepareError, match="Required asset missing"):
            await _prepare(store, RegimeFakeDispatcher())


class TestFetchForOutcome:
    async def test_fetch_returns_facts_and_four_traces(self):
        fetched = await fetch_regime_facts(symbol="SPY", dispatcher=RegimeFakeDispatcher(),
                                           max_staleness_seconds=600)
        assert fetched.facts.symbol == "SPY"
        assert len(fetched.traces) == 4 and all(t.outcome == "ok" for t in fetched.traces)
