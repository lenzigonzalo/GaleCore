"""Unit tests for CognitiveRuntime — end-to-end agent run orchestration."""

import pytest

from galecore_ai.capabilities.contracts import KNOWN_CAPABILITIES
from galecore_ai.capabilities.registry import CapabilityRegistry
from galecore_ai.contracts.agent_run import AgentRunRequest, RunStatus
from galecore_ai.contracts.gex_analysis import GexInterpretation
from galecore_ai.harness.convention_resolver import ConventionResolver
from galecore_ai.harness.definitions import (
    AgentDefinition,
    ConventionEntry,
    ConventionPrecedence,
    ConventionSet,
)
from galecore_ai.harness.protocol_loader import ProtocolLoader
from galecore_ai.harness.runtime import CognitiveRuntime
from galecore_ai.harness.skill_loader import SkillLoader
from galecore_ai.models.providers.fake import (
    FakeProvider,
    clear_canned_responses,
    register_canned_response,
)


@pytest.fixture(autouse=True)
def _clean():
    clear_canned_responses()
    yield
    clear_canned_responses()


def _build_runtime(
    *,
    provider: FakeProvider | None = None,
) -> CognitiveRuntime:
    # Skill
    skill_loader = SkillLoader()
    skill_loader.load_from_dict({
        "skill_id": "gex_interpretation",
        "version": "1.0",
        "display_name": "GEX Interpretation",
        "output_contract": "galecore_ai.contracts.gex_analysis.GexInterpretation",
        "required_capabilities": ["compute.gamma_exposure"],
        "system_prompt": "You are a GEX analyst.",
        "instructions": "Classify the regime.",
    })

    # Protocol
    protocol_loader = ProtocolLoader()
    protocol_loader.load_from_dict({
        "protocol_id": "facts_discipline",
        "version": "1.0",
        "display_name": "Facts Discipline",
        "trigger": "always",
        "steps": [
            {"step_id": "check", "description": "Check facts", "required": True},
        ],
        "guardrails": ["no_invented_numbers", "facts_match_source"],
    })

    # Conventions
    conventions = ConventionResolver()
    conventions.load(ConventionSet(
        convention_id="test", version="1.0", display_name="Test",
        entries=[
            ConventionEntry(key="timezone", value="America/New_York", precedence=ConventionPrecedence.DOMAIN),
        ],
    ))

    # Registry
    registry = CapabilityRegistry()
    registry.register_many(KNOWN_CAPABILITIES)

    return CognitiveRuntime(
        provider=provider or FakeProvider(),
        skill_loader=skill_loader,
        protocol_loader=protocol_loader,
        convention_resolver=conventions,
        capability_registry=registry,
    )


def _agent() -> AgentDefinition:
    return AgentDefinition(
        agent_id="TradingAgent",
        version="1.0",
        display_name="Trading Agent",
        skills=["gex_interpretation"],
        protocols=["facts_discipline"],
        allowed_capabilities=["compute.gamma_exposure", "market_data.quote"],
    )


def _request(symbol: str = "SPY") -> AgentRunRequest:
    return AgentRunRequest(
        task_type="gex_interpretation",
        parameters={"symbol": symbol},
    )


def _facts() -> dict:
    return {
        "symbol": "SPY",
        "net_gex": 1500000.0,
        "call_gex": 2000000.0,
        "put_gex": -500000.0,
        "spot": 450.5,
    }


class TestCognitiveRuntimeSuccess:
    @pytest.mark.asyncio
    async def test_successful_run_with_canned_response(self):
        register_canned_response("GexInterpretation", {
            "regime": "positive_gamma",
            "observations": ["Net GEX positive — dealers are long gamma"],
            "implications": ["Mean reversion expected around spot"],
            "quantitative_claims": [
                {"metric": "net_gex", "value": 1500000.0, "unit": "billion_usd"},
                {"metric": "spot", "value": 450.5, "unit": "usd"},
            ],
            "evidence": [
                {"fact_path": "facts.net_gex", "claim": "Net GEX is positive"},
                {"fact_path": "facts.spot", "claim": "Spot is the reference level"},
            ],
            "limitations": ["Based on current snapshot"],
        })

        runtime = _build_runtime()
        result = await runtime.execute(
            _request(),
            agent_definition=_agent(),
            facts=_facts(),
            output_schema=GexInterpretation,
        )

        assert result.status == RunStatus.SUCCESS
        assert result.result is not None
        assert result.result["regime"] == "positive_gamma"
        assert result.trace.provider == "fake"
        assert any(s.skill_id == "gex_interpretation" for s in result.trace.skills)
        assert any(p.protocol_id == "facts_discipline" for p in result.trace.protocols)
        assert result.trace.latency_ms >= 0
        assert result.trace.started_at is not None
        assert result.trace.completed_at is not None

    @pytest.mark.asyncio
    async def test_successful_run_with_defaults(self):
        """FakeProvider cannot auto-build GexInterpretation (enum regime + min_length constraints).

        This tests the fail-closed path: MODEL_ERROR when no canned response is registered.
        """
        runtime = _build_runtime()
        result = await runtime.execute(
            _request(),
            agent_definition=_agent(),
            facts=_facts(),
            output_schema=GexInterpretation,
        )
        # GexInterpretation has GexRegime enum + min_length=1 on observations/evidence,
        # so _build_default cannot construct a valid instance → MODEL_ERROR.
        assert result.status in (RunStatus.MODEL_ERROR, RunStatus.VALIDATION_ERROR)
        assert result.trace is not None


