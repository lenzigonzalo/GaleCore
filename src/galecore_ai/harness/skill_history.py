"""Version history of a skill (GC-AI-0016): what changed in each version and which feedback caused it.

It lives in ``history.yaml`` next to the skill's ``skill.yaml``, outside the skill
definition, so writing a history does not change the hash a stored result recorded
for its skill. ``catalog --check`` requires an entry for the version in force.
"""

from __future__ import annotations

from datetime import date
from pathlib import PurePosixPath

import yaml
from pydantic import BaseModel, Field, field_validator

from galecore_ai.harness.assets import asset_root, load_asset

HISTORY_FILE = "history.yaml"


class SkillVersionNote(BaseModel):
    model_config = {"extra": "forbid"}

    version: str
    date: date
    changes: str                                         # what this version changes, in plain words
    feedback: list[str] = Field(default_factory=list)    # feedback:<id> that originated the change
    # The owner's words deciding that a single case becomes method (§1.6.4: one case is not a rule).
    owner_decision: str = ""

    @field_validator("version", "changes")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be blank")
        return v


class SkillHistory(BaseModel):
    model_config = {"extra": "forbid"}

    skill_id: str
    versions: list[SkillVersionNote]                     # newest first

    def get(self, version: str) -> SkillVersionNote | None:
        return next((v for v in self.versions if v.version == version), None)


class SkillHistoryError(Exception):
    """The history file is missing or does not match its contract."""


def history_path(skill_path: str) -> str:
    """Asset path of the history next to ``skill_path`` (both relative to config/)."""
    return str(PurePosixPath(skill_path).parent / HISTORY_FILE)


def load_skill_history(skill_path: str) -> SkillHistory:
    path = history_path(skill_path)
    if not (asset_root() / path).is_file():
        raise SkillHistoryError(f"no {HISTORY_FILE} next to {skill_path}; each version says what changed")
    try:
        return load_asset(path, SkillHistory)
    except (OSError, ValueError, yaml.YAMLError) as exc:  # ValidationError is a ValueError
        raise SkillHistoryError(f"{path}: {exc}") from exc
