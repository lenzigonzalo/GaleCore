"""Unit tests for Harness definition models."""

from galecore_ai.harness.definitions import (
    AgentDefinition,
    ConventionEntry,
    ConventionPrecedence,
    ConventionSet,
    ProtocolDefinition,
    ProtocolStep,
    SkillDefinition,
)


class TestAgentDefinition:
    def test_create_minimal(self):
        agent = AgentDefinition(
            agent_id="test_agent",
            version="1.0.0",
            display_name="Test Agent",
        )
        assert agent.agent_id == "test_agent"
        assert agent.skills == []
        assert agent.model_preferences.provider == "fake"

    def test_with_skills_and_protocols(self):
        agent = AgentDefinition(
            agent_id="trading",
            version="1.0.0",
            display_name="Trading Agent",
            skills=["gex_interpretation"],
            protocols=["facts_discipline"],
            conventions=["trading_defaults"],
        )
        assert "gex_interpretation" in agent.skills
        assert "facts_discipline" in agent.protocols


class TestSkillDefinition:
    def test_create(self):
        skill = SkillDefinition(
            skill_id="test_skill",
            version="1.0.0",
            display_name="Test",
            output_contract="some.module.OutputModel",
            system_prompt="You are a test.",
        )
        assert skill.skill_id == "test_skill"
        assert skill.output_contract == "some.module.OutputModel"

    def test_required_capabilities(self):
        skill = SkillDefinition(
            skill_id="gex",
            version="1.0.0",
            display_name="GEX",
            output_contract="gex.GexInterpretation",
            required_capabilities=["compute.gamma_exposure"],
        )
        assert "compute.gamma_exposure" in skill.required_capabilities


class TestProtocolDefinition:
    def test_create_with_steps(self):
        proto = ProtocolDefinition(
            protocol_id="test_proto",
            version="1.0.0",
            display_name="Test Protocol",
            steps=[
                ProtocolStep(step_id="s1", description="Step 1"),
                ProtocolStep(step_id="s2", description="Step 2", required=False),
            ],
        )
        assert len(proto.steps) == 2
        assert proto.steps[0].required is True
        assert proto.steps[1].required is False

    def test_default_trigger_is_always(self):
        proto = ProtocolDefinition(
            protocol_id="p", version="1.0", display_name="P",
        )
        assert proto.trigger == "always"


class TestConventionSet:
    def test_create_with_entries(self):
        cs = ConventionSet(
            convention_id="test",
            version="1.0.0",
            display_name="Test",
            entries=[
                ConventionEntry(key="k1", value=42, precedence=ConventionPrecedence.DOMAIN),
                ConventionEntry(key="k2", value="hello", precedence=ConventionPrecedence.USER),
            ],
        )
        assert len(cs.entries) == 2
        assert cs.entries[1].precedence == ConventionPrecedence.USER
