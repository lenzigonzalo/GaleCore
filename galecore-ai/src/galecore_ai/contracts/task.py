"""Recurring task (GC-AI-0009): a follow-up the owner delegates from the conversation.

A task is small and bounded on purpose: it runs one read-only capability on a schedule, through the Windows Task
Scheduler of the owner's PC. Which capabilities may be scheduled is declared in the catalog (``schedulable``,
GC-AI-0017): the strategy follow-up runs as code, others (the daily briefing) through the model. Its definition and state live in
``<knowledge>/tasks/<id>/task.json``; every change and every run is appended to ``events.jsonl``; each run's
result is a follow-up record (``knowledge/followups/``) or a research revision, and names the task. A task can never write a strategy
version, an approval or a deployment, and never operates money.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator, model_validator

TASK_SCHEMA_VERSION = "1"
TASK_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+){0,7}$")
KIND_RE = re.compile(r"^[a-z][a-z0-9_]{2,63}$")  # a catalog id; that it is schedulable is checked when creating and running
STATUSES = ("active", "paused", "cancelled")
DELIVERIES = ("historial", "biblioteca")   # where a run leaves its result; mail by Gmail comes later
FREQUENCIES = ("daily", "weekdays", "days", "every_minutes", "market_hours")
WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
DAY_NAMES = {"mon": "lunes", "tue": "martes", "wed": "miércoles", "thu": "jueves", "fri": "viernes", "sat": "sábado",
             "sun": "domingo"}
# market_hours (GC-AI-0020): every N minutes, Monday to Friday, inside the US cash session only.
MARKET_TZ, MARKET_OPEN, MARKET_CLOSE = "America/New_York", "09:30", "16:00"


class Schedule(BaseModel):
    model_config = {"extra": "forbid"}

    frequency: str                         # daily | weekdays | days | every_minutes | market_hours
    time: str | None = None                # HH:MM in `timezone` (daily, weekdays, days)
    days: list[str] | None = None          # days: the chosen weekdays (mon..sun), in week order
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
        if self.frequency == "days":
            if not self.days or any(d not in WEEKDAYS for d in self.days) or len(set(self.days)) != len(self.days):
                raise ValueError(f"days needs one or more different days of {WEEKDAYS}")
            self.days = sorted(self.days, key=WEEKDAYS.index)
        elif self.days is not None:
            raise ValueError("days is only for the days frequency")
        if self.frequency == "market_hours":
            if self.minutes is None or not 15 <= self.minutes <= 240 or self.time is not None:
                raise ValueError("market_hours needs minutes between 15 and 240 and no time")
            if self.timezone != MARKET_TZ:
                raise ValueError(f"market_hours runs on the US session: timezone is {MARKET_TZ}")
        elif self.frequency == "every_minutes":
            if self.minutes is None or not 15 <= self.minutes <= 1440 or self.time is not None:
                raise ValueError("every_minutes needs minutes between 15 and 1440 and no time")
        elif self.time is None or not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", self.time) or self.minutes is not None:
            raise ValueError(f"{self.frequency} needs time as HH:MM and no minutes")
        return self

    def describe(self) -> str:
        if self.frequency == "every_minutes":
            return f"cada {self.minutes} minutos"
        if self.frequency == "market_hours":
            return f"cada {self.minutes} minutos en horario de mercado (L–V {MARKET_OPEN}–{MARKET_CLOSE} Nueva York)"
        if self.frequency == "days":
            names = [DAY_NAMES[d] for d in self.days]
            when = names[0] if len(names) == 1 else f"{', '.join(names[:-1])} y {names[-1]}"
            return f"{when} a las {self.time} ({self.timezone})"
        return f"{'todos los días' if self.frequency == 'daily' else 'de lunes a viernes'} a las {self.time} ({self.timezone})"


class ScanRule(BaseModel):
    """A market agent's screen run by code before the model (P1-05): the model is called only with a finding.

    A symbol is a finding when its IV rank is at least `iv_rank_min` and none of `releases` falls within the next
    `quiet_business_days` business days. What the screen cannot evaluate is never a finding."""
    model_config = {"extra": "forbid"}

    symbols: list[str] = Field(min_length=1, max_length=10)
    iv_rank_min: float = Field(ge=0, le=100)
    quiet_business_days: int = Field(default=3, ge=0, le=10)
    releases: list[str] = Field(default_factory=lambda: ["Empleo (NFP)", "CPI", "FOMC"])

    @field_validator("releases")
    @classmethod
    def _releases(cls, v: list[str]) -> list[str]:
        known = {"Empleo (NFP)", "CPI", "PPI", "PIB", "Ingresos y gastos (PCE)", "Ventas minoristas", "FOMC"}
        if unknown := [r for r in v if r not in known]:
            raise ValueError(f"unknown releases {unknown}: use {sorted(known)}")
        return v

    @field_validator("symbols")
    @classmethod
    def _symbols(cls, v: list[str]) -> list[str]:
        out = [s.strip().upper() for s in v if s.strip()]
        if not out or any(not re.fullmatch(r"[A-Z][A-Z0-9.]{0,9}", s) for s in out):
            raise ValueError("symbols are tickers like SPY, QQQ")
        return out


class TaskDefinition(BaseModel):
    model_config = {"extra": "forbid"}

    schema_version: str = TASK_SCHEMA_VERSION
    kind: str
    id: str
    objective: str                          # what the owner wants to know
    strategy: str | None = None             # the strategy followed (its approved version is resolved at each run);
                                            # None for an agent that watches the market, not one strategy (GC-AI-0020)
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
    result_slug: str | None = None          # model runs: the investigation each run revises (research:<date>-<slug>)
    scan: ScanRule | None = None            # market agents: screened by code; the model only with a finding (P1-05)
    model: Literal["haiku", "sonnet", "opus"] | None = None  # owner's override; None follows the catalog policy
    tools: list[str] | None = None          # owner's subset of the skill's read tools (WS-0055); None = all of them
    delivery: list[str] = Field(default_factory=lambda: ["historial"])   # history always; the library when chosen
    runs_on: Literal["pc", "vps"] = "pc"    # who runs it: the owner's Windows scheduler or the VPS runner (WS-0079); never both

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        if not TASK_ID_RE.fullmatch(v):
            raise ValueError("task id is lowercase words separated by hyphens (at most 8)")
        return v

    @field_validator("kind")
    @classmethod
    def _kind(cls, v: str) -> str:
        if not KIND_RE.fullmatch(v):
            raise ValueError("kind is a catalog capability id")
        return v

    @field_validator("result_slug")
    @classmethod
    def _slug(cls, v: str | None) -> str | None:
        if v is not None and not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", v):
            raise ValueError("result_slug is lowercase words separated by hyphens")
        return v

    @field_validator("delivery")
    @classmethod
    def _delivery(cls, v: list[str]) -> list[str]:
        if any(d not in DELIVERIES for d in v) or "historial" not in v or len(set(v)) != len(v):
            raise ValueError(f"delivery is {DELIVERIES} without repeats and always includes historial")
        return sorted(v, key=DELIVERIES.index)

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