class TestCognitiveRuntimePreflightFailures:
    @pytest.mark.asyncio
    async def test_unknown_skill_fails_preflight(self):
        runtime = _build_runtime()
        request = AgentRunRequest(task_type="unknown_skill", parameters={})
        result = await runtime.execute(
            request,
            agent_definition=_agent(),
            facts={},
            output_schema=GexInterpretation,
        )
        assert result.status == RunStatus.VALIDATION_ERROR
        assert "Preflight failed" in result.error_detail
        assert "not found" in result.error_detail.lower()

    @pytest.mark.asyncio
    async def test_agent_without_skill_fails_preflight(self):
        runtime = _build_runtime()
        agent = AgentDefinition(
            agent_id="limited", version="1.0", display_name="Limited",
            skills=[],  # no skills
            allowed_capabilities=["compute.gamma_exposure"],
        )
        result = await runtime.execute(
            _request(),
            agent_definition=agent,
            facts=_facts(),
            output_schema=GexInterpretation,
        )
        assert result.status == RunStatus.VALIDATION_ERROR
        assert "does not declare" in result.error_detail


class TestCognitiveRuntimeFailClosed:
    @pytest.mark.asyncio
    async def test_empty_facts_returns_insufficient_data(self):
        """Skill with required_capabilities must not reach model with empty facts."""
        runtime = _build_runtime()
        result = await runtime.execute(
            _request(),
            agent_definition=_agent(),
            facts={},  # empty!
            output_schema=GexInterpretation,
        )
        assert result.status == RunStatus.INSUFFICIENT_DATA
        assert "facts are empty" in result.error_detail

    @pytest.mark.asyncio
    async def test_guardrail_failure_result_is_null(self):
        """Guardrail failure must return result=None, not the rejected output."""
        register_canned_response("GexInterpretation", {
            "regime": "positive_gamma",
            "observations": ["Target price 999.99"],
            "implications": [],
            "quantitative_claims": [{"metric": "net_gex", "value": 1500000.0, "unit": "billion_usd"}],
            "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is positive"}],
            "limitations": ["Snapshot only"],
        })
        runtime = _build_runtime()
        result = await runtime.execute(
            _request(),
            agent_definition=_agent(),
            facts=_facts(),
            output_schema=GexInterpretation,
        )
        assert result.status == RunStatus.VALIDATION_ERROR
        assert result.result is None


class TestCognitiveRuntimeModelErrors:
    @pytest.mark.asyncio
    async def test_model_error_returns_model_error_status(self):
        provider = FakeProvider(force_error="simulated model failure")
        runtime = _build_runtime(provider=provider)
        result = await runtime.execute(
            _request(),
            agent_definition=_agent(),
            facts=_facts(),
            output_schema=GexInterpretation,
        )
        assert result.status == RunStatus.MODEL_ERROR
        assert "simulated model failure" in result.error_detail


class TestCognitiveRuntimeGuardrails:
    @pytest.mark.asyncio
    async def test_guardrail_catches_invented_numbers(self):
        register_canned_response("GexInterpretation", {
            "regime": "positive_gamma",
            "observations": ["Target price 475.0 based on analysis"],
            "implications": [],
            "quantitative_claims": [{"metric": "net_gex", "value": 1500000.0, "unit": "billion_usd"}],
            "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is positive"}],
            "limitations": ["Snapshot only"],
        })

        runtime = _build_runtime()
        result = await runtime.execute(
            _request(),
            agent_definition=_agent(),
            facts=_facts(),
            output_schema=GexInterpretation,
        )
        assert result.status == RunStatus.VALIDATION_ERROR
        assert "Guardrail failure" in result.error_detail
        assert "no_invented_numbers" in result.error_detail
        assert result.result is None  # fail-closed: rejected output never crosses boundary


class TestCognitiveRuntimeTrace:
    @pytest.mark.asyncio
    async def test_trace_records_agent_definition(self):
        register_canned_response("GexInterpretation", {
            "regime": "positive_gamma",
            "observations": ["net_gex is positive"],
            "implications": ["spot stable"],
            "quantitative_claims": [{"metric": "net_gex", "value": 1500000.0, "unit": "billion_usd"}],
            "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is positive"}],
            "limitations": ["snapshot only"],
        })

        runtime = _build_runtime()
        result = await runtime.execute(
            _request(),
            agent_definition=_agent(),
            facts=_facts(),
            output_schema=GexInterpretation,
        )
        assert result.trace.agent_definition.agent_id == "TradingAgent"
        assert result.trace.agent_definition.version == "1.0"

    @pytest.mark.asyncio
    async def test_trace_records_token_usage(self):
        register_canned_response("GexInterpretation", {
            "regime": "positive_gamma",
            "observations": ["net_gex is positive"],
            "implications": ["spot stable"],
            "quantitative_claims": [{"metric": "net_gex", "value": 1500000.0, "unit": "billion_usd"}],
            "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is positive"}],
            "limitations": ["snapshot"],
        })

        runtime = _build_runtime()
        result = await runtime.execute(
            _request(),
            agent_definition=_agent(),
            facts=_facts(),
            output_schema=GexInterpretation,
        )
        assert result.status == RunStatus.SUCCESS
        assert result.trace.input_tokens is not None
        assert result.trace.output_tokens is not None
