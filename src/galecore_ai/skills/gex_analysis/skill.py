"""Compatibility factory backed by the canonical versioned cognitive asset."""

from galecore_ai.harness.assets import load_asset
from galecore_ai.harness.definitions import SkillDefinition


def build_gex_interpretation_skill() -> SkillDefinition:
    return load_asset("skills/gex-analysis/skill.yaml", SkillDefinition)
