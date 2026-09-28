"""Recurring follow-up tasks (GC-AI-0009) with a fake scheduler; the real one is exercised in the evidence."""

from __future__ import annotations

import functools
import os
import time
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from galecore_ai.application import tasks as t
from galecore_ai.application.followup import run_followup
from galecore_ai.application.knowledge import KnowledgeError
from galecore_ai.contracts.task import Schedule
from tests.unit.test_followup import report, stub
from tests.unit.test_knowledge import HOST, NOW, kb, save  # noqa: F401  (kb is a fixture)
from tests.unit.test_strategy import (  # noqa: F401  (research_ref is a fixture)
    NAME,
    research_ref,
    stored,
)

DAILY = Schedule(frequency="daily", time="17:05", timezone="America/New_York")


class FakeScheduler:
    def __init__(self):
        self.tasks: dict[str, dict] = {}
        self.calls: list[tuple] = []

    def create(self, name, command, schedule, local_time):
        self.calls.append(("create", name, schedule.frequency, local_time))
        self.tasks[name] = {"command": command, "schedule": schedule, "local": local_time, "enabled": True}

    def delete(self, name):
        self.calls.append(("delete", name))
        self.tasks.pop(name)

    def set_enabled(self, name, enabled):
        self.calls.append(("enabled", name, enabled))
        self.tasks[name]["enabled"] = enabled

    def query(self, name):
        return {"registered": name in self.tasks, **({"enabled": self.tasks[name]["enabled"]} if name in self.tasks else {})}


@pytest.fixture
def env(kb, research_ref, tmp_path):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    sch = FakeScheduler()
    follow = functools.partial(run_followup, report_command=stub(tmp_path, report(doc.spec_hash, mine=False)))
    return kb, sch, follow


def make(kb, sch, **kw):  # noqa: F811
    args = {"task_id": "seguimiento-spy", "strategy": NAME, "objective": "¿Qué hizo mi estrategia?",
            "expected_result": "registro de seguimiento", "sources": ["GaleCore Dev API"], "schedule": DAILY,
            "prompt": "Hacé este seguimiento diariamente y guardalo", "now": NOW}
    args.update(kw)
    return t.create(kb=kb, scheduler=sch, **args)


def test_create_schedules_and_records(env):
    kb, sch, _ = env  # noqa: F811
    task = make(kb, sch)
    assert task.scheduler_name == "GaleCore-AI\\seguimiento-spy" and task.status == "active"
    cmd = sch.tasks[task.scheduler_name]["command"]
    assert cmd[-2].endswith("task_runner.py") and cmd[-1] == "seguimiento-spy"
    assert task.local_time == t.local_time_for(DAILY, NOW)
    assert [e["event"] for e in t.events(kb, task.id)] == ["created"]
    with pytest.raises(t.TaskError, match="already exists"):
        make(kb, sch)
    with pytest.raises(t.TaskError, match="no strategy"):
        make(kb, sch, task_id="otra", strategy="no_existe")


def test_timezone_is_converted_to_this_pc(env):
    ny_1705 = datetime(2026, 9, 28, 17, 5, tzinfo=__import__("zoneinfo").ZoneInfo("America/New_York"))
    assert t.local_time_for(DAILY, NOW) == ny_1705.astimezone().strftime("%H:%M")


def test_run_records_a_followup_tied_to_the_task(env):
    kb, sch, follow = env  # noqa: F811
    make(kb, sch)
    result = t.run(kb=kb, task_id="seguimiento-spy", followup=follow, commit=False, now=NOW + timedelta(hours=1))
    assert result["status"] == "DEGRADED" and result["strategy_ref"].startswith(f"strategy:{NAME}/")
    task = t.load(kb, "seguimiento-spy")
    assert [r.task_id for r in t.runs(kb, task)] == ["seguimiento-spy"]
    st = t.status(kb=kb, scheduler=sch, task_id="seguimiento-spy")
    assert st["runs"] == 1 and st["last_result"]["task_id"] == "seguimiento-spy"
    assert not (kb.base / "tasks" / "seguimiento-spy" / "run.lock").exists()


def test_paused_or_cancelled_tasks_do_not_run(env):
    kb, sch, follow = env  # noqa: F811
    make(kb, sch)
    t.pause(kb=kb, scheduler=sch, task_id="seguimiento-spy", prompt="Pausalo", now=NOW)
    assert sch.tasks["GaleCore-AI\\seguimiento-spy"]["enabled"] is False
    assert t.run(kb=kb, task_id="seguimiento-spy", followup=follow, commit=False)["status"] == "SKIPPED"
    t.resume(kb=kb, scheduler=sch, task_id="seguimiento-spy", prompt="Reanudalo", now=NOW)
    t.cancel(kb=kb, scheduler=sch, task_id="seguimiento-spy", prompt="Cancelalo", now=NOW)
    assert "GaleCore-AI\\seguimiento-spy" not in sch.tasks
    assert t.run(kb=kb, task_id="seguimiento-spy", followup=follow, commit=False)["status"] == "SKIPPED"
    with pytest.raises(t.TaskError, match="cancelled"):
        t.pause(kb=kb, scheduler=sch, task_id="seguimiento-spy", prompt="x")
    kinds = [e["event"] for e in t.events(kb, "seguimiento-spy")]
    assert kinds == ["created", "paused", "run_skipped", "resumed", "cancelled", "run_skipped"]


