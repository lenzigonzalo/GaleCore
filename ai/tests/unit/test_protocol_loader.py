"""Unit tests for ProtocolLoader."""

from galecore_ai.harness.definitions import ProtocolDefinition
from galecore_ai.harness.protocol_loader import ProtocolLoader


class TestProtocolLoader:
    def test_register_and_get(self):
        loader = ProtocolLoader()
        proto = ProtocolDefinition(
            protocol_id="test", version="1.0", display_name="Test",
        )
        loader.register(proto)
        assert loader.get("test") is proto

    def test_load_from_dict(self):
        loader = ProtocolLoader()
        proto = loader.load_from_dict({
            "protocol_id": "from_dict",
            "version": "1.0",
            "display_name": "From Dict",
            "steps": [{"step_id": "s1", "description": "Do something"}],
        })
        assert proto.protocol_id == "from_dict"
        assert len(proto.steps) == 1

    def test_get_for_trigger_always(self):
        loader = ProtocolLoader()
        loader.load_from_dict({
            "protocol_id": "always_proto",
            "version": "1.0",
            "display_name": "Always",
            "trigger": "always",
        })
        loader.load_from_dict({
            "protocol_id": "gex_only",
            "version": "1.0",
            "display_name": "GEX Only",
            "trigger": "gex_interpretation",
        })
        loader.load_from_dict({
            "protocol_id": "other",
            "version": "1.0",
            "display_name": "Other",
            "trigger": "some_other_skill",
        })

        # For gex_interpretation: should get "always" + "gex_only"
        matched = loader.get_for_trigger("gex_interpretation")
        ids = [p.protocol_id for p in matched]
        assert "always_proto" in ids
        assert "gex_only" in ids
        assert "other" not in ids

    def test_get_for_trigger_always_only(self):
        loader = ProtocolLoader()
        loader.load_from_dict({
            "protocol_id": "always",
            "version": "1.0",
            "display_name": "Always",
            "trigger": "always",
        })
        matched = loader.get_for_trigger("any_skill")
        assert len(matched) == 1
        assert matched[0].protocol_id == "always"

    def test_clear(self):
        loader = ProtocolLoader()
        loader.load_from_dict({
            "protocol_id": "x", "version": "1.0", "display_name": "X",
        })
        loader.clear()
        assert len(loader.protocols) == 0
