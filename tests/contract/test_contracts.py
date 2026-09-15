"""Contract tests — verify contracts serialize/deserialize correctly and maintain compatibility."""

import json
from datetime import UTC, datetime
from uuid import uuid4

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
    GexAnalysisResult,
    GexFacts,
    GexInterpretation,
)


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
            run_id=str(uuid4()),
            status=RunStatus.SUCCESS,
            result={"analysis": "done"},
        )
        data = json.loads(result.model_dump_json())
        restored = AgentRunResult.model_validate(data)
        assert restored.status == RunStatus.SUCCESS
        assert restored.result["analysis"] == "done"

    def test_result_error(self):
        result = AgentRunResult(
            run_id=str(uuid4()),
            status=RunStatus.MODEL_ERROR,
            error_detail="Provider timeout after 30s",
        )
        assert result.status == RunStatus.MODEL_ERROR
        assert result.error_detail is not None

    def test_trace_record_defaults(self):
        trace = TraceRecord()
        assert trace.trace_id is not None
        assert trace.provider is None
        assert trace.skills_used == []


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
            caveats=["Based on current open interest snapshot"],
        )
        data = json.loads(interp.model_dump_json())
        restored = GexInterpretation.model_validate(data)
        assert restored.regime == "positive_gamma"
        assert len(restored.observations) == 1

    def test_full_analysis_roundtrip(self):
        analysis = GexAnalysisResult(
            symbol="SPY",
            facts=GexFacts(
                symbol="SPY",
                net_gex=1_500_000.0,
                call_gex=2_000_000.0,
                put_gex=-500_000.0,
                spot=450.50,
            ),
            interpretation=GexInterpretation(
                regime="positive_gamma",
                observations=["Dealer long gamma"],
                implications=["Mean reversion expected"],
            ),
            evidence=[{"type": "capability_call", "capability": "compute.gamma_exposure"}],
        )
        data = json.loads(analysis.model_dump_json())
        restored = GexAnalysisResult.model_validate(data)
        assert restored.status == "SUCCESS"
        assert restored.facts.spot == 450.50
        assert restored.interpretation.regime == "positive_gamma"
        assert len(restored.evidence) == 1

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
