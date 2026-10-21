"""Harness definitions — agent, skill, protocol, and convention schemas.

These Pydantic models define the shape of YAML/JSON definition files
that configure the Harness at startup. They are NOT runtime state.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field

# ── Agent Definition ──────────────────────────────────────────────


class AgentDefinition(BaseModel):
    """Declares an agent's identity, capabilities, and constraints."""

    agent_id: str
    version: str
    display_name: str
    description: str = ""
    skills: list[str] = Field(default_factory=list)       # skill IDs this agent can use
    protocols: list[str] = Field(default_factory=list)     # protocol IDs this agent must follow
    conventions: list[str] = Field(default_factory=list)   # convention IDs applied to this agent
    allowed_capabilities: list[str] = Field(default_factory=list)  # capability IDs this agent can invoke
    model_preferences: ModelPreferences = Field(default_factory=lambda: ModelPreferences())


class ModelPreferences(BaseModel):
    """Preferred model configuration for an agent."""

    provider: str = "fake"       # default to fake for testing
    model: str | None = None
    temperature: float = 0.0
    max_tokens: int = 4096


# ── Skill Definition ─────────────────────────────────────────────


class SkillDefinition(BaseModel):
    """A Skill teaches the agent domain expertise for a specific task.

    Skills are the unit of cognitive reuse. Each skill declares:
    - what it needs (required context, capabilities)
    - what it produces (output schema)
    - how to prompt the model (system prompt, instructions)
    """

    skill_id: str
    version: str
    display_name: str
    description: str = ""
    required_capabilities: list[str] = Field(default_factory=list)
    output_contract: str  # fully qualified class name of the Pydantic output model
    system_prompt: str = ""
    instructions: str = ""
    answer: str = ""  # «cómo responder»: what the Lab pastes into the turn
    examples: list[SkillExample] = Field(default_factory=list)


class SkillExample(BaseModel):
    """An input/output example for few-shot prompting within a skill."""

    input_summary: str
    expected_output: dict


# ── Protocol Definition ──────────────────────────────────────────


class ProtocolStep(BaseModel):
    """A single step in a cognitive protocol."""

    step_id: str
    description: str
    required: bool = True


class ProtocolDefinition(BaseModel):
    """A Protocol defines required reasoning steps and guardrails.

    Protocols ensure the agent follows a structured reasoning process.
    They are validation/process constraints, not domain knowledge (that's Skills).
    """

    protocol_id: str
    version: str
    display_name: str
    description: str = ""
    trigger: str = "always"  # when this protocol applies: "always", skill_id, task_type
    steps: list[ProtocolStep] = Field(default_factory=list)
    guardrails: list[str] = Field(default_factory=list)  # guardrail rule IDs


# ── Convention Definition ─────────────────────────────────────────


class ConventionPrecedence(str, Enum):
    """Three-tier convention precedence per v4."""

    DOMAIN = "domain"           # built-in trading conventions (lowest priority)
    METHODOLOGY = "methodology"  # discipline-specific overrides
    USER = "user"               # user-specified overrides (highest priority)


class ConventionEntry(BaseModel):
    """A single convention key-value with its precedence tier."""

    key: str
    value: str | float | int | bool | list | dict
    precedence: ConventionPrecedence = ConventionPrecedence.DOMAIN
    description: str = ""


class ConventionSet(BaseModel):
    """A named set of conventions."""

    convention_id: str
    version: str
    display_name: str
    description: str = ""
    entries: list[ConventionEntry] = Field(default_factory=list)
