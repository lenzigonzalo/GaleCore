"""ConventionResolver — three-tier precedence resolution for domain conventions.

Precedence (highest wins):
  1. USER      — user-specified overrides
  2. METHODOLOGY — discipline-specific defaults
  3. DOMAIN    — built-in trading conventions
"""

from __future__ import annotations

import logging

from galecore_ai.harness.definitions import (
    ConventionEntry,
    ConventionPrecedence,
    ConventionSet,
)

logger = logging.getLogger(__name__)

# Precedence order: higher index wins
_PRECEDENCE_ORDER = {
    ConventionPrecedence.DOMAIN: 0,
    ConventionPrecedence.METHODOLOGY: 1,
    ConventionPrecedence.USER: 2,
}


class ConventionResolver:
    """Resolves convention values with three-tier precedence."""

    def __init__(self) -> None:
        self._convention_sets: list[ConventionSet] = []
        self._resolved: dict[str, ConventionEntry] | None = None

    def load(self, convention_set: ConventionSet) -> None:
        """Add a convention set. Invalidates the resolved cache."""
        self._convention_sets.append(convention_set)
        self._resolved = None

    def load_many(self, sets: list[ConventionSet]) -> None:
        for cs in sets:
            self.load(cs)

    def _resolve_all(self) -> dict[str, ConventionEntry]:
        """Build the resolved map: for each key, keep the highest-precedence entry."""
        result: dict[str, ConventionEntry] = {}
        for cs in self._convention_sets:
            for entry in cs.entries:
                existing = result.get(entry.key)
                if existing is None or _PRECEDENCE_ORDER[entry.precedence] >= _PRECEDENCE_ORDER[existing.precedence]:
                    result[entry.key] = entry
        return result

    @property
    def resolved(self) -> dict[str, ConventionEntry]:
        if self._resolved is None:
            self._resolved = self._resolve_all()
        return self._resolved

    def get(self, key: str, default: object = None) -> object:
        """Get the resolved value for a convention key."""
        entry = self.resolved.get(key)
        if entry is None:
            return default
        return entry.value

    def get_entry(self, key: str) -> ConventionEntry | None:
        """Get the full resolved entry (value + precedence + description)."""
        return self.resolved.get(key)

    def get_all(self) -> dict[str, object]:
        """Get all resolved convention values as a flat dict."""
        return {k: e.value for k, e in self.resolved.items()}

    def all_sets(self) -> list[ConventionSet]:
        """Return all loaded convention sets (for tracing)."""
        return list(self._convention_sets)

    def clear(self) -> None:
        self._convention_sets.clear()
        self._resolved = None
