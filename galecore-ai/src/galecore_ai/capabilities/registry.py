"""CapabilityRegistry — discovers, registers, and validates capability access.

The registry is the single source of truth for what capabilities exist and
whether the current phase/agent is allowed to invoke them.
"""

from __future__ import annotations

import logging

from galecore_ai.capabilities.contracts import (
    PHASE3_ALLOWED_CLASSES,
    CapabilityDefinition,
    SemanticClass,
)

logger = logging.getLogger(__name__)


class CapabilityNotFoundError(Exception):
    """Raised when a capability_id is not registered."""


class CapabilityNotAllowedError(Exception):
    """Raised when a capability exists but is not allowed in the current phase/context."""


class CapabilityRegistry:
    """Registry of GaleCore capabilities available to the AI layer.

    Enforces:
    - Phase 3 allowlist (only PURE_QUERY and COMPUTE)
    - Agent-level capability restrictions (allowed_capabilities list)
    """

    def __init__(
        self,
        *,
        allowed_classes: frozenset[SemanticClass] = PHASE3_ALLOWED_CLASSES,
    ) -> None:
        self._capabilities: dict[str, CapabilityDefinition] = {}
        self._allowed_classes = allowed_classes

    def register(self, capability: CapabilityDefinition) -> None:
        """Register a capability definition."""
        if capability.capability_id in self._capabilities:
            logger.warning("Overwriting capability %s", capability.capability_id)
        self._capabilities[capability.capability_id] = capability

    def register_many(self, capabilities: list[CapabilityDefinition]) -> None:
        for cap in capabilities:
            self.register(cap)

    def get(self, capability_id: str) -> CapabilityDefinition:
        """Get a capability by ID. Raises CapabilityNotFoundError if not registered."""
        cap = self._capabilities.get(capability_id)
        if cap is None:
            raise CapabilityNotFoundError(f"Capability not found: {capability_id}")
        return cap

    def validate_access(
        self,
        capability_id: str,
        *,
        agent_allowed: list[str] | None = None,
    ) -> None:
        """Validate that a capability can be invoked.

        Checks:
        1. Capability exists in registry
        2. Semantic class is in the allowed set (Phase 3: PURE_QUERY, COMPUTE)
        3. If agent_allowed is provided, capability_id must be in that list

        Raises CapabilityNotFoundError or CapabilityNotAllowedError.
        """
        cap = self.get(capability_id)

        if cap.semantic_class not in self._allowed_classes:
            raise CapabilityNotAllowedError(
                f"Capability {capability_id} has class {cap.semantic_class.value} "
                f"which is not in the allowed set: {[c.value for c in self._allowed_classes]}"
            )

        if agent_allowed is not None and capability_id not in agent_allowed:
            raise CapabilityNotAllowedError(
                f"Agent is not allowed to invoke capability {capability_id}. "
                f"Allowed: {agent_allowed}"
            )

    def list_all(self) -> list[CapabilityDefinition]:
        """List all registered capabilities."""
        return list(self._capabilities.values())

    def list_allowed(self) -> list[CapabilityDefinition]:
        """List only capabilities whose semantic class is in the allowed set."""
        return [c for c in self._capabilities.values() if c.semantic_class in self._allowed_classes]

    def clear(self) -> None:
        self._capabilities.clear()
