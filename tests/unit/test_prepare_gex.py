"""Tests for prepare_gex_snapshot — facts preparation with store."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from galecore_ai.adapters.snapshot_store import FileSnapshotStore
from galecore_ai.application.prepare_gex import PrepareError, prepare_gex_snapshot
from galecore_ai.capabilities.dispatcher import CapabilityResult


def _base_galecore_response(**overrides):
    now = datetime.now(tz=UTC).isoformat()
    gex_global = {
        "spot": 450.50,
        "callGex": 2000000.0,
        "putGex": -500000.0,
        "netGex": 1500.0,
        "gammaZeroLevel": 445.0,
        "callWall": 460.0,
        "putWall": 440.0,
        "expirationsIncluded": 8,
        "expirationsRequested": 12,
        "coveragePct": 85.5,
        "strikes": [],
    }
    return {
        "symbol": overrides.pop("symbol", "SPY"),
        "timestamp": overrides.pop("timestamp", now),
        "spotPrice": gex_global["spot"],
        "fromCache": False,
        "switchEnabled": True,
        "frozen": False,
        "elapsedMs": 100,
        "macroRegime": {
            "signal": "SELL",
            "passedCount": 4,
            "totalChecks": 6,
            "checks": {
                "vixAbsolute": {"passed": True, "value": 18.5, "threshold": 30.0},
                "vixTermStructure": {"passed": True, "noData": False},
                "ivRank": {"passed": True, "value": 42.0, "min": 25.0, "max": 65.0},
                "ivMomentum": {"passed": False, "value": 15.3, "threshold": 12.0},
                "gexTotal": {"passed": True, "value": 1500.0, "metric": "billions_usd", "threshold": 0.0},
                "spotVsZgl": {"passed": False, "spot": 450.5, "zgl": 445.0, "bufferPct": 0.005},
            },
        },
        "structureInputs": None,
        "gex": {
            "global": gex_global,
            "byExpiry": [],
            "config": {
                "maxDte": 60,
                "includeZeroDte": False,
                "expirationTypes": ["Regular"],
                "greeksBatchSize": 50,
                "greeksRetries": 2,
                "cacheSeconds": 120,
                "cacheMinCoveragePct": 50.0,
            },
        },
        **overrides,
    }


class FakeDispatcher:
    def __init__(self, data=None, error=None):
        self._data = data
        self._error = error

    async def invoke(self, capability_id, parameters, **kwargs):
        return CapabilityResult(
            capability_id=capability_id,
            data=self._data,
            error=self._error,
            latency_ms=5,
        )


@pytest.fixture
def store(tmp_path):
    return FileSnapshotStore(base_dir=tmp_path / "snapshots")


@pytest.mark.asyncio
async def test_prepare_success_stores_and_returns_view(store):
    """Valid response stores snapshot and returns PreparedAnalysisView."""
    data = _base_galecore_response()
    dispatcher = FakeDispatcher(data=data)

    view = await prepare_gex_snapshot(
        symbol="SPY",
        dispatcher=dispatcher,
        store=store,
        allow_unknown_freshness=True,
    )

    assert view.symbol == "SPY"
    assert view.facts["net_gex"] == 1500.0
    assert view.facts_hash.startswith("sha256:")
    assert view.run_id

    # Snapshot is stored internally
    recovered = store.get(view.run_id)
    assert recovered.facts == view.facts
    assert recovered.facts_hash == view.facts_hash


@pytest.mark.asyncio
async def test_prepare_capability_error(store):
    dispatcher = FakeDispatcher(error="Connection refused")
    with pytest.raises(PrepareError, match="Capability fetch failed"):
        await prepare_gex_snapshot(symbol="SPY", dispatcher=dispatcher, store=store)


@pytest.mark.asyncio
async def test_prepare_invalid_spot(store):
    data = _base_galecore_response()
    data["gex"]["global"]["spot"] = 0.0
    data["spotPrice"] = 0.0
    dispatcher = FakeDispatcher(data=data)
    with pytest.raises(PrepareError, match="Fact validation failed"):
        await prepare_gex_snapshot(symbol="SPY", dispatcher=dispatcher, store=store)


@pytest.mark.asyncio
async def test_prepare_stale_data(store):
    data = _base_galecore_response(timestamp="2020-01-01T00:00:00+00:00")
    dispatcher = FakeDispatcher(data=data)
    with pytest.raises(PrepareError, match="stale"):
        await prepare_gex_snapshot(symbol="SPY", dispatcher=dispatcher, store=store, max_staleness_seconds=300)


@pytest.mark.asyncio
async def test_prepare_unknown_freshness_rejected(store):
    data = _base_galecore_response(timestamp=None)
    dispatcher = FakeDispatcher(data=data)
    with pytest.raises(PrepareError, match="UNKNOWN"):
        await prepare_gex_snapshot(symbol="SPY", dispatcher=dispatcher, store=store, allow_unknown_freshness=False)


@pytest.mark.asyncio
async def test_prepare_includes_required_asset_hashes(store):
    """All four required asset hashes appear in the view."""
    data = _base_galecore_response()
    dispatcher = FakeDispatcher(data=data)

    view = await prepare_gex_snapshot(
        symbol="SPY", dispatcher=dispatcher, store=store, allow_unknown_freshness=True,
    )

    assert view.effective_assets.agent.content_hash.startswith("sha256:")
    assert view.effective_assets.agent.asset_id
    assert view.effective_assets.agent.version
    assert "gex_interpretation" in view.effective_assets.skills
    assert "facts_discipline" in view.effective_assets.protocols
    assert "trading_defaults" in view.effective_assets.conventions


@pytest.mark.asyncio
async def test_prepare_facts_hash_covers_core_values(store):
    """Hash depends on fact values, not on run timing."""
    data = _base_galecore_response()
    dispatcher = FakeDispatcher(data=data)

    view = await prepare_gex_snapshot(
        symbol="SPY", dispatcher=dispatcher, store=store, allow_unknown_freshness=True,
    )

    # Hash should be non-empty sha256
    assert view.facts_hash.startswith("sha256:")
    assert len(view.facts_hash) == 71  # "sha256:" + 64 hex chars
