"""Tasks that run on the VPS (WS-0079, phase 1): one side runs, move, the runner's tick and the reasons for «no corrió»."""

# ruff: noqa: F811
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from galecore_ai.application import task_service as svc
from galecore_ai.application import tasks as t
from galecore_ai.application.space import agent_state
from tests.unit.test_knowledge import kb  # noqa: F401  (kb is a fixture)
from tests.unit.test_strategy import research_ref  # noqa: F401  (research_ref is a fixture)
from tests.unit.test_tasks import DAILY, _ny, env, make  # noqa: F401  (env is a fixture)

T0 = _ny(2026, 9, 28, 12, 0)


def _to_vps(kb, sch, **kw):
    make(kb, sch, now=T0, **kw)
    return t.move(kb=kb, scheduler=sch, task_id="seguimiento-spy", to="vps", prompt="Pasala al VPS", now=T0)


def test_runs_on_defaults_to_pc_and_is_published(env):
    kb, sch, _ = env
    task = make(kb, sch, now=T0)
    assert task.runs_on == "pc"
    assert "runs_on" not in (kb.base / "tasks" / task.id / "task.json").read_text(encoding="utf-8")  # old checkouts read it
    assert t.list_tasks(kb)[0]["runs_on"] == "pc"
    assert t.status(kb=kb, scheduler=sch, task_id=task.id, now=T0)["runs_on"] == "pc"
    assert agent_state(kb, task.id, now=T0)["runs_on"] == "pc"


def test_only_one_side_runs_a_task(env):
    kb, sch, follow = env
    _to_vps(kb, sch)
    due = _ny(2026, 9, 28, 17, 10)
    skipped = t.run(kb=kb, task_id="seguimiento-spy", scheduler=sch, followup=follow, commit=False, now=due,
                    invoked_by="scheduler")
    assert skipped["status"] == "SKIPPED" and skipped["reason"] == "corre en el VPS"
    ran = t.run(kb=kb, task_id="seguimiento-spy", followup=follow, commit=False, now=due, invoked_by="vps",
                slot=due.isoformat())
    assert ran["status"] == "DEGRADED"
    started = [e for e in t.events(kb, "seguimiento-spy") if e["event"] == "run_started"]
    assert [(e["invoked_by"], e["slot"]) for e in started] == [("vps", due.isoformat())]
    assert t.runs(kb, t.load(kb, "seguimiento-spy"))[0].host.provider == "vps-runner"
    manual = t.run(kb=kb, task_id="seguimiento-spy", followup=follow, commit=False, now=due + timedelta(minutes=5))
    assert manual["status"] == "DEGRADED"                      # a manual run is valid on any side

    t.move(kb=kb, scheduler=sch, task_id="seguimiento-spy", to="pc", prompt="Volvela", now=due + timedelta(minutes=6))
    back = t.run(kb=kb, task_id="seguimiento-spy", followup=follow, commit=False, now=due + timedelta(minutes=7),
                 invoked_by="vps", slot="x")
    assert back["status"] == "SKIPPED" and back["reason"] == "corre en la PC" and back["slot"] == "x"


def test_move_to_vps_and_back_with_a_fake_scheduler(env):
    kb, sch, _ = env
    task = make(kb, sch, now=T0)
    moved = t.move(kb=kb, scheduler=sch, task_id=task.id, to="vps", prompt="Pasala", now=T0)
    assert moved.runs_on == "vps" and moved.local_time is None and task.scheduler_name not in sch.tasks
    assert t.status(kb=kb, scheduler=sch, task_id=task.id, now=T0)["scheduler"] == {"registered": True, "runner": "vps"}
    with pytest.raises(t.TaskError, match="already runs on el VPS"):
        t.move(kb=kb, scheduler=sch, task_id=task.id, to="vps", prompt="Otra vez", now=T0)
    # on the VPS the Windows scheduler is never touched, whatever is changed
    sch.calls.clear()
    t.set_frequency(kb=kb, scheduler=sch, task_id=task.id, schedule=DAILY.model_copy(update={"time": "09:00"}),
                    prompt="A las 9", now=T0)
    t.pause(kb=kb, scheduler=sch, task_id=task.id, prompt="Pausa", now=T0)
    t.resume(kb=kb, scheduler=sch, task_id=task.id, prompt="Sigue", now=T0)
    assert sch.calls == [] and t.load(kb, task.id).local_time is None

    t.pause(kb=kb, scheduler=sch, task_id=task.id, prompt="Pausa", now=T0)
    back = t.move(kb=kb, scheduler=sch, task_id=task.id, to="pc", prompt="Volvela", now=T0)
    assert back.runs_on == "pc" and back.local_time == t.local_time_for(back.schedule, T0)
    assert sch.tasks[task.scheduler_name]["enabled"] is False        # paused stays disabled
    assert [e["event"] for e in t.events(kb, task.id)][-1] == "moved"
    t.cancel(kb=kb, scheduler=sch, task_id=task.id, prompt="Fuera", now=T0)
    with pytest.raises(t.TaskError, match="cancelled"):
        t.move(kb=kb, scheduler=sch, task_id=task.id, to="vps", prompt="No", now=T0)


