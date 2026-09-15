"""Unit tests for preflight checks."""

from galecore_ai.capabilities.contracts import KNOWN_CAPABILITIES
from galecore_ai.capabilities.registry import CapabilityRegistry
from galecore_ai.harness.definitions import AgentDefinition
from galecore_ai.harness.preflight import run_preflight
from galecore_ai.harness.skill_loader import SkillLoader


def _agent(skills=None, caps=None) -> AgentDefinition:
    return AgentDefinition(
        agent_id="test",
        version="1.0",
        display_name="Test",
        skills=skills or ["gex_interpretation"],
        allowed_capabilities=caps or ["compute.gamma_exposure"],
    )


def _skill_loader() -> SkillLoader:
    loader = SkillLoader()
    loader.load_from_dict({
        "skill_id": "gex_interpretation",
        "version": "1.0",
        "display_name": "GEX",
        "output_contract": "gex.GexInterpretation",
        "required_capabilities": ["compute.gamma_exposure"],
    })
    return loader


def _registry() -> CapabilityRegistry:
    reg = CapabilityRegistry()
    reg.register_many(KNOWN_CAPABILITIES)
    return reg


class TestPreflight:
    def test_all_checks_pass(self):
        result = run_preflight(
            agent=_agent(),
            skill_id="gex_interpretation",
            skill_loader=_skill_loader(),
            registry=_registry(),
        )
        assert result.passed
        assert len(result.errors) == 0

    def test_skill_not_found(self):
        result = run_preflight(
            agent=_agent(),
            skill_id="nonexistent_skill",
            skill_loader=_skill_loader(),
            registry=_registry(),
        )
        assert not result.passed
        assert any("not found" in e.lower() for e in result.errors)

    def test_agent_missing_skill(self):
        agent = _agent(skills=["other_skill"])
        result = run_preflight(
            agent=agent,
            skill_id="gex_interpretation",
            skill_loader=_skill_loader(),
            registry=_registry(),
        )
        assert not result.passed
        assert any("does not declare" in e for e in result.errors)

    def test_capability_not_registered(self):
        empty_reg = CapabilityRegistry()
        result = run_preflight(
            agent=_agent(),
            skill_id="gex_interpretation",
            skill_loader=_skill_loader(),
            registry=empty_reg,
        )
        assert not result.passed
        assert any("not found" in e.lower() for e in result.errors)

    def test_capability_not_in_agent_allowlist(self):
        agent = _agent(caps=["market_data.quote"])  # gamma_exposure NOT in list
        result = run_preflight(
            agent=agent,
            skill_id="gex_interpretation",
            skill_loader=_skill_loader(),
            registry=_registry(),
        )
        assert not result.passed
        assert any("not allowed" in e.lower() for e in result.errors)

    def test_all_checks_recorded(self):
        result = run_preflight(
            agent=_agent(),
            skill_id="gex_interpretation",
            skill_loader=_skill_loader(),
            registry=_registry(),
        )
        check_ids = [c.check_id for c in result.checks]
        assert "skill_exists" in check_ids
        assert "agent_has_skill" in check_ids
        assert "capability_compute.gamma_exposure" in check_ids
