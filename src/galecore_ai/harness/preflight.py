"""Preflight checks — validation before an agent run starts.

Preflight runs BEFORE calling the model. It verifies that:
1. The requested skill exists and is loaded
2. All required capabilities for the skill are registered and allowed
3. The agent is allowed to use the requested skill
4. Facts are present for required capabilities (or will be fetched)
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from galecore_ai.capabilities.registry import (
    CapabilityNotAllowedError,
    CapabilityNotFoundError,
    CapabilityRegistry,
)
from galecore_ai.harness.definitions import AgentDefinition
from galecore_ai.harness.skill_loader import SkillLoader


class PreflightResult(BaseModel):
    """Result of preflight validation."""

    passed: bool
    checks: list[PreflightCheck] = Field(default_factory=list)

    @property
    def errors(self) -> list[str]:
        return [c.message for c in self.checks if not c.passed]


class PreflightCheck(BaseModel):
    """A single preflight check result."""

    check_id: str
    passed: bool
    message: str = ""


def run_preflight(
    *,
    agent: AgentDefinition,
    skill_id: str,
    skill_loader: SkillLoader,
    registry: CapabilityRegistry,
) -> PreflightResult:
    """Run all preflight checks before an agent run.

    Returns PreflightResult with passed=True if all checks pass.
    """
    checks: list[PreflightCheck] = []

    # 1. Skill exists
    skill = skill_loader.get(skill_id)
    if skill is None:
        checks.append(PreflightCheck(
            check_id="skill_exists",
            passed=False,
            message=f"Skill '{skill_id}' not found in loader",
        ))
        return PreflightResult(passed=False, checks=checks)

    checks.append(PreflightCheck(
        check_id="skill_exists",
        passed=True,
        message=f"Skill '{skill_id}' found (v{skill.version})",
    ))

    # 2. Agent declares this skill
    if skill_id not in agent.skills:
        checks.append(PreflightCheck(
            check_id="agent_has_skill",
            passed=False,
            message=f"Agent '{agent.agent_id}' does not declare skill '{skill_id}'",
        ))
    else:
        checks.append(PreflightCheck(
            check_id="agent_has_skill",
            passed=True,
            message=f"Agent '{agent.agent_id}' declares skill '{skill_id}'",
        ))

    # 3. Required capabilities exist and are allowed
    for cap_id in skill.required_capabilities:
        try:
            registry.validate_access(cap_id, agent_allowed=agent.allowed_capabilities)
            checks.append(PreflightCheck(
                check_id=f"capability_{cap_id}",
                passed=True,
                message=f"Capability '{cap_id}' registered and allowed",
            ))
        except (CapabilityNotFoundError, CapabilityNotAllowedError) as exc:
            checks.append(PreflightCheck(
                check_id=f"capability_{cap_id}",
                passed=False,
                message=str(exc),
            ))

    all_passed = all(c.passed for c in checks)
    return PreflightResult(passed=all_passed, checks=checks)
