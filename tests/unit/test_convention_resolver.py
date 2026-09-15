"""Unit tests for ConventionResolver — three-tier precedence."""

from galecore_ai.harness.convention_resolver import ConventionResolver
from galecore_ai.harness.definitions import (
    ConventionEntry,
    ConventionPrecedence,
    ConventionSet,
)


def _set(convention_id: str, entries: list[ConventionEntry]) -> ConventionSet:
    return ConventionSet(
        convention_id=convention_id,
        version="1.0",
        display_name=convention_id,
        entries=entries,
    )


class TestConventionResolver:
    def test_single_domain_convention(self):
        resolver = ConventionResolver()
        resolver.load(_set("d", [
            ConventionEntry(key="timezone", value="America/New_York", precedence=ConventionPrecedence.DOMAIN),
        ]))
        assert resolver.get("timezone") == "America/New_York"

    def test_methodology_overrides_domain(self):
        resolver = ConventionResolver()
        resolver.load(_set("domain", [
            ConventionEntry(key="threshold", value=10.0, precedence=ConventionPrecedence.DOMAIN),
        ]))
        resolver.load(_set("method", [
            ConventionEntry(key="threshold", value=15.0, precedence=ConventionPrecedence.METHODOLOGY),
        ]))
        assert resolver.get("threshold") == 15.0

    def test_user_overrides_all(self):
        resolver = ConventionResolver()
        resolver.load(_set("domain", [
            ConventionEntry(key="precision", value=2, precedence=ConventionPrecedence.DOMAIN),
        ]))
        resolver.load(_set("method", [
            ConventionEntry(key="precision", value=4, precedence=ConventionPrecedence.METHODOLOGY),
        ]))
        resolver.load(_set("user", [
            ConventionEntry(key="precision", value=6, precedence=ConventionPrecedence.USER),
        ]))
        assert resolver.get("precision") == 6

    def test_independent_keys_not_affected(self):
        resolver = ConventionResolver()
        resolver.load(_set("domain", [
            ConventionEntry(key="a", value=1, precedence=ConventionPrecedence.DOMAIN),
            ConventionEntry(key="b", value=2, precedence=ConventionPrecedence.DOMAIN),
        ]))
        resolver.load(_set("user", [
            ConventionEntry(key="a", value=99, precedence=ConventionPrecedence.USER),
        ]))
        assert resolver.get("a") == 99
        assert resolver.get("b") == 2  # not overridden

    def test_get_default(self):
        resolver = ConventionResolver()
        assert resolver.get("nonexistent") is None
        assert resolver.get("nonexistent", "fallback") == "fallback"

    def test_get_entry(self):
        resolver = ConventionResolver()
        resolver.load(_set("d", [
            ConventionEntry(key="k", value=42, precedence=ConventionPrecedence.DOMAIN, description="desc"),
        ]))
        entry = resolver.get_entry("k")
        assert entry is not None
        assert entry.value == 42
        assert entry.description == "desc"

    def test_get_all(self):
        resolver = ConventionResolver()
        resolver.load(_set("d", [
            ConventionEntry(key="a", value=1, precedence=ConventionPrecedence.DOMAIN),
            ConventionEntry(key="b", value=2, precedence=ConventionPrecedence.DOMAIN),
        ]))
        all_vals = resolver.get_all()
        assert all_vals == {"a": 1, "b": 2}

    def test_clear(self):
        resolver = ConventionResolver()
        resolver.load(_set("d", [
            ConventionEntry(key="k", value=1, precedence=ConventionPrecedence.DOMAIN),
        ]))
        assert resolver.get("k") == 1
        resolver.clear()
        assert resolver.get("k") is None

    def test_same_precedence_last_wins(self):
        resolver = ConventionResolver()
        resolver.load(_set("d1", [
            ConventionEntry(key="x", value="first", precedence=ConventionPrecedence.DOMAIN),
        ]))
        resolver.load(_set("d2", [
            ConventionEntry(key="x", value="second", precedence=ConventionPrecedence.DOMAIN),
        ]))
        assert resolver.get("x") == "second"
