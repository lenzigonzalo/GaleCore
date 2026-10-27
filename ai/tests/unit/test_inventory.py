"""GC-AI-0024: what the harness has and what it costs — capabilities with their model and consumption, data sources,
host connectors."""
# ruff: noqa: F811  (pytest fixtures imported from other test modules)

from __future__ import annotations

from datetime import timedelta

import pytest
from pydantic import ValidationError

from galecore_ai.adapters.source_registry_store import load_source_registry
from galecore_ai.adapters.source_status_store import FileSourceStatusStore
from galecore_ai.application import inventory
from galecore_ai.application import tasks as t
from galecore_ai.harness.catalog import load_catalog
from tests.unit.test_knowledge import NOW, kb  # noqa: F401  (kb is a fixture)
from tests.unit.test_strategy import research_ref  # noqa: F401  (research_ref is a fixture)
from tests.unit.test_tasks import env, make  # noqa: F401  (env is a fixture)


def _finished(kb, task_id, minutes, **data):
    t._append(kb, task_id, "run_finished", NOW + timedelta(minutes=minutes), **data)


def build(kb, tmp_path):
    return inventory.build(catalog=load_catalog(), registry=load_source_registry(),
                           status_store=FileSourceStatusStore(tmp_path / "status"), kb=kb)


def test_consumption_is_per_capability_and_averages_only_runs_with_tokens(env, tmp_path):
    kb, sch, _ = env
    make(kb, sch, task_id="atencion", capability="daily_attention", result_slug="atencion-spy", objective="o")
    _finished(kb, "atencion", 1, result="OK", duration_s=100.0, tokens={"input": 10, "output": 1000,
                                                                       "cache_read": 30000, "cache_write": 2000})
    _finished(kb, "atencion", 2, result="OK", duration_s=200.0, tokens={"input": 30, "output": 3000,
                                                                       "cache_read": 50000, "cache_write": 0})
    _finished(kb, "atencion", 3, result="FAILED", duration_s=30.0)          # a run from before tokens were kept
    used = inventory.consumption(kb)["daily_attention"]
    assert used["runs"] == 3 and used["runs_with_tokens"] == 2 and used["mean_duration_s"] == 110.0
    assert used["mean_tokens"] == {"input": 20, "output": 2000, "cache_read": 40000, "cache_write": 1000}
    assert used["last_at"].startswith((NOW + timedelta(minutes=3)).isoformat()[:16])
    inv = build(kb, tmp_path)
    cap = next(c for c in inv["capabilities"] if c["id"] == "daily_attention")
    assert cap["runs"] == "modelo" and cap["max_turns"] == 40 and cap["consumption"] == used
    assert "| daily_attention | modelo |" in inventory.render(inv) and "2.0 k ·" in inventory.render(inv)


def test_without_runs_or_knowledge_base_there_is_no_consumption(tmp_path):
    inv = build(None, tmp_path)
    assert all(c["consumption"] is None for c in inv["capabilities"])
    watch = next(c for c in inv["capabilities"] if c["id"] == "market_watch")
    assert watch["model"] == "sonnet"
    assert next(c for c in inv["capabilities"] if c["id"] == "research")["runs"] == "en sesión"


def test_sources_and_connectors_say_cost_purpose_and_permission(tmp_path):
    inv = build(None, tmp_path)
    assert {s["id"] for s in inv["sources"]} >= {"galecore", "fred", "alpha_vantage"}
    conn = {c["id"]: c for c in inv["connectors"]}
    assert conn["iol"]["permission"] == "ask" and conn["ibkr"]["permission"] == "warn"
    for c in conn.values():
        assert c["for"] and c["when"]
        if c["source"]:                                   # a connector that brings data is in the source registry
            assert c["source"] in {s["id"] for s in inv["sources"]}
    text = inventory.render(inv)
    assert "preguntar antes" in text and "no ven conectores" in text and "cupo diario" in text


def test_the_macro_calendar_is_galecores_now(tmp_path):
    # GC-0006 serves calendar.macro_releases and calendar.fomc_meetings: it is no longer a requested source.
    reg = load_source_registry()
    assert reg.get("galecore_macro_calendar") is None
    assert any(c.category == "macro_calendar" for c in reg.get("galecore").covers)


def test_a_connector_with_an_unknown_permission_is_refused():
    with pytest.raises(ValidationError, match="permission"):
        inventory.HostConnector.model_validate({"id": "x", "display_name": "X", "state": "connected", "for": "a",
                                                "when": "b", "permission": "always"})
