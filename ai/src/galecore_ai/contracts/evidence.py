"""Evidence contracts (GC-AI-0007): one source response kept with its provenance.

An investigation cites facts; the facts come from somewhere — GaleCore, or an
external source the host queried directly (an MCP tool, an API). Evidence keeps
that response durable in the knowledge base, next to the investigation that uses
it, with what is needed to recover and judge it later: source, tool or series,
non-sensitive parameters, unit, observation and retrieval dates, frequency, and
revision or access notes.

Provenance is always ``HOST_DECLARED``: the host obtained the response and wrote
it here; GaleCore-AI did not fetch it and does not certify it. Nothing stored as
evidence is ``GALECORE_VERIFIED``, including GaleCore responses the host obtained
outside a controlled capability.

Immutability rule: an evidence item is written once and hashed; a later reading
of the same series is a new item.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator, model_validator

from galecore_ai.contracts.regime_record import RecordHost

EVIDENCE_SCHEMA_VERSION = "1"
EVIDENCE_PROVENANCE = "HOST_DECLARED"

# Parameter names that could carry a credential. Evidence is shared data; a key never goes in it.
SENSITIVE_PARAM_MARKERS = ("key", "token", "secret", "password", "auth", "credential", "cookie", "session")
# A credential echoed inside a response (signed URL, query string, header dump) is refused too.
_CREDENTIAL_IN_TEXT = re.compile(
    r"(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|client[_-]?secret|secret|password|"
    r"authorization|cookie|session(?:[_-]?id)?|x-api-key)[\"']?\s*[=:]\s*[\"']?(bearer\s+)?[A-Za-z0-9._~+/-]{8,}",
    re.IGNORECASE)


def _non_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    return value


class PayloadScope(str, Enum):
    FULL = "full"        # the response as received
    EXCERPT = "excerpt"  # part of it; excerpt_note says which part and why


class EvidenceSeries(BaseModel):
    """One series or field in the response, with what is needed to read it."""

    model_config = {"extra": "forbid"}

    name: str                 # the source's own name or id (e.g. "10-Year Treasury Constant Maturity Rate")
    unit: str                 # e.g. "percent", "index 1982-84=100", "usd", "thousands of persons"
    frequency: str            # e.g. "daily", "monthly", "snapshot"
    observation_dates: str    # the dates the values refer to (e.g. "2025-08-01..2026-08-01", "2026-09-25 20:15 UTC")
    revision_note: str = ""   # vintages, revisions, seasonal adjustment, missing values — or "" if not applicable

    check_not_blank = field_validator("name", "unit", "frequency", "observation_dates")(_non_blank)


class EvidenceContent(BaseModel):
    """What the host writes. The store checks it and adds provenance and hash."""

    model_config = {"extra": "forbid"}

    source: str                                   # e.g. "galecore", "alpha_vantage", "fmp", "fred"
    tool: str                                     # MCP tool, endpoint or script that produced the response
    params: dict[str, str | int | float | bool] = Field(default_factory=dict)
    retrieved_at: datetime                        # when the host obtained the response (UTC)
    series: list[EvidenceSeries]
    payload: str                                  # the response text, verbatim (or the excerpt)
    payload_scope: PayloadScope
    excerpt_note: str = ""                        # required for an excerpt: what was kept and what was left out
    access_notes: list[str] = Field(default_factory=list)  # plan limits, errors, truncation, rate limits

    check_not_blank = field_validator("source", "tool", "payload")(_non_blank)

    @field_validator("params")
    @classmethod
    def _no_credentials(cls, params: dict) -> dict:
        bad = [k for k in params if any(m in k.lower() for m in SENSITIVE_PARAM_MARKERS)]
        bad += [k for k, v in params.items() if isinstance(v, str) and _CREDENTIAL_IN_TEXT.search(v)]
        if bad:
            raise ValueError(f"parameters that may carry credentials are not stored: {bad}")
        return params

    @field_validator("payload")
    @classmethod
    def _no_credentials_in_payload(cls, payload: str) -> str:
        if _CREDENTIAL_IN_TEXT.search(payload):
            raise ValueError("the payload seems to contain a credential; remove it before storing")
        return payload

    @field_validator("retrieved_at")
    @classmethod
    def _aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("retrieved_at needs a timezone (UTC)")
        return value

    @model_validator(mode="after")
    def _complete(self) -> EvidenceContent:
        if not self.series:
            raise ValueError("at least one series is required")
        if self.payload_scope == PayloadScope.EXCERPT and not self.excerpt_note.strip():
            raise ValueError("an excerpt needs excerpt_note saying what was kept")
        return self


class EvidenceDocument(BaseModel):
    model_config = {"extra": "forbid"}

    schema_version: str = EVIDENCE_SCHEMA_VERSION
    kind: str = "evidence"
    id: str
    recorded_at: datetime
    provenance: str = EVIDENCE_PROVENANCE
    host: RecordHost
    prompt: str                   # what the user asked in the session that gathered it
    content: EvidenceContent
    content_hash: str             # sha256 over every field above (canonical JSON)

    @field_validator("schema_version")
    @classmethod
    def _known_schema(cls, v: str) -> str:
        if v != EVIDENCE_SCHEMA_VERSION:
            raise ValueError(f"Unknown evidence schema_version {v!r}; this reader knows {EVIDENCE_SCHEMA_VERSION!r}")
        return v

    @field_validator("kind")
    @classmethod
    def _is_evidence(cls, v: str) -> str:
        if v != "evidence":
            raise ValueError(f"kind must be 'evidence', got {v!r}")
        return v

    @field_validator("provenance")
    @classmethod
    def _host_declared(cls, v: str) -> str:
        if v != EVIDENCE_PROVENANCE:
            raise ValueError(f"evidence provenance is always {EVIDENCE_PROVENANCE}, got {v!r}")
        return v

    @field_validator("host")
    @classmethod
    def _host_declared_host(cls, host: RecordHost) -> RecordHost:
        if host.provenance != EVIDENCE_PROVENANCE:
            raise ValueError(f"host provenance is always {EVIDENCE_PROVENANCE}, got {host.provenance!r}")
        return host

    def hashable_content(self) -> dict:
        data = self.model_dump(mode="json")
        data.pop("content_hash", None)
        return data


def compute_evidence_hash(content: dict) -> str:
    canonical = json.dumps(content, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