def test_move_to_vps_without_a_windows_entry_does_not_fail(env):
    kb, sch, _ = env
    task = make(kb, sch, now=T0)
    sch.tasks.clear()                                                  # schtasks has no entry (never registered or removed)
    assert t.move(kb=kb, scheduler=sch, task_id=task.id, to="vps", prompt="Pasala", now=T0).runs_on == "vps"
    assert ("delete", task.scheduler_name) not in sch.calls


def test_moved_is_an_anchor_for_freshness(env):
    kb, sch, follow = env
    _to_vps(kb, sch)

    def fresh(at):
        return t.freshness(t.load(kb, "seguimiento-spy"), t.events(kb, "seguimiento-spy"), at)
    assert fresh(_ny(2026, 9, 28, 17, 20))["state"] == "DUE_NOW"
    assert fresh(_ny(2026, 9, 28, 18, 0))["state"] == "MISSED"
    assert "el VPS no la corrió a la hora" in fresh(_ny(2026, 9, 28, 18, 0))["detail"]
    t.run(kb=kb, task_id="seguimiento-spy", followup=follow, commit=False, now=_ny(2026, 9, 28, 17, 6), invoked_by="vps")
    assert fresh(_ny(2026, 9, 28, 17, 30))["state"] == "CURRENT"
    # moving back resets the expectation: a due time before the move is not owed
    t.move(kb=kb, scheduler=sch, task_id="seguimiento-spy", to="pc", prompt="Volvela", now=_ny(2026, 9, 28, 19, 0))
    assert fresh(_ny(2026, 9, 28, 19, 5))["state"] == "NOT_DUE_YET"


def test_tick_runs_each_slot_once_and_one_task_at_a_time(env, tmp_path):
    kb, sch, follow = env
    _to_vps(kb, sch)
    calls = []

    def runner(**kw):
        calls.append(kw["slot"])
        return t.run(**kw, followup=follow, commit=False)
    places = tmp_path / "places"
    assert svc.tick(kb, _ny(2026, 9, 28, 16, 59), directory=places, places=1, runner=runner) == []   # nothing due yet
    done = svc.tick(kb, _ny(2026, 9, 28, 17, 6), directory=places, places=1, runner=runner)
    assert [(d["task"], d["status"]) for d in done] == [("seguimiento-spy", "DEGRADED")]
    assert svc.tick(kb, _ny(2026, 9, 28, 17, 7), directory=places, places=1, runner=runner) == []     # slot already served
    assert calls == [_ny(2026, 9, 28, 17, 5).isoformat()] and not list(places.iterdir())              # place released
    assert len(svc.tick(kb, _ny(2026, 9, 29, 17, 6), directory=places, places=1, runner=runner)) == 1  # next day's slot
    t.pause(kb=kb, scheduler=sch, task_id="seguimiento-spy", prompt="Pausa", now=_ny(2026, 9, 29, 18, 0))
    assert svc.tick(kb, _ny(2026, 9, 30, 17, 6), directory=places, places=1, runner=runner) == []     # paused: not owed


def test_tick_leaves_a_task_of_the_pc_alone(env, tmp_path):
    kb, sch, _ = env
    make(kb, sch, now=T0)
    assert svc.tick(kb, _ny(2026, 9, 28, 17, 6), directory=tmp_path, places=1) == []
    assert [e["event"] for e in t.events(kb, "seguimiento-spy")] == ["created"]


def test_tick_every_minutes_does_not_replay_an_outage(env, tmp_path):
    kb, sch, follow = env
    make(kb, sch, now=T0, schedule=t.Schedule(frequency="every_minutes", minutes=15, timezone="UTC"))
    t.move(kb=kb, scheduler=sch, task_id="seguimiento-spy", to="vps", prompt="Pasala", now=T0)
    runner = lambda **kw: t.run(**kw, followup=follow, commit=False)
    assert svc.tick(kb, T0 + timedelta(minutes=10), directory=tmp_path, places=1, runner=runner) == []
    assert len(svc.tick(kb, T0 + timedelta(hours=3, minutes=2), directory=tmp_path, places=1, runner=runner)) == 1
    assert svc.tick(kb, T0 + timedelta(hours=3, minutes=5), directory=tmp_path, places=1, runner=runner) == []
    assert len(svc.tick(kb, T0 + timedelta(hours=3, minutes=16), directory=tmp_path, places=1, runner=runner)) == 1


