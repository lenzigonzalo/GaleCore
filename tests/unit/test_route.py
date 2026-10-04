"""GC-AI-0022: ask without naming a skill — the request, in the trader's words, finds its capability."""

from __future__ import annotations

import pytest

from galecore_ai.application.route import match
from galecore_ai.harness.catalog import load_catalog


@pytest.mark.parametrize("request_text,expected", [
    ("¿Hay algo para vender prima esta semana en SPY o QQQ sin meterme en el CPI?", "market_watch"),
    ("¿Qué merece mi atención hoy?", "daily_attention"),
    ("Armame un agente que revise IWM cada hora", "market_watch"),
    ("¿Cuál es el IV rank de NVDA?", "data_sources"),
    ("Quiero probar una estrategia de call credit spreads", "strategy_design"),
    ("¿Cómo le fue a mi estrategia en SHADOW?", "strategy_followup"),
    ("¿Qué sabés de mis objetivos?", "trader_space"),
    ("Anotá esto: mirar el VIX antes de abrir", "idea_inbox"),
    ("Analizame el contexto macro para una idea alcista en tasas", "context_research"),
])
def test_the_request_finds_its_capability(request_text, expected):
    assert match(request_text, load_catalog())["matches"][0]["capability"] == expected


def test_nothing_matches_and_it_says_so():
    out = match("Comprame un auto", load_catalog())
    assert out["missing"] and "capability_builder" in out["next"]
