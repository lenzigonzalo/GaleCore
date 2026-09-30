"""GC-AI-0017: a task runs any schedulable capability; the model reads, the runner validates and saves."""
# ruff: noqa: F811  (pytest fixtures imported from other test modules)

from __future__ import annotations

import json
import subprocess
from datetime import timedelta
from pathlib import Path

import pytest

from galecore_ai.adapters.cli import build_parser
from galecore_ai.application import model_run as mr
from galecore_ai.application import tasks as t
from galecore_ai.application.catalog_check import cli_commands
from galecore_ai.harness.catalog import load_catalog
from tests.unit.test_evidence import evidence
from tests.unit.test_knowledge import NOW, content, kb, save  # noqa: F401  (kb is a fixture)
from tests.unit.test_strategy import NAME, research_ref  # noqa: F401  (research_ref is a fixture)
from tests.unit.test_tasks import DAILY, FakeScheduler, env, make  # noqa: F401  (env is a fixture)

LATER = NOW + timedelta(hours=1)


class FakeModel:
    """Returns a canned reply and remembers what it was asked."""

    def __init__(self, reply: mr.ModelReply):
        self.reply, self.calls = reply, []

    def run(self, **kw):
        self.calls.append(kw)
        return self.reply


def output(status="OK", reason="", ev=None, **content_overrides) -> dict:
    data = {"status": status, "reason": reason, "content": content(**content_overrides).model_dump(mode="json"),
            "evidence": ev or []}
    return data


def model_ok(structured: dict) -> FakeModel:
    return FakeModel(mr.ModelReply(ok=True, structured=structured, turns=12, duration_s=80.0, model="claude-test"))


@pytest.fixture
def briefing(env, monkeypatch):
    kb, sch, follow = env
    monkeypatch.setenv("LOCALAPPDATA", str(kb.base.parent / "appdata"))
    make(kb, sch, task_id="atencion-diaria", capability="daily_attention",
         result_slug="atencion-diaria-spy", objective="¿Qué merece mi atención hoy?")
    return kb, sch, follow


def run(kb, follow, model, **kw):
    return t.run(kb=kb, task_id="atencion-diaria", followup=follow, commit=False, now=LATER, client=model, **kw)


# ── creating ────────────────────────────────────────────────────


def test_only_schedulable_capabilities_can_be_scheduled(env):
    kb, sch, _ = env
    with pytest.raises(t.TaskError, match="not schedulable"):
        make(kb, sch, task_id="diseno", capability="strategy_design")
    with pytest.raises(t.TaskError, match="No catalog entry"):
        make(kb, sch, task_id="nada", capability="no_existe")
    with pytest.raises(t.TaskError, match="no result_slug"):
        make(kb, sch, task_id="seg", result_slug="x")


def test_a_model_task_records_its_capability_and_limits(briefing):
    kb, _, _ = briefing
    task = t.load(kb, "atencion-diaria")
    assert task.kind == "daily_attention" and task.result_slug == "atencion-diaria-spy"
    assert "40 turnos" in task.allowed[0]
    assert t.events(kb, task.id)[0]["capability"] == "daily_attention"


def test_a_code_task_file_stays_readable_by_the_previous_code(env):
    kb, sch, _ = env
    make(kb, sch)
    assert "result_slug" not in json.loads((kb.base / "tasks" / "seguimiento-spy" / "task.json").read_text("utf-8"))


# ── the model's tools and prompt ────────────────────────────────


def test_the_model_gets_only_the_read_commands_of_the_flow():
    entry = load_catalog().get("daily_attention")
    rules = mr.allowed_tools(entry, cli_commands(build_parser()))
    assert f"Bash({mr.CLI} profile show:*)" in rules and f"Bash({mr.CLI} followup run:*)" in rules
    assert "Bash(python -B tools/fred_query.py:*)" in rules and "Read" in rules
    joined = " ".join(rules)
    for forbidden in ("research save", "research revise", "evidence add", "strategy", "profile set", "task "):
        assert forbidden not in joined, forbidden


