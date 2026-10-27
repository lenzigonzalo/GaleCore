"""Unit tests for the expanded TraceRecord and trace sub-models."""

from datetime import UTC, datetime
from uuid import UUID

from galecore_ai.contracts.agent_run import (
    AgentDefinitionTrace,
    CapabilityTrace,
    FreshnessTrace,
    GuardrailTrace,
    ProtocolTrace,
    SkillTrace,
    TraceRecord,
)
from galecore_ai.contracts.ids import new_id


class TestNewId:
    def test_returns_valid_uuid_string(self):
        uid = new_id()
        parsed = UUID(uid)
        assert str(parsed) == uid

    def test_uuid7_version(self):
        uid = new_id()
        parsed = UUID(uid)
        assert parsed.version == 7

    def test_ids_are_unique(self):
        ids = {new_id() for _ in range(100)}
        assert len(ids) == 100

    def test_ids_are_time_ordered(self):
        """UUIDv7 embeds a timestamp — later IDs should sort after earlier ones."""
        a = new_id()
        b = new_id()
        assert a < b or a == b  # monotonic (equality only if generated in same ms)


class TestTraceRecordDefaults:
    def test_default_construction(self):
        trace = TraceRecord()
        assert trace.trace_id is not None
        # Verify it is a valid UUIDv7
        parsed = UUID(trace.trace_id)
        assert parsed.version == 7

    def test_default_fields_are_none_or_empty(self):
        trace = TraceRecord()
        assert trace.correlation_id is None
        assert trace.request_timestamp is None
        assert trace.started_at is None
        assert trace.completed_at is None
        assert trace.latency_ms is None
        assert trace.provider is None
        assert trace.model is None
        assert trace.validator_called_model is False
        assert trace.host_model_execution == "HOST_DECLARED"
        assert trace.input_tokens is None
        assert trace.output_tokens is None
        assert trace.agent_definition is None
        assert trace.skills == []
        assert trace.protocols == []
        assert trace.conventions == []
        assert trace.capabilities_invoked == []
        assert trace.freshness is None
        assert trace.guardrails_executed == []
        assert trace.status is None
        assert trace.error is None

    def test_validator_called_model_false_by_default(self):
        trace = TraceRecord()
        assert trace.validator_called_model is False
        assert trace.host_model_execution == "HOST_DECLARED"


class TestTraceTimestamps:
    def test_timestamps_are_utc_aware(self):
        now = datetime.now(tz=UTC)
        trace = TraceRecord(
            started_at=now,
            completed_at=now,
            request_timestamp=now,
        )
        assert trace.started_at.tzinfo is not None
        assert trace.completed_at.tzinfo is not None
        assert trace.request_timestamp.tzinfo is not None


class TestGuardrailTrace:
    def test_guardrail_pass(self):
        gt = GuardrailTrace(guardrail_id="no_invented_numbers", passed=True, message="OK")
        assert gt.passed is True
        assert gt.guardrail_id == "no_invented_numbers"

    def test_guardrail_fail(self):
        gt = GuardrailTrace(
            guardrail_id="facts_match_source",
            passed=False,
            message="Output does not reference facts",
        )
        assert gt.passed is False
        assert "does not reference" in gt.message

    def test_guardrail_default_message(self):
        gt = GuardrailTrace(guardrail_id="test", passed=True)
        assert gt.message == ""


class TestCapabilityTrace:
    def test_captures_endpoint_and_outcome(self):
        ct = CapabilityTrace(
            capability_id="compute.gex_analysis",
            endpoint="/App/Gex/Analysis",
            outcome="ok",
            latency_ms=42,
        )
        assert ct.endpoint == "/App/Gex/Analysis"
        assert ct.outcome == "ok"
        assert ct.latency_ms == 42

    def test_error_outcome(self):
        ct = CapabilityTrace(
            capability_id="compute.gex_analysis",
            outcome="error",
            error="Connection refused",
        )
        assert ct.outcome == "error"
        assert ct.error == "Connection refused"

    def test_galecore_versions_are_none_by_default(self):
        ct = CapabilityTrace(capability_id="test")
        assert ct.schema_version is None
        assert ct.calculation_version is None
        assert ct.methodology_version is None

    def test_transport_defaults_to_rest(self):
        ct = CapabilityTrace(capability_id="test")
        assert ct.transport == "REST"


class TestFreshnessTrace:
    def test_captures_age(self):
        now = datetime.now(tz=UTC)
        ft = FreshnessTrace(
            market_data_as_of=now,
            response_received_at=now,
            freshness_status="FRESH",
            freshness_age_seconds=2.5,
        )
        assert ft.freshness_age_seconds == 2.5
        assert ft.freshness_status == "FRESH"

    def test_unknown_freshness(self):
        ft = FreshnessTrace(freshness_status="UNKNOWN")
        assert ft.market_data_as_of is None
        assert ft.freshness_age_seconds is None


class TestAgentDefinitionTrace:
    def test_basic_fields(self):
        adt = AgentDefinitionTrace(agent_id="TradingAgent", version="1.0")
        assert adt.agent_id == "TradingAgent"
        assert adt.content_hash is None


class TestSkillTrace:
    def test_basic_fields(self):
        st = SkillTrace(skill_id="gex_interpretation", version="1.0")
        assert st.skill_id == "gex_interpretation"
        assert st.content_hash is None


class TestProtocolTrace:
    def test_basic_fields(self):
        pt = ProtocolTrace(protocol_id="facts_discipline", version="1.0")
        assert pt.protocol_id == "facts_discipline"
        assert pt.content_hash is None


class TestTraceRecordSerialization:
    def test_roundtrip_with_all_fields(self):
        now = datetime.now(tz=UTC)
        trace = TraceRecord(
            provider="anthropic",
            model="claude-sonnet-4-20250514",
            validator_called_model=True,
            started_at=now,
            completed_at=now,
            request_timestamp=now,
            latency_ms=150,
            input_tokens=500,
            output_tokens=200,
            agent_definition=AgentDefinitionTrace(agent_id="TradingAgent", version="1.0"),
            skills=[SkillTrace(skill_id="gex_interpretation", version="1.0")],
            protocols=[ProtocolTrace(protocol_id="facts_discipline", version="1.0")],
            capabilities_invoked=[
                CapabilityTrace(
                    capability_id="compute.gex_analysis",
                    endpoint="/App/Gex/Analysis",
                    outcome="ok",
                    latency_ms=42,
                ),
            ],
            freshness=FreshnessTrace(
                market_data_as_of=now,
                freshness_status="FRESH",
                freshness_age_seconds=1.2,
            ),
            guardrails_executed=[
                GuardrailTrace(guardrail_id="no_invented_numbers", passed=True, message="OK"),
            ],
            status="SUCCESS",
        )
        data = trace.model_dump()
        restored = TraceRecord.model_validate(data)
        assert restored.validator_called_model is True
        assert restored.agent_definition.agent_id == "TradingAgent"
        assert len(restored.skills) == 1
        assert len(restored.guardrails_executed) == 1
        assert restored.freshness.freshness_age_seconds == 1.2
