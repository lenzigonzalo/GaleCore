"""Unit tests for ContextAssembler."""

from galecore_ai.harness.context_assembler import ContextAssembler
from galecore_ai.harness.convention_resolver import ConventionResolver
from galecore_ai.harness.definitions import (
    AgentDefinition,
    ConventionEntry,
    ConventionPrecedence,
    ConventionSet,
    ProtocolDefinition,
    ProtocolStep,
    SkillDefinition,
)
from galecore_ai.models.provider import ModelRole


def _agent() -> AgentDefinition:
    return AgentDefinition(
        agent_id="test_agent", version="1.0", display_name="Test Agent",
        description="A test agent.",
    )


def _skill() -> SkillDefinition:
    return SkillDefinition(
        skill_id="test_skill", version="1.0", display_name="Test Skill",
        output_contract="test.Output",
        system_prompt="You are a test analyst.",
        instructions="Analyze the data and produce output.",
    )


def _protocol() -> ProtocolDefinition:
    return ProtocolDefinition(
        protocol_id="test_proto", version="1.0", display_name="Test Protocol",
        steps=[
            ProtocolStep(step_id="s1", description="Check facts", required=True),
            ProtocolStep(step_id="s2", description="State caveats", required=False),
        ],
        guardrails=["no_invented_numbers"],
    )


def _conventions() -> ConventionResolver:
    resolver = ConventionResolver()
    resolver.load(ConventionSet(
        convention_id="test", version="1.0", display_name="Test",
        entries=[
            ConventionEntry(key="timezone", value="America/New_York", precedence=ConventionPrecedence.DOMAIN),
        ],
    ))
    return resolver


class TestContextAssembler:
    def test_assembles_system_prompt(self):
        assembler = ContextAssembler()
        ctx = assembler.assemble(
            agent=_agent(),
            skill=_skill(),
            protocols=[_protocol()],
            conventions=_conventions(),
            facts={"net_gex": 1500000, "spot": 450.5},
            user_message="Analyze GEX for SPY",
        )
        assert "Test Agent" in ctx.system_prompt
        assert "Test Skill" in ctx.system_prompt
        assert "You are a test analyst." in ctx.system_prompt
        assert "Analyze the data" in ctx.system_prompt

    def test_includes_protocol_steps(self):
        assembler = ContextAssembler()
        ctx = assembler.assemble(
            agent=_agent(),
            skill=_skill(),
            protocols=[_protocol()],
            conventions=_conventions(),
            facts={},
            user_message="test",
        )
        assert "Check facts" in ctx.system_prompt
        assert "required" in ctx.system_prompt.lower()
        assert len(ctx.protocol_instructions) > 0

    def test_includes_conventions(self):
        assembler = ContextAssembler()
        ctx = assembler.assemble(
            agent=_agent(),
            skill=_skill(),
            protocols=[],
            conventions=_conventions(),
            facts={},
            user_message="test",
        )
        assert "America/New_York" in ctx.system_prompt
        assert ctx.conventions == {"timezone": "America/New_York"}

    def test_includes_facts(self):
        assembler = ContextAssembler()
        facts = {"net_gex": 1500000, "spot": 450.5}
        ctx = assembler.assemble(
            agent=_agent(),
            skill=_skill(),
            protocols=[],
            conventions=_conventions(),
            facts=facts,
            user_message="test",
        )
        assert "1500000" in ctx.system_prompt
        assert "450.5" in ctx.system_prompt
        assert "do not invent" in ctx.system_prompt.lower()
        assert ctx.facts == facts

    def test_user_message_becomes_first_message(self):
        assembler = ContextAssembler()
        ctx = assembler.assemble(
            agent=_agent(),
            skill=_skill(),
            protocols=[],
            conventions=_conventions(),
            facts={},
            user_message="Analyze SPY GEX",
        )
        assert len(ctx.messages) == 1
        assert ctx.messages[0].role == ModelRole.USER
        assert ctx.messages[0].content == "Analyze SPY GEX"

    def test_metadata_populated(self):
        assembler = ContextAssembler()
        ctx = assembler.assemble(
            agent=_agent(),
            skill=_skill(),
            protocols=[_protocol()],
            conventions=_conventions(),
            facts={},
            user_message="test",
        )
        assert ctx.metadata["agent_id"] == "test_agent"
        assert ctx.metadata["skill_id"] == "test_skill"
        assert "test_proto" in ctx.metadata["protocol_ids"]
