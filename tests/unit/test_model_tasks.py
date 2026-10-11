"""GC-AI-0017: a task runs any schedulable capability; the model reads, the runner validates and saves."""
# ruff: noqa: F811  (pytest fixtures imported from other test modules)

from __future__ import annotations

import json
import subprocess
import sys
import time
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
    assert f"Bash({mr.CLI} profile show:*)" in rules and f"Bash({mr.CLI} followup history:*)" in rules
    assert f"Bash({mr.CLI} galecore get:*)" in rules and "Read" in rules
    assert not [r for r in rules if "python -B tools/" in r]   # no script since WS-0014
    joined = " ".join(rules)
    for forbidden in ("followup run", "research save", "research revise", "evidence add", "strategy", "profile set",
                      "task "):
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


def test_a_saved_run_says_its_numbers_were_not_verified(briefing):
    # Codex 03/10: the model's evidence is its own; the stored result says so.
    kb, _, follow = briefing
    run(kb, follow, model_ok(output()))
    assert mr.UNVERIFIED_NOTE in kb.research.load("2026-09-23-atencion-diaria-spy").current.content.limitations


def test_a_trading_recommendation_is_refused(briefing):
    # Codex 03/10: a probe with «comprar calls ahora» was accepted.
    kb, _, _ = briefing
    out = mr.parse_output(output(hypothesis="Conviene comprar calls de SPY ahora"))
    assert any("trading recommendation" in p for p in mr.check_refs(kb, out, None))


@pytest.mark.parametrize("text", [
    "Short put spreads on SPY have limited risk", "Stop-loss at 200% of credit is the rule tested in the backtest",
    "The exit rule closes the short put when delta exceeds 0.30", "Risk-reward ratio of the structure is 1:3",
    "Dealers add exposure to SPY as it falls", "La regla de salida cierra la posición al 50 % del crédito",
])
def test_describing_the_rules_is_not_a_recommendation(briefing, text):
    # Internal recheck 03/10: the regime patterns refused ordinary briefing sentences.
    kb, _, _ = briefing
    out = mr.parse_output(output(hypothesis=text))
    assert not any("trading recommendation" in p for p in mr.check_refs(kb, out, None))


def test_the_model_gets_only_the_environment_it_needs(tmp_path, monkeypatch):
    # Codex 03/10: the unattended process received every credential of the owner's environment.
    monkeypatch.setenv("SOME_OTHER_TOKEN", "x")
    monkeypatch.setenv("GALECORE_BASE_URL", "http://localhost:7001")
    seen = {}

    def fake_popen(cmd, **kw):
        seen.update(kw["env"])
        raise OSError("stop here")
    monkeypatch.setattr(mr.subprocess, "Popen", fake_popen)
    mr.ClaudeCodeClient(binary="x").run(prompt="p", allowed=[], max_turns=1, schema={}, cwd=tmp_path,
                                        timeout_s=2, add_dir=tmp_path)
    assert "SOME_OTHER_TOKEN" not in seen and seen["GALECORE_BASE_URL"] == "http://localhost:7001"


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


def test_the_runner_runs_the_followup_and_commits_it_with_the_run(briefing, monkeypatch):
    # Internal review 30/09: the model could run `followup run` for another task or strategy. Now the runner does it.
    kb, _, follow = briefing
    committed = []
    monkeypatch.setattr(t, "_commit_knowledge", lambda kb_, paths, msg: committed.extend(paths) or "committed")
    model = model_ok(output())
    result = t.run(kb=kb, task_id="atencion-diaria", followup=follow, now=LATER, client=model)
    assert result["followup"] and result["followup"] in model.calls[0]["prompt"]
    assert any(p.parent.name == "evidence" and "shadow" in p.name for p in committed)
    assert not any("followup run" in r for r in model.calls[0]["allowed"])


def test_an_unexpected_error_is_still_a_recorded_failure(briefing):
    # Internal review 30/09: an exception left run_started without an outcome and LATEST.md unchanged.
    kb, _, follow = briefing

    class Broken(FakeModel):
        def run(self, **kw):
            raise FileNotFoundError("C:/nope/claude.exe")
    result = run(kb, follow, Broken(None))
    assert result["status"] == "FAILED" and "FileNotFoundError" in result["error"]
    assert t.events(kb, "atencion-diaria")[-1]["event"] == "run_failed"
    assert "No hay resultado" in (kb.base / "tasks" / "atencion-diaria" / "LATEST.md").read_text("utf-8")


