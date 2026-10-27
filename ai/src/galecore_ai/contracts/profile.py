"""User profile (GC-AI-0013): what every capability should know about the user before working.

Versioned and create-only: a change is a new version (``profile:v<N>``) with a note
saying what changed and the user's words that asked for it. Any field may be
missing; a missing field is declared, never filled with a guess. The profile holds
preferences and declared limits in the user's own words — no code computes risk or
sizing from it — and never credentials (a heuristic check, not a guarantee).

Criteria and mandate (P1-02, WS-0010) live here too, in the user's words: the minimum
return below which a strategy is not worth its risk, what counts as edge rather than
luck, what happens when a limit is hit, and what the system does alone versus what
needs the user's approval. Fields added later are left out of the hash while empty, so
versions written before them keep verifying.

A value the user asked to be filled with a placeholder is listed by field name in
``provisional``: capabilities use it but label what depends on it as provisional,
never as the user's decision.
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

# Fields added after the first versions: dropped from the hash while empty (older versions keep their hash).
LATER_FIELDS = ("provisional", "minimum_return", "edge_criterion", "exit_rule", "mandate_autonomous",
                "mandate_needs_approval")

compute_profile_hash = compute_evidence_hash  # same canonical-JSON sha256

# Beyond the shared guard: Spanish labels and unlabeled key prefixes (the profile is free Spanish text).
_CREDENTIAL_ES = re.compile(
    r"\b(clave|contraseña|contrasena|secreto|credencial)\b[^\n]{0,20}?[:=]?\s*(es\s+)?"
    r"(?=[A-Za-z0-9._~+/-]*\d)[A-Za-z0-9._~+/-]{8,}"
    r"|\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})", re.IGNORECASE)


class ReferenceCapital(BaseModel):
    model_config = {"extra": "forbid"}

    amount: float = Field(gt=0, allow_inf_nan=False, strict=True)
    currency: str = Field(pattern=r"^[A-Z]{3}$")


class ProfileContent(BaseModel):
    """What the user declared. Lists empty / values None = not declared yet."""

    model_config = {"extra": "forbid"}

    objectives: list[str] = Field(default_factory=list)      # e.g. "retorno anual buscado 12 %"
    max_drawdown: str | None = None                          # e.g. "15 % del capital de referencia"
    horizon: str | None = None                               # e.g. "operaciones de 30 a 45 días"
    reference_capital: ReferenceCapital | None = None
    risk_limits: list[str] = Field(default_factory=list)     # e.g. "no más de 2 % por operación"
    preferred_sources: list[str] = Field(default_factory=list)  # retired (owner 21/10): only read from old versions
    delivery_format: list[str] = Field(default_factory=list)    # e.g. "tablas y gráficos primero, texto mínimo"
    language: str | None = None
    minimum_return: str | None = None                      # e.g. "8 % anual; por debajo, no vale el riesgo"
    edge_criterion: str | None = None                      # e.g. "30 cierres y resultado neto > 0 después de costos"
    exit_rule: str | None = None                           # e.g. "al tocar el drawdown: no abrir más y revisar"
    mandate_autonomous: list[str] = Field(default_factory=list)      # what the system does on its own
    mandate_needs_approval: list[str] = Field(default_factory=list)  # what waits for the user's ok
    provisional: list[str] = Field(default_factory=list)  # field names holding placeholders, not the user's values

    @field_validator("objectives", "risk_limits", "delivery_format", "preferred_sources", "mandate_autonomous",
                     "mandate_needs_approval", mode="before")
    @classmethod
    def _clean_items(cls, value: object) -> object:
        if value is None:
            return []  # null clears a list field back to "not declared"
        if isinstance(value, list):
            items = [v.strip() if isinstance(v, str) else v for v in value]
            if any(v == "" for v in items):
                raise ValueError("items must not be blank")
            if len(set(items)) != len(items):
                raise ValueError("items must not repeat")
            return items
        return value

    @field_validator("max_drawdown", "horizon", "language", "minimum_return", "edge_criterion", "exit_rule",
                     mode="before")
    @classmethod
    def _clean_text(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()
            if not value:
                raise ValueError("must not be blank; use null for 'not declared'")
        return value

    @model_validator(mode="after")
    def _provisional_are_declared_fields(self) -> ProfileContent:
        for name in self.provisional:
            if name not in self.declared_fields() or name in self.missing():
                raise ValueError("provisional must list only fields this profile declares")
        return self

    @classmethod
    def declared_fields(cls) -> list[str]:
        return [name for name in cls.model_fields if name not in ("provisional", "preferred_sources")]

    def missing(self) -> list[str]:
        return [name for name in self.declared_fields() if getattr(self, name) in (None, [])]


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
    feedback: list[str] = Field(default_factory=list)  # feedback:<id> this version applies (GC-AI-0016)
    content_hash: str

    @field_validator("schema_version")
    @classmethod
    def _known_schema(cls, v: str) -> str:
        if v != PROFILE_SCHEMA_VERSION:
            raise ValueError(f"Unknown profile schema_version; this reader knows {PROFILE_SCHEMA_VERSION!r}")
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
        if _CREDENTIAL_IN_TEXT.search(text) or _CREDENTIAL_ES.search(text):
            raise ValueError("the profile seems to contain a credential; remove it before storing")
        return self

    @property
    def ref(self) -> str:
        return f"profile:v{self.version}"

    def hashable_content(self) -> dict:
        data = self.model_dump(mode="json")
        data.pop("content_hash", None)
        for name in LATER_FIELDS:
            if data["content"][name] in (None, []):
                del data["content"][name]  # versions written before the field existed keep their hash
        if not data["feedback"]:
            del data["feedback"]  # same for versions written before feedback could be cited
        return data
