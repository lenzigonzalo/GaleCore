"""Single load of the required assets: manifest hash, resolved values and
conventions_hash must come from the same YAML read."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from pydantic import ValidationError

from galecore_ai.adapters import asset_manifest
from galecore_ai.adapters.asset_manifest import RequiredAssetError, load_required_assets
from galecore_ai.contracts.prepared_analysis import (
    PreparedAnalysisView,
    StoredPreparedSnapshot,
    compute_conventions_hash,
)
from galecore_ai.harness.definitions import ConventionSet


def test_convention_yaml_is_read_exactly_once():
    original = asset_manifest.load_asset
    convention_loads: list[str] = []

    def counting(rel_path, schema):
        if schema is ConventionSet:
            convention_loads.append(rel_path)
        return original(rel_path, schema)

    with patch.object(asset_manifest, "load_asset", counting):
        bundle = load_required_assets()

    assert convention_loads == ["conventions/trading-defaults.yaml"]
    assert bundle.manifest.conventions["trading_defaults"].content_hash.startswith("sha256:")
    assert bundle.resolved_conventions["gex_near_zero_threshold_pct"] == 5.0
    assert bundle.conventions_hash == compute_conventions_hash(bundle.resolved_conventions)


def test_bundle_values_match_the_canonical_yaml():
    """The resolved dict is exactly the entries of the file the manifest hashed."""
    bundle = load_required_assets()
    conv = asset_manifest.load_asset("conventions/trading-defaults.yaml", ConventionSet)
    assert bundle.resolved_conventions == {e.key: e.value for e in conv.entries}
    assert bundle.manifest.conventions["trading_defaults"].version == conv.version


def test_conventions_hash_is_deterministic_and_canonical():
    a = compute_conventions_hash({"b": 1, "a": "x"})
    b = compute_conventions_hash({"a": "x", "b": 1})
    assert a == b
    assert a.startswith("sha256:") and len(a) == len("sha256:") + 64
    assert compute_conventions_hash({"a": "x", "b": 2}) != a
    assert load_required_assets().conventions_hash == load_required_assets().conventions_hash


def test_missing_convention_asset_fails_closed():
    missing = asset_manifest.asset_root() / "missing"
    with patch.object(asset_manifest, "asset_root", lambda: missing), pytest.raises(RequiredAssetError):
        load_required_assets()


def test_bundle_is_frozen():
    bundle = load_required_assets()
    with pytest.raises(ValidationError):
        bundle.conventions_hash = "sha256:" + "0" * 64


def test_snapshot_requires_conventions_hash_and_values():
    from datetime import UTC, datetime

    from galecore_ai.contracts.agent_run import CapabilityTrace
    from galecore_ai.contracts.prepared_analysis import compute_facts_hash

    bundle = load_required_assets()
    facts = {"symbol": "SPY", "net_gex": 1500.0, "spot": 450.5}
    base = {
        "symbol": "SPY", "facts": facts, "facts_hash": compute_facts_hash(facts),
        "market_data_as_of": datetime.now(UTC), "freshness_status": "VALID",
        "freshness_max_age_seconds": 300.0,
        "capability_trace": CapabilityTrace(capability_id="t", outcome="ok", latency_ms=1),
        "effective_assets": bundle.manifest,
    }
    with pytest.raises(ValidationError):
        StoredPreparedSnapshot(**base, resolved_conventions=bundle.resolved_conventions)
    with pytest.raises(ValidationError):
        StoredPreparedSnapshot(**base, conventions_hash=bundle.conventions_hash)
    with pytest.raises(ValidationError):
        StoredPreparedSnapshot(
            **base, resolved_conventions=bundle.resolved_conventions, conventions_hash="sha1:abc",
        )
    snapshot = StoredPreparedSnapshot(
        **base, resolved_conventions=bundle.resolved_conventions, conventions_hash=bundle.conventions_hash,
    )
    assert snapshot.conventions_hash == bundle.conventions_hash
    assert "conventions_hash" in PreparedAnalysisView.model_fields
