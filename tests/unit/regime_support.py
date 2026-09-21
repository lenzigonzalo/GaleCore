"""Shared builders for the regime (Phase 4) tests. Not a test module."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from galecore_ai.capabilities.dispatcher import CapabilityResult
from galecore_ai.contracts.agent_run import CapabilityTrace
from galecore_ai.contracts.prepared_analysis import (
    AssetEntry,
    AssetManifest,
    StoredPreparedSnapshot,
    compute_conventions_hash,
    compute_facts_hash,
    seal_snapshot,
)
from galecore_ai.contracts.regime_analysis import REGIME_SKILL_ID

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "galecore"
CONVENTIONS = {"gex_near_zero_threshold_pct": 5.0, "timezone": "America/New_York"}


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def gex_payload(*, net_gex: float = -1473.4, spot: float = 757.43, timestamp: datetime | None = None) -> dict:
    data = load_fixture("gex_analysis_spy.json")
    data["timestamp"] = (timestamp or datetime.now(UTC)).isoformat()
    data["gex"]["global"]["netGex"] = net_gex
    data["gex"]["global"]["spot"] = spot
    data["spotPrice"] = spot
    return data


def trade_payload(symbol: str, *, price: float, at: datetime | None = None) -> dict:
    data = load_fixture("trade_vix.json")
    ev = data["data"][0]
    ev["eventSymbol"] = symbol
    ev["price"] = price
    ev["time"] = int((at or datetime.now(UTC)).timestamp() * 1000)
    return data


def put_skew_payload(*, level_ok: bool = True, ratio: float = 1.1951) -> dict:
    data = load_fixture("put_skew_spy.json")
    data["levelOk"] = level_ok
    data["putSkew25d"] = ratio
    return data


class RegimeFakeDispatcher:
    """Routes by (capability_id, symbol); records what was invoked."""

    def __init__(self, *, responses: dict[tuple[str, str], dict | None] | None = None,
                 errors: dict[tuple[str, str], str] | None = None) -> None:
        now = datetime.now(UTC)
        self.responses = responses if responses is not None else {
            ("compute.gex_analysis", "SPY"): gex_payload(timestamp=now),
            ("compute.put_skew", "SPY"): put_skew_payload(),
            ("market_data.trade", "VIX"): trade_payload("VIX", price=17.71, at=now),
            ("market_data.trade", "VVIX"): trade_payload("VVIX", price=95.41, at=now),
        }
        self.errors = errors or {}
        self.calls: list[tuple[str, str]] = []

    async def invoke(self, capability_id, parameters, **kwargs):
        key = (capability_id, parameters["symbol"])
        self.calls.append(key)
        if key in self.errors:
            return CapabilityResult(capability_id, error=self.errors[key], latency_ms=3)
        return CapabilityResult(capability_id, data=self.responses.get(key), latency_ms=3)


def stale(seconds: float) -> datetime:
    return datetime.now(UTC) - timedelta(seconds=seconds)


def regime_facts(**overrides) -> dict:
    now = datetime.now(UTC)
    src = {
        "capability_id": "x", "endpoint": "/x", "provenance": "GALECORE_VERIFIED",
        "freshness_basis": "galecore_timestamp", "freshness_status": "VALID",
        "response_received_at": now.isoformat(), "market_data_as_of": now.isoformat(),
    }
    facts = {
        "symbol": "SPY",
        "net_gex": -1473.4, "call_gex": 2000000.0, "put_gex": -500000.0, "spot": 757.43,
        "zero_gamma_level": 745.0, "call_wall": 760.0, "put_wall": 740.0, "coverage_pct": 97.5,
        "put_skew_ratio": 1.1951, "atm_iv": 0.1435, "put_wing_iv": 0.1715,
        "put_skew_dte": 30, "put_skew_expiration": "2026-10-16",
        "put_skew_level_ok": True, "put_skew_level_threshold": 1.3,
        "vix": 17.71, "vvix": 95.41,
        "market_data_as_of": now.isoformat(), "freshness_status": "VALID",
        "sources": {"gex": dict(src), "put_skew": dict(src), "vix": dict(src), "vvix": dict(src)},
    }
    facts.update(overrides)
    return facts


def test_manifest(skill_id: str = REGIME_SKILL_ID) -> AssetManifest:
    h = "sha256:" + "a" * 64
    return AssetManifest(
        agent=AssetEntry(asset_id="TradingAgent", version="1.1.0", content_hash=h),
        skills={skill_id: AssetEntry(asset_id=skill_id, version="1.0.0", content_hash=h)},
        protocols={"facts_discipline": AssetEntry(asset_id="facts_discipline", version="1.2.0", content_hash=h)},
        conventions={"trading_defaults": AssetEntry(asset_id="trading_defaults", version="1.0.0", content_hash=h)},
    )


def regime_snapshot(*, facts: dict | None = None, skill_id: str = REGIME_SKILL_ID,
                    prepared_at: datetime | None = None) -> StoredPreparedSnapshot:
    facts = facts or regime_facts()
    ts = datetime.fromisoformat(facts["market_data_as_of"])
    traces = [
        CapabilityTrace(capability_id=c, endpoint=e, outcome="ok", latency_ms=3)
        for c, e in (
            ("compute.gex_analysis", "/App/Gex/Analysis"),
            ("compute.put_skew", "/App.Analytics/PutSkew"),
            ("market_data.trade", "/Data/Tastytrade/MarketData/Trade"),
            ("market_data.trade", "/Data/Tastytrade/MarketData/Trade"),
        )
    ]
    kwargs = {}
    if prepared_at is not None:
        kwargs["prepared_at"] = prepared_at
    return seal_snapshot(StoredPreparedSnapshot(
        symbol="SPY",
        skill_id=skill_id,
        facts=facts,
        facts_hash=compute_facts_hash(facts),
        market_data_as_of=ts,
        freshness_status=facts["freshness_status"],
        freshness_max_age_seconds=300.0,
        capability_trace=traces[0],
        capability_traces=traces,
        effective_assets=test_manifest(skill_id),
        resolved_conventions=CONVENTIONS,
        conventions_hash=compute_conventions_hash(CONVENTIONS),
        **kwargs,
    ))


def valid_regime_interpretation(**overrides) -> dict:
    data = {
        "gamma_regime": "negative_gamma",
        "tail_pricing": "calm",
        "observations": ["Dealers are short gamma and the skew sits in the calm zone"],
        "implications": ["Moves may be amplified while protection stays cheap"],
        "quantitative_claims": [
            {"metric": "net_gex", "value": -1473.4, "unit": "billion_usd"},
            {"metric": "put_skew_ratio", "value": 1.1951, "unit": "ratio"},
            {"metric": "vix", "value": 17.71, "unit": "index_points"},
        ],
        "evidence": [
            {"fact_path": "facts.net_gex", "claim": "Net GEX is negative"},
            {"fact_path": "facts.put_skew_level_ok", "claim": "Skew semaphore is calm"},
        ],
        "limitations": ["Skew carries no GaleCore timestamp"],
    }
    data.update(overrides)
    return data