def test_evidence_from_the_future_is_refused_before_anything_is_saved(briefing):
    kb, _, follow = briefing
    ok = {"slug": "fred", "content": evidence().model_dump(mode="json")}
    future = {"slug": "fed", "content": evidence(retrieved_at=LATER + timedelta(days=2)).model_dump(mode="json")}
    model = model_ok(output(ev=[ok, future], antecedents=[{"ref": "evidence:@fred", "summary": "s", "bearing": "b"},
                                                          {"ref": "evidence:@fed", "summary": "s", "bearing": "b"}]))
    result = run(kb, follow, model)
    assert result["status"] == "INCOMPLETE" and "after the save time" in result["reason"]
    assert not [i for i in kb.evidence.ids() if "atencion-diaria-" in i]


def test_evidence_returned_but_not_cited_is_not_kept(briefing):
    kb, _, follow = briefing
    ev = [{"slug": "fred", "content": evidence().model_dump(mode="json")},
          {"slug": "sobra", "content": evidence().model_dump(mode="json")}]
    model = model_ok(output(ev=ev, antecedents=[{"ref": "evidence:@fred", "summary": "s", "bearing": "b"}]))
    assert run(kb, follow, model)["evidence_saved"] == 1
    assert not [i for i in kb.evidence.ids() if i.endswith("-sobra")]


def test_the_cmd_shim_is_replaced_by_the_real_executable(tmp_path):
    shim = tmp_path / "claude.CMD"
    shim.write_text("@echo off", encoding="utf-8")
    exe = tmp_path / "node_modules" / "@anthropic-ai" / "claude-code" / "bin" / "claude.exe"
    exe.parent.mkdir(parents=True)
    exe.write_bytes(b"")
    assert mr.ClaudeCodeClient(binary=str(shim)).binary == str(exe)
    assert mr.ClaudeCodeClient(binary="/usr/bin/claude").binary == "/usr/bin/claude"


def test_a_timed_out_model_is_stopped_with_its_children(tmp_path, monkeypatch):
    # Internal review 30/09: subprocess.run killed only cmd.exe and then waited for claude.exe.
    script = tmp_path / "slow.py"
    script.write_text("import subprocess, sys, time\n"
                      "subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
                      "time.sleep(60)\n", encoding="utf-8")
    client = mr.ClaudeCodeClient(binary="x")
    monkeypatch.setattr(client, "command", lambda **kw: [sys.executable, str(script)])
    t0 = time.monotonic()
    reply = client.run(prompt="p", allowed=[], max_turns=1, schema={}, cwd=tmp_path, timeout_s=2, add_dir=tmp_path)
    assert not reply.ok and "time cap" in reply.error and time.monotonic() - t0 < 30


def test_a_slow_followup_leaves_the_model_no_time_beyond_the_lock(briefing, monkeypatch):
    # Internal recheck 30/09: follow-up (up to 3 min per report) + model + correction could outlive the 30-min lock.
    kb, _, follow = briefing
    committed = []
    monkeypatch.setattr(t, "_commit_knowledge", lambda kb_, paths, msg: committed.extend(paths) or "committed")
    ticks = __import__("itertools").count(0.0, 1500.0)         # every reading of the clock: 25 minutes later
    monkeypatch.setattr(t.time, "monotonic", lambda: next(ticks))
    model = model_ok(output())
    result = t.run(kb=kb, task_id="atencion-diaria", followup=follow, now=LATER, client=model)
    assert result["status"] == "FAILED" and "no time left" in result["error"] and model.calls == []
    assert any(p.parent.name == "evidence" and "shadow" in p.name for p in committed)   # the day's data is kept


def test_the_model_cap_never_exceeds_the_lock(briefing):
    kb, _, follow = briefing
    model = model_ok(output())
    run(kb, follow, model)
    assert model.calls[0]["timeout_s"] + t.REPAIR_SECONDS + t.LOCK_MARGIN_SECONDS <= t.LOCK_STALE_MINUTES * 60