def test_the_client_is_isolated():
    cmd = mr.ClaudeCodeClient(binary="claude").command(allowed=["Read"], max_turns=7, schema={}, add_dir=Path("x"))
    for flag in ("--restricted", "--strict-mcp-config", "--no-session-persistence"):
        assert flag in cmd
    assert cmd[cmd.index("--tools") + 1] == "Bash,Read" and cmd[cmd.index("--max-turns") + 1] == "7"
    assert cmd[-2:] == ["--allowedTools", "Read"]   # last: the variadic list cannot swallow another flag


def test_the_real_command_fits_the_windows_limit():
    # claude is a .CMD on Windows: cmd.exe takes 8191 characters. The prompt goes on stdin, never as an argument.
    entry = load_catalog().get("daily_attention")
    allowed = mr.allowed_tools(entry, cli_commands(build_parser()))
    long_dir = Path("C:/Users/someone/AppData/Local/GaleCore-AI/runs/atencion-diaria-spy/20261001T130000Z")
    cmd = mr.ClaudeCodeClient(binary="C:/Users/someone/AppData/Roaming/npm/claude.CMD").command(
        allowed=allowed, max_turns=40, schema=mr.output_schema(), add_dir=long_dir)
    assert len(subprocess.list2cmdline(cmd)) < 2000
    assert cmd[cmd.index("-p") + 1].startswith("--")


# ── a run ───────────────────────────────────────────────────────


def test_an_ok_run_saves_evidence_then_the_research(briefing):
    kb, _, follow = briefing
    ev = [{"slug": "fomc", "content": evidence().model_dump(mode="json")}]
    model = model_ok(output(ev=ev, missing=["Griegas: ninguna fuente"],
                            antecedents=[{"ref": "evidence:@fomc", "summary": "calendario FOMC",
                                          "bearing": "fija las fechas"}]))
    result = run(kb, follow, model, invoked_by="scheduler")
    assert result["status"] == "OK" and result["research"] == "research:2026-09-23-atencion-diaria-spy"
    assert result["turns"] == 12 and result["max_turns"] == 40 and result["duration_s"] >= 0
    doc = kb.research.load("2026-09-23-atencion-diaria-spy")
    rev = doc.current
    assert rev.host.provider == "windows-task-scheduler+claude-code" and rev.host.model == "claude-test"
    cited = rev.content.antecedents[0].ref
    assert cited.startswith("evidence:2026-09-23-atencion-diaria-") and cited.endswith("-fomc")
    assert model.calls[0]["max_turns"] == 40 and model.calls[0]["timeout_s"] == 20 * 60
    latest = (kb.base / "tasks" / "atencion-diaria" / "LATEST.md").read_text("utf-8")
    assert "**OK**" in latest and "Vigencia" in latest
    status = t.status(kb=kb, scheduler=FakeScheduler(), task_id="atencion-diaria", now=LATER)
    assert status["last_run"]["turns"] == 12 and status["last_run"]["result"] == "OK"


def test_the_next_run_revises_the_same_investigation(briefing):
    kb, _, follow = briefing
    run(kb, follow, model_ok(output()))
    result = t.run(kb=kb, task_id="atencion-diaria", followup=follow, commit=False, now=LATER + timedelta(days=1),
                   client=model_ok(output()))
    assert result["research"] == "research:2026-09-23-atencion-diaria-spy" and result["revision"] == 2


def test_an_incomplete_run_says_what_was_missing(briefing):
    kb, _, follow = briefing
    result = run(kb, follow, model_ok(output(status="INCOMPLETE", reason="GaleCore Dev no respondió")))
    assert result["status"] == "INCOMPLETE" and result["reason"] == "GaleCore Dev no respondió"
    assert "No se pudo completar" in (kb.base / "tasks" / "atencion-diaria" / "LATEST.md").read_text("utf-8")


@pytest.mark.parametrize("reply, why", [
    (mr.ModelReply(ok=False, turns=40, error="turn cap reached (40)"), "turn cap"),
    (mr.ModelReply(ok=False, error="claude not found on PATH"), "claude not found"),
    (mr.ModelReply(ok=True, structured={"status": "OK"}), "does not match the contract"),
    (mr.ModelReply(ok=True, structured=output(status="INCOMPLETE")), "must say what was missing"),
    (mr.ModelReply(ok=True, structured=output(antecedents=[{"ref": "evidence:@nada", "summary": "s",
                                                            "bearing": "b"}])), "did not return"),
])
def test_without_a_valid_briefing_the_days_data_is_kept_and_nothing_is_invented(briefing, reply, why):
    kb, _, follow = briefing
    result = run(kb, follow, FakeModel(reply))
    assert result["status"] == "INCOMPLETE" and why in result["reason"] and result["followup"]
    assert not [i for i in kb.research.ids() if i.endswith("atencion-diaria-spy")]
    assert "No se pudo completar" in (kb.base / "tasks" / "atencion-diaria" / "LATEST.md").read_text("utf-8")


