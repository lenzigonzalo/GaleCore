"""ContextAssembler — builds the reasoning context for an agent run.

Collects facts from capabilities, conventions, skill instructions, and
protocol steps into a structured context that the agent uses for reasoning.

Phase 3: read-only context from PURE_QUERY and COMPUTE capabilities only.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from galecore_ai.harness.convention_resolver import ConventionResolver
from galecore_ai.harness.definitions import (
    AgentDefinition,
    ProtocolDefinition,
    SkillDefinition,
)
from galecore_ai.models.provider import ModelMessage, ModelRole


class AssembledContext(BaseModel):
    """The complete context assembled for a single agent reasoning cycle."""

    system_prompt: str
    messages: list[ModelMessage] = Field(default_factory=list)
    facts: dict = Field(default_factory=dict)
    conventions: dict = Field(default_factory=dict)
    protocol_instructions: list[str] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)


class ContextAssembler:
    """Assembles context for an agent run from skills, protocols, conventions, and facts."""

    def assemble(
        self,
        *,
        agent: AgentDefinition,
        skill: SkillDefinition,
        protocols: list[ProtocolDefinition],
        conventions: ConventionResolver,
        facts: dict,
        user_message: str,
    ) -> AssembledContext:
        """Build a complete reasoning context.

        Args:
            agent: The agent definition being run.
            skill: The skill being executed.
            protocols: Active protocols for this run.
            conventions: Resolved conventions.
            facts: Deterministic data from GaleCore capabilities.
            user_message: The task/question to reason about.
        """
        # Build system prompt from agent + skill
        system_parts: list[str] = []

        if agent.description:
            system_parts.append(f"# Agent: {agent.display_name}\n{agent.description}")

        if skill.system_prompt:
            system_parts.append(f"# Skill: {skill.display_name}\n{skill.system_prompt}")

        if skill.instructions:
            system_parts.append(f"# Instructions\n{skill.instructions}")

        # Inject protocol steps as reasoning constraints
        protocol_instructions: list[str] = []
        for proto in protocols:
            steps_text = "\n".join(
                f"  {i+1}. {s.description}" + (" (required)" if s.required else " (optional)")
                for i, s in enumerate(proto.steps)
            )
            protocol_instructions.append(
                f"Protocol '{proto.display_name}':\n{steps_text}"
            )
            if proto.guardrails:
                protocol_instructions.append(
                    f"Guardrails: {', '.join(proto.guardrails)}"
                )

        if protocol_instructions:
            system_parts.append("# Reasoning Protocols\n" + "\n\n".join(protocol_instructions))

        # Inject conventions
        resolved_conventions = conventions.get_all()
        if resolved_conventions:
            conv_lines = [f"  - {k}: {v}" for k, v in resolved_conventions.items()]
            system_parts.append("# Domain Conventions\n" + "\n".join(conv_lines))

        # Inject facts as structured data
        if facts:
            system_parts.append(
                "# Facts (deterministic data — do not invent or recalculate)\n"
                "The following facts come from GaleCore's deterministic computations. "
                "Use them as-is. Do not invent new numbers.\n"
                f"```json\n{_format_facts(facts)}\n```"
            )

        system_prompt = "\n\n".join(system_parts)

        # Build user message
        messages = [ModelMessage(role=ModelRole.USER, content=user_message)]

        return AssembledContext(
            system_prompt=system_prompt,
            messages=messages,
            facts=facts,
            conventions=resolved_conventions,
            protocol_instructions=protocol_instructions,
            metadata={
                "agent_id": agent.agent_id,
                "agent_version": agent.version,
                "skill_id": skill.skill_id,
                "skill_version": skill.version,
                "protocol_ids": [p.protocol_id for p in protocols],
            },
        )


def _format_facts(facts: dict) -> str:
    """Format facts dict as indented JSON for the system prompt."""
    import json

    return json.dumps(facts, indent=2, default=str)
