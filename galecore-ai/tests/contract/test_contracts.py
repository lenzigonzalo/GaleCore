"""Contract tests — verify contracts serialize/deserialize correctly and maintain compatibility."""

import json
from datetime import UTC, datetime

from galecore_ai.contracts.agent_run import (
    AgentRunRequest,
    AgentRunResult,
    RunStatus,
    TraceRecord,
)
from galecore_ai.contracts.envelopes import (
    Actor,
    ActorType,
    BaseEnvelope,
    CognitiveEnvelope,
    TemporalContext,
)
from galecore_ai.contracts.gex_analysis import (
    METRIC_REGISTRY,
    EvidenceRef,
    GexFacts,
    GexInterpretation,
    GexMetric,
    GexUnit,
    QuantitativeClaim,
)
from galecore_ai.contracts.ids import new_id


class TestEnvelopeContracts:
    def test_base_envelope_roundtrip(self):
        env = BaseEnvelope(
            actor=Actor(actor_type=ActorType.AGENT),
            temporal_context=TemporalContext(requested_at=datetime(2026, 1, 1, tzinfo=UTC)),
        )
        data = json.loads(env.model_dump_json())
        restored = BaseEnvelope.model_validate(data)
        assert restored.contract_version == "1.0"
        assert restored.actor.actor_type == ActorType.AGENT

    def test_cognitive_envelope_roundtrip(self):
        env = CognitiveEnvelope(
            actor=Actor(actor_type=ActorType.SYSTEM, tenant_id="test"),
            temporal_context=TemporalContext(requested_at=datetime(2026, 1, 1, tzinfo=UTC)),
            payload_type="gex_analysis",
            payload={"symbol": "SPY"},
            evidence_refs=[{"type": "market_data", "ref": "quote/SPY"}],
            capability_versions={"compute.gamma_exposure": "1.0"},
        )
        data = json.loads(env.model_dump_json())
        restored = CognitiveEnvelope.model_validate(data)
        assert restored.payload_type == "gex_analysis"
        assert len(restored.evidence_refs) == 1

    def test_envelope_ids_are_unique(self):
        e1 = BaseEnvelope(
            actor=Actor(actor_type=ActorType.AGENT),
            temporal_context=TemporalContext(requested_at=datetime.now(tz=UTC)),
        )
        e2 = BaseEnvelope(
            actor=Actor(actor_type=ActorType.AGENT),
            temporal_context=TemporalContext(requested_at=datetime.now(tz=UTC)),
        )
        assert e1.message_id != e2.message_id
        assert e1.trace_id != e2.trace_id


class TestAgentRunContracts:
    def test_request_roundtrip(self):
        req = AgentRunRequest(
            task_type="gex_analysis",
            parameters={"symbol": "SPY"},
        )
        data = json.loads(req.model_dump_json())
        restored = AgentRunRequest.model_validate(data)
        assert restored.task_type == "gex_analysis"
        assert restored.agent_id == "TradingAgent"

    def test_result_success(self):
        result = AgentRunResult(
            run_id=new_id(),
            status=RunStatus.SUCCESS,
            result={"analysis": "done"},
        )
        data = json.loads(result.model_dump_json())
        restored = AgentRunResult.model_validate(data)
        assert restored.status == RunStatus.SUCCESS
        assert restored.result["analysis"] == "done"

    def test_result_error(self):
        result = AgentRunResult(
            run_id=new_id(),
            status=RunStatus.MODEL_ERROR,
            error_detail="Provider timeout after 30s",
        )
        assert result.status == RunStatus.MODEL_ERROR
        assert result.error_detail is not None

    def test_trace_record_defaults(self):
        trace = TraceRecord()
        assert trace.trace_id is not None
        assert trace.provider is None
        assert trace.skills == []


class TestGexAnalysisContracts:
    def test_facts_roundtrip(self):
        facts = GexFacts(
            symbol="SPY",
            net_gex=1_500_000.0,
            call_gex=2_000_000.0,
            put_gex=-500_000.0,
            spot=450.50,
            zero_gamma_level=445.0,
            call_wall=460.0,
            put_wall=440.0,
        )
        data = json.loads(facts.model_dump_json())
        restored = GexFacts.model_validate(data)
        assert restored.symbol == "SPY"
        assert restored.net_gex == 1_500_000.0

    def test_interpretation_roundtrip(self):
        interp = GexInterpretation(
            regime="positive_gamma",
            observations=["Net GEX positive — dealer long gamma"],
            implications=["Expect mean reversion, reduced volatility"],
            quantitative_claims=[QuantitativeClaim(metric="net_gex", value=1500.0, unit="billion_usd")],
            evidence=[EvidenceRef(fact_path="facts.net_gex", claim="Net GEX is positive")],
            limitations=["Based on current open interest snapshot"],
        )
        data = json.loads(interp.model_dump_json())
        restored = GexInterpretation.model_validate(data)
        assert restored.regime == "positive_gamma"
        assert len(restored.observations) == 1
        assert len(restored.evidence) == 1
        assert restored.evidence[0].fact_path == "facts.net_gex"
        assert restored.quantitative_claims[0].metric == GexMetric.NET_GEX
        assert restored.quantitative_claims[0].unit == GexUnit.BILLION_USD
        assert data["quantitative_claims"][0] == {"metric": "net_gex", "value": 1500.0, "unit": "billion_usd"}

    def test_quantitative_claim_is_closed(self):
        """metric/unit are closed enums; fact_path is validator-owned, never host input."""
        import pytest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            QuantitativeClaim(metric="call_gex", value=1.0, unit="usd")
        with pytest.raises(ValidationError):
            QuantitativeClaim(metric="net_gex", value=1.0, unit="million_usd")
        with pytest.raises(ValidationError):
            QuantitativeClaim.model_validate(
                {"metric": "net_gex", "value": 1.0, "unit": "billion_usd", "fact_path": "facts.spot"},
            )
        for metric, spec in METRIC_REGISTRY.items():
            assert spec.fact_path == f"facts.{metric.value}"
        assert {m.value for m in GexMetric} == {"net_gex", "spot", "zero_gamma_level", "call_wall", "put_wall"}

    def test_quantitative_claims_required(self):
        import pytest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            GexInterpretation(
                regime="positive_gamma",
                observations=["Net GEX positive"],
                quantitative_claims=[],
                evidence=[EvidenceRef(fact_path="facts.net_gex", claim="Net GEX is positive")],
                limitations=["snapshot"],
            )

    def test_interpretation_rejects_extra_fields(self):
        """extra='forbid' must reject unknown fields."""
        import pytest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            GexInterpretation(
                regime="positive_gamma",
                observations=["test"],
                quantitative_claims=[QuantitativeClaim(metric="net_gex", value=1500.0, unit="billion_usd")],
                evidence=[EvidenceRef(fact_path="facts.net_gex", claim="test")],
                caveats=["old field name should fail"],
            )

    def test_facts_and_interpretation_separate(self):
        """Facts are deterministic data. Interpretation is model output.
        They must be separate concerns in the contract."""
        # Facts have no interpretation fields
        facts_fields = set(GexFacts.model_fields.keys())
        assert "regime" not in facts_fields
        assert "observations" not in facts_fields

        # Interpretation has no fact fields
        interp_fields = set(GexInterpretation.model_fields.keys())
        assert "net_gex" not in interp_fields
        assert "spot" not in interp_fields
