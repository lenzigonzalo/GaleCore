"""Observed access status of a data source, with history (GC-AI-0012, AC-02).

The registry (``contracts.sources``) says what a source is and what it should
cover; this contract records what was actually observed: available, denied,
rate-limited or down, on which date, by whom (this repo's code running a minimal
probe, or the host declaring what it saw through its own connector), and which
evidence backs it. Never a key or token.

Immutability rule: observations are append-only, oldest first. A new write may
only add observations after the ones already on file; it can never remove or
rewrite one. An edited or reordered file is reported as ``INTEGRITY_FAILED``.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator, model_validator

from galecore_ai.contracts.evidence import _CREDENTIAL_IN_TEXT  # same guard; imported, not copied
from galecore_ai.contracts.regime_record import RecordHost

SOURCE_STATUS_SCHEMA_VERSION = "1"


def _non_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    return value


class AccessState(str, Enum):
    AVAILABLE = "available"
    DENIED = "denied"
    LIMITED = "limited"
    DOWN = "down"


class ObservationOrigin(str, Enum):
    CODE_PROBE = "code_probe"        # this repo's code ran the probe and observed the result (GaleCore, FRED)
    HOST_DECLARED = "host_declared"  # the host reports what it saw through a connector it holds


class SourceStatusObservation(BaseModel):
    model_config = {"extra": "forbid"}

    observed_at: datetime  # UTC; the moment the access was actually observed, never the write time
    state: AccessState
    origin: ObservationOrigin
    note: str                      # what happened, in prose; never a key or token
    evidence: str | None = None    # e.g. "evidence:<id>" or "file:<path>"; must resolve when set
    host: RecordHost | None = None  # required when origin is host_declared; absent for a code probe
    category: str | None = None    # a coverage category this observation is about; None = the whole source

    check_not_blank = field_validator("note")(_non_blank)

    @field_validator("observed_at")
    @classmethod
    def _aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("observed_at needs a timezone (UTC)")
        return value

    @field_validator("note")
    @classmethod
    def _no_credentials(cls, value: str) -> str:
        if _CREDENTIAL_IN_TEXT.search(value):
            raise ValueError("the note seems to contain a credential; remove it before storing")
        return value

    @model_validator(mode="after")
    def _host_matches_origin(self) -> SourceStatusObservation:
        if self.origin is ObservationOrigin.HOST_DECLARED and self.host is None:
            raise ValueError("a host_declared observation needs host")
        if self.origin is ObservationOrigin.CODE_PROBE and self.host is not None:
            raise ValueError("a code_probe observation has no host to declare")
        return self


class SourceStatusDocument(BaseModel):
    """All observations for one source, oldest first."""

    model_config = {"extra": "forbid"}

    schema_version: str = SOURCE_STATUS_SCHEMA_VERSION
    source_id: str
    observations: list[SourceStatusObservation] = Field(default_factory=list)

    @field_validator("schema_version")
    @classmethod
    def _known_schema(cls, v: str) -> str:
        if v != SOURCE_STATUS_SCHEMA_VERSION:
            raise ValueError(
                f"Unknown source status schema_version {v!r}; this reader knows {SOURCE_STATUS_SCHEMA_VERSION!r}")
        return v

    @property
    def latest(self) -> SourceStatusObservation | None:
        """The chronologically most recent observation (by observed_at, not append order).

        Observations are appended in write order, which need not match observed_at order:
        a backdated ``sources declare`` (e.g. seeding an earlier finding after a newer one
        was already recorded) must not make an older state look current.
        """
        if not self.observations:
            return None
        return max(self.observations, key=lambda o: o.observed_at)
