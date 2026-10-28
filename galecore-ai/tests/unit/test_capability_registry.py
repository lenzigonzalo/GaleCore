"""Unit tests for CapabilityRegistry."""

import pytest

from galecore_ai.capabilities.contracts import (
    KNOWN_CAPABILITIES,
    CapabilityDefinition,
    SemanticClass,
)
from galecore_ai.capabilities.registry import (
    CapabilityNotAllowedError,
    CapabilityNotFoundError,
    CapabilityRegistry,
)


def _query_cap(cap_id: str = "test.query") -> CapabilityDefinition:
    return CapabilityDefinition(
        capability_id=cap_id,
        semantic_class=SemanticClass.PURE_QUERY,
        description="test query",
    )


def _compute_cap(cap_id: str = "test.compute") -> CapabilityDefinition:
    return CapabilityDefinition(
        capability_id=cap_id,
        semantic_class=SemanticClass.COMPUTE,
        description="test compute",
    )


def _mutation_cap(cap_id: str = "test.mutate") -> CapabilityDefinition:
    return CapabilityDefinition(
        capability_id=cap_id,
        semantic_class=SemanticClass.STATE_MUTATION,
        description="test mutation",
    )


class TestCapabilityRegistry:
    def test_register_and_get(self):
        reg = CapabilityRegistry()
        cap = _query_cap()
        reg.register(cap)
        assert reg.get("test.query") is cap

    def test_get_not_found(self):
        reg = CapabilityRegistry()
        with pytest.raises(CapabilityNotFoundError):
            reg.get("nonexistent")

    def test_register_many(self):
        reg = CapabilityRegistry()
        reg.register_many(KNOWN_CAPABILITIES)
        assert len(reg.list_all()) == len(KNOWN_CAPABILITIES)

    def test_validate_access_pure_query(self):
        reg = CapabilityRegistry()
        reg.register(_query_cap())
        reg.validate_access("test.query")  # should not raise

    def test_validate_access_compute(self):
        reg = CapabilityRegistry()
        reg.register(_compute_cap())
        reg.validate_access("test.compute")  # should not raise

    def test_validate_access_mutation_blocked(self):
        reg = CapabilityRegistry()
        reg.register(_mutation_cap())
        with pytest.raises(CapabilityNotAllowedError, match="STATE_MUTATION"):
            reg.validate_access("test.mutate")

    def test_validate_access_external_action_blocked(self):
        reg = CapabilityRegistry()
        cap = CapabilityDefinition(
            capability_id="test.external",
            semantic_class=SemanticClass.EXTERNAL_ACTION,
            description="test",
        )
        reg.register(cap)
        with pytest.raises(CapabilityNotAllowedError, match="EXTERNAL_ACTION"):
            reg.validate_access("test.external")

    def test_validate_access_agent_allowlist(self):
        reg = CapabilityRegistry()
        reg.register(_query_cap("market_data.quote"))
        reg.register(_query_cap("market_data.trade"))

        # Agent only allowed market_data.quote
        reg.validate_access("market_data.quote", agent_allowed=["market_data.quote"])

        with pytest.raises(CapabilityNotAllowedError, match="not allowed"):
            reg.validate_access("market_data.trade", agent_allowed=["market_data.quote"])

    def test_validate_access_not_found(self):
        reg = CapabilityRegistry()
        with pytest.raises(CapabilityNotFoundError):
            reg.validate_access("nonexistent")

    def test_list_all(self):
        reg = CapabilityRegistry()
        reg.register(_query_cap())
        reg.register(_mutation_cap())
        assert len(reg.list_all()) == 2

    def test_list_allowed(self):
        reg = CapabilityRegistry()
        reg.register(_query_cap())
        reg.register(_mutation_cap())
        allowed = reg.list_allowed()
        assert len(allowed) == 1
        assert allowed[0].capability_id == "test.query"

    def test_clear(self):
        reg = CapabilityRegistry()
        reg.register(_query_cap())
        reg.clear()
        assert len(reg.list_all()) == 0
