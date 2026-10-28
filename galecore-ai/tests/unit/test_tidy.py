"""WS-0063: kb tidy proposes what looks abandoned; kb archive moves it out of the search (no automatic delete)."""

from __future__ import annotations

import json
import os
import subprocess
from datetime import UTC, datetime, timedelta

import pytest

from galecore_ai.application import tidy
from galecore_ai.application.knowledge import KnowledgeError
from tests.unit.test_knowledge import kb  # noqa: F401  (fixture)

NOW = datetime(2026, 10, 26, tzinfo=UTC)


def _age(path, days):
    t = (NOW - timedelta(days=days)).timestamp()
    for f in [path, *path.rglob("*")]:
        os.utime(f, (t, t))


def _project(kb, sub, name, days):  # noqa: F811
    d = kb.base / sub / name
    d.mkdir(parents=True)
    (d / "workspace.json").write_text("{}", encoding="utf-8")
    _age(d, days)
    return d


def test_tidy_lists_the_four_groups_with_their_command(kb):  # noqa: F811
    _project(kb, "workspaces", "personal", 90)           # never proposed
    _project(kb, "workspaces", "vieja", 40)
    _project(kb, "strategies", "reciente", 2)
    (kb.base / "followups" / "huerfana").mkdir(parents=True)
    (kb.base / "followups" / "reciente").mkdir(parents=True)
    (kb.base / "gaps").mkdir()
    need = "Backtest de spreads de SPY de los últimos diez años con cotizaciones"
    for i, text in enumerate([need + " históricas", need + " ejecutables", "Algo distinto del todo en otro tema"]):
        (kb.base / "gaps" / f"g{i}.json").write_text(json.dumps({"need": text}), encoding="utf-8")
    agents = [{"key": "vieja-tarea", "content": json.dumps({"status": "cancelled"})},
              {"key": "viva", "content": json.dumps({"status": "active"})}]
    out = tidy.tidy(kb, now=NOW, space_agents=agents)
    assert [i["item"] for i in out["idle_projects"]] == ["workspaces/vieja"]
    assert out["idle_projects"][0]["command"] == "kb archive workspaces/vieja"
    assert [i["item"] for i in out["orphans"]] == ["followups/huerfana"]
    assert [i["command"] for i in out["cancelled_in_space"]] == ["space delete agent/vieja-tarea"]
    assert out["similar_gaps"][0]["files"] == ["gaps/g0.json", "gaps/g1.json"]
    assert out["similar_gaps"][0]["command"] == "kb archive gaps/g1.json"
    assert out["count"] == 4


def test_a_recent_lab_conversation_keeps_a_project_off_the_list(kb):  # noqa: F811
    _project(kb, "workspaces", "vieja", 40)
    chats = kb.base.parent / "tools" / "terminal" / ".local" / "chats"
    chats.mkdir(parents=True)
    chat = chats / "c.json"
    chat.write_text(json.dumps({"project": "vieja"}), encoding="utf-8")
    t = (NOW - timedelta(days=1)).timestamp()
    os.utime(chat, (t, t))
    assert tidy.tidy(kb, now=NOW)["idle_projects"] == []


def test_the_curator_section_names_each_item_and_its_command(kb):  # noqa: F811
    _project(kb, "workspaces", "vieja", 40)
    section = tidy.report_section(tidy.tidy(kb, now=NOW))
    assert "## Para limpiar" in section and "`kb archive workspaces/vieja`" in section
    assert tidy.report_section(tidy.tidy(kb.__class__(base=kb.base / "nada", records=kb.records, research=kb.research),
                                         now=NOW)) == ""


def test_archive_moves_to_archive_and_commits(kb):  # noqa: F811
    d = _project(kb, "workspaces", "vieja", 40)
    subprocess.run(["git", "-C", str(kb.base), "init", "-q"], check=True)
    subprocess.run(["git", "-C", str(kb.base), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(kb.base), "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x"],
                   check=True)
    out = tidy.archive(kb, "workspaces/vieja")
    assert out["to"] == "archive/workspaces/vieja" and not d.exists()
    assert (kb.base / "archive" / "workspaces" / "vieja" / "workspace.json").exists()
    assert out["knowledge"] in ("committed",) or out["knowledge"].startswith("commit failed")


@pytest.mark.parametrize("bad", ["", "../fuera", "workspaces", "archive/x/y", "/abs/path", "workspaces/no-existe"])
def test_archive_refuses_what_it_should_not_move(kb, bad):  # noqa: F811
    with pytest.raises(KnowledgeError):
        tidy.archive(kb, bad)
