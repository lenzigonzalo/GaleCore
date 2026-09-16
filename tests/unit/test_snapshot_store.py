"""Tests for FileSnapshotStore — path traversal, TTL, missing run_id."""

from __future__ import annotations

import time
from datetime import UTC, datetime

import pytest

from galecore_ai.adapters.snapshot_store import FileSnapshotStore, SnapshotNotFoundError
from galecore_ai.contracts.agent_run import CapabilityTrace
from galecore_ai.contracts.prepared_analysis import (
    AssetEntry,
    AssetManifest,
    StoredPreparedSnapshot,
    compute_conventions_hash,
    compute_facts_hash,
)


def _dummy_manifest() -> AssetManifest:
    h = "sha256:" + "a" * 64
    e = AssetEntry(asset_id="test", version="1.0.0", content_hash=h)
    return AssetManifest(
        agent=e,
        skills={"s": e},
        protocols={"p": e},
        conventions={"c": e},
    )


def _dummy_snapshot(**overrides) -> StoredPreparedSnapshot:
    facts = {"symbol": "SPY", "net_gex": 1500.0, "spot": 450.5}
    return StoredPreparedSnapshot(
        symbol="SPY",
        facts=facts,
        facts_hash=compute_facts_hash(facts),
        market_data_as_of=datetime.now(UTC),
        freshness_status="VALID",
        freshness_max_age_seconds=300.0,
        capability_trace=CapabilityTrace(capability_id="test", outcome="ok", latency_ms=1),
        effective_assets=_dummy_manifest(),
        resolved_conventions={"timezone": "America/New_York"},
        conventions_hash=compute_conventions_hash({"timezone": "America/New_York"}),
        **overrides,
    )


@pytest.fixture
def store(tmp_path):
    return FileSnapshotStore(base_dir=tmp_path / "snapshots")


class TestSaveAndGet:
    def test_roundtrip(self, store):
        snap = _dummy_snapshot()
        store.save(snap)
        recovered = store.get(snap.run_id)
        assert recovered.run_id == snap.run_id
        assert recovered.facts == snap.facts
        assert recovered.facts_hash == snap.facts_hash

    def test_delete(self, store):
        snap = _dummy_snapshot()
        store.save(snap)
        assert store.delete(snap.run_id)
        with pytest.raises(SnapshotNotFoundError):
            store.get(snap.run_id)


class TestMissingRunId:
    def test_nonexistent(self, store):
        with pytest.raises(SnapshotNotFoundError, match="not found"):
            store.get("01a0a7bc-0fc3-7a41-9fcf-73ec491249c3")

    def test_invalid_format(self, store):
        with pytest.raises(SnapshotNotFoundError, match="Invalid run_id"):
            store.get("not-a-uuid")

    def test_empty(self, store):
        with pytest.raises(SnapshotNotFoundError, match="Invalid run_id"):
            store.get("")


class TestPathTraversal:
    def test_dotdot_rejected(self, store):
        with pytest.raises(SnapshotNotFoundError, match="Invalid run_id"):
            store.get("../../etc/passwd")

    def test_slash_rejected(self, store):
        with pytest.raises(SnapshotNotFoundError, match="Invalid run_id"):
            store.get("foo/bar")


class TestTTLValidation:
    def test_zero_ttl_rejected(self, tmp_path):
        with pytest.raises(ValueError, match="finite and > 0"):
            FileSnapshotStore(base_dir=tmp_path / "snap", ttl_seconds=0)

    def test_negative_ttl_rejected(self, tmp_path):
        with pytest.raises(ValueError, match="finite and > 0"):
            FileSnapshotStore(base_dir=tmp_path / "snap", ttl_seconds=-1)

    def test_infinite_ttl_rejected(self, tmp_path):
        with pytest.raises(ValueError, match="finite and > 0"):
            FileSnapshotStore(base_dir=tmp_path / "snap", ttl_seconds=float("inf"))

    def test_nan_ttl_rejected(self, tmp_path):
        with pytest.raises(ValueError, match="finite and > 0"):
            FileSnapshotStore(base_dir=tmp_path / "snap", ttl_seconds=float("nan"))


class TestCorruptSnapshot:
    def test_corrupt_file_fails_closed(self, tmp_path):
        """Corrupt JSON on disk produces SnapshotNotFoundError, not a crash."""
        store = FileSnapshotStore(base_dir=tmp_path / "snap")
        snap = _dummy_snapshot()
        store.save(snap)
        # Corrupt the file
        path = (tmp_path / "snap" / f"{snap.run_id}.json")
        path.write_text("NOT VALID JSON", encoding="utf-8")
        with pytest.raises(SnapshotNotFoundError, match="Corrupt"):
            store.get(snap.run_id)
        # File should be removed
        assert not path.exists()

    def test_empty_file_fails_closed(self, tmp_path):
        store = FileSnapshotStore(base_dir=tmp_path / "snap")
        snap = _dummy_snapshot()
        store.save(snap)
        path = (tmp_path / "snap" / f"{snap.run_id}.json")
        path.write_text("", encoding="utf-8")
        with pytest.raises(SnapshotNotFoundError, match="Corrupt"):
            store.get(snap.run_id)


class TestTTL:
    def test_expired_snapshot_rejected(self, tmp_path):
        store = FileSnapshotStore(base_dir=tmp_path / "snap", ttl_seconds=1)
        snap = _dummy_snapshot()
        store.save(snap)
        time.sleep(1.5)  # wait for TTL
        with pytest.raises(SnapshotNotFoundError, match="expired"):
            store.get(snap.run_id)

    def test_expire_stale_removes_old(self, tmp_path):
        store = FileSnapshotStore(base_dir=tmp_path / "snap", ttl_seconds=1)
        snap = _dummy_snapshot()
        store.save(snap)
        time.sleep(1.5)
        removed = store.expire_stale()
        assert removed >= 1
