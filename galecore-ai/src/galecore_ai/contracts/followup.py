"""Follow-up record (GC-AI-0008/0009): what a strategy did, read from GaleCore, tied to its exact version.

One record per run, create-only and hashed, in ``<knowledge>/followups/<strategy>/<UTC stamp>.json``. It names the
strategy version evaluated (the approved one if any, otherwise the latest, flagged as not approved), the method
(runner and skill version, code commit), the evidence it read (the GaleCore report kept verbatim as evidence:),
and three separate parts: how the runtime operated, what SHADOW did (simulated fills, never executions) and what
this says about the hypothesis. A run that could not read GaleCore is still recorded, with the error.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from galecore_ai.contracts.regime_record import RecordHost

FOLLOWUP_SCHEMA_VERSION = "1"
STATUSES = ("OK", "DEGRADED", "ERROR")  # DEGRADED: GaleCore answered but something needs attention


class FollowupMethod(BaseModel):
    model_config = {"extra": "forbid"}

    runner: str               # e.g. "galecore_ai.application.followup 1"
    skill: str                # catalog skill id and version followed
    code_commit: str          # GaleCore-AI commit that produced the record ("unknown" if not a git checkout)


class FollowupRecord(BaseModel):
    model_config = {"extra": "forbid"}

    schema_version: str = FOLLOWUP_SCHEMA_VERSION
    kind: str = "followup"
    id: str                                   # <strategy>/<UTC stamp>
    strategy: str
    strategy_ref: str                         # strategy:<name>/<version> evaluated
    spec_hash: str
    approved: bool
    research_ref: str | None                  # the strategy's own investigation
    recorded_at: datetime
    since: datetime | None                    # previous follow-up of this strategy ("last review"), if any
    task_id: str | None = None                # the recurring task that ran it, if any
    prompt: str
    host: RecordHost
    method: FollowupMethod
    sources: list[str] = Field(default_factory=list)   # evidence:<id> of the GaleCore report (or its error)
    status: str
    operation: list[str]                      # funcionamiento operativo
    shadow: list[str]                         # resultados SHADOW (fills simulados)
    hypothesis: list[str]                     # evidencia sobre la hipótesis
    other_versions: list[str] = Field(default_factory=list)   # instances of other hashes, never mixed in
    attention: list[str]                      # what deserves the owner's attention
    content_hash: str

    @field_validator("status")
    @classmethod
    def _status(cls, v: str) -> str:
        if v not in STATUSES:
            raise ValueError(f"status is one of {STATUSES}")
        return v

    def hashable_content(self) -> dict:
        data = self.model_dump(mode="json")
        data.pop("content_hash", None)
        return data
