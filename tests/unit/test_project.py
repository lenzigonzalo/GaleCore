"""GC-AI-0026: a strategy, or the portfolio, as a project — one view with references, and the owner's log."""

from __future__ import annotations

import json

import pytest

from galecore_ai.application import project, space
from galecore_ai.application.knowledge import KnowledgeError, search
from galecore_ai.application.profile import set_profile
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
    assert any("tesis" in m for m in view["missing"]) and any("ninguna versión aprobada" in m for m in view["missing"])


def test_the_approved_version_is_the_one_in_force(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    approve(kb=kb, key=KEY, spec_hash=doc.spec_hash, owner_words="apruebo", host=HOST, now=NOW)
    view = project.strategy_project(kb, NAME)
    assert view["current"]["approved"] and not any("aprobada" in m for m in view["missing"])


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
        project.strategy_project(kb, NAME)
    assert any(f["ref"] == f"project:{NAME}" for f in search(kb, text="vix")["integrity_failed"])


def test_kb_search_finds_project_entries(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    add(kb, "story", "Funciona con gamma positiva")
    found = search(kb, text="gamma positiva", kind="project")["results"]
    assert [r["ref"] for r in found] == [f"project:{NAME}"]


def test_portfolio_without_galecore_declares_the_profile_unconfirmed(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    set_profile(kb.profile, changes={"horizon": "30 a 45 días"}, note="horizonte", prompt="p", host=HOST)
    add(kb, "decision", "Máximo dos estrategias a la vez", name="portfolio")
    view = project.portfolio_project(kb, None, "ConnectError: sin red")
    assert [s["name"] for s in view["strategies"]] == [NAME] and view["strategies"][0]["approved"] is None
    assert view["profile"]["ref"] == "profile:v1" and "sin confirmar" in view["profile"]["source"]
    assert any("GaleCore no respondió" in m for m in view["missing"])
    assert view["log"]["decisions"][0]["words"] == "Máximo dos estrategias a la vez"


def test_a_monitor_edit_is_not_overwritten_and_is_pulled(kb, galecore):  # noqa: F811
    fake, client = galecore
    set_profile(kb.profile, changes={"horizon": "30 a 45 días"}, note="horizonte", prompt="p", host=HOST)
    pieces = space.local_pieces(kb)
    space.sync(client, [p for p in pieces if p["kind"] != "agent"])
    assert space.profile_state(client, kb)["state"] == "coherent"
    row = fake.rows[("profile", "perfil")]                    # the owner edits the horizon in the monitor
    row["content"] = json.dumps({**json.loads(row["content"]), "horizon": "60 días"})
    state = space.profile_state(client, kb)
    assert state["state"] == "edited_in_monitor" and state["ref"] is None
    kept, held = space.guard_profile(client, kb, pieces)
    assert not any(p["kind"] == "profile" for p in kept) and held
    assert project.portfolio_project(kb, state)["missing"][0].startswith("el perfil se editó en el monitor")
    result = space.pull_profile(client, kb, HOST)
    assert result["status"] == "PULLED" and result["ref"] == "profile:v2"
    assert kb.profile.latest().content.horizon == "60 días"
    space.sync(client, [p for p in space.local_pieces(kb) if p["kind"] != "agent"])
    assert space.profile_state(client, kb)["state"] == "coherent"


def test_a_local_version_not_imported_yet_is_local_newer(kb, galecore):  # noqa: F811
    _, client = galecore
    set_profile(kb.profile, changes={"horizon": "30 a 45 días"}, note="v1", prompt="p", host=HOST)
    space.sync(client, [p for p in space.local_pieces(kb) if p["kind"] == "profile"])
    set_profile(kb.profile, changes={"horizon": "45 días"}, note="v2", prompt="p", host=HOST)
    state = space.profile_state(client, kb)
    assert state["state"] == "local_newer" and state["ref"] == "profile:v2"
    assert space.guard_profile(client, kb, space.local_pieces(kb))[1] == []
