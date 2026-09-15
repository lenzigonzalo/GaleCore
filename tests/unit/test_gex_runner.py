"""Unit tests for GexAnalysisRunner — the application service that fetches facts
from GaleCore and orchestrates the cognitive pipeline."""

import httpx
import pytest

from galecore_ai.capabilities.contracts import KNOWN_CAPABILITIES
from galecore_ai.capabilities.dispatcher import CapabilityDispatcher
from galecore_ai.capabilities.registry import CapabilityRegistry
from galecore_ai.contracts.agent_run import RunStatus
from galecore_ai.harness.convention_resolver import ConventionResolver
from galecore_ai.harness.definitions import AgentDefinition
from galecore_ai.harness.protocol_loader import ProtocolLoader
from galecore_ai.harness.runtime import CognitiveRuntime
from galecore_ai.harness.skill_loader import SkillLoader
from galecore_ai.models.providers.fake import (
    FakeProvider,
    clear_canned_responses,
    register_canned_response,
)
from galecore_ai.skills.gex_analysis.runner import (
    FactValidationError,
    GexAnalysisRunner,
)


@pytest.fixture(autouse=True)
def _clean():
    clear_canned_responses()
    yield
    clear_canned_responses()


def _make_registry() -> CapabilityRegistry:
    reg = CapabilityRegistry()
    reg.register_many(KNOWN_CAPABILITIES)
    return reg


