"""Tests for prepare_gex_snapshot — facts preparation without model invocation."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from galecore_ai.application.prepare_gex import PrepareError, prepare_gex_snapshot
from galecore_ai.capabilities.dispatcher import CapabilityResult
from galecore_ai.contracts.prepared_analysis import AssetManifest


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


@pytest.mark.asyncio
async def test_prepare_success():
    """Valid GaleCore response produces a snapshot with facts and hash."""
    data = _base_galecore_response()
    dispatcher = FakeDispatcher(data=data)

    snapshot = await prepare_gex_snapshot(
        symbol="SPY",
        dispatcher=dispatcher,
        allow_unknown_freshness=True,
    )

    assert snapshot.symbol == "SPY"
    assert snapshot.facts["net_gex"] == 1500.0
    assert snapshot.facts["spot"] == 450.5
    assert snapshot.facts_hash.startswith("sha256:")
    assert snapshot.run_id  # non-empty


@pytest.mark.asyncio
async def test_prepare_capability_error():
    """Dispatcher error raises PrepareError."""
    dispatcher = FakeDispatcher(error="Connection refused")

    with pytest.raises(PrepareError, match="Capability fetch failed"):
        await prepare_gex_snapshot(symbol="SPY", dispatcher=dispatcher)


@pytest.mark.asyncio
async def test_prepare_invalid_spot():
    """Zero spot price raises PrepareError."""
    data = _base_galecore_response()
    data["gex"]["global"]["spot"] = 0.0
    data["spotPrice"] = 0.0
    dispatcher = FakeDispatcher(data=data)

    with pytest.raises(PrepareError, match="Fact validation failed"):
        await prepare_gex_snapshot(symbol="SPY", dispatcher=dispatcher)


@pytest.mark.asyncio
async def test_prepare_stale_data():
    """Old timestamp raises PrepareError."""
    data = _base_galecore_response(timestamp="2020-01-01T00:00:00+00:00")
    dispatcher = FakeDispatcher(data=data)

    with pytest.raises(PrepareError, match="stale"):
        await prepare_gex_snapshot(
            symbol="SPY",
            dispatcher=dispatcher,
            max_staleness_seconds=300,
        )


@pytest.mark.asyncio
async def test_prepare_unknown_freshness_rejected():
    """Unknown freshness rejected when allow_unknown_freshness=False."""
    data = _base_galecore_response(timestamp=None)
    dispatcher = FakeDispatcher(data=data)

    with pytest.raises(PrepareError, match="UNKNOWN"):
        await prepare_gex_snapshot(
            symbol="SPY",
            dispatcher=dispatcher,
            allow_unknown_freshness=False,
        )


@pytest.mark.asyncio
async def test_prepare_preserves_asset_manifest():
    """Asset manifest is included in the snapshot."""
    data = _base_galecore_response()
    dispatcher = FakeDispatcher(data=data)
    manifest = AssetManifest(agent_hash="sha256:abc123")

    snapshot = await prepare_gex_snapshot(
        symbol="SPY",
        dispatcher=dispatcher,
        allow_unknown_freshness=True,
        effective_assets=manifest,
    )

    assert snapshot.effective_assets.agent_hash == "sha256:abc123"


@pytest.mark.asyncio
async def test_prepare_facts_hash_deterministic():
    """Same facts produce the same hash."""
    data = _base_galecore_response()
    d1 = FakeDispatcher(data=data)
    d2 = FakeDispatcher(data=data)

    s1 = await prepare_gex_snapshot(symbol="SPY", dispatcher=d1, allow_unknown_freshness=True)
    s2 = await prepare_gex_snapshot(symbol="SPY", dispatcher=d2, allow_unknown_freshness=True)

    assert s1.facts_hash == s2.facts_hash
