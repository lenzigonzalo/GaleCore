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
    pack = contrast.pack(kb, now=NOW + timedelta(hours=2))
    assert pack["story"]["ref"] == "research:2026-09-23-historia-del-mercado-spy" and not pack["story"]["stale"]
    assert [s["name"] for s in pack["strategies"]] == [NAME] and pack["strategies"][0]["where_it_works"] == []
    assert any("no dice en qué historia funciona" in m for m in pack["missing"])
    assert pack["save_as"] == {"capability": "daily_contrast", "slug": "contraste-diario"}
    assert pack["integrity_failed"] == []


def test_the_strategy_story_and_decisions_reach_the_pack(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    project.add(kb=kb, name=NAME, kind="story", words="Funciona con gamma positiva y skew calmo", prompt="p", now=NOW)
    project.add(kb=kb, name=NAME, kind="decision", words="No operar con VIX arriba de 30", prompt="p", now=NOW)
    s = contrast.pack(kb, now=NOW)["strategies"][0]
    assert s["where_it_works"] == ["Funciona con gamma positiva y skew calmo"]
    assert s["decisions"] == ["No operar con VIX arriba de 30"]


def test_a_missing_or_stale_story_is_declared(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    assert any("sin lectura de la historia" in m for m in contrast.pack(kb, now=NOW)["missing"])
    save(kb, slug="historia-del-mercado-spy")
    pack = contrast.pack(kb, now=NOW + timedelta(hours=60))
    assert pack["story"]["stale"] and any("puede no ser la de hoy" in m for m in pack["missing"])


# ── P1-05 (U-28): «esperar», «qué la cambiaría» and what moves the symbol ─────────────────────────────

import pytest

from galecore_ai.application import story
from galecore_ai.application.knowledge import (
    KnowledgeError,
    check_content,
    save_research,
)
from galecore_ai.contracts.regime_record import RecordHost
from tests.unit.test_knowledge import content

FACT = {"kind": "fact", "text": "El corte incluye el vencimiento del día", "sources": ["file:notes/backlog.md"]}


def proposal(text: str) -> dict:
    return {"kind": "interpretation", "text": text}


def problems(kb, *texts, capability="daily_contrast"):  # noqa: F811
    return check_content(content(statements=[FACT, *(proposal(x) for x in texts)]), kb, capability=capability)[1]


def test_each_strategy_gets_one_proposal_that_says_what_would_change_it(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    ok = f"{NAME}: esperar — el CPI del 14/10 cae en el vencimiento; qué la cambiaría: el CPI sin mover a SPY más que la IV"
    assert problems(kb, ok) == []
    assert problems(kb, ok.replace(" — ", " - ")) == []                       # a plain hyphen is accepted
    assert any("qué la cambiaría" in p for p in problems(kb, f"{NAME}: mantener — la historia sigue igual"))
    assert any("qué la cambiaría" in p for p in problems(kb, f"{NAME}: mantener — igual; qué la cambiaría:   "))
    assert any("«mantener (reducir)»" in p
               for p in problems(kb, f"{NAME}: mantener (reducir) — x; qué la cambiaría: y"))
    # A strategy without its proposal is refused; a line about something else is not a proposal.
    assert any(f"no proposal for {NAME}" in p for p in problems(kb, "Nota: esperar — el mercado está quieto"))
    assert problems(kb, "Nota: esperar — x", capability="market_story") == []


def test_saving_a_contrast_without_what_would_change_it_is_refused(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    with pytest.raises(KnowledgeError, match="qué la cambiaría"):
        save_research(kb=kb, slug="contraste-diario", prompt="p", host=RecordHost(provider="test"), now=NOW,
                      content=content(statements=[FACT, proposal(f"{NAME}: apagar — la historia cambió")]),
                      capability="daily_contrast")


def test_the_pack_brings_what_moves_the_symbol_from_the_latest_story_pack(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    drivers = {"reaction": {"from": "2026-04-01", "days_without_data": {"n": 90, "median_ratio": 0.44},
                            "by_release": {"CPI": {"n": 6, "median_ratio": 0.3, "premium": "la IV pagó de más",
                                                   "vs_days_without_data": "mueve menos", "events": [{}]}}},
               "upcoming": [{"date": "2026-10-14", "release": "CPI", "implied_today_pct": 0.94}],
               "co_movement": {"assets": [{"asset": "TLT", "corr_last": 0.65}]}}
    pack = {"symbol": "SPY", "gathered_at": (NOW - timedelta(hours=1)).isoformat(), "prices": {}, "volatility": {},
            "missing": [], "drivers": drivers}
    ref, _ = story.save_pack(kb, pack, prompt="historia", host=RecordHost(provider="test"), now=NOW)
    got = contrast.pack(kb, now=NOW)["drivers"]
    assert got["ref"] == ref and got["upcoming"][0]["release"] == "CPI"
    assert got["by_release"]["CPI"] == {"n": 6, "median_ratio": 0.3, "premium": "la IV pagó de más",
                                        "vs_days_without_data": "mueve menos"}
    assert got["co_movement"] == [{"asset": "TLT", "corr_last": 0.65}]


def test_without_a_story_pack_the_contrast_declares_it(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    pack = contrast.pack(kb, now=NOW)
    assert pack["drivers"] is None and any("sin «qué mueve hoy»" in m for m in pack["missing"])
