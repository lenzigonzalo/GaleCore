"""Compatibility factory backed by the canonical versioned cognitive asset."""

from galecore_ai.harness.assets import load_asset
from galecore_ai.harness.definitions import ProtocolDefinition


def build_facts_discipline_protocol() -> ProtocolDefinition:
    return load_asset("protocols/facts-discipline.yaml", ProtocolDefinition)
