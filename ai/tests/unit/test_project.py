"""GC-AI-0026: a strategy, or the portfolio, as a project — one view with references, and the owner's log."""

from __future__ import annotations

import json

import pytest

from galecore_ai.application import project
from galecore_ai.application.knowledge import KnowledgeError, search
from galecore_ai.application.strategy import approve
from tests.unit.test_knowledge import HOST, NOW, kb, save  # noqa: F401  (kb is a fixture)
from tests.unit.test_space import galecore  # noqa: F401  (fixture)
from tests.unit.test_strategy import (  # noqa: F401  (research_ref is a fixture)
    KEY,
    NAME,
    research_ref,
    stored,
)


def add(kb, kind, words, **kw):  # noqa: F811
    return project.add(kb=kb, name=kw.pop("name", NAME), kind=kind, words=words, prompt=f"Anotá: {words}",
                       now=NOW, **kw)


def test_the_strategy_view_gathers_what_exists_with_references(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    view = project.strategy_project(kb, NAME)
    assert view["current"]["ref"] == f"strategy:{KEY}" and not view["current"]["approved"]
    assert view["current"]["spec_hash"] == doc.spec_hash and view["current"]["rules"]
    assert [r["ref"] for r in view["research"]] == [research_ref]
    assert view["last_followup"] is None and view["integrity_failed"] == []
    # WS-0027: an unapproved version says whether approval is recommended (strategy controls), and why.
    assert view["current"]["aprobacion"]["recomendar_aprobacion"] is False
    assert view["current"]["aprobacion"]["motivo"].startswith("No se recomienda aprobar")
    assert any("tesis" in m for m in view["missing"]) and any("ninguna versión aprobada" in m for m in view["missing"])


def test_the_approved_version_is_the_one_in_force(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    approve(kb=kb, key=KEY, spec_hash=doc.spec_hash, owner_words="apruebo", host=HOST, now=NOW)
    view = project.strategy_project(kb, NAME)
    assert view["current"]["approved"] and not any("aprobada" in m for m in view["missing"])
    assert "aprobacion" not in view["current"]


def test_owner_entries_are_kept_verbatim_and_open_items_close(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    add(kb, "thesis", "La prima de varianza paga si el mercado no se rompe", refs=[research_ref])
    add(kb, "story", "Funciona con gamma positiva y skew calmo; no con eventos macro encima")
    pending, _ = add(kb, "pending", "Definir el stop por VIX")
    log = project.strategy_project(kb, NAME)["log"]
    assert log["thesis"][0]["words"].startswith("La prima") and log["thesis"][0]["refs"] == [research_ref]
    assert [o["words"] for o in log["open"]] == ["Definir el stop por VIX"]
    add(kb, "done", "Stop definido en 30", closes=pending.hash[:16])
    view = project.strategy_project(kb, NAME)
    assert view["log"]["open"] == [] and view["log"]["closed"][0]["closes"] == pending.hash[:19]
    assert not any("tesis" in m or "historia" in m for m in view["missing"])


def test_bad_entries_are_refused(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    with pytest.raises(KnowledgeError, match="no strategy named"):
        add(kb, "thesis", "x", name="otra_estrategia")
    with pytest.raises(KnowledgeError, match="ref research:nada"):
        add(kb, "decision", "x", refs=["research:nada"])
    with pytest.raises(KnowledgeError, match="done needs --closes"):
        add(kb, "done", "x", closes="sha256:0")
    with pytest.raises(KnowledgeError, match="kind is one of"):
        add(kb, "idea", "x")


def test_an_edited_log_is_integrity_failed(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    _, path = add(kb, "decision", "No operar con VIX arriba de 30")
    data = json.loads(path.read_text(encoding="utf-8"))
    data["entries"][0]["words"] = "Operar siempre"
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(KnowledgeError, match="INTEGRITY_FAILED"):
        project.load_log(kb, NAME)
    assert any(f["ref"] == f"project:{NAME}" for f in search(kb, text="vix")["integrity_failed"])


def test_kb_search_finds_project_entries(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    add(kb, "story", "Funciona con gamma positiva")
    found = search(kb, text="gamma positiva", kind="project")["results"]
    assert [r["ref"] for r in found] == [f"project:{NAME}"]


def test_the_portfolio_view_has_strategies_and_its_log_and_no_profile(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    add(kb, "decision", "Máximo dos estrategias a la vez", name="portfolio")
    view = project.portfolio_project(kb)
    assert [s["name"] for s in view["strategies"]] == [NAME] and view["strategies"][0]["approved"] is None
    assert "profile" not in view
    assert view["log"]["decisions"][0]["words"] == "Máximo dos estrategias a la vez"


def test_a_damaged_log_does_not_hide_the_rest_of_the_view(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    for name in (NAME, "portfolio"):
        _, path = add(kb, "decision", "No operar con VIX arriba de 30", name=name)
        data = json.loads(path.read_text(encoding="utf-8"))
        data["entries"][0]["words"] = "Operar siempre"
        path.write_text(json.dumps(data), encoding="utf-8")
    view = project.strategy_project(kb, NAME)
    assert view["current"]["ref"] == f"strategy:{KEY}" and view["log"]["decisions"] == []
    assert view["integrity_failed"][0]["ref"] == f"project:{NAME}"
    pf = project.portfolio_project(kb)
    assert {f["ref"] for f in pf["integrity_failed"]} == {f"project:{NAME}", "project:portfolio"}
    assert pf["strategies"][0]["open_items"] is None