def test_no_model_and_no_data_is_failed(briefing):
    kb, _, _ = briefing

    def broken(**_):
        raise ConnectionError("GaleCore Dev apagado")
    result = run(kb, broken, FakeModel(mr.ModelReply(ok=False, error="claude not found on PATH")))
    assert result["status"] == "FAILED" and "GaleCore Dev apagado" in result["error"]
    fresh = t.status(kb=kb, scheduler=FakeScheduler(), task_id="atencion-diaria", now=LATER)
    assert fresh["last_run"]["event"] == "run_failed"
    assert "No hay resultado" in (kb.base / "tasks" / "atencion-diaria" / "LATEST.md").read_text("utf-8")


def test_a_capability_no_longer_schedulable_does_not_run(briefing, monkeypatch):
    kb, _, follow = briefing
    real = t.load_catalog

    def unscheduled():
        cat = real()
        for e in cat.entries:
            if e.id == "daily_attention":
                e.schedulable = None
        return cat
    monkeypatch.setattr(t, "load_catalog", unscheduled)
    model = model_ok(output())
    result = run(kb, follow, model)
    assert result["status"] == "FAILED" and "not schedulable" in result["error"] and model.calls == []


def test_a_paused_model_task_does_not_call_the_model(briefing):
    kb, sch, follow = briefing
    t.pause(kb=kb, scheduler=sch, task_id="atencion-diaria", prompt="Pausala")
    model = model_ok(output())
    assert run(kb, follow, model)["status"] == "SKIPPED" and model.calls == []
    t.resume(kb=kb, scheduler=sch, task_id="atencion-diaria", prompt="Reanudala")
    assert run(kb, follow, model)["status"] == "OK"


def test_evidence_fetched_after_the_run_started_is_saved(briefing, monkeypatch):
    # Real run 30/09: the model fetched FRED minutes after the start; saving with the start time refused it.
    kb, _, follow = briefing
    ticks = __import__("itertools").count(0.0, 300.0)       # every reading of the clock is 5 minutes later
    monkeypatch.setattr(t.time, "monotonic", lambda: next(ticks))
    ev = [{"slug": "fred", "content": evidence(retrieved_at=LATER + timedelta(minutes=4)).model_dump(mode="json")}]
    model = model_ok(output(ev=ev, antecedents=[{"ref": "evidence:@fred", "summary": "s", "bearing": "b"}]))
    result = run(kb, follow, model)
    assert result["status"] == "OK", result.get("reason")


def test_evidence_cited_without_the_marker_resolves_too(briefing):
    # Real run 30/09: the model cited `evidence:<slug>` as in a session.
    kb, _, follow = briefing
    ev = [{"slug": "fed-fomc", "content": evidence().model_dump(mode="json")}]
    model = model_ok(output(ev=ev, antecedents=[{"ref": "evidence:fed-fomc", "summary": "s", "bearing": "b"}]))
    result = run(kb, follow, model)
    assert result["status"] == "OK", result.get("reason")
    cited = kb.research.load(result["research"].removeprefix("research:")).current.content.antecedents[0].ref
    assert cited.endswith("-fed-fomc") and cited.startswith("evidence:2026-09-23-atencion-diaria-")


def test_a_refused_output_leaves_no_orphan_evidence(briefing):
    # Real run 30/09: the model cited the investigation being revised; the evidence had been saved already.
    kb, _, follow = briefing
    run(kb, follow, model_ok(output()))
    target = "research:2026-09-23-atencion-diaria-spy"
    ev = [{"slug": "fred", "content": evidence().model_dump(mode="json")}]
    model = model_ok(output(ev=ev, antecedents=[{"ref": target, "summary": "s", "bearing": "b"},
                                                {"ref": "evidence:@fred", "summary": "s", "bearing": "b"}]))
    mine = lambda: [i for i in kb.evidence.ids() if "atencion-diaria-" in i]
    result = t.run(kb=kb, task_id="atencion-diaria", followup=follow, commit=False, now=LATER + timedelta(days=1),
                   client=model)
    assert result["status"] == "INCOMPLETE" and "being revised" in result["reason"]
    assert mine() == []   # the fallback keeps its runtime report; the model's evidence is never saved
    assert "Do not cite research:2026-09-23-atencion-diaria-spy" in model.calls[0]["prompt"]


