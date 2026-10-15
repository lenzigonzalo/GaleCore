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


# WS-0037: the requests of the closing test (roadmap §2, C0–C12) reach their capability above the hook's threshold.
@pytest.mark.parametrize("request_text,expected", [
    ("Retomemos lo que trabajamos", "strategy_project"),                          # C0
    ("¿Dónde habíamos quedado con la estrategia?", "strategy_project"),
    ("¿Qué cambió y me afecta?", "daily_attention"),                              # C1
    ("Explicame la macro", "on_demand_analysis"),                                 # C2
    ("¿Qué mueve a SPY?", "on_demand_analysis"),
    ("Mis objetivos, ¿están claros?", "user_profile"),                            # C3
    ("¿Qué haría que esta tesis deje de servir?", "strategy_design"),             # C4
    ("Tengo una idea, pensemos si sirve", "strategy_design"),                     # C5
    ("¿Prendo, pauso o espero la estrategia?", "strategy_design"),                # C6
    ("Avisame si SPY baja de 650", "watch_alerts"),                               # C7
    ("¿La dejo abierta antes del CPI?", "daily_attention"),
    ("¿Qué exposición tengo?", "capital_risk"),                                   # C8
    ("Tengo 5.000 USD, ¿qué puedo hacer?", "capital_risk"),
    ("¿Cómo viene mi cartera?", "performance_review"),                            # C9
    ("Esto no me sirvió porque usaste datos viejos", "capability_builder"),       # C10
    ("Este trabajo me sirvió, quiero reutilizarlo", "capability_builder"),        # C11
    ("¿Qué podés hacer?", "trader_space"),                                        # C12 / U-14
])
def test_the_closing_test_requests_find_their_capability(request_text, expected):
    out = match(request_text, load_catalog())
    assert out["matches"][0]["capability"] == expected and out["confident"]


def test_a_weak_match_hands_every_capability_to_choose_by_meaning():
    catalog = load_catalog()
    out = match("¿En qué quedamos la última vez?", catalog)
    assert not out["confident"] and len(out["options"]) == len(catalog.entries)
    assert all(o["serves"] and o["example"] for o in out["options"])
