"""GC-AI-0020: agents the owner creates — market-hours schedule, tasks without a strategy, model per capability."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from pydantic import ValidationError

from galecore_ai.application import market_clock
from galecore_ai.application import model_run as mr
from galecore_ai.application import tasks as t
from galecore_ai.contracts.task import Schedule
from tests.unit.test_knowledge import kb  # noqa: F401  (fixture)
from tests.unit.test_model_tasks import LATER, model_ok, output
from tests.unit.test_strategy import research_ref  # noqa: F401  (fixture)
from tests.unit.test_tasks import FakeScheduler, env, make  # noqa: F401  (env is a fixture)

NY = "America/New_York"
MARKET = Schedule(frequency="market_hours", minutes=30, timezone=NY)


def test_market_hours_is_validated():
    with pytest.raises(ValidationError):
        Schedule(frequency="market_hours", minutes=5, timezone=NY)
    with pytest.raises(ValidationError):
        Schedule(frequency="market_hours", minutes=30, timezone="America/Argentina/Buenos_Aires")
    with pytest.raises(ValidationError):
        Schedule(frequency="market_hours", minutes=30, time="10:00", timezone=NY)
    assert "horario de mercado" in MARKET.describe()


def test_market_hours_fires_only_inside_the_session():
    # Friday 2026-10-02 11:10 NY = 15:10 UTC: the last slot was 11:00, the next 11:30.
    fri = datetime(2026, 10, 2, 15, 10, tzinfo=UTC)
    assert t.last_due(MARKET, fri) == datetime(2026, 10, 2, 15, 0, tzinfo=UTC)
    assert t.next_due(MARKET, fri) == datetime(2026, 10, 2, 15, 30, tzinfo=UTC)
    # Saturday: nothing new is due; the next run is Monday's open.
    sat = datetime(2026, 10, 3, 18, 0, tzinfo=UTC)
    assert t.last_due(MARKET, sat) == datetime(2026, 10, 2, 19, 30, tzinfo=UTC)   # Friday 15:30, the last slot
    assert t.next_due(MARKET, sat) == datetime(2026, 10, 5, 13, 30, tzinfo=UTC)   # Monday 09:30 NY


def test_the_scheduler_repeats_for_the_length_of_the_session(monkeypatch):
    seen = {}
    monkeypatch.setattr(t.WindowsScheduler, "_run", lambda self, args: seen.setdefault("args", args) or "")
    monkeypatch.setattr(t.WindowsScheduler, "_settings", lambda self, name: seen.setdefault("settings", name))
    t.WindowsScheduler().create("GaleCore\\x", ["py"], MARKET, "10:30")
    args = seen["args"]
    assert args[args.index("/sc") + 1] == "weekly" and args[args.index("/ri") + 1] == "30"
    assert args[args.index("/du") + 1] == "06:30" and args[args.index("/st") + 1] == "10:30"
    assert seen["settings"] == "GaleCore\\x"     # every agent task gets the settings schtasks cannot set


def test_a_missed_run_starts_when_the_pc_wakes_and_battery_does_not_stop_it(monkeypatch):
    """WS-0018: the PC slept through every run of 07/10 and 08/10; schtasks' defaults never caught up."""
    seen = {}

    class Done:
        returncode, stdout, stderr = 0, b"", b""

    monkeypatch.setattr(t.subprocess, "run", lambda cmd, **kw: seen.update(cmd=cmd, env=kw["env"]) or Done())
    t.WindowsScheduler()._settings(r"GaleCore-AI\historia-del-mercado")
    script = seen["cmd"][-1]
    for flag in ("-StartWhenAvailable", "-AllowStartIfOnBatteries", "-DontStopIfGoingOnBatteries"):
        assert flag in script
    assert seen["env"]["GC_TASK_PATH"] == "\\GaleCore-AI\\" and seen["env"]["GC_TASK_NAME"] == "historia-del-mercado"
    assert "historia" not in script                  # the name travels in the environment, never in the script

    Done.returncode, Done.stderr = 1, b"access denied"
    with pytest.raises(t.TaskError, match="access denied"):
        t.WindowsScheduler()._settings(r"GaleCore-AI\x")


def test_an_agent_needs_no_strategy_but_a_follow_up_does(env):  # noqa: F811
    kb, sch, _ = env  # noqa: F811
    task = make(kb, sch, task_id="oportunidades", strategy=None, capability="market_watch", schedule=MARKET,
                objective="Revisá SPY, QQQ e IWM: IV rank > 30 y sin evento macro en 3 días")
    assert task.strategy is None and task.result_slug == "market-watch-oportunidades"
    with pytest.raises(t.TaskError, match="--strategy is required"):
        make(kb, sch, task_id="seguimiento-sin", strategy=None)


def test_an_agent_runs_without_a_follow_up_and_with_its_model(env):  # noqa: F811
    kb, sch, _ = env  # noqa: F811
    make(kb, sch, task_id="oportunidades", strategy=None, capability="market_watch", schedule=MARKET,
         objective="Revisá SPY: IV rank > 30")
    called = []
    model = model_ok(output())
    result = t.run(kb=kb, task_id="oportunidades", followup=lambda **kw: called.append(kw), commit=False,
                   now=LATER, client=model)
    assert called == [] and result["status"] == "OK"
    assert "follows no strategy" in model.calls[0]["prompt"]


