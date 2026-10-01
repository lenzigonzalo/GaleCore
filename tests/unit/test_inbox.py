"""Idea inbox (GC-AI-0018): an idea is kept as said, reviewed later, and never deleted."""

from __future__ import annotations

import json
from datetime import timedelta

import pytest

from galecore_ai.application import inbox
from galecore_ai.application.knowledge import KnowledgeError
from tests.unit.test_knowledge import NOW, kb, save  # noqa: F401  (kb is a fixture)

IDEA = "Probar la estrategia con acciones en vez de opciones, con datos más fáciles de conseguir"


@pytest.fixture
def workspace(kb):  # noqa: F811
    """A backlog with one item and a work item, where the destinations are looked up."""
    backlog = kb.workspace / "GaleCore-AI" / "docs" / "architecture" / "PRODUCT-BACKLOG.md"
    backlog.parent.mkdir(parents=True)
    backlog.write_text("# Backlog\n\n## BL-007 — Estrategias\n\ntexto\n", encoding="utf-8")
    wi = kb.workspace / ".worktrees" / "galecore-ai" / "GC-AI-0019" / "docs" / "engineering" / "work-items"
    wi.mkdir(parents=True)
    (wi / "GC-AI-0019-acciones.md").write_text("---\nid: GC-AI-0019\n---\n", encoding="utf-8")
    return kb


def note(kb, words=IDEA, **kw):  # noqa: F811
    return inbox.add(kb=kb, words=words, prompt=f"Anotá esto: {words}", now=kw.pop("now", NOW), **kw)


def test_an_idea_is_kept_verbatim_and_pending(kb):  # noqa: F811
    item, path = note(kb, context="revisando el briefing de la entrega 5")
    assert item.id == "2026-09-23-probar-la-estrategia-con-acciones-en" and item.words == IDEA
    assert item.status == "pending" and path == kb.base / "inbox" / f"{item.id}.json"
    assert [i.id for i in inbox.items(kb, "pending")] == [item.id]


def test_the_same_idea_twice_is_two_items(kb):  # noqa: F811
    first, _ = note(kb)
    second, _ = note(kb)
    assert second.id == f"{first.id}-2" and len(inbox.items(kb)) == 2


def test_refs_must_resolve_and_credentials_are_refused(kb):  # noqa: F811
    with pytest.raises(KnowledgeError, match="ref research:nada"):
        note(kb, refs=["research:nada"])
    doc, _ = save(kb)
    assert note(kb, refs=[f"research:{doc.id}"])[0].refs == [f"research:{doc.id}"]
    with pytest.raises(KnowledgeError, match="credential"):
        note(kb, words="usar la api_key=abcd1234efgh5678 de FMP")


def test_a_review_needs_an_existing_destination_and_keeps_the_history(workspace):
    kb = workspace  # noqa: F811
    item, _ = note(kb)
    for bad, why in (("backlog:BL-999", "BL-999 is not in"), ("work-item:GC-AI-0099", "no work item GC-AI-0099"),
                     ("backlog", "to is roadmap")):
        with pytest.raises(KnowledgeError) as exc:
            inbox.resolve(kb=kb, item_id=item.id, to=bad, note="n", prompt="p", now=NOW)
        assert why in " ".join([str(exc.value), *exc.value.problems])
    inbox.resolve(kb=kb, item_id=item.id, to="backlog:BL-007", note="ya lo cubre BL-007 (addendum)",
                  prompt="mandala al backlog", now=NOW + timedelta(days=1))
    moved, _ = inbox.resolve(kb=kb, item_id=item.id, to="work-item:GC-AI-0019", note="se abrió el work item",
                             prompt="ahora es trabajo", now=NOW + timedelta(days=2))
    assert moved.status == "work-item:GC-AI-0019" and [r.to for r in moved.resolutions] == [
        "backlog:BL-007", "work-item:GC-AI-0019"]
    assert inbox.items(kb, "pending") == [] and len(inbox.items(kb, "resolved")) == 1


def test_a_review_needs_a_reason_and_the_owners_words(workspace):
    item, _ = note(workspace)
    with pytest.raises(KnowledgeError, match="Refusing to resolve"):
        inbox.resolve(kb=workspace, item_id=item.id, to="discarded", note="  ", prompt="p")


def test_an_edited_idea_is_integrity_failed(kb):  # noqa: F811
    item, path = note(kb)
    data = json.loads(path.read_text(encoding="utf-8"))
    data["words"] = "otra cosa"
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(KnowledgeError, match="INTEGRITY_FAILED"):
        inbox.load(kb, item.id)


def test_noting_never_writes_outside_the_inbox(kb):  # noqa: F811
    before = {p for p in kb.base.rglob("*") if p.is_file()}
    note(kb)
    after = {p for p in kb.base.rglob("*") if p.is_file()}
    assert {p.parent.name for p in after - before} == {"inbox"}