class Sequence(FakeModel):
    """Replies in order (the run, then the correction round)."""

    def __init__(self, *replies):
        super().__init__(None)
        self.replies = list(replies)

    def run(self, **kw):
        self.calls.append(kw)
        return self.replies.pop(0)


FACT_WITHOUT_SOURCE = {"kind": "fact", "text": "El VIX subió"}


def test_one_correction_round_without_tools_fixes_what_the_validators_refused(briefing):
    # Real run 30/09: one fact without a source cost the whole briefing.
    kb, _, follow = briefing
    ev = [{"slug": "fred", "content": evidence().model_dump(mode="json")}]
    bad = output(ev=ev, statements=[FACT_WITHOUT_SOURCE],
                 antecedents=[{"ref": "evidence:@fred", "summary": "s", "bearing": "b"}])
    good = output(ev=ev, statements=[{"kind": "interpretation", "text": "El VIX subió"}],
                  antecedents=[{"ref": "evidence:@fred", "summary": "s", "bearing": "b"}])
    model = Sequence(mr.ModelReply(ok=True, structured=bad, turns=30, model="m"),
                     mr.ModelReply(ok=True, structured=good, turns=1, model="m"))
    result = run(kb, follow, model)
    assert result["status"] == "OK" and result["turns"] == 31
    assert "a fact must cite at least one source" in result["repaired"][0]
    repair = model.calls[1]
    assert repair["allowed"] == [] and repair["max_turns"] == mr.REPAIR_TURNS
    assert "a fact must cite" in repair["prompt"]


def test_a_failed_correction_keeps_nothing_of_the_model(briefing):
    kb, _, follow = briefing
    ev = [{"slug": "fred", "content": evidence().model_dump(mode="json")}]
    bad = output(ev=ev, statements=[FACT_WITHOUT_SOURCE],
                 antecedents=[{"ref": "evidence:@fred", "summary": "s", "bearing": "b"}])
    model = Sequence(mr.ModelReply(ok=True, structured=bad, turns=10), mr.ModelReply(ok=True, structured=bad, turns=1))
    result = run(kb, follow, model)
    assert result["status"] == "INCOMPLETE" and "a fact must cite" in result["reason"]
    assert not [i for i in kb.evidence.ids() if "atencion-diaria-" in i]   # checked before saving: no orphans


def test_no_correction_round_beyond_the_turn_cap(briefing):
    kb, _, follow = briefing
    model = Sequence(mr.ModelReply(ok=True, structured=output(statements=[FACT_WITHOUT_SOURCE]), turns=39))
    result = run(kb, follow, model)
    assert result["status"] == "INCOMPLETE" and len(model.calls) == 1


def test_the_repair_call_has_no_tools():
    cmd = mr.ClaudeCodeClient(binary="claude").command(allowed=[], max_turns=4, schema={}, add_dir=Path("x"))
    assert cmd[cmd.index("--tools") + 1] == "" and "--allowedTools" not in cmd and "--add-dir" not in cmd


def test_what_the_models_followup_left_is_committed_with_the_run(briefing, monkeypatch):
    kb, _, follow = briefing
    committed = []
    monkeypatch.setattr(t, "_commit_knowledge", lambda kb_, paths, msg: committed.extend(paths) or "committed")

    class RunsFollowup(FakeModel):
        def run(self, **kw):
            follow(kb=kb, strategy=NAME, prompt="p", host=t.MANUAL_HOST, task_id="atencion-diaria", now=LATER)
            return super().run(**kw)
    t.run(kb=kb, task_id="atencion-diaria", followup=follow, now=LATER, client=RunsFollowup(model_ok(output()).reply))
    assert any(p.parent.name == "evidence" and "shadow" in p.name for p in committed)