def test_overlapping_runs_are_skipped_and_stale_locks_broken(env):
    kb, sch, follow = env  # noqa: F811
    make(kb, sch)
    lock = kb.base / "tasks" / "seguimiento-spy" / "run.lock"
    lock.write_text("123 running", encoding="utf-8")
    now = datetime.now(UTC)
    assert t.run(kb=kb, task_id="seguimiento-spy", followup=follow, commit=False, now=now)["status"] == "SKIPPED"
    old = time.time() - (t.LOCK_STALE_MINUTES + 5) * 60
    os.utime(lock, (old, old))
    result = t.run(kb=kb, task_id="seguimiento-spy", followup=follow, commit=False, now=now)
    assert result["status"] == "DEGRADED"
    started = [e for e in t.events(kb, "seguimiento-spy") if e["event"] == "run_started"][-1]
    assert "stale lock" in started["note"]


def test_a_failed_run_is_recorded_not_raised(env):
    kb, sch, _ = env  # noqa: F811
    make(kb, sch)

    def broken(**_):
        raise RuntimeError("GaleCore exploded")
    result = t.run(kb=kb, task_id="seguimiento-spy", followup=broken, commit=False)
    assert result["status"] == "FAILED" and "GaleCore exploded" in result["error"]
    assert t.status(kb=kb, scheduler=sch, task_id="seguimiento-spy")["recent_problems"][-1]["event"] == "run_failed"


def test_changing_frequency_recreates_the_schedule_and_keeps_pause(env):
    kb, sch, _ = env  # noqa: F811
    make(kb, sch)
    t.pause(kb=kb, scheduler=sch, task_id="seguimiento-spy", prompt="Pausalo", now=NOW)
    new = Schedule(frequency="weekdays", time="09:45", timezone="America/New_York")
    task = t.set_frequency(kb=kb, scheduler=sch, task_id="seguimiento-spy", schedule=new, prompt="Cambiá la frecuencia", now=NOW)
    assert task.schedule.frequency == "weekdays" and task.status == "paused"
    assert sch.tasks[task.scheduler_name]["enabled"] is False
    assert t.events(kb, "seguimiento-spy")[-1]["event"] == "frequency_changed"


def test_schedule_shapes_are_validated():
    with pytest.raises(ValidationError):
        Schedule(frequency="every_minutes", minutes=5, timezone="UTC")
    with pytest.raises(ValidationError):
        Schedule(frequency="daily", time="25:00", timezone="UTC")
    with pytest.raises(ValidationError, match="unknown timezone"):
        Schedule(frequency="daily", time="10:00", timezone="Mars/Olympus")


def test_an_edited_event_log_is_detected(env):
    kb, sch, _ = env  # noqa: F811
    make(kb, sch)
    t.pause(kb=kb, scheduler=sch, task_id="seguimiento-spy", prompt="Pausalo", now=NOW)
    path = kb.base / "tasks" / "seguimiento-spy" / "events.jsonl"
    lines = path.read_text(encoding="utf-8").splitlines()
    path.write_text(lines[0].replace("Hacé", "Hace") + "\n" + lines[1] + "\n", encoding="utf-8")
    with pytest.raises(KnowledgeError, match="hash chain"):
        t.events(kb, "seguimiento-spy")


def test_weekdays_crossing_midnight_is_refused():
    """Review R1 MAJOR: the weekday set would shift; refuse instead of firing on the wrong days."""
    here = datetime.now().astimezone().utcoffset()
    tz, hhmm = ("Pacific/Pago_Pago", "23:30") if here > timedelta(hours=-11) else ("Pacific/Kiritimati", "00:30")
    with pytest.raises(t.TaskError, match="another calendar day"):
        t.local_time_for(Schedule(frequency="weekdays", time=hhmm, timezone=tz), NOW)
    assert t.local_time_for(Schedule(frequency="daily", time=hhmm, timezone=tz), NOW)


