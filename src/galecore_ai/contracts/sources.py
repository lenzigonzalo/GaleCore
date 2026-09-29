"""Data source registry contracts (GC-AI-0012): what the harness has, and how to reach it.

A capability that needs a fact should not decide, in the moment, which source to
try and whether it is worth probing an external connector again. That decision
is made once here, declaratively, and reused: what each known source covers, its
type of access, its cost and known limits, its preference order, and the minimal
call that tells whether it is reachable right now.

This module is the registry itself (``config/sources.yaml``, loaded by
``adapters.source_registry_store``). The *history* of observed access — the part
that changes over time and must never be silently rewritten — is a separate
contract, ``contracts.source_status``, because the registry is versioned code
review and the status history is append-only knowledge.
"""

from __future__ import annotations

import re
from enum import Enum

from pydantic import BaseModel, Field, field_validator, model_validator

SOURCES_SCHEMA_VERSION = "1"

_ID_RE = re.compile(r"^[a-z][a-z0-9_]{1,31}$")


def _non_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    return value


class AccessType(str, Enum):
    GALECORE_API = "galecore_api"      # GaleCore's own API
    API_KEY = "api_key"                # this repo's code calls it directly with a key from the environment
    HOST_CONNECTOR = "host_connector"  # an MCP tool or similar the host has; this repo's code cannot call it


class Usage(str, Enum):
    """How using the source is paid for; queries order by this first (owner's rule, 29/09)."""

    FREE = "free"                # no practical limit (e.g. FRED)
    OWN = "own"                  # our own API: no extra cost, needs GaleCore Dev up
    DAILY_QUOTA = "daily_quota"  # a daily call budget: only when cheaper sources do not cover the need
    PLAN = "plan"                # limited by the subscription plan: only endpoints checked as available


USAGE_RANK = {Usage.FREE: 0, Usage.OWN: 1, Usage.DAILY_QUOTA: 2, Usage.PLAN: 3}
USAGE_NOTE = {Usage.DAILY_QUOTA: "consume cupo diario: usarla sólo si las fuentes anteriores no cubren el dato"}


class SourceCoverage(BaseModel):
    """One thing this source can answer, in its own terms."""

    model_config = {"extra": "forbid"}

    category: str       # e.g. "market_data", "rates_curve", "inflation", "earnings_valuation"
    description: str    # what exactly, concretely, in this source's own vocabulary
    any_symbol: bool = False  # serves any instrument symbol, so a ticker need not be named in the description

    check_not_blank = field_validator("category", "description")(_non_blank)


class SourceProbe(BaseModel):
    """The minimal call that tells whether this source is reachable right now."""

    model_config = {"extra": "forbid"}

    description: str            # what the probe does, one line
    command: str | None = None  # a command this repo's code can run; None when only the host can observe it

    check_not_blank = field_validator("description")(_non_blank)

    @field_validator("command")
    @classmethod
    def _command_not_blank(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("command must not be blank; use None when there is no runnable probe")
        return v


class DataSource(BaseModel):
    model_config = {"extra": "forbid"}

    id: str
    display_name: str
    access_type: AccessType
    cost: str                                          # e.g. "sin costo adicional (API propia)", "clave gratuita"
    usage: Usage                                        # orders first: free, own, daily_quota, plan
    preference: int                                     # lower sorts first within the same usage
    covers: list[SourceCoverage]
    limits: list[str] = Field(default_factory=list)    # known constraints in prose, without a date (dated history is status)
    probe: SourceProbe

    check_not_blank = field_validator("display_name", "cost")(_non_blank)

    @field_validator("id")
    @classmethod
    def _id_shape(cls, v: str) -> str:
        if not _ID_RE.fullmatch(v):
            raise ValueError(f"source id must be lower_snake_case: {v!r}")
        return v

    @model_validator(mode="after")
    def _complete(self) -> DataSource:
        if not self.covers:
            raise ValueError(f"{self.id}: at least one coverage entry is required")
        if any(not limit.strip() for limit in self.limits):
            raise ValueError(f"{self.id}: a limit must not be blank")
        has_command = self.probe.command is not None
        if self.access_type is AccessType.HOST_CONNECTOR and has_command:
            raise ValueError(f"{self.id}: a host_connector source has no command this code can run")
        if self.access_type is not AccessType.HOST_CONNECTOR and not has_command:
            raise ValueError(f"{self.id}: a {self.access_type.value} source needs a runnable probe.command")
        return self


class SourceRegistry(BaseModel):
    model_config = {"extra": "forbid"}

    schema_version: str = SOURCES_SCHEMA_VERSION
    sources: list[DataSource]

    @field_validator("schema_version")
    @classmethod
    def _known_schema(cls, v: str) -> str:
        if v != SOURCES_SCHEMA_VERSION:
            raise ValueError(f"Unknown sources schema_version {v!r}; this reader knows {SOURCES_SCHEMA_VERSION!r}")
        return v

    @model_validator(mode="after")
    def _unique_ids(self) -> SourceRegistry:
        ids = [s.id for s in self.sources]
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        if dupes:
            raise ValueError(f"duplicate source ids: {dupes}")
        return self

    def get(self, source_id: str) -> DataSource | None:
        return next((s for s in self.sources if s.id == source_id), None)


# ── query results (what `cli sources list|query` prints) ───────────


class SourceStatusView(BaseModel):
    """The last known status of a source, as shown to a query (None if never observed)."""

    model_config = {"extra": "forbid"}

    state: str | None = None
    observed_at: str | None = None  # ISO 8601, UTC
    origin: str | None = None
    note: str | None = None


class SourceMatch(BaseModel):
    model_config = {"extra": "forbid"}

    id: str
    display_name: str
    access_type: AccessType
    usage: Usage
    usage_note: str | None = None
    preference: int
    cost: str
    limits: list[str]
    matched_coverage: list[SourceCoverage]
    last_status: SourceStatusView


class SourceQueryResult(BaseModel):
    """Answer to "¿de dónde saco X?" (AC-04): matches ordered by usage, then preference."""

    model_config = {"extra": "forbid"}

    need: str
    matches: list[SourceMatch]
    missing: bool  # true when no known source covers `need`


class CategorySummary(BaseModel):
    model_config = {"extra": "forbid"}

    category: str
    sources: list[str]  # source ids covering this category, in preference order


class SourceCatalogSummary(BaseModel):
    """Answer to "¿qué datos tengo?" (AC-04): the registry grouped by category."""

    model_config = {"extra": "forbid"}

    categories: list[CategorySummary]
    sources: list[SourceMatch]
