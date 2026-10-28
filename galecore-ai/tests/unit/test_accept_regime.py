"""accept_interpretation dispatches on the snapshot's skill_id (GEX vs regime)."""

from __future__ import annotations

import pytest

from galecore_ai.adapters.snapshot_store import FileSnapshotStore
from galecore_ai.application.accept_interpretation import (
    accept_gex_interpretation,
    accept_interpretation,
)
from galecore_ai.contracts.agent_run import RunStatus
from galecore_ai.contracts.prepared_analysis import AcceptanceRequest
from galecore_ai.contracts.regime_analysis import REGIME_SKILL_ID
from tests.unit.regime_support import regime_snapshot, valid_regime_interpretation


@pytest.fixture
def store(tmp_path):
    return FileSnapshotStore(base_dir=tmp_path / "snapshots")


def _accept(store, snapshot, interpretation, **kw):
    return accept_interpretation(
        store=store,
        request=AcceptanceRequest(run_id=snapshot.run_id, interpretation=interpretation,
                                  host_provider="claude-code", host_model="claude-opus-5"),
        allow_unknown_freshness=True,
        **kw,
    )


class TestRegimeAcceptance:
    def test_valid_regime_interpretation_accepted(self, store):
        snapshot = regime_snapshot()
        store.save(snapshot)
        result = _accept(store, snapshot, valid_regime_interpretation())
        assert result.status == RunStatus.SUCCESS, result.error_detail
        assert result.result == valid_regime_interpretation()

    def test_trace_lists_every_capability_and_the_regime_skill(self, store):
        snapshot = regime_snapshot()
        store.save(snapshot)
        trace = _accept(store, snapshot, valid_regime_interpretation()).trace
        assert [c.capability_id for c in trace.capabilities_invoked] == [
            "compute.gex_analysis", "compute.put_skew", "market_data.trade", "market_data.trade",
        ]
        assert [s.skill_id for s in trace.skills] == [REGIME_SKILL_ID]
        assert trace.facts_hash == snapshot.facts_hash
        assert trace.provider == "HOST_DECLARED:claude-code"
        assert trace.validator_called_model is False

    def test_structural_regime_checks_are_in_the_trace(self, store):
        snapshot = regime_snapshot()
        store.save(snapshot)
        trace = _accept(store, snapshot, valid_regime_interpretation()).trace
        ids = {g.guardrail_id for g in trace.guardrails_executed}
        assert {"snapshot_integrity", "gex_regime_sign", "tail_pricing_level",
                "quantitative_claims_valid", "no_numbers_in_prose"} <= ids

    def test_gex_shaped_payload_rejected_against_regime_snapshot(self, store):
        snapshot = regime_snapshot()
        store.save(snapshot)
        gex_like = valid_regime_interpretation()
        gex_like["regime"] = gex_like.pop("gamma_regime")
        del gex_like["tail_pricing"]
        result = _accept(store, snapshot, gex_like)
        assert result.status == RunStatus.VALIDATION_ERROR and result.result is None

    def test_tail_pricing_contradiction_rejected(self, store):
        snapshot = regime_snapshot()
        store.save(snapshot)
        result = _accept(store, snapshot, valid_regime_interpretation(tail_pricing="elevated"))
        assert result.status == RunStatus.VALIDATION_ERROR
        failed = {g.guardrail_id for g in result.trace.guardrails_executed if not g.passed}
        assert failed == {"tail_pricing_level"}


class TestSkillDispatch:
    def test_unknown_skill_id_is_internal_error_not_success(self, store):
        snapshot = regime_snapshot(skill_id="macro_interpretation")
        store.save(snapshot)
        result = _accept(store, snapshot, valid_regime_interpretation())
        assert result.status == RunStatus.INTERNAL_ERROR
        assert "No output contract" in (result.error_detail or "")

    def test_gex_alias_still_exposed(self):
        assert accept_gex_interpretation is accept_interpretation


