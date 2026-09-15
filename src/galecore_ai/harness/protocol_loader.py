"""ProtocolLoader — discovers and loads protocol definitions into the Harness."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from galecore_ai.harness.definitions import ProtocolDefinition

logger = logging.getLogger(__name__)

try:
    import yaml as _yaml

    HAS_YAML = True
except ImportError:
    HAS_YAML = False


class ProtocolLoader:
    """Loads ProtocolDefinition objects from files or dicts."""

    def __init__(self) -> None:
        self._protocols: dict[str, ProtocolDefinition] = {}

    @property
    def protocols(self) -> dict[str, ProtocolDefinition]:
        return dict(self._protocols)

    def register(self, protocol: ProtocolDefinition) -> None:
        if protocol.protocol_id in self._protocols:
            logger.warning("Overwriting protocol %s", protocol.protocol_id)
        self._protocols[protocol.protocol_id] = protocol

    def load_from_dict(self, data: dict) -> ProtocolDefinition:
        protocol = ProtocolDefinition.model_validate(data)
        self.register(protocol)
        return protocol

    def load_from_file(self, path: Path) -> ProtocolDefinition:
        text = path.read_text(encoding="utf-8")
        if path.suffix in (".yaml", ".yml"):
            if not HAS_YAML:
                raise ImportError("PyYAML required to load .yaml protocol files")
            data = _yaml.safe_load(text)
        else:
            data = json.loads(text)
        return self.load_from_dict(data)

    def load_directory(self, directory: Path) -> list[ProtocolDefinition]:
        loaded: list[ProtocolDefinition] = []
        if not directory.is_dir():
            logger.warning("Protocol directory does not exist: %s", directory)
            return loaded
        for path in sorted(directory.iterdir()):
            if path.suffix in (".json", ".yaml", ".yml"):
                try:
                    loaded.append(self.load_from_file(path))
                    logger.info("Loaded protocol: %s from %s", loaded[-1].protocol_id, path.name)
                except (json.JSONDecodeError, ValueError, OSError):
                    logger.exception("Failed to load protocol from %s", path)
        return loaded

    def get(self, protocol_id: str) -> ProtocolDefinition | None:
        return self._protocols.get(protocol_id)

    def get_for_trigger(self, trigger: str) -> list[ProtocolDefinition]:
        """Get all protocols that match a given trigger (skill_id, task_type, or 'always')."""
        return [
            p for p in self._protocols.values()
            if p.trigger == "always" or p.trigger == trigger
        ]

    def clear(self) -> None:
        self._protocols.clear()
