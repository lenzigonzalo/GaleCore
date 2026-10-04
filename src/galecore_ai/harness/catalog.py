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
from pydantic import BaseModel, Field, field_validator, model_validator

from galecore_ai.harness.assets import asset_root, definition_hash, load_asset
from galecore_ai.harness.definitions import SkillDefinition

CATALOG_PATH = "catalog.yaml"
STORED_AS = ("none", "regime", "research", "strategy", "task", "profile", "inbox")
RUNNERS = ("code", "model")
# Routing by the kind of work (owner 04/10, GC-AI-0025): gathering is code; the model runs only what needs it, at the
# lowest tier that does it. A provider failure or missing quota never moves a capability to a costlier model.
WORK_MODELS = {"simple": "haiku", "reading": "sonnet", "interpretation": "opus"}


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


class Schedulable(BaseModel):
    """A capability a recurring task may run (GC-AI-0017): read-only, by code or by the model with a turn cap."""

    model_config = {"extra": "forbid"}

    runs: str                            # code | model
    max_turns: int | None = None         # model: turns per run (protects the plan's quota)
    timeout_minutes: int = 20            # wall-clock cap per run
    work: str | None = None              # model: simple | reading | interpretation; picks the model (GC-AI-0025)
    model: str | None = None             # model: set by the policy from `work`; declaring another one is refused

    @field_validator("runs")
    @classmethod
    def _runs(cls, v: str) -> str:
        if v not in RUNNERS:
            raise ValueError(f"runs is one of {RUNNERS}")
        return v

    @field_validator("timeout_minutes")
    @classmethod
    def _timeout(cls, v: int) -> int:
        # Model + correction round (4 min) + follow-up stay under the task's stale-lock age (30 min, tasks.py).
        if not 1 <= v <= 20:
            raise ValueError("timeout_minutes is between 1 and 20")
        return v

    @model_validator(mode="after")
    def _turns(self) -> Schedulable:
        if self.runs == "model" and (self.max_turns is None or not 1 <= self.max_turns <= 100):
            raise ValueError("a model run needs max_turns between 1 and 100")
        if self.runs == "code" and self.max_turns is not None:
            raise ValueError("a code run has no max_turns")
        if self.runs == "code" and (self.work or self.model):
            raise ValueError("a code run has no work or model: it calls no model")
        if self.runs == "model":
            if self.work not in WORK_MODELS:
                raise ValueError(f"a model run declares its work, one of {tuple(WORK_MODELS)}")
            policy = WORK_MODELS[self.work]
            if self.model not in (None, policy):
                raise ValueError(f"model {self.model} does not match the policy: {self.work} work runs on {policy}")
            self.model = policy
        return self

    def route_reason(self) -> str | None:
        """Why this model: the record of the choice kept with every run."""
        return f"{self.work} → {self.model} (política GC-AI-0025)" if self.runs == "model" else None


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
    stored_as: str                       # none | regime | research | strategy | task | profile | inbox
    controls: list[str]                  # what the validator checks for this kind of work (and what it does not)
    guide: str | None = None             # longer guide in docs/, if any
    schedulable: Schedulable | None = None  # a recurring task may run it (read-only; `catalog --check` enforces it)


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