def _make_runtime(provider: FakeProvider | None = None) -> CognitiveRuntime:
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

    return CognitiveRuntime(
        provider=provider or FakeProvider(),
        skill_loader=skill_loader,
        protocol_loader=protocol_loader,
        convention_resolver=ConventionResolver(),
        capability_registry=_make_registry(),
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


VALID_GEX_RESPONSE = {
    "symbol": "SPY",
    "net_gex": 1500000.0,
    "call_gex": 2000000.0,
    "put_gex": -500000.0,
    "spot": 450.50,
    "zero_gamma_level": 445.0,
    "call_wall": 460.0,
    "put_wall": 440.0,
}


def _mock_transport(response_json: dict, status_code: int = 200):
    """Build an httpx MockTransport returning given JSON."""
    return httpx.MockTransport(
        lambda request: httpx.Response(status_code, json=response_json)
    )


def _make_dispatcher(transport: httpx.MockTransport) -> CapabilityDispatcher:
    """Create a dispatcher that uses a mock transport."""
    d = CapabilityDispatcher(
        base_url="http://localhost:5000",
        registry=_make_registry(),
    )
    # Patch the invoke to use mock transport
    original_invoke = d.invoke

    async def mock_invoke(capability_id, parameters, *, agent_allowed=None):
        # For GEX capability, use mock transport directly
        if capability_id == "compute.gamma_exposure":
            async with httpx.AsyncClient(transport=transport) as client:
                resp = await client.get(
                    "http://localhost:5000/App.Analytics/GammaExposure",
                    params={"symbol": parameters.get("symbol", "SPY")},
                )
                from galecore_ai.capabilities.dispatcher import CapabilityResult

                if resp.status_code != 200:
                    return CapabilityResult(
                        capability_id, error=f"HTTP {resp.status_code}"
                    )
                return CapabilityResult(
                    capability_id, data=resp.json(), latency_ms=1
                )
        return await original_invoke(capability_id, parameters, agent_allowed=agent_allowed)

    d.invoke = mock_invoke
    return d


class TestGexAnalysisRunnerSuccess:
    @pytest.mark.asyncio
    async def test_successful_run_with_valid_gex_data(self):
        register_canned_response("GexInterpretation", {
            "regime": "positive_gamma",
            "observations": ["net_gex is positive at 1500000.0"],
            "implications": ["Mean reversion expected around spot 450.5"],
            "caveats": ["Based on current snapshot"],
        })

        transport = _mock_transport(VALID_GEX_RESPONSE)
        dispatcher = _make_dispatcher(transport)
        runner = GexAnalysisRunner(
            runtime=_make_runtime(),
            dispatcher=dispatcher,
        )

        result = await runner.run(
            symbol="SPY",
            agent_definition=_agent(),
        )

        assert result.status == RunStatus.SUCCESS
        assert result.result is not None
        assert result.result["regime"] == "positive_gamma"
        # Capability trace should be present
        cap_traces = [
            c for c in result.trace.capabilities_invoked
            if c["capability_id"] == "compute.gamma_exposure"
        ]
        assert len(cap_traces) >= 1
        assert cap_traces[0]["ok"] is True


class TestGexAnalysisRunnerInsufficientData:
    @pytest.mark.asyncio
    async def test_capability_fetch_failure(self):
        transport = _mock_transport({"error": "not found"}, status_code=404)
        dispatcher = _make_dispatcher(transport)
        runner = GexAnalysisRunner(
            runtime=_make_runtime(),
            dispatcher=dispatcher,
        )

        result = await runner.run(symbol="SPY", agent_definition=_agent())
        assert result.status == RunStatus.INSUFFICIENT_DATA
        assert "Capability fetch failed" in result.error_detail

    @pytest.mark.asyncio
    async def test_missing_required_field(self):
        incomplete = {
            "symbol": "SPY",
            "net_gex": 1500000.0,
            # missing call_gex, put_gex, spot
        }
        transport = _mock_transport(incomplete)
        dispatcher = _make_dispatcher(transport)
        runner = GexAnalysisRunner(
            runtime=_make_runtime(),
            dispatcher=dispatcher,
        )

        result = await runner.run(symbol="SPY", agent_definition=_agent())
        assert result.status == RunStatus.INSUFFICIENT_DATA
        assert "call_gex" in result.error_detail

    # NaN/Inf tests are in TestFactValidation since they can't round-trip through JSON

    @pytest.mark.asyncio
    async def test_symbol_mismatch_rejected(self):
        bad_data = {
            **VALID_GEX_RESPONSE,
            "symbol": "QQQ",
        }
        transport = _mock_transport(bad_data)
        dispatcher = _make_dispatcher(transport)
        runner = GexAnalysisRunner(
            runtime=_make_runtime(),
            dispatcher=dispatcher,
        )

        result = await runner.run(symbol="SPY", agent_definition=_agent())
        assert result.status == RunStatus.INSUFFICIENT_DATA
        assert "mismatch" in result.error_detail.lower()


class TestFactValidation:
    def test_null_payload_raises(self):
        runner = GexAnalysisRunner(
            runtime=_make_runtime(),
            dispatcher=CapabilityDispatcher(
                base_url="http://localhost:5000",
                registry=_make_registry(),
            ),
        )
        with pytest.raises(FactValidationError, match="Expected dict"):
            runner._validate_and_build_facts(None, "SPY")

    def test_list_payload_raises(self):
        runner = GexAnalysisRunner(
            runtime=_make_runtime(),
            dispatcher=CapabilityDispatcher(
                base_url="http://localhost:5000",
                registry=_make_registry(),
            ),
        )
        with pytest.raises(FactValidationError, match="Expected dict"):
            runner._validate_and_build_facts([], "SPY")

    def test_valid_data_builds_facts(self):
        runner = GexAnalysisRunner(
            runtime=_make_runtime(),
            dispatcher=CapabilityDispatcher(
                base_url="http://localhost:5000",
                registry=_make_registry(),
            ),
        )
        facts = runner._validate_and_build_facts(VALID_GEX_RESPONSE, "SPY")
        assert facts.symbol == "SPY"
        assert facts.net_gex == 1500000.0
        assert facts.spot == 450.50
        assert facts.zero_gamma_level == 445.0

    def test_non_numeric_field_raises(self):
        bad = {**VALID_GEX_RESPONSE, "spot": "not_a_number"}
        runner = GexAnalysisRunner(
            runtime=_make_runtime(),
            dispatcher=CapabilityDispatcher(
                base_url="http://localhost:5000",
                registry=_make_registry(),
            ),
        )
        with pytest.raises(FactValidationError, match="must be numeric"):
            runner._validate_and_build_facts(bad, "SPY")

    def test_nan_value_raises(self):
        bad = {**VALID_GEX_RESPONSE, "net_gex": float("nan")}
        runner = GexAnalysisRunner(
            runtime=_make_runtime(),
            dispatcher=CapabilityDispatcher(
                base_url="http://localhost:5000",
                registry=_make_registry(),
            ),
        )
        with pytest.raises(FactValidationError, match="not finite"):
            runner._validate_and_build_facts(bad, "SPY")

    def test_inf_value_raises(self):
        bad = {**VALID_GEX_RESPONSE, "spot": float("inf")}
        runner = GexAnalysisRunner(
            runtime=_make_runtime(),
            dispatcher=CapabilityDispatcher(
                base_url="http://localhost:5000",
                registry=_make_registry(),
            ),
        )
        with pytest.raises(FactValidationError, match="not finite"):
            runner._validate_and_build_facts(bad, "SPY")
