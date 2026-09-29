"""User profile (GC-AI-0013): what every capability should know about the user before working.

Versioned and create-only: a change is a new version (``profile:v<N>``) with a note
saying what changed and the user's words that asked for it. Any field may be
missing; a missing field is declared, never filled with a guess. The profile holds
preferences and declared limits in the user's own words — no code computes risk or
sizing from it — and never credentials.
"""

from __future__ import annotations

import json
import re
from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

from galecore_ai.contracts.evidence import _CREDENTIAL_IN_TEXT, compute_evidence_hash
from galecore_ai.contracts.regime_record import RecordHost

PROFILE_SCHEMA_VERSION = "1"
PROFILE_VERSION_RE = re.compile(r"^v([1-9]\d*)$")

compute_profile_hash = compute_evidence_hash  # same canonical-JSON sha256


class ReferenceCapital(BaseModel):
    model_config = {"extra": "forbid"}

    amount: float = Field(gt=0)
    currency: str = Field(pattern=r"^[A-Z]{3}$")


class ProfileContent(BaseModel):
    """What the user declared. Lists empty / values None = not declared yet."""

    model_config = {"extra": "forbid"}

    objectives: list[str] = Field(default_factory=list)      # e.g. "retorno anual buscado 12 %"
    max_drawdown: str | None = None                          # e.g. "15 % del capital de referencia"
    horizon: str | None = None                               # e.g. "operaciones de 30 a 45 días"
    reference_capital: ReferenceCapital | None = None
    risk_limits: list[str] = Field(default_factory=list)     # e.g. "no más de 2 % por operación"
    preferred_sources: list[str] = Field(default_factory=list)  # source ids of config/sources.yaml, in order
    delivery_format: list[str] = Field(default_factory=list)    # e.g. "tablas y gráficos primero, texto mínimo"
    language: str | None = None

    @field_validator("objectives", "risk_limits", "delivery_format", "preferred_sources")
    @classmethod
    def _no_blank_items(cls, value: list[str]) -> list[str]:
        if any(not item.strip() for item in value):
            raise ValueError("items must not be blank")
        return value

    @field_validator("max_drawdown", "horizon", "language")
    @classmethod
    def _not_blank(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("must not be blank; use null for 'not declared'")
        return value

    def missing(self) -> list[str]:
        return [name for name in type(self).model_fields if getattr(self, name) in (None, [])]


class ProfileVersion(BaseModel):
    model_config = {"extra": "forbid"}

    schema_version: str = PROFILE_SCHEMA_VERSION
    kind: str = "profile"
    version: int = Field(ge=1)
    recorded_at: datetime
    note: str        # what this version changes
    prompt: str      # the user's words that asked for it
    host: RecordHost
    content: ProfileContent
    content_hash: str

    @field_validator("schema_version")
    @classmethod
    def _known_schema(cls, v: str) -> str:
        if v != PROFILE_SCHEMA_VERSION:
            raise ValueError(f"Unknown profile schema_version {v!r}; this reader knows {PROFILE_SCHEMA_VERSION!r}")
        return v

    @field_validator("kind")
    @classmethod
    def _is_profile(cls, v: str) -> str:
        if v != "profile":
            raise ValueError("kind must be 'profile'")
        return v

    @field_validator("note", "prompt")
    @classmethod
    def _required(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be blank")
        return v

    @field_validator("recorded_at")
    @classmethod
    def _aware(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("recorded_at needs a timezone (UTC)")
        return v

    @model_validator(mode="after")
    def _no_credentials(self) -> ProfileVersion:
        text = json.dumps([self.note, self.prompt, self.content.model_dump(mode="json")], ensure_ascii=False)
        if _CREDENTIAL_IN_TEXT.search(text):
            raise ValueError("the profile seems to contain a credential; remove it before storing")
        return self

    @property
    def ref(self) -> str:
        return f"profile:v{self.version}"

    def hashable_content(self) -> dict:
        data = self.model_dump(mode="json")
        data.pop("content_hash", None)
        return data
