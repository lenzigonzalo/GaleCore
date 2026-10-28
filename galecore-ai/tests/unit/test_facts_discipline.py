"""Unit tests for the facts_discipline protocol."""

from galecore_ai.protocols.facts_discipline import build_facts_discipline_protocol


class TestFactsDisciplineProtocol:
    def test_protocol_id(self):
        proto = build_facts_discipline_protocol()
        assert proto.protocol_id == "facts_discipline"

    def test_trigger_is_always(self):
        proto = build_facts_discipline_protocol()
        assert proto.trigger == "always"

    def test_has_required_steps(self):
        proto = build_facts_discipline_protocol()
        assert len(proto.steps) >= 3
        assert all(s.required for s in proto.steps)

    def test_has_guardrails(self):
        proto = build_facts_discipline_protocol()
        assert "no_invented_numbers" in proto.guardrails

    def test_no_invention_step_exists(self):
        proto = build_facts_discipline_protocol()
        step_ids = [s.step_id for s in proto.steps]
        assert "no_invention" in step_ids