class TestLegacySnapshots:
    def test_pre_phase4_snapshot_without_new_fields_loads_but_is_not_accepted(self, store, tmp_path):
        """A dump without skill_id/capability_traces/snapshot_hash loads (defaults) but is
        rejected at accept: it was never sealed, so nothing binds its metadata (Codex B1)."""
        import json

        from galecore_ai.contracts.prepared_analysis import StoredPreparedSnapshot
        from tests.unit.regime_support import regime_snapshot as _snap

        modern = _snap(skill_id="gex_interpretation")
        raw = json.loads(modern.model_dump_json())
        del raw["skill_id"]
        del raw["capability_traces"]
        raw["facts"] = {"symbol": "SPY", "net_gex": 1500.0, "call_gex": 2e6, "put_gex": -5e5,
                        "spot": 450.5, "freshness_status": "VALID",
                        "market_data_as_of": raw["market_data_as_of"]}
        from galecore_ai.contracts.prepared_analysis import compute_facts_hash

        raw["facts_hash"] = compute_facts_hash(raw["facts"])
        raw.pop("snapshot_hash", None)
        legacy = StoredPreparedSnapshot.model_validate(raw)
        assert legacy.skill_id == "gex_interpretation" and legacy.capability_traces == []
        assert legacy.snapshot_hash is None
        store.save(legacy)
        gex = {
            "regime": "positive_gamma",
            "observations": ["Dealers are long gamma"],
            "quantitative_claims": [{"metric": "net_gex", "value": 1500.0, "unit": "billion_usd"}],
            "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is positive"}],
            "limitations": ["Snapshot"],
        }
        result = _accept(store, legacy, gex)
        assert result.status == RunStatus.INTERNAL_ERROR
        assert "snapshot_hash missing" in (result.error_detail or "")
        assert [g.guardrail_id for g in result.trace.guardrails_executed] == ["snapshot_integrity"]


class TestSnapshotHashBinding:
    """Codex B1: acceptance-critical metadata cannot be edited in the store undetected."""

    def _write_raw(self, store, snapshot, mutate):
        import json

        data = json.loads(snapshot.model_dump_json())
        mutate(data)
        (store._base_dir / f"{snapshot.run_id}.json").write_text(json.dumps(data), encoding="utf-8")

    def _rejected(self, store, snapshot, mutate, interpretation=None):
        self._write_raw(store, snapshot, mutate)
        result = _accept(store, snapshot, interpretation or valid_regime_interpretation())
        assert result.status == RunStatus.INTERNAL_ERROR, result.status
        assert result.result is None
        assert [g.guardrail_id for g in result.trace.guardrails_executed] == ["snapshot_integrity"]
        return result.error_detail or ""

    def test_switching_skill_id_to_a_laxer_contract_is_detected(self, store):
        snapshot = regime_snapshot()
        gex_like = valid_regime_interpretation()
        gex_like["regime"] = gex_like.pop("gamma_regime")
        del gex_like["tail_pricing"]

        def mutate(d):
            d["skill_id"] = "gex_interpretation"

        assert "snapshot_hash mismatch" in self._rejected(store, snapshot, mutate, gex_like)

    def test_widening_freshness_window_is_detected(self, store):
        from datetime import UTC, datetime, timedelta

        from tests.unit.regime_support import regime_facts

        old = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
        snapshot = regime_snapshot(facts=regime_facts(market_data_as_of=old))

        def mutate(d):
            d["freshness_max_age_seconds"] = 86400.0

        assert "snapshot_hash mismatch" in self._rejected(store, snapshot, mutate)

    def test_skill_not_among_loaded_assets_is_detected(self, store):
        from galecore_ai.contracts.prepared_analysis import seal_snapshot

        snapshot = regime_snapshot(skill_id="gex_interpretation")  # manifest lists gex only
        snapshot = seal_snapshot(snapshot.model_copy(update={"skill_id": REGIME_SKILL_ID}))
        store.save(snapshot)
        result = _accept(store, snapshot, valid_regime_interpretation())
        assert result.status == RunStatus.INTERNAL_ERROR
        assert "skill mismatch" in (result.error_detail or "")

    def test_edited_asset_hash_is_detected(self, store):
        snapshot = regime_snapshot()

        def mutate(d):
            d["effective_assets"]["skills"][REGIME_SKILL_ID]["content_hash"] = "sha256:" + "b" * 64

        assert "snapshot_hash mismatch" in self._rejected(store, snapshot, mutate)

    def test_sealed_snapshot_still_accepts(self, store):
        snapshot = regime_snapshot()
        store.save(snapshot)
        assert _accept(store, snapshot, valid_regime_interpretation()).status == RunStatus.SUCCESS