def test_the_capability_model_reaches_the_command():
    cmd = mr.ClaudeCodeClient(binary="claude", model="sonnet").command(allowed=["Read"], max_turns=5, schema={},
                                                                         add_dir=__import__("pathlib").Path("."))
    assert cmd[cmd.index("--model") + 1] == "sonnet"
    assert "--model" not in mr.ClaudeCodeClient(binary="claude").command(allowed=[], max_turns=5, schema={},
                                                                           add_dir=__import__("pathlib").Path("."))


def test_the_unattended_model_never_gets_the_traders_login(tmp_path, monkeypatch):
    # Internal review 03/10: GALECORE_* kept GALECORE_USERNAME/PASSWORD for the claude subprocess.
    monkeypatch.setenv("GALECORE_PASSWORD", "secreto")
    monkeypatch.setenv("GALECORE_USERNAME", "yo")
    monkeypatch.setenv("GALECORE_API_KEY", "k")
    seen = {}

    def fake_popen(cmd, **kw):
        seen.update(kw["env"])
        raise OSError("stop")
    monkeypatch.setattr(mr.subprocess, "Popen", fake_popen)
    mr.ClaudeCodeClient(binary="x").run(prompt="p", allowed=[], max_turns=1, schema={}, cwd=tmp_path, timeout_s=2,
                                        add_dir=tmp_path)
    assert "GALECORE_PASSWORD" not in seen and "GALECORE_USERNAME" not in seen and seen["GALECORE_API_KEY"] == "k"


def test_a_scheduled_market_hours_run_outside_the_session_is_skipped(env):  # noqa: F811
    # Internal review 03/10: a PC clock without New York's DST would fire an hour off.
    kb, sch, _ = env  # noqa: F811
    make(kb, sch, task_id="oportunidades", strategy=None, capability="market_watch", schedule=MARKET)
    saturday = datetime(2026, 10, 3, 15, 0, tzinfo=UTC)
    out = t.run(kb=kb, task_id="oportunidades", now=saturday, invoked_by="scheduler", commit=False,
                client=model_ok(output()))
    assert out["status"] == "SKIPPED" and "outside the US session" in out["reason"]
    assert t.in_session(MARKET, datetime(2026, 10, 2, 15, 0, tzinfo=UTC))          # Friday 11:00 New York


# WS-0107: the schedule knows NYSE holidays and early closes (market_clock), not only weekdays.
WEEKDAYS_9 = Schedule(frequency="weekdays", time="09:00", timezone=NY)
DAILY_9 = Schedule(frequency="daily", time="09:00", timezone=NY)
THANKSGIVING, AFTER_THANKSGIVING = date(2026, 11, 26), date(2026, 11, 27)   # holiday / 13:00 early close
SATURDAY = date(2026, 11, 28)


def test_a_nyse_holiday_fires_neither_weekdays_nor_market_hours_but_daily_does():
    assert THANKSGIVING in market_clock.holidays(2026) and AFTER_THANKSGIVING in market_clock.early_closes(2026)
    assert t._slots(WEEKDAYS_9, THANKSGIVING) == [] and t._slots(MARKET, THANKSGIVING) == []
    assert t._slots(DAILY_9, THANKSGIVING) != []                      # an explicit choice of the user
    assert t._slots(WEEKDAYS_9, SATURDAY) == [] and t._slots(MARKET, SATURDAY) == []
    assert t._slots(WEEKDAYS_9, date(2026, 11, 25)) != []


def test_market_hours_stops_at_the_real_early_close():
    slots = t._slots(MARKET, AFTER_THANKSGIVING)
    assert slots[0] == datetime(2026, 11, 27, 14, 30, tzinfo=UTC)     # 09:30 NY (EST)
    assert slots[-1] == datetime(2026, 11, 27, 17, 30, tzinfo=UTC)    # 12:30 NY: the 13:00 slot is the close
    assert len(slots) == 7
    assert len(t._slots(MARKET, date(2026, 11, 25))) == 13            # a normal day runs to 15:30


def test_a_holiday_is_not_a_missed_run():
    thursday = datetime(2026, 11, 26, 20, 0, tzinfo=UTC)
    assert t.last_due(WEEKDAYS_9, thursday) == datetime(2026, 11, 25, 14, 0, tzinfo=UTC)   # Wednesday's 09:00
    assert t.next_due(WEEKDAYS_9, thursday) == datetime(2026, 11, 27, 14, 0, tzinfo=UTC)
    assert t.last_due(MARKET, thursday) == datetime(2026, 11, 25, 20, 30, tzinfo=UTC)      # Wednesday 15:30
    assert t.next_due(MARKET, thursday) == datetime(2026, 11, 27, 14, 30, tzinfo=UTC)


def test_in_session_knows_holidays_and_early_closes():
    assert not t.in_session(MARKET, datetime(2026, 11, 26, 15, 0, tzinfo=UTC))   # Thanksgiving 10:00 NY
    assert t.in_session(MARKET, datetime(2026, 11, 27, 17, 0, tzinfo=UTC))       # Friday 12:00 NY
    assert not t.in_session(MARKET, datetime(2026, 11, 27, 18, 30, tzinfo=UTC))  # Friday 13:30 NY, after the early close
    assert not t.in_session(MARKET, datetime(2026, 11, 28, 15, 0, tzinfo=UTC))   # Saturday


def test_market_closed_reads_as_not_due_and_is_not_a_failure():
    assert t.reason_text({"reason_code": "market_closed"}) == "no correspondía (mercado cerrado)"
    assert t.failure_code("Mercado cerrado: feriado (Acción de Gracias)") is None
