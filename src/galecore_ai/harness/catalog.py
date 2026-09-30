"""The catalog of work the host can ask GaleCore-AI for (``config/catalog.yaml``).

One entry per capability: what request it serves, which skill guides the model,
which contract its output must satisfy, which commands run it, which GaleCore
capabilities it reads and where its result is kept. The host discovers
capabilities here (``cli catalog``) instead of from a routing table in prose.

Adding a capability means adding an entry and its skill asset. Whatever the
capability needs beyond that (a prepare function, a validator, a store) is code,
and the entry says which command runs it.
"""

from __future__ import annotations

from importlib import import_module

import yaml
from pydantic import BaseModel, Field, field_validator

from galecore_ai.harness.assets import asset_root, definition_hash, load_asset
from galecore_ai.harness.definitions import SkillDefinition

CATALOG_PATH = "catalog.yaml"
STORED_AS = ("none", "regime", "research", "strategy", "task", "profile")


class CatalogError(Exception):
    """The catalog or one of the assets it names is missing or inconsistent."""


class DataNeed(BaseModel):
    """A datum the capability needs, resolved against the source registry (config/sources.yaml)."""

    model_config = {"extra": "forbid"}

    need: str                            # in the terms `sources query --need` understands
    missing: str | None = None           # why no source covers it today; required when the registry has none

    @field_validator("need", "missing")
    @classmethod
    def _not_blank(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("must not be blank")
        return v


class CatalogEntry(BaseModel):
    model_config = {"extra": "forbid"}

    id: str                              # equals the skill_id of its skill asset
    kind: str                            # interpretation | investigation | …
    serves: str                          # the request it answers, in the user's terms
    example_requests: list[str] = Field(default_factory=list)
    skill: str                           # skill asset path, relative to config/
    output_contract: str                 # module.Class of the output the host must produce
    galecore_capabilities: list[str] = Field(default_factory=list)
    data_needs: list[DataNeed]           # every datum it needs; [] only when it reads no market or source data
    prepare_skill: str | None = None     # value of `prepare --skill` when the flow starts from a fact snapshot
    flow: list[str]                      # CLI commands, in order
    stored_as: str                       # none | regime | research | strategy | task | profile
    controls: list[str]                  # what the validator checks for this kind of work (and what it does not)
    guide: str | None = None             # longer guide in docs/, if any


class Catalog(BaseModel):
    model_config = {"extra": "forbid"}

    catalog_version: str
    entries: list[CatalogEntry]

    def get(self, entry_id: str) -> CatalogEntry:
        for e in self.entries:
            if e.id == entry_id:
                return e
        raise CatalogError(f"No catalog entry {entry_id!r}")


def load_catalog() -> Catalog:
    """Load and check the catalog: unique ids, known storage, skills whose id matches the entry."""
    if not (asset_root() / CATALOG_PATH).is_file():
        raise CatalogError(f"Catalog not found: {asset_root() / CATALOG_PATH}")
    try:
        catalog = load_asset(CATALOG_PATH, Catalog)
    except (OSError, ValueError, yaml.YAMLError) as exc:  # ValidationError is a ValueError
        raise CatalogError(f"Invalid catalog: {exc}") from exc
    ids = [e.id for e in catalog.entries]
    if len(ids) != len(set(ids)):
        raise CatalogError(f"Duplicate catalog ids: {ids}")
    for e in catalog.entries:
        if e.stored_as not in STORED_AS:
            raise CatalogError(f"{e.id}: stored_as must be one of {STORED_AS}, got {e.stored_as!r}")
    return catalog


def describe(catalog: Catalog) -> list[dict]:
    """Each entry with the version and hash of the skill actually loaded, and whether its contract imports."""
    out = []
    for e in catalog.entries:
        item = e.model_dump(mode="json")
        try:
            skill = load_asset(e.skill, SkillDefinition)
            if skill.skill_id != e.id:
                raise CatalogError(f"skill asset declares skill_id {skill.skill_id!r}")
            if skill.output_contract != e.output_contract:
                raise CatalogError(f"skill declares output_contract {skill.output_contract!r}")
            module, _, cls = e.output_contract.rpartition(".")
            getattr(import_module(module), cls)
            item["skill_asset"] = {"version": skill.version, "content_hash": definition_hash(skill)}
            item["available"] = True
        # Reported per entry: one broken entry does not hide the others.
        except (CatalogError, OSError, ValueError, yaml.YAMLError, ImportError, AttributeError) as exc:
            item["available"] = False
            item["error"] = str(exc)
        out.append(item)
    return out


def skill_paths() -> dict[str, str]:
    """skill_id → asset path, from the catalog (the single list of known skills)."""
    return {e.id: e.skill for e in load_catalog().entries}
