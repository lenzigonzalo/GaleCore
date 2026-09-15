"""Unit tests for AnalyzeGexUseCase — the application service that fetches facts
from GaleCore and orchestrates the cognitive pipeline."""

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from galecore_ai.application.analyze_gex import GEX_CAPABILITY_ID, AnalyzeGexUseCase
from galecore_ai.capabilities.contracts import KNOWN_CAPABILITIES
from galecore_ai.capabilities.dispatcher import CapabilityResult
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

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures" / "galecore"


@pytest.fixture(autouse=True)
def _clean():
    clear_canned_responses()
    yield
    clear_canned_responses()


def _load_fixture(name: str = "gex_analysis_spy.json", *, fresh: bool = False) -> dict:
    data = json.loads((FIXTURES_DIR / name).read_text())
    if fresh:
        data["timestamp"] = datetime.now(tz=UTC).isoformat()
    return data


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
        "required_capabilities": ["compute.gex_analysis"],
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
        allowed_capabilities=["compute.gex_analysis", "compute.gamma_exposure", "market_data.quote"],
    )


def _mock_use_case(
    response_data: dict | None = None,
    cap_error: str | None = None,
    allow_unknown_freshness: bool = True,
) -> AnalyzeGexUseCase:
    """Build use case with a mock dispatcher."""
    runtime = _make_runtime()
    use_case = AnalyzeGexUseCase(
        runtime=runtime,
        dispatcher=None,  # type: ignore[arg-type]  # we patch invoke
        allow_unknown_freshness=allow_unknown_freshness,
    )

    # Patch dispatcher invoke
    async def mock_invoke(capability_id, parameters, *, agent_allowed=None):
        if cap_error:
            return CapabilityResult(capability_id, error=cap_error, latency_ms=1)
        return CapabilityResult(capability_id, data=response_data, latency_ms=5)

    # Create a minimal dispatcher-like object
    class MockDispatcher:
        invoke = staticmethod(mock_invoke)

    use_case._dispatcher = MockDispatcher()
    return use_case


class TestAnalyzeGexSuccess:
    @pytest.mark.asyncio
    async def test_successful_run_with_real_fixture(self):
        """SUCCESS case with realistic camelCase GaleCore response."""
        register_canned_response("GexInterpretation", {
            "regime": "positive_gamma",
            "observations": ["net_gex is positive at 1500.0"],
            "implications": ["Mean reversion expected around spot 450.5"],
            "caveats": ["Based on current snapshot"],
        })

        fixture = _load_fixture(fresh=True)
        use_case = _mock_use_case(fixture, allow_unknown_freshness=True)

        result = await use_case.run(symbol="SPY", agent_definition=_agent())

        assert result.status == RunStatus.SUCCESS
        assert result.result is not None
        assert result.result["regime"] == "positive_gamma"

        # Capability trace present
        cap_traces = [
            c for c in result.trace.capabilities_invoked
            if c.capability_id == GEX_CAPABILITY_ID
        ]
        assert len(cap_traces) >= 1
        assert cap_traces[0].outcome == "ok"


class TestAnalyzeGexInsufficientData:
    @pytest.mark.asyncio
    async def test_capability_fetch_failure(self):
        use_case = _mock_use_case(cap_error="Connection refused")
        result = await use_case.run(symbol="SPY", agent_definition=_agent())
        assert result.status == RunStatus.INSUFFICIENT_DATA
        assert "Capability fetch failed" in result.error_detail

    @pytest.mark.asyncio
    async def test_null_payload(self):
        use_case = _mock_use_case(response_data=None, allow_unknown_freshness=True)
        # Dispatcher returns ok=False when data is None
        result = await use_case.run(symbol="SPY", agent_definition=_agent())
        assert result.status == RunStatus.INSUFFICIENT_DATA

    @pytest.mark.asyncio
    async def test_symbol_mismatch(self):
        fixture = _load_fixture()
        fixture["symbol"] = "QQQ"
        use_case = _mock_use_case(fixture, allow_unknown_freshness=True)
        result = await use_case.run(symbol="SPY", agent_definition=_agent())
        assert result.status == RunStatus.INSUFFICIENT_DATA
        assert "mismatch" in result.error_detail.lower()

    @pytest.mark.asyncio
    async def test_unknown_freshness_blocked_by_default(self):
        """UNKNOWN freshness → INSUFFICIENT_DATA when allow_unknown_freshness=False."""
        fixture = _load_fixture()
        fixture["timestamp"] = None  # no timestamp → UNKNOWN
        use_case = _mock_use_case(fixture, allow_unknown_freshness=False)
        result = await use_case.run(symbol="SPY", agent_definition=_agent())
        assert result.status == RunStatus.INSUFFICIENT_DATA
        assert "UNKNOWN" in result.error_detail

    @pytest.mark.asyncio
    async def test_stale_data_rejected(self):
        """Stale data → INSUFFICIENT_DATA."""
        fixture = _load_fixture()
        fixture["timestamp"] = "2020-01-01T00:00:00"  # very old
        use_case = _mock_use_case(fixture, allow_unknown_freshness=True)
        result = await use_case.run(symbol="SPY", agent_definition=_agent())
        assert result.status == RunStatus.INSUFFICIENT_DATA
        assert "stale" in result.error_detail.lower() or "STALE" in result.error_detail