def test_full_places_wait_and_after_30_minutes_the_slot_is_vps_busy(env, tmp_path):
    kb, sch, _ = env
    _to_vps(kb, sch)
    places = tmp_path / "places"
    taken = svc.acquire_place(places, 1, _ny(2026, 9, 28, 17, 0))       # another user's run holds the only place
    assert taken is not None and svc.acquire_place(places, 1, _ny(2026, 9, 28, 17, 0)) is None
    runner = lambda **kw: pytest.fail("it must not run without a place")
    assert svc.tick(kb, _ny(2026, 9, 28, 17, 6), directory=places, places=1, runner=runner) == []
    assert svc.tick(kb, _ny(2026, 9, 28, 17, 30), directory=places, places=1, runner=runner) == []     # still within 30 min
    late = svc.tick(kb, _ny(2026, 9, 28, 17, 40), directory=places, places=1, runner=runner)
    assert [(d["status"], d["reason_code"]) for d in late] == [("SKIPPED", "vps_busy")]
    fr = t.freshness(t.load(kb, "seguimiento-spy"), t.events(kb, "seguimiento-spy"), _ny(2026, 9, 28, 17, 41))
    assert fr["state"] == "MISSED" and fr["detail"] == "no corrió: VPS ocupado"
    assert svc.tick(kb, _ny(2026, 9, 28, 17, 45), directory=places, places=1, runner=runner) == []     # served: not again


def test_a_down_runner_is_missed_without_inventing_a_reason(env, tmp_path):
    kb, sch, _ = env
    _to_vps(kb, sch)
    assert svc.tick(kb, _ny(2026, 9, 28, 19, 0), directory=tmp_path, places=1) == []   # first sight, 2 h late: no place was waited for
    assert [e["event"] for e in t.events(kb, "seguimiento-spy")] == ["created", "moved"]
    fr = t.freshness(t.load(kb, "seguimiento-spy"), t.events(kb, "seguimiento-spy"), _ny(2026, 9, 28, 19, 0))
    assert fr["state"] == "MISSED" and "reason_code" not in fr and "VPS ocupado" not in fr["detail"]


def test_a_stale_place_is_broken(tmp_path):
    now = datetime.now(UTC)
    first = svc.acquire_place(tmp_path, 1, now)
    assert svc.acquire_place(tmp_path, 1, now + timedelta(minutes=29)) is None
    assert svc.acquire_place(tmp_path, 1, now + timedelta(minutes=t.LOCK_STALE_MINUTES + 1)) == first


def test_places_come_from_the_environment(monkeypatch, tmp_path):
    monkeypatch.setenv(svc.SLOTS_DIR_ENV, str(tmp_path))
    assert svc.slots_dir() == tmp_path and svc.max_parallel() == 1
    monkeypatch.setenv(svc.MAX_PARALLEL_ENV, "2")
    assert svc.max_parallel() == 2
    monkeypatch.setenv(svc.MAX_PARALLEL_ENV, "x")
    assert svc.max_parallel() == 1


@pytest.mark.parametrize("error, code", [
    ("Invalid API key · Please run /login", "auth"),
    ("API Error: 401 OAuth token has expired", "auth"),
    ("authentication_error: invalid x-api-key", "auth"),
    ("Claude AI usage limit reached|1760000000", "plan_limit"),
    ("You've hit your limit · resets 3pm", "plan_limit"),
    ("429 rate_limit_error", "plan_limit"),
    ("turn cap reached (12)", None),
    (None, None),
])
def test_failure_code_from_the_engines_text(error, code):
    assert t.failure_code(error) == code


def test_the_reason_shows_in_freshness_status_and_the_published_state(env):
    kb, sch, _ = env
    make(kb, sch, now=_ny(2026, 9, 28, 12, 0))
    t._event(kb, "seguimiento-spy", "run_started", _ny(2026, 9, 28, 17, 5), invoked_by="scheduler")
    t._event(kb, "seguimiento-spy", "run_failed", _ny(2026, 9, 28, 17, 6), invoked_by="scheduler", result="FAILED",
             reason_code="auth", error="model: Invalid API key")
    at = _ny(2026, 9, 28, 17, 30)
    fr = t.status(kb=kb, scheduler=sch, task_id="seguimiento-spy", now=at)
    assert fr["freshness"]["state"] == "FAILED" and fr["freshness"]["detail"] == t.REASON_TEXT["auth"]
    assert fr["last_run"]["reason_code"] == "auth" and fr["last_run"]["reason_text"] == t.REASON_TEXT["auth"]
    pub = agent_state(kb, "seguimiento-spy", now=at)
    assert pub["state_detail"] == t.REASON_TEXT["auth"] and pub["last_run"]["reason_text"] == t.REASON_TEXT["auth"]
    assert pub["history"][0]["reason_code"] == "auth"
