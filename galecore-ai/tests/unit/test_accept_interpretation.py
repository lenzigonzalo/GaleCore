"""Tests for accept_gex_interpretation — store-based acceptance."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from galecore_ai.adapters.snapshot_store import FileSnapshotStore
from galecore_ai.application.accept_interpretation import accept_gex_interpretation
from galecore_ai.contracts.agent_run import CapabilityTrace, RunStatus
from galecore_ai.contracts.prepared_analysis import (
    AcceptanceRequest,
    AssetEntry,
    AssetManifest,
    Provenance,
    StoredPreparedSnapshot,
    compute_conventions_hash,
    compute_facts_hash,
    seal_snapshot,
)

CONVENTIONS = {"gex_near_zero_threshold_pct": 5.0, "timezone": "America/New_York"}


def _test_manifest() -> AssetManifest:
    h = "sha256:" + "a" * 64
    return AssetManifest(
        skills={"gex_interpretation": AssetEntry(asset_id="gex_interpretation", version="1.2.0", content_hash=h)},
        protocols={"facts_discipline": AssetEntry(asset_id="facts_discipline", version="1.1.0", content_hash=h)},
        conventions={"trading_defaults": AssetEntry(asset_id="trading_defaults", version="1.0.0", content_hash=h)},
    )


def _make_snapshot(
    *,
    net_gex: float = 1500.0,
    spot: float = 450.5,
    market_data_as_of: datetime | None = None,
    freshness_max_age: float = 300.0,
) -> StoredPreparedSnapshot:
    if market_data_as_of is None:
        market_data_as_of = datetime.now(UTC)
    facts = {
        "symbol": "SPY",
        "net_gex": net_gex,
        "call_gex": 2000000.0,
        "put_gex": -500000.0,
        "spot": spot,
        "freshness_status": "VALID",
        "market_data_as_of": market_data_as_of.isoformat(),
    }
    return seal_snapshot(StoredPreparedSnapshot(
        symbol="SPY",
        facts=facts,
        facts_hash=compute_facts_hash(facts),
        market_data_as_of=market_data_as_of,
        freshness_status="VALID",
        freshness_max_age_seconds=freshness_max_age,
        capability_trace=CapabilityTrace(
            capability_id="compute.gex_analysis",
            outcome="ok",
            latency_ms=5,
        ),
        effective_assets=_test_manifest(),
        resolved_conventions=CONVENTIONS,
        conventions_hash=compute_conventions_hash(CONVENTIONS),
    ))


def _valid_interpretation(net_gex: float = 1500.0, spot: float = 450.5) -> dict:
    return {
        "regime": "positive_gamma",
        "observations": ["Net GEX is positive, dealers are long gamma"],
        "implications": ["Mean reversion expected"],
        "quantitative_claims": [
            {"metric": "net_gex", "value": net_gex, "unit": "billion_usd"},
            {"metric": "spot", "value": spot, "unit": "usd"},
        ],
        "evidence": [
            {"fact_path": "facts.net_gex", "claim": "Net GEX is positive"},
            {"fact_path": "facts.spot", "claim": "Spot is above the zero-gamma level"},
        ],
        "limitations": ["Point-in-time snapshot"],
    }


def _write_raw(store: FileSnapshotStore, snapshot: StoredPreparedSnapshot, mutate) -> None:
    """Persist a snapshot after mutating its serialized form, bypassing the model."""
    import json

    data = json.loads(snapshot.model_dump_json())
    mutate(data)
    (store._base_dir / f"{snapshot.run_id}.json").write_text(json.dumps(data), encoding="utf-8")


@pytest.fixture
def store(tmp_path):
    return FileSnapshotStore(base_dir=tmp_path / "snapshots")


class TestAcceptSuccess:
    def test_valid_interpretation_accepted(self, store):
        snapshot = _make_snapshot()
        store.save(snapshot)
        request = AcceptanceRequest(
            run_id=snapshot.run_id,
            interpretation=_valid_interpretation(),
        )

        result = accept_gex_interpretation(
            store=store,
            request=request,
            allow_unknown_freshness=True,
        )

        assert result.status == RunStatus.SUCCESS
        assert result.result is not None
        assert result.result["regime"] == "positive_gamma"

    def test_trace_records_host_declared_provider(self, store):
        snapshot = _make_snapshot()
        store.save(snapshot)
        request = AcceptanceRequest(
            run_id=snapshot.run_id,
            interpretation=_valid_interpretation(),
            host_provider="claude-code",
            host_model="claude-sonnet-4-6",
        )

        result = accept_gex_interpretation(
            store=store,
            request=request,
            allow_unknown_freshness=True,
        )

        assert result.trace.provider == f"{Provenance.HOST_DECLARED.value}:claude-code"
        assert result.trace.model == f"{Provenance.HOST_DECLARED.value}:claude-sonnet-4-6"

    def test_validator_did_not_call_model_for_host_execution(self, store):
        """Validator never calls a model in the interactive host path."""
        snapshot = _make_snapshot()
        store.save(snapshot)
        request = AcceptanceRequest(
            run_id=snapshot.run_id,
            interpretation=_valid_interpretation(),
        )

        result = accept_gex_interpretation(
            store=store, request=request, allow_unknown_freshness=True,
        )

        assert result.trace.validator_called_model is False
        assert result.trace.host_model_execution == "HOST_DECLARED"

    def test_trace_contains_all_effective_assets(self, store):
        """Accepted trace must contain agent, skills, protocols, conventions from snapshot."""
        snapshot = _make_snapshot()
        store.save(snapshot)
        request = AcceptanceRequest(
            run_id=snapshot.run_id,
            interpretation=_valid_interpretation(),
        )

        result = accept_gex_interpretation(
            store=store, request=request, allow_unknown_freshness=True,
        )

        assert result.status == RunStatus.SUCCESS
        t = result.trace
        assert t.agent_definition is None
        assert len(t.skills) == 1
        assert t.skills[0].skill_id == "gex_interpretation"
        assert t.skills[0].content_hash.startswith("sha256:")
        assert len(t.protocols) == 1
        assert t.protocols[0].protocol_id == "facts_discipline"
        assert len(t.conventions) == 1
        assert t.conventions[0].convention_id == "trading_defaults"

    def test_trace_contains_facts_hash_and_prepared_at(self, store):
        """Trace must record facts_hash and prepared_at from internal snapshot."""
        snapshot = _make_snapshot()
        store.save(snapshot)
        request = AcceptanceRequest(
            run_id=snapshot.run_id,
            interpretation=_valid_interpretation(),
        )

        result = accept_gex_interpretation(
            store=store, request=request, allow_unknown_freshness=True,
        )

        assert result.trace.facts_hash == snapshot.facts_hash
        assert result.trace.conventions_hash == snapshot.conventions_hash
        assert result.trace.prepared_at == snapshot.prepared_at
        assert result.trace.facts_provenance == "GALECORE_VERIFIED"

    def test_accepted_at_is_internal_clock(self, store):
        """accepted_at must be set by validator, not by the host."""
        snapshot = _make_snapshot()
        store.save(snapshot)
        before = datetime.now(UTC)
        request = AcceptanceRequest(
            run_id=snapshot.run_id,
            interpretation=_valid_interpretation(),
        )

        result = accept_gex_interpretation(
            store=store, request=request, allow_unknown_freshness=True,
        )

        after = datetime.now(UTC)
        assert result.trace.accepted_at is not None
        assert before <= result.trace.accepted_at <= after

    def test_asset_hashes_match_snapshot(self, store):
        """Hashes in trace must match what was in the stored snapshot."""
        snapshot = _make_snapshot()
        store.save(snapshot)
        request = AcceptanceRequest(
            run_id=snapshot.run_id,
            interpretation=_valid_interpretation(),
        )

        result = accept_gex_interpretation(
            store=store, request=request, allow_unknown_freshness=True,
        )

        m = snapshot.effective_assets
        assert result.trace.skills[0].content_hash == m.skills["gex_interpretation"].content_hash
        assert result.trace.protocols[0].content_hash == m.protocols["facts_discipline"].content_hash
        assert result.trace.conventions[0].content_hash == m.conventions["trading_defaults"].content_hash


class TestAcceptRejectionTrace:
    def test_guardrail_failure_still_has_assets_and_provenance(self, store):
        """Rejection paths must also include trace with assets, facts_hash, provider."""
        snapshot = _make_snapshot()
        store.save(snapshot)
        bad_interp = {
            "regime": "positive_gamma",
            "observations": ["Price target 999.99"],
            "implications": ["Going up"],
            "quantitative_claims": [{"metric": "net_gex", "value": 1500.0, "unit": "billion_usd"}],
            "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is positive"}],
            "limitations": ["Snapshot only"],
        }
        request = AcceptanceRequest(
            run_id=snapshot.run_id,
            interpretation=bad_interp,
            host_provider="test-host",
            host_model="test-model",
        )

        result = accept_gex_interpretation(
            store=store, request=request, allow_unknown_freshness=True,
        )

        assert result.status == RunStatus.VALIDATION_ERROR
        assert result.result is None
        t = result.trace
        # Even on rejection, trace has provenance
        assert t.facts_hash == snapshot.facts_hash
        assert t.prepared_at == snapshot.prepared_at
        assert t.facts_provenance == "GALECORE_VERIFIED"
        assert t.agent_definition is None
        assert t.provider == "HOST_DECLARED:test-host"
        assert t.model == "HOST_DECLARED:test-model"
        assert t.validator_called_model is False

    def test_missing_snapshot_trace_has_host_declared(self, store):
        """Even when snapshot is missing, host metadata is recorded."""
        request = AcceptanceRequest(
            run_id="01a0a7bc-0fc3-7a41-9fcf-73ec491249c3",
            interpretation=_valid_interpretation(),
            host_provider="test-host",
        )

        result = accept_gex_interpretation(
            store=store, request=request, allow_unknown_freshness=True,
        )

        assert result.status == RunStatus.VALIDATION_ERROR
        assert result.trace.provider == "HOST_DECLARED:test-host"
        assert result.trace.validator_called_model is False
        # No snapshot → no facts_hash or assets
        assert result.trace.facts_hash is None
        assert result.trace.agent_definition is None


class TestAcceptSnapshotNotFound:
    def test_missing_run_id_rejected(self, store):
        request = AcceptanceRequest(
            run_id="01a0a7bc-0fc3-7a41-9fcf-73ec491249c3",
            interpretation=_valid_interpretation(),
        )

        result = accept_gex_interpretation(
            store=store, request=request, allow_unknown_freshness=True,
        )

        assert result.status == RunStatus.VALIDATION_ERROR
        assert result.result is None
        assert "not found" in result.error_detail.lower() or "expired" in result.error_detail.lower()


class TestAcceptedAtNotControllable:
    def test_acceptance_uses_internal_time(self, store):
        """accepted_at cannot be supplied by the host; freshness uses internal clock."""
        old_ts = datetime.now(UTC) - timedelta(seconds=600)
        snapshot = _make_snapshot(market_data_as_of=old_ts, freshness_max_age=300)
        store.save(snapshot)

        # Even if the host could pass accepted_at (it can't with the new API),
        # the validator uses its own clock
        request = AcceptanceRequest(
            run_id=snapshot.run_id,
            interpretation=_valid_interpretation(),
        )

        result = accept_gex_interpretation(store=store, request=request)

        assert result.status == RunStatus.INSUFFICIENT_DATA
        assert result.result is None


class TestAcceptFreshnessRecheck:
    def test_stale_at_acceptance_rejected(self, store):
        old_ts = datetime.now(UTC) - timedelta(seconds=600)
        snapshot = _make_snapshot(market_data_as_of=old_ts, freshness_max_age=300)
        store.save(snapshot)
        request = AcceptanceRequest(
            run_id=snapshot.run_id,
            interpretation=_valid_interpretation(),
        )

        result = accept_gex_interpretation(store=store, request=request)

        assert result.status == RunStatus.INSUFFICIENT_DATA
        assert result.result is None


class TestAcceptGuardrailFailure:
    def test_invented_numbers_rejected(self, store):
        snapshot = _make_snapshot()
        store.save(snapshot)
        bad_interp = {
            "regime": "positive_gamma",
            "observations": ["Price target 999.99 based on momentum"],
            "implications": ["Breakout to 1200.0 expected"],
            "quantitative_claims": [{"metric": "net_gex", "value": 1500.0, "unit": "billion_usd"}],
            "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is positive"}],
            "limitations": ["Snapshot only"],
        }
        request = AcceptanceRequest(run_id=snapshot.run_id, interpretation=bad_interp)

        result = accept_gex_interpretation(
            store=store, request=request, allow_unknown_freshness=True,
        )

        assert result.status == RunStatus.VALIDATION_ERROR
        assert result.result is None

    def test_invalid_evidence_path_rejected(self, store):
        snapshot = _make_snapshot()
        store.save(snapshot)
        bad_interp = {
            "regime": "positive_gamma",
            "observations": ["Market looks bullish"],
            "implications": ["Going up"],
            "quantitative_claims": [{"metric": "net_gex", "value": 1500.0, "unit": "billion_usd"}],
            "evidence": [{"fact_path": "facts.nonexistent", "claim": "Made up"}],
            "limitations": ["None"],
        }
        request = AcceptanceRequest(run_id=snapshot.run_id, interpretation=bad_interp)

        result = accept_gex_interpretation(
            store=store, request=request, allow_unknown_freshness=True,
        )

        assert result.status == RunStatus.VALIDATION_ERROR
        checks = result.trace.guardrails_executed
        assert any(c.guardrail_id == "facts_match_source" and not c.passed for c in checks)

    def test_sign_contradiction_rejected(self, store):
        snapshot = _make_snapshot(net_gex=1500.0)
        store.save(snapshot)
        bad_interp = {
            "regime": "negative_gamma",
            "observations": ["Net GEX is negative"],
            "implications": ["Dealers short gamma"],
            "quantitative_claims": [{"metric": "net_gex", "value": 1500.0, "unit": "billion_usd"}],
            "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is negative"}],
            "limitations": ["Snapshot"],
        }
        request = AcceptanceRequest(run_id=snapshot.run_id, interpretation=bad_interp)

        result = accept_gex_interpretation(
            store=store, request=request, allow_unknown_freshness=True,
        )

        assert result.status == RunStatus.VALIDATION_ERROR
        assert result.result is None

    def test_mixed_valid_and_invalid_evidence_rejected(self, store):
        """One valid + one invalid evidence ref must reject the whole output."""
        snapshot = _make_snapshot()
        store.save(snapshot)
        mixed_interp = {
            "regime": "positive_gamma",
            "observations": ["Net GEX is positive"],
            "implications": ["Mean reversion"],
            "quantitative_claims": [{"metric": "net_gex", "value": 1500.0, "unit": "billion_usd"}],
            "evidence": [
                {"fact_path": "facts.net_gex", "claim": "Net GEX is positive"},
                {"fact_path": "facts.nonexistent", "claim": "Made up"},
            ],
            "limitations": ["Snapshot"],
        }
        request = AcceptanceRequest(run_id=snapshot.run_id, interpretation=mixed_interp)

        result = accept_gex_interpretation(
            store=store, request=request, allow_unknown_freshness=True,
        )

        assert result.status == RunStatus.VALIDATION_ERROR
        assert result.result is None

    def test_empty_limitations_rejected(self, store):
        """limitations must have at least 1 element per contract."""
        snapshot = _make_snapshot()
        store.save(snapshot)
        bad_interp = {
            "regime": "positive_gamma",
            "observations": ["Net GEX is positive"],
            "implications": ["Mean reversion expected"],
            "quantitative_claims": [{"metric": "net_gex", "value": 1500.0, "unit": "billion_usd"}],
            "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is positive"}],
            "limitations": [],
        }
        request = AcceptanceRequest(run_id=snapshot.run_id, interpretation=bad_interp)

        result = accept_gex_interpretation(
            store=store, request=request, allow_unknown_freshness=True,
        )

        assert result.status == RunStatus.VALIDATION_ERROR
        assert result.result is None

    def test_value_from_wrong_field_rejected(self, store):
        """A claim carries the spot value under the net_gex metric."""
        snapshot = _make_snapshot(net_gex=1500.0, spot=450.5)
        store.save(snapshot)
        wrong_field = {
            "regime": "positive_gamma",
            "observations": ["Net GEX is positive"],
            "implications": ["Reversion"],
            "quantitative_claims": [{"metric": "net_gex", "value": 450.5, "unit": "billion_usd"}],
            "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is positive"}],
            "limitations": ["Snapshot"],
        }
        request = AcceptanceRequest(run_id=snapshot.run_id, interpretation=wrong_field)

        result = accept_gex_interpretation(
            store=store, request=request, allow_unknown_freshness=True,
        )

        assert result.status == RunStatus.VALIDATION_ERROR
        assert result.result is None


def _accept(store, snapshot):
    return accept_gex_interpretation(
        store=store,
        request=AcceptanceRequest(run_id=snapshot.run_id, interpretation=_valid_interpretation()),
        allow_unknown_freshness=True,
    )


class TestConventionIntegrity:
    """conventions_hash binds the resolved values to the snapshot; no grace period."""

    def test_correct_hash_accepted(self, store):
        snapshot = _make_snapshot()
        store.save(snapshot)
        assert _accept(store, snapshot).status == RunStatus.SUCCESS

    def test_wrong_hash_rejected_before_cognitive_validation(self, store):
        snapshot = _make_snapshot()

        def mutate(d):
            d["conventions_hash"] = "sha256:" + "0" * 64

        _write_raw(store, snapshot, mutate)
        result = _accept(store, snapshot)
        assert result.status == RunStatus.INTERNAL_ERROR
        assert result.result is None
        assert "conventions_hash mismatch" in result.error_detail
        executed = result.trace.guardrails_executed
        assert [g.guardrail_id for g in executed] == ["snapshot_integrity"], "no cognitive validation on a corrupt snapshot"
        assert executed[0].passed is False

    def test_mutated_resolved_conventions_rejected(self, store):
        snapshot = _make_snapshot()

        def mutate(d):
            d["resolved_conventions"]["gex_near_zero_threshold_pct"] = 50.0

        _write_raw(store, snapshot, mutate)
        result = _accept(store, snapshot)
        assert result.status == RunStatus.INTERNAL_ERROR
        assert result.result is None
        assert "conventions_hash mismatch" in result.error_detail

    def test_missing_hash_snapshot_rejected(self, store):
        """A pre-Increment-4 snapshot without conventions_hash is not accepted."""
        snapshot = _make_snapshot()

        def mutate(d):
            del d["conventions_hash"]

        _write_raw(store, snapshot, mutate)
        result = _accept(store, snapshot)
        assert result.status == RunStatus.VALIDATION_ERROR
        assert result.result is None
        assert "corrupt" in result.error_detail.lower()

    def test_malformed_hash_snapshot_rejected(self, store):
        snapshot = _make_snapshot()

        def mutate(d):
            d["conventions_hash"] = "md5:abc"

        _write_raw(store, snapshot, mutate)
        result = _accept(store, snapshot)
        assert result.status == RunStatus.VALIDATION_ERROR
        assert result.result is None

    def test_outer_timestamp_must_equal_hashed_one(self, store):
        """Codex B2: the freshness timestamp used at accept is bound to facts_hash."""
        snapshot = _make_snapshot(market_data_as_of=datetime.now(UTC) - timedelta(hours=2))

        def mutate(d):
            d["market_data_as_of"] = datetime.now(UTC).isoformat()  # outer field "refreshed"

        _write_raw(store, snapshot, mutate)
        result = _accept(store, snapshot)
        assert result.status == RunStatus.INTERNAL_ERROR
        assert result.result is None
        assert "market_data_as_of mismatch" in result.error_detail

    def test_malformed_hashed_timestamp_is_controlled_rejection(self, store):
        """Codex M1 (review 3): a corrupt inner timestamp must not escape as ValueError."""
        snapshot = _make_snapshot()

        def mutate(d):
            d["facts"]["market_data_as_of"] = "not-a-timestamp"
            from galecore_ai.contracts.prepared_analysis import compute_facts_hash as h
            d["facts_hash"] = h(d["facts"])  # keep facts_hash consistent so only the parse fails

        _write_raw(store, snapshot, mutate)
        result = _accept(store, snapshot)
        assert result.status == RunStatus.INTERNAL_ERROR
        assert result.result is None
        assert "facts malformed" in result.error_detail
        assert [g.guardrail_id for g in result.trace.guardrails_executed] == ["snapshot_integrity"]

    def test_missing_snapshot_records_lookup_failure(self, store):
        request = AcceptanceRequest(run_id="01a0a7bc-0fc3-7a41-9fcf-73ec491249c3", interpretation=_valid_interpretation())
        result = accept_gex_interpretation(store=store, request=request, allow_unknown_freshness=True)
        assert [g.guardrail_id for g in result.trace.guardrails_executed] == ["snapshot_lookup"]
        assert result.trace.guardrails_executed[0].passed is False

    def test_stale_freshness_status_is_accurate(self, store):
        old_ts = datetime.now(UTC) - timedelta(seconds=600)
        snapshot = _make_snapshot(market_data_as_of=old_ts, freshness_max_age=300)
        store.save(snapshot)
        result = accept_gex_interpretation(
            store=store, request=AcceptanceRequest(run_id=snapshot.run_id, interpretation=_valid_interpretation()),
        )
        assert result.status == RunStatus.INSUFFICIENT_DATA
        assert result.trace.freshness.freshness_status == "STALE"

    def test_future_freshness_status_is_accurate(self, store):
        snapshot = _make_snapshot(market_data_as_of=datetime.now(UTC) + timedelta(seconds=120))
        store.save(snapshot)
        result = accept_gex_interpretation(
            store=store, request=AcceptanceRequest(run_id=snapshot.run_id, interpretation=_valid_interpretation()),
        )
        assert result.status == RunStatus.INSUFFICIENT_DATA
        assert result.trace.freshness.freshness_status == "FUTURE"

    def test_facts_mutation_still_detected(self, store):
        snapshot = _make_snapshot()

        def mutate(d):
            d["facts"]["net_gex"] = -1500.0

        _write_raw(store, snapshot, mutate)
        result = _accept(store, snapshot)
        assert result.status == RunStatus.INTERNAL_ERROR
        assert "facts_hash mismatch" in result.error_detail
