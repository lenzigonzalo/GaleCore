"""GC-AI-0027: the daily contrast pack — today's story against each strategy and the portfolio, built by code."""

from __future__ import annotations

from datetime import timedelta

from galecore_ai.application import contrast, project
from tests.unit.test_knowledge import NOW, kb, save  # noqa: F401  (kb is a fixture)
from tests.unit.test_strategy import (  # noqa: F401  (research_ref is a fixture)
    NAME,
    research_ref,
    stored,
)


def test_the_pack_gathers_story_strategies_and_declares_what_is_missing(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    save(kb, slug="historia-del-mercado-spy", title="Historia del mercado SPY")
    pack = contrast.pack(kb, space_error="sin red", now=NOW + timedelta(hours=2))
    assert pack["story"]["ref"] == "research:2026-09-23-historia-del-mercado-spy" and not pack["story"]["stale"]
    assert [s["name"] for s in pack["strategies"]] == [NAME] and pack["strategies"][0]["where_it_works"] == []
    assert any("no dice en qué historia funciona" in m for m in pack["missing"])
    assert pack["save_as"] == {"capability": "daily_contrast", "slug": "contraste-diario"}
    assert pack["integrity_failed"] == []


def test_the_strategy_story_and_decisions_reach_the_pack(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    project.add(kb=kb, name=NAME, kind="story", words="Funciona con gamma positiva y skew calmo", prompt="p", now=NOW)
    project.add(kb=kb, name=NAME, kind="decision", words="No operar con VIX arriba de 30", prompt="p", now=NOW)
    s = contrast.pack(kb, space_error="sin red", now=NOW)["strategies"][0]
    assert s["where_it_works"] == ["Funciona con gamma positiva y skew calmo"]
    assert s["decisions"] == ["No operar con VIX arriba de 30"]


def test_a_missing_or_stale_story_is_declared(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    assert any("sin lectura de la historia" in m for m in contrast.pack(kb, now=NOW)["missing"])
    save(kb, slug="historia-del-mercado-spy")
    pack = contrast.pack(kb, now=NOW + timedelta(hours=60))
    assert pack["story"]["stale"] and any("puede no ser la de hoy" in m for m in pack["missing"])