def test_a_scheduler_failure_keeps_the_old_schedule_and_is_logged(env):
    kb, sch, _ = env  # noqa: F811
    make(kb, sch)

    def failing(*_):
        raise t.TaskError("schtasks create failed: Access is denied")
    sch.create = failing
    new = Schedule(frequency="every_minutes", minutes=30, timezone="UTC")
    with pytest.raises(t.TaskError, match="Access is denied"):
        t.set_frequency(kb=kb, scheduler=sch, task_id="seguimiento-spy", schedule=new, prompt="Cambiá", now=NOW)
    assert t.load(kb, "seguimiento-spy").schedule == DAILY
    assert r"GaleCore-AI\seguimiento-spy" in sch.tasks                  # the previous registration is intact
    assert t.events(kb, "seguimiento-spy")[-1]["event"] == "scheduler_error"


def test_a_paused_frequency_change_that_cannot_disable_again_stays_consistent(env):
    """Codex C4 MAJOR: replacement succeeded, re-disabling failed -> state records the registered schedule, stays
    paused, the scheduler's runs are skipped, and the failure is raised and logged."""
    kb, sch, follow = env  # noqa: F811
    make(kb, sch)
    t.pause(kb=kb, scheduler=sch, task_id="seguimiento-spy", prompt="Pausalo", now=NOW)

    def failing(*_):
        raise t.TaskError("schtasks change failed: Access is denied")
    sch.set_enabled = failing
    new = Schedule(frequency="weekdays", time="09:45", timezone="America/New_York")
    with pytest.raises(t.TaskError, match="could not be disabled again"):
        t.set_frequency(kb=kb, scheduler=sch, task_id="seguimiento-spy", schedule=new, prompt="Cambiá", now=NOW)
    task = t.load(kb, "seguimiento-spy")
    assert task.schedule == new == sch.tasks[task.scheduler_name]["schedule"] and task.status == "paused"
    log = t.events(kb, "seguimiento-spy")
    assert [e["event"] for e in log[-2:]] == ["scheduler_error", "frequency_changed"]
    assert log[-1]["scheduler_left_enabled"] is True
    assert t.run(kb=kb, task_id="seguimiento-spy", followup=follow, commit=False,
                 invoked_by="scheduler")["status"] == "SKIPPED"


def test_manual_and_scheduled_runs_are_told_apart(env):
    """Codex C4 MAJOR: a manual `task run` must not look like an automatic one."""
    kb, sch, follow = env  # noqa: F811
    make(kb, sch)
    sch.query = lambda name: {"registered": True, "status": "Running", "last_run": "28/09/2026 6:05:00 PM",
                              "last_result": "267009", "next_run": "29/09/2026 6:05:00 PM", "schedule": "Daily"}
    t.run(kb=kb, task_id="seguimiento-spy", scheduler=sch, followup=follow, commit=False, now=NOW + timedelta(hours=1))
    t.run(kb=kb, task_id="seguimiento-spy", scheduler=sch, followup=follow, commit=False, now=NOW + timedelta(hours=2),
          invoked_by="scheduler")
    started = [e for e in t.events(kb, "seguimiento-spy") if e["event"] == "run_started"]
    assert [e["invoked_by"] for e in started] == ["manual", "scheduler"]
    assert "scheduler_seen" not in started[0]
    assert started[1]["scheduler_seen"]["last_run"] == "28/09/2026 6:05:00 PM"
    hosts = [r.host.provider for r in t.runs(kb, t.load(kb, "seguimiento-spy"))]
    assert sorted(hosts) == ["manual-cli", "windows-task-scheduler"]
    with pytest.raises(t.TaskError, match="invoked_by"):
        t.run(kb=kb, task_id="seguimiento-spy", followup=follow, commit=False, invoked_by="cron")


def test_pausing_during_a_run_is_not_overwritten(env):
    """Review R1 MAJOR: a chat command during an in-flight run keeps its effect and the chain stays intact."""
    kb, sch, follow = env  # noqa: F811
    make(kb, sch)

    def follow_and_pause(**kw):
        t.pause(kb=kb, scheduler=sch, task_id="seguimiento-spy", prompt="Pausalo", now=NOW)
        return follow(**kw)
    t.run(kb=kb, task_id="seguimiento-spy", scheduler=sch, followup=follow_and_pause, commit=False,
          now=NOW + timedelta(hours=1))
    assert t.load(kb, "seguimiento-spy").status == "paused"
    kinds = [e["event"] for e in t.events(kb, "seguimiento-spy")]           # raises if the chain broke
    assert kinds == ["created", "run_started", "paused", "run_finished"]


def test_a_busy_state_lock_times_out_instead_of_racing(env):
    kb, sch, _ = env  # noqa: F811
    make(kb, sch)
    (kb.base / "tasks" / "seguimiento-spy" / "state.lock").write_text("held", encoding="utf-8")
    with pytest.raises(t.TaskError, match="being changed"), t._state_lock(kb, "seguimiento-spy", timeout=0.2):
        pass
