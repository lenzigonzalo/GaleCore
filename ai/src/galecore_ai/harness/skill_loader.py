"""SkillLoader — discovers and loads skill definitions into the Harness."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from galecore_ai.harness.definitions import SkillDefinition

logger = logging.getLogger(__name__)

# Try to import yaml; it's optional
try:
    import yaml as _yaml

    HAS_YAML = True
except ImportError:
    HAS_YAML = False


class SkillLoader:
    """Loads SkillDefinition objects from files or dicts."""

    def __init__(self) -> None:
        self._skills: dict[str, SkillDefinition] = {}

    @property
    def skills(self) -> dict[str, SkillDefinition]:
        return dict(self._skills)

    def register(self, skill: SkillDefinition) -> None:
        """Register a skill definition directly."""
        if skill.skill_id in self._skills:
            logger.warning("Overwriting skill %s", skill.skill_id)
        self._skills[skill.skill_id] = skill

    def load_from_dict(self, data: dict) -> SkillDefinition:
        """Load a skill from a dictionary."""
        skill = SkillDefinition.model_validate(data)
        self.register(skill)
        return skill

    def load_from_file(self, path: Path) -> SkillDefinition:
        """Load a skill from a JSON or YAML file."""
        text = path.read_text(encoding="utf-8")
        if path.suffix in (".yaml", ".yml"):
            if not HAS_YAML:
                raise ImportError("PyYAML required to load .yaml skill files")
            data = _yaml.safe_load(text)
        else:
            data = json.loads(text)
        return self.load_from_dict(data)

    def load_directory(self, directory: Path) -> list[SkillDefinition]:
        """Load all skill definitions from a directory."""
        loaded: list[SkillDefinition] = []
        if not directory.is_dir():
            logger.warning("Skill directory does not exist: %s", directory)
            return loaded
        for path in sorted(directory.iterdir()):
            if path.suffix in (".json", ".yaml", ".yml"):
                try:
                    loaded.append(self.load_from_file(path))
                    logger.info("Loaded skill: %s from %s", loaded[-1].skill_id, path.name)
                except (json.JSONDecodeError, ValueError, OSError):
                    logger.exception("Failed to load skill from %s", path)
        return loaded

    def get(self, skill_id: str) -> SkillDefinition | None:
        return self._skills.get(skill_id)

    def clear(self) -> None:
        self._skills.clear()
