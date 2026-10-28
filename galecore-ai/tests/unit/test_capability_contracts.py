"""Unit tests for capability contracts."""

from galecore_ai.capabilities.contracts import (
    KNOWN_CAPABILITIES,
    PHASE3_ALLOWED_CLASSES,
    CapabilityDefinition,
    SemanticClass,
)


class TestSemanticClass:
    def test_phase3_allows_only_read(self):
        assert SemanticClass.PURE_QUERY in PHASE3_ALLOWED_CLASSES
        assert SemanticClass.COMPUTE in PHASE3_ALLOWED_CLASSES
        assert SemanticClass.STATE_MUTATION not in PHASE3_ALLOWED_CLASSES
        assert SemanticClass.EXTERNAL_ACTION not in PHASE3_ALLOWED_CLASSES


class TestCapabilityDefinition:
    def test_pure_query_is_phase3_allowed(self):
        cap = CapabilityDefinition(
            capability_id="test.query",
            semantic_class=SemanticClass.PURE_QUERY,
            description="test",
        )
        assert cap.is_phase3_allowed()

    def test_compute_is_phase3_allowed(self):
        cap = CapabilityDefinition(
            capability_id="test.compute",
            semantic_class=SemanticClass.COMPUTE,
            description="test",
        )
        assert cap.is_phase3_allowed()

    def test_state_mutation_not_phase3_allowed(self):
        cap = CapabilityDefinition(
            capability_id="test.mutate",
            semantic_class=SemanticClass.STATE_MUTATION,
            description="test",
        )
        assert not cap.is_phase3_allowed()

    def test_external_action_not_phase3_allowed(self):
        cap = CapabilityDefinition(
            capability_id="test.external",
            semantic_class=SemanticClass.EXTERNAL_ACTION,
            description="test",
        )
        assert not cap.is_phase3_allowed()


class TestKnownCapabilities:
    def test_all_known_are_phase3_allowed(self):
        for cap in KNOWN_CAPABILITIES:
            assert cap.is_phase3_allowed(), f"{cap.capability_id} not phase3-allowed"

    def test_market_data_quote_exists(self):
        ids = [c.capability_id for c in KNOWN_CAPABILITIES]
        assert "market_data.quote" in ids

    def test_gamma_exposure_exists(self):
        ids = [c.capability_id for c in KNOWN_CAPABILITIES]
        assert "compute.gamma_exposure" in ids
