"""Loads and checks the declarative source registry (``config/sources.yaml``, GC-AI-0012 AC-01).

Adding a source means adding an entry here; the contract (``contracts.sources``)
rejects one missing coverage, cost or a runnable probe where one is required. This
module only loads and validates; combining the registry with observed status
history lives in ``application.source_query``.
"""

from __future__ import annotations

import yaml

from galecore_ai.contracts.sources import SourceRegistry
from galecore_ai.harness.assets import asset_root, load_asset

SOURCES_PATH = "sources.yaml"


class SourceRegistryError(Exception):
    """The registry file is missing or does not match the contract."""


def load_source_registry() -> SourceRegistry:
    if not (asset_root() / SOURCES_PATH).is_file():
        raise SourceRegistryError(f"Source registry not found: {asset_root() / SOURCES_PATH}")
    try:
        return load_asset(SOURCES_PATH, SourceRegistry)
    except (OSError, ValueError, yaml.YAMLError) as exc:  # ValidationError is a ValueError
        raise SourceRegistryError(f"Invalid source registry: {exc}") from exc
