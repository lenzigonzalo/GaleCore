"""Recurring task (GC-AI-0009): a follow-up the owner delegates from the conversation.

A task is small and bounded on purpose: it runs one read-only capability (today, the strategy follow-up) on a
schedule, through the Windows Task Scheduler of the owner's PC. Its definition and state live in
``<knowledge>/tasks/<id>/task.json``; every change and every run is appended to ``events.jsonl``; each run's
result is a follow-up record (``knowledge/followups/``) that names the task. A task can never write a strategy
version, an approval or a deployment, and never operates money.
"""

from __future__ import annotations

import re
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator, model_validator

TASK_SCHEMA_VERSION = "1"
TASK_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+){0,7}$")
KINDS = ("strategy_followup",)            # the only capability a task may run today (read-only)
STATUSES = ("active", "paused", "cancelled")
FREQUENCIES = ("daily", "weekdays", "every_minutes")


class Schedule(BaseModel):
    model_config = {"extra": "forbid"}

    frequency: str                         # daily | weekdays | every_minutes
    time: str | None = None                # HH:MM in `timezone` (daily, weekdays)
    minutes: int | None = None             # period (every_minutes): for short supervised trials, 15..1440
    timezone: str

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"unknown timezone {v!r} (IANA name, e.g. America/New_York)") from exc
        return v

    @model_validator(mode="after")
    def _shape(self) -> Schedule:
        if self.frequency not in FREQUENCIES:
            raise ValueError(f"frequency is one of {FREQUENCIES}")
        if self.frequency == "every_minutes":
            if self.minutes is None or not 15 <= self.minutes <= 1440 or self.time is not None:
                raise ValueError("every_minutes needs minutes between 15 and 1440 and no time")
        elif self.time is None or not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", self.time) or self.minutes is not None:
            raise ValueError(f"{self.frequency} needs time as HH:MM and no minutes")
        return self

    def describe(self) -> str:
        if self.frequency == "every_minutes":
            return f"cada {self.minutes} minutos"
        return f"{'todos los días' if self.frequency == 'daily' else 'de lunes a viernes'} a las {self.time} ({self.timezone})"


class TaskDefinition(BaseModel):
    model_config = {"extra": "forbid"}

    schema_version: str = TASK_SCHEMA_VERSION
    kind: str
    id: str
    objective: str                          # what the owner wants to know
    strategy: str                           # the strategy followed (its approved version is resolved at each run)
    sources: list[str]                      # where the data comes from
    expected_result: str                    # what each run must leave
    schedule: Schedule
    status: str = "active"
    created_at: datetime
    updated_at: datetime
    created_by_prompt: str                  # the owner's request that created it
    scheduler_name: str                     # Windows Task Scheduler name
    local_time: str | None = None           # the schedule converted to this PC's local time (what the scheduler runs)
    code_path: str                          # checkout whose code the scheduler runs
    allowed: list[str] = Field(default_factory=lambda: ["followup run (read-only)"])

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        if not TASK_ID_RE.fullmatch(v):
            raise ValueError("task id is lowercase words separated by hyphens (at most 8)")
        return v

    @field_validator("kind")
    @classmethod
    def _kind(cls, v: str) -> str:
        if v not in KINDS:
            raise ValueError(f"a task may only run {KINDS}")
        return v

    @field_validator("status")
    @classmethod
    def _status(cls, v: str) -> str:
        if v not in STATUSES:
            raise ValueError(f"status is one of {STATUSES}")
        return v

    @field_validator("objective", "expected_result", "created_by_prompt")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be blank")
        return v

    @field_validator("sources")
    @classmethod
    def _sources(cls, v: list[str]) -> list[str]:
        if not [s for s in v if s.strip()]:
            raise ValueError("a task names its sources")
        return v
