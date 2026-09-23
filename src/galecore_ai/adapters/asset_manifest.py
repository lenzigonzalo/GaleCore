"""Load the required cognitive assets once and derive everything from that read.

Fail-closed: if any required asset is missing or invalid, raise immediately.
Every vertical requires TradingAgent, facts_discipline and trading_defaults plus
the skill(s) it prepares for: gex_interpretation (GEX) or regime_interpretation
(daily regime). The manifest lists only the skills actually loaded for the run.

The convention YAML is read exactly once. From that single ConventionSet we
derive the AssetEntry (content_hash), the resolved values stored in the
snapshot, and the conventions_hash that binds them. There is no second load
that could disagree with the first.
"""

from __future__ import annotations

from pydantic import BaseModel

from galecore_ai.contracts.prepared_analysis import (
    AssetEntry,
    AssetManifest,
    compute_conventions_hash,
)
from galecore_ai.harness.assets import asset_root, definition_hash, load_asset
from galecore_ai.harness.catalog import CatalogError, skill_paths
from galecore_ai.harness.definitions import (
    AgentDefinition,
    ConventionSet,
    ProtocolDefinition,
    SkillDefinition,
)


class RequiredAssetError(Exception):
    """A required cognitive asset is missing or invalid."""


# Required assets; skills are selected per vertical from _KNOWN_SKILLS
_REQUIRED_AGENT = "agents/trading-agent.yaml"
DEFAULT_SKILL_IDS: tuple[str, ...] = ("gex_interpretation",)
_REQUIRED_PROTOCOLS = {"facts_discipline": "protocols/facts-discipline.yaml"}
_REQUIRED_CONVENTIONS = {"trading_defaults": "conventions/trading-defaults.yaml"}


class RequiredAssetBundle(BaseModel):
    """Everything prepare needs from the canonical assets, from one read each.

    Not a generic asset platform: a fixed, typed carrier for the GEX vertical.
    """

    model_config = {"frozen": True, "extra": "forbid"}

    manifest: AssetManifest
    resolved_conventions: dict[str, float | int | str | bool]
    conventions_hash: str


def _load(rel_path: str, schema, what: str):
    full = asset_root() / rel_path
    if not full.exists():
        raise RequiredAssetError(f"Required {what} asset not found: {full}")
    try:
        return load_asset(rel_path, schema)
    except Exception as exc:
        raise RequiredAssetError(f"Failed to load {what}: {exc}") from exc


def load_required_assets(
    skill_ids: tuple[str, ...] = DEFAULT_SKILL_IDS,
) -> RequiredAssetBundle:
    """Load all required YAML assets once; hashes and values come from the same objects.

    Raises RequiredAssetError if any asset is missing, unreadable, or invalid,
    or if a requested skill is not a known canonical asset.
    """
    try:
        known_skills = skill_paths()
    except CatalogError as exc:
        raise RequiredAssetError(f"Catalog unavailable: {exc}") from exc
    unknown = [s for s in skill_ids if s not in known_skills]
    if unknown or not skill_ids:
        raise RequiredAssetError(f"Unknown or empty skill selection: {list(skill_ids)}")
    agent = _load(_REQUIRED_AGENT, AgentDefinition, "agent")
    agent_entry = AssetEntry(
        asset_id=agent.agent_id, version=agent.version, content_hash=definition_hash(agent),
    )

    skill_entries: dict[str, AssetEntry] = {}
    for skill_id in skill_ids:
        skill = _load(known_skills[skill_id], SkillDefinition, f"skill {skill_id}")
        if skill.skill_id != skill_id:
            raise RequiredAssetError(
                f"Skill asset {skill_id} declares skill_id {skill.skill_id!r}"
            )
        skill_entries[skill.skill_id] = AssetEntry(
            asset_id=skill.skill_id, version=skill.version, content_hash=definition_hash(skill),
        )

    protocol_entries: dict[str, AssetEntry] = {}
    for proto_id, rel_path in _REQUIRED_PROTOCOLS.items():
        proto = _load(rel_path, ProtocolDefinition, f"protocol {proto_id}")
        protocol_entries[proto.protocol_id] = AssetEntry(
            asset_id=proto.protocol_id, version=proto.version, content_hash=definition_hash(proto),
        )

    convention_entries: dict[str, AssetEntry] = {}
    resolved: dict[str, float | int | str | bool] = {}
    for conv_id, rel_path in _REQUIRED_CONVENTIONS.items():
        conv: ConventionSet = _load(rel_path, ConventionSet, f"convention {conv_id}")
        convention_entries[conv.convention_id] = AssetEntry(
            asset_id=conv.convention_id, version=conv.version, content_hash=definition_hash(conv),
        )
        for entry in conv.entries:
            if entry.key in resolved:
                raise RequiredAssetError(f"Duplicate convention key across sets: {entry.key}")
            resolved[entry.key] = entry.value

    return RequiredAssetBundle(
        manifest=AssetManifest(
            agent=agent_entry,
            skills=skill_entries,
            protocols=protocol_entries,
            conventions=convention_entries,
        ),
        resolved_conventions=resolved,
        conventions_hash=compute_conventions_hash(resolved),
    )
