"""Compatibility factory backed by the canonical versioned cognitive asset."""

from galecore_ai.harness.assets import load_asset
from galecore_ai.harness.definitions import ConventionSet


def build_trading_defaults() -> ConventionSet:
    return load_asset("conventions/trading-defaults.yaml", ConventionSet)
