"""WS-0073 AC-6: `skill run` for scheduled agents (only their own skill) and the record of every run."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pytest

from galecore_ai.adapters import cli
from galecore_ai.application import model_run as mr
from galecore_ai.application import skill_run as sr
from galecore_ai.application import space
from galecore_ai.application.catalog_check import _schedule_problems, cli_commands, own_script
from galecore_ai.harness.catalog import load_catalog
from tests.unit.test_knowledge import kb  # noqa: F401  (fixture)
from tests.unit.test_strategy import research_ref  # noqa: F401  (fixture)
from tests.unit.test_tasks import env, make  # noqa: F401  (env is a fixture)

DEMO = Path(__file__).resolve().parents[1] / "fixtures" / "skills" / "demo-folder"
SWING = "revisar_swing_etfs"
RULE = f"Bash({mr.CLI} skill run revisar-swing-etfs revision_swing.py:*)"


def _tools(capability: str) -> list[str]:
    return mr.allowed_tools(load_catalog().get(capability), cli_commands(cli.build_parser()))


def test_an_agent_gets_only_the_script_of_its_own_skill():
    assert RULE in _tools(SWING)
    assert not [r for r in _tools("market_watch") if "skill run" in r]            # no scripts declared elsewhere
    assert not [r for r in _tools(SWING) if r.startswith("Bash(") and "skill run" in r and r != RULE]


def test_a_flow_that_runs_another_skills_script_is_refused():
    entry, commands = load_catalog().get(SWING), cli_commands(cli.build_parser())
    for line in ("skill run on-demand-analysis calc.py", "skill run revisar-swing-etfs ../otro.py",
                 "skill run revisar-swing-etfs no_existe.py"):
        bad = entry.model_copy(update={"flow": [line]})
        assert own_script(bad, line.split()) is None
        assert any("own skill folder" in p for p in _schedule_problems(bad, commands)), line
    assert _schedule_problems(entry, commands) == []


def _run_cli(monkeypatch, tmp_path, script, run_dir=None):
    monkeypatch.setattr(cli, "knowledge_dir", lambda: tmp_path)
    def fake_skill_dir(ref):
        if ref != "demo-folder":
            raise sr.SkillRunError(f"No skill {ref!r} in the catalog")
        return DEMO
    monkeypatch.setattr(sr, "skill_dir", fake_skill_dir)
    if run_dir:
        monkeypatch.setenv(sr.RUN_DIR_ENV, str(run_dir))
    else:
        monkeypatch.delenv(sr.RUN_DIR_ENV, raising=False)
    skill = "demo-folder" if script != "otra" else "otra-skill"
    with pytest.raises(SystemExit) as stop:
        cli._cmd_skill(argparse.Namespace(skill=skill, script=script if script != "otra" else "x.py",
                                          script_args=["2", "3"] if script == "calc.py" else [], timeout=30))
    return stop.value.code


def test_an_agent_run_is_recorded_with_the_file_hash(monkeypatch, tmp_path):
    run_dir = tmp_path / "runs" / "swing-agente" / "20261101T120000Z"
    assert _run_cli(monkeypatch, tmp_path, "calc.py", run_dir) == 0
    [row] = [json.loads(x) for x in (tmp_path / sr.RUNS_FILE).read_text(encoding="utf-8").splitlines()]
    assert row["by"] == "agent:swing-agente" and row["skill"] == "demo-folder" and row["script"] == "calc.py"
    assert row["ok"] and row["exit_code"] == 0 and row["args"] == ["2", "3"] and row["error"] is None
    import hashlib
    assert row["sha256"] == hashlib.sha256((DEMO / "scripts" / "calc.py").read_bytes()).hexdigest()
    assert row["duration_ms"] >= 0 and row["at"]


def test_a_failing_script_leaves_a_record_with_its_error(monkeypatch, tmp_path):
    assert _run_cli(monkeypatch, tmp_path, "falla.py", tmp_path / "runs" / "a1" / "s") != 0
    row = json.loads((tmp_path / sr.RUNS_FILE).read_text(encoding="utf-8").splitlines()[0])
    assert not row["ok"] and row["exit_code"] == 3 and "salió mal" in row["error"] and row["by"] == "agent:a1"


def test_a_refused_run_is_recorded_too_and_chat_is_told_apart(monkeypatch, tmp_path):
    assert _run_cli(monkeypatch, tmp_path, "otra") != 0
    row = json.loads((tmp_path / sr.RUNS_FILE).read_text(encoding="utf-8").splitlines()[0])
    assert not row["ok"] and row["by"] == "chat" and row["sha256"] is None and "otra-skill" in row["error"]


def test_the_agents_screen_state_gives_the_last_run_of_each_script(env):  # noqa: F811
    kb, sch, _ = env  # noqa: F811
    make(kb, sch, task_id="swing", strategy=None, capability=SWING, objective="Revisá SPY, IEF y GLD")
    empty = space.agent_state(kb, "swing")["skill_scripts"]
    assert empty == {"skill": "revisar-swing-etfs", "scripts": [{"script": "revision_swing.py", "last_run": None}]}
    sr.record_run(kb.base, {"ok": False, "skill": "revisar-swing-etfs", "script": "revision_swing.py",
                            "exit_code": 1, "stderr": "boom", "duration_ms": 5, "sha256": "ab"}, [], by="agent:swing")
    sr.record_run(kb.base, {"ok": True, "skill": "revisar-swing-etfs", "script": "revision_swing.py",
                            "exit_code": 0, "duration_ms": 9, "sha256": "cd"}, [], by="agent:swing")
    sr.record_run(kb.base, {"ok": False, "skill": "revisar-swing-etfs", "script": "revision_swing.py"}, [], by="chat")
    last = space.agent_state(kb, "swing")["skill_scripts"]["scripts"][0]["last_run"]
    assert last["ok"] and last["sha256"] == "cd" and last["by"] == "agent:swing"
    assert space.agent_state(kb, "swing")["skill_scripts"]["skill"] == "revisar-swing-etfs"


def _candles(n=300, drift=0.0):
    day = 86_400_000
    rows = []
    for i in range(n):
        c = 100 + i * 0.1 + drift * (i % 7)
        rows.append({"time": 1_700_000_000_000 + i * day, "open": c, "high": c + 1, "low": c - 1, "close": c,
                     "volume": 1000})
    return {"data": rows}


def test_the_swing_script_prints_json_from_files_without_touching_the_skill_folder(tmp_path):
    for s in ("spy", "ief", "gld"):
        (tmp_path / f"{s}.json").write_text(json.dumps(_candles()), encoding="utf-8")
        (tmp_path / f"{s}-quote.json").write_text(json.dumps({"data": [{"bidPrice": 99.9, "askPrice": 100.1}]}),
                                                  encoding="utf-8")
    folder = Path(sr.skill_dir(SWING))
    last = _candles()["data"][-1]["time"]
    from datetime import UTC, datetime
    cutoff = datetime.fromtimestamp(last / 1000, UTC).date().isoformat()
    before = sorted(p.name for p in folder.rglob("*") if p.is_file())
    r = sr.run_script(folder, "revision_swing.py", ["--input", str(tmp_path), "--cutoff", cutoff])
    assert r["ok"], r["stderr"]
    assert [x["symbol"] for x in r["result"]] == ["SPY", "IEF", "GLD"] and r["result"][0]["bars"] == 300
    assert sorted(p.name for p in folder.rglob("*") if p.is_file()) == before