# ── consumption (GC-AI-0024) ────────────────────────────────────


def test_the_client_keeps_the_tokens_the_run_reports(tmp_path, monkeypatch):
    out = {"num_turns": 3, "modelUsage": {"claude-sonnet": {}}, "structured_output": {"status": "OK"},
           "usage": {"input_tokens": 120, "output_tokens": 900, "cache_read_input_tokens": 40000,
                     "cache_creation_input_tokens": 5000, "server_tool_use": {}}}
    script = tmp_path / "fake.py"
    script.write_text(f"import sys; sys.stdin.read(); print({json.dumps(json.dumps(out))})", encoding="utf-8")
    client = mr.ClaudeCodeClient(binary="x")
    monkeypatch.setattr(client, "command", lambda **kw: [sys.executable, str(script)])
    reply = client.run(prompt="p", allowed=[], max_turns=5, schema={}, cwd=tmp_path, timeout_s=30, add_dir=tmp_path)
    assert reply.ok and reply.tokens == {"input": 120, "output": 900, "cache_read": 40000, "cache_write": 5000}


def test_a_run_without_usage_has_no_tokens():
    assert mr.usage_of({"num_turns": 1}) is None and mr.usage_of({"usage": {"foo": 1}}) is None


def test_the_run_records_its_tokens_including_the_correction_round(briefing):
    kb, _, follow = briefing
    ev = [{"slug": "fred", "content": evidence().model_dump(mode="json")}]
    bad = output(ev=ev, statements=[FACT_WITHOUT_SOURCE],
                 antecedents=[{"ref": "evidence:@fred", "summary": "s", "bearing": "b"}])
    good = output(ev=ev, statements=[{"kind": "interpretation", "text": "El VIX subió"}],
                  antecedents=[{"ref": "evidence:@fred", "summary": "s", "bearing": "b"}])
    model = Sequence(mr.ModelReply(ok=True, structured=bad, turns=30, model="m", tokens={"input": 10, "output": 100}),
                     mr.ModelReply(ok=True, structured=good, turns=1, model="m", tokens={"input": 2, "output": 20}))
    result = run(kb, follow, model)
    assert result["tokens"] == {"input": 12, "output": 120}
    status = t.status(kb=kb, scheduler=FakeScheduler(), task_id="atencion-diaria", now=LATER)
    assert status["last_run"]["tokens"] == {"input": 12, "output": 120}


# ── the daily briefing only with news (WS-0025) ─────────────────


def test_a_scheduled_briefing_without_news_does_not_call_the_model(briefing, monkeypatch):
    kb, _, follow = briefing
    monkeypatch.setattr(t, "followup_news", lambda rec: False)
    model = model_ok(output())
    result = t.run(kb=kb, task_id="atencion-diaria", followup=follow, now=LATER, client=model, invoked_by="scheduler",
                   commit=False)
    assert model.calls == [] and result["model"] is None and result["result"] == "OK"
    assert result["followup"] and "sin novedades" in result["reason"]
    assert "Sin modelo: sin novedades" in (kb.base / "tasks" / "atencion-diaria" / "LATEST.md").read_text(encoding="utf-8")


def test_a_manual_briefing_always_calls_the_model(briefing, monkeypatch):
    kb, _, follow = briefing
    monkeypatch.setattr(t, "followup_news", lambda rec: False)
    model = model_ok(output())
    run(kb, follow, model)
    assert len(model.calls) == 1


def test_news_is_an_open_position_a_notice_or_a_new_event():
    from types import SimpleNamespace

    from galecore_ai.application.followup import has_news
    rec = lambda attention=(), shadow=(): SimpleNamespace(attention=list(attention), shadow=list(shadow))
    assert not has_news(rec(shadow=["Posición CLOSED: crédito 0.46, salida TAKE_PROFIT"]))
    assert has_news(rec(shadow=["Posición OPEN: crédito 0.44"]))
    assert has_news(rec(attention=["GaleCore respondió sin estado del runtime"]))
    assert has_news(rec(shadow=["2026-10-10T18:39 POSITION_OPENED: {}"]))
    assert not has_news(rec(shadow=["2026-10-10T18:39 GATES_NOT_PASSED: iv", "2026-10-10T18:40 ENTRY_SKIPPED: x"]))
