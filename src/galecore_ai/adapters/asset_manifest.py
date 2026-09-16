"""Build an AssetManifest from the canonical cognitive assets on disk."""

from __future__ import annotations

import logging

from galecore_ai.contracts.prepared_analysis import AssetManifest
from galecore_ai.harness.assets import asset_root, definition_hash, load_asset
from galecore_ai.harness.definitions import (
    AgentDefinition,
    ConventionSet,
    ProtocolDefinition,
    SkillDefinition,
)

logger = logging.getLogger(__name__)


def build_asset_manifest() -> AssetManifest:
    """Load canonical YAML assets and compute their content hashes."""
    manifest = AssetManifest()
    root = asset_root()

    # Agent
    agent_path = root / "agents" / "trading-agent.yaml"
    if agent_path.exists():
        agent = load_asset("agents/trading-agent.yaml", AgentDefinition)
        manifest.agent_hash = definition_hash(agent)

    # Skills
    skills_dir = root / "skills"
    if skills_dir.is_dir():
        for skill_dir in sorted(skills_dir.iterdir()):
            skill_file = skill_dir / "skill.yaml" if skill_dir.is_dir() else None
            if skill_file and skill_file.exists():
                try:
                    rel = f"skills/{skill_dir.name}/skill.yaml"
                    skill = load_asset(rel, SkillDefinition)
                    manifest.skill_hashes[skill.skill_id] = definition_hash(skill)
                except (OSError, ValueError, KeyError):
                    logger.warning("Failed to load skill from %s", skill_dir.name)

    # Protocols
    protocols_dir = root / "protocols"
    if protocols_dir.is_dir():
        for p in sorted(protocols_dir.glob("*.yaml")):
            try:
                rel = f"protocols/{p.name}"
                proto = load_asset(rel, ProtocolDefinition)
                manifest.protocol_hashes[proto.protocol_id] = definition_hash(proto)
            except (OSError, ValueError, KeyError):
                logger.warning("Failed to load protocol from %s", p.name)

    # Conventions
    conventions_dir = root / "conventions"
    if conventions_dir.is_dir():
        for c in sorted(conventions_dir.glob("*.yaml")):
            try:
                rel = f"conventions/{c.name}"
                conv = load_asset(rel, ConventionSet)
                manifest.convention_hashes[conv.convention_id] = definition_hash(conv)
            except (OSError, ValueError, KeyError):
                logger.warning("Failed to load convention from %s", c.name)

    return manifest
