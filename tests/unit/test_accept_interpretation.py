"""Tests for accept_gex_interpretation — snapshot-based acceptance."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from galecore_ai.application.accept_interpretation import accept_gex_interpretation
from galecore_ai.contracts.agent_run import CapabilityTrace, RunStatus
from galecore_ai.contracts.prepared_analysis import (
    AcceptanceRequest,
    PreparedSnapshot,
    compute_facts_hash,
)


def _make_snapshot(
    *,
    net_gex: float = 1500.0,
    spot: float = 450.5,
    market_data_as_of: datetime | None = None,
    freshness_max_age: float = 300.0,
) -> PreparedSnapshot:
    if market_data_as_of is None:
        market_data_as_of = datetime.now(UTC)
    facts = {
        "symbol": "SPY",
        "net_gex": net_gex,
        "call_gex": 2000000.0,
        "put_gex": -500000.0,
        "spot": spot,
        "freshness_status": "VALID",
    }
    return PreparedSnapshot(
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
    )


def _valid_interpretation(net_gex: float = 1500.0, spot: float = 450.5) -> dict:
    return {
        "regime": "positive_gamma",
        "observations": [f"Net GEX is {net_gex}, spot at {spot}"],
        "implications": ["Mean reversion expected"],
        "evidence": [{"fact_path": "facts.net_gex", "claim": f"Net GEX is {net_gex}"}],
        "limitations": ["Point-in-time snapshot"],
    }


class TestAcceptSuccess:
    def test_valid_interpretation_accepted(self):
        snapshot = _make_snapshot()
        request = AcceptanceRequest(
            run_id=snapshot.run_id,
            interpretation=_valid_interpretation(),
        )

        result = accept_gex_interpretation(
            snapshot=snapshot,
            request=request,
            allow_unknown_freshness=True,
        )

        assert result.status == RunStatus.SUCCESS
        assert result.result is not None
        assert result.result["regime"] == "positive_gamma"

    def test_trace_records_host_declared_provider(self):
        snapshot = _make_snapshot()
        request = AcceptanceRequest(
            run_id=snapshot.run_id,
            interpretation=_valid_interpretation(),
            host_provider="claude-code",
            host_model="claude-sonnet-4-6",
        )

        result = accept_gex_interpretation(
            snapshot=snapshot,
            request=request,
            allow_unknown_freshness=True,
        )

        assert result.trace.provider == "HOST_DECLARED:claude-code"
        assert result.trace.model == "HOST_DECLARED:claude-sonnet-4-6"


class TestAcceptRunIdMismatch:
    def test_mismatched_run_id_rejected(self):
        snapshot = _make_snapshot()
        request = AcceptanceRequest(
            run_id="wrong-id",
            interpretation=_valid_interpretation(),
        )

        result = accept_gex_interpretation(
            snapshot=snapshot,
            request=request,
            allow_unknown_freshness=True,
        )

        assert result.status == RunStatus.VALIDATION_ERROR
        assert result.result is None
        assert "mismatch" in result.error_detail


class TestAcceptFreshnessRecheck:
    def test_stale_at_acceptance_rejected(self):
        """Facts were fresh at prepare but stale by acceptance time."""
        old_ts = datetime.now(UTC) - timedelta(seconds=600)
        snapshot = _make_snapshot(market_data_as_of=old_ts, freshness_max_age=300)
        request = AcceptanceRequest(
            run_id=snapshot.run_id,
            interpretation=_valid_interpretation(),
        )

        result = accept_gex_interpretation(
            snapshot=snapshot,
            request=request,
        )

        assert result.status == RunStatus.INSUFFICIENT_DATA
        assert result.result is None
        assert "stale" in result.error_detail.lower() or "Freshness" in result.error_detail


class TestAcceptGuardrailFailure:
    def test_invented_numbers_rejected(self):
        snapshot = _make_snapshot()
        bad_interp = {
            "regime": "positive_gamma",
            "observations": ["Price target 999.99 based on momentum"],
            "implications": ["Breakout to 1200.0 expected"],
            "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is positive"}],
            "limitations": ["Snapshot only"],
        }
        request = AcceptanceRequest(
            run_id=snapshot.run_id,
            interpretation=bad_interp,
        )

        result = accept_gex_interpretation(
            snapshot=snapshot,
            request=request,
            allow_unknown_freshness=True,
        )

        assert result.status == RunStatus.VALIDATION_ERROR
        assert result.result is None

    def test_invalid_evidence_path_rejected(self):
        snapshot = _make_snapshot()
        bad_interp = {
            "regime": "positive_gamma",
            "observations": ["Market looks bullish"],
            "implications": ["Going up"],
            "evidence": [{"fact_path": "facts.nonexistent", "claim": "Made up"}],
            "limitations": ["None"],
        }
        request = AcceptanceRequest(
            run_id=snapshot.run_id,
            interpretation=bad_interp,
        )

        result = accept_gex_interpretation(
            snapshot=snapshot,
            request=request,
            allow_unknown_freshness=True,
        )

        assert result.status == RunStatus.VALIDATION_ERROR
        assert result.result is None
        checks = result.trace.guardrails_executed
        assert any(c.guardrail_id == "facts_match_source" and not c.passed for c in checks)

    def test_sign_contradiction_rejected(self):
        """Positive net_gex with negative_gamma regime."""
        snapshot = _make_snapshot(net_gex=1500.0)
        bad_interp = {
            "regime": "negative_gamma",
            "observations": ["Net GEX is 1500.0"],
            "implications": ["Dealers short gamma"],
            "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is 1500.0"}],
            "limitations": ["Snapshot"],
        }
        request = AcceptanceRequest(
            run_id=snapshot.run_id,
            interpretation=bad_interp,
        )

        result = accept_gex_interpretation(
            snapshot=snapshot,
            request=request,
            allow_unknown_freshness=True,
        )

        assert result.status == RunStatus.VALIDATION_ERROR
        assert result.result is None


class TestAcceptIntegrity:
    def test_tampered_facts_hash_rejected(self):
        snapshot = _make_snapshot()
        snapshot.facts_hash = "sha256:tampered"
        request = AcceptanceRequest(
            run_id=snapshot.run_id,
            interpretation=_valid_interpretation(),
        )

        result = accept_gex_interpretation(
            snapshot=snapshot,
            request=request,
            allow_unknown_freshness=True,
        )

        assert result.status == RunStatus.VALIDATION_ERROR
        assert "tampered" in result.error_detail.lower() or "mismatch" in result.error_detail.lower()
