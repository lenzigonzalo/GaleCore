"""The curator's screen by code (WS-0025): the model is called only for a domain with enough new material."""

from __future__ import annotations

# ruff: noqa: F811  (pytest fixtures imported from other test modules)
from datetime import timedelta
from typing import ClassVar

from galecore_ai.application import curation
from galecore_ai.application import tasks as t
from tests.unit.test_knowledge import NOW, kb, save  # noqa: F401  (kb is a fixture)
from tests.unit.test_model_tasks import FakeModel, mr
from tests.unit.test_strategy import research_ref  # noqa: F401  (research_ref is a fixture)
from tests.unit.test_tasks import env, make  # noqa: F401  (env is a fixture)

LATER = NOW + timedelta(hours=1)
LONG_AGO = NOW - timedelta(days=30)


def test_nothing_new_calls_no_domain(kb):
    found = curation.screen(kb, last_run=LATER, now=LATER + timedelta(days=1))
    assert found["domains"] == [] and found["new"] == {}


def test_a_domain_needs_the_threshold_and_is_listed_with_its_refs(kb):
    for slug in ("gex-a", "gex-b"):
        save(kb, slug)
    assert curation.screen(kb, last_run=LONG_AGO, now=LATER)["domains"] == []
    save(kb, "gex-c")
    found = curation.screen(kb, last_run=LONG_AGO, now=LATER)
    assert found["domains"] == ["mercado"] and found["new"]["mercado"]["count"] == 3
    assert all(r.startswith("research:") for r in found["new"]["mercado"]["refs"])


def test_what_was_curated_before_the_last_run_does_not_count(kb):
    for slug in ("gex-a", "gex-b", "gex-c"):
        save(kb, slug)
    assert curation.screen(kb, last_run=LATER, now=LATER + timedelta(days=1))["new"] == {}


def test_the_curation_itself_is_not_material(kb):
    for slug in ("curaduria", "gex-a", "gex-b"):
        save(kb, slug)
    assert curation.screen(kb, last_run=LONG_AGO, now=LATER)["new"]["mercado"]["count"] == 2


def test_a_run_without_material_does_not_call_the_model(env):
    kb, sch, follow = env
    make(kb, sch, task_id="curaduria", capability="knowledge_curator", result_slug="curaduria",
         objective="Poner al día la memoria")
    model = FakeModel(mr.ModelReply(ok=True, structured={}, turns=1, duration_s=1.0, model="claude-test"))
    out = t.run(kb=kb, task_id="curaduria", followup=follow, commit=False, now=LATER, client=model)
    assert model.calls == [] and out["result"] == "OK" and out["model"] is None
    assert "sin modelo" in out["reason"]


def test_with_material_the_model_gets_only_the_domains_that_crossed_the_threshold(env):
    kb, sch, follow = env
    for slug in ("gex-a", "gex-b", "gex-c"):
        save(kb, slug)
    make(kb, sch, task_id="curaduria", capability="knowledge_curator", result_slug="curaduria",
         objective="Poner al día la memoria")
    model = FakeModel(mr.ModelReply(ok=False, error="sin cuota", turns=1, duration_s=1.0, model="claude-test"))
    t.run(kb=kb, task_id="curaduria", followup=follow, commit=False, now=LATER, client=model)
    assert len(model.calls) == 1
    prompt = model.calls[0]["prompt"]
    assert "Curate ONLY these domains: mercado" in prompt and "research:" in prompt


def test_a_story_with_a_reason_stays_on_sonnet_and_the_event_says_why(env, monkeypatch):
    kb, sch, follow = env
    make(kb, sch, task_id="historia", capability="market_story", strategy=None, result_slug="historia-spy",
         objective="¿Qué historia está priceando el mercado?")
    monkeypatch.setattr(t, "_story_pack", lambda *a: ("evidence:pack", "pack", "VIX.close +12.0%"))

    class Spy(mr.ClaudeCodeClient):
        used: ClassVar[list] = []

        def run(self, **kw):
            self.used.append(self.model)
            return mr.ModelReply(ok=False, error="sin cuota", turns=1, duration_s=1.0, model="claude-test")

    out = t.run(kb=kb, task_id="historia", followup=follow, commit=False, now=LATER, client=Spy(binary="claude"))
    assert Spy.used == ["sonnet"] and out["route"].endswith("la historia marcó: VIX.close +12.0%")
