"""Recurring tasks (GC-AI-0009): create, inspect, change, pause, cancel and run a delegated follow-up.

Execution is the Windows Task Scheduler of the owner's PC (verified 27/09: a task runs as the user, with the
user's environment, even with no Claude session open). It needs the PC on, the user logged on, GaleCore Dev's API
up and its development credentials; when any is missing the run is still recorded, with the error.

Controls: one run at a time per task (exclusive lock file; a stale lock older than LOCK_STALE_MINUTES is broken
and noted), a paused or cancelled task never runs even if the scheduler fires, every change and run is appended
to a hash-chained events log, and a run can only do what its capability is declared to do: the read-only strategy follow-up as code, or a
capability declared schedulable with `runs: model` through the model with read commands only (GC-AI-0017,
application/model_run.py). The catalog is checked again at every run.
"""

from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import traceback
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from galecore_ai.application import model_run
from galecore_ai.application.catalog_check import CODE_RUNNERS, cli_commands
from galecore_ai.application.followup import has_news as followup_news
from galecore_ai.application.followup import history as followup_history
from galecore_ai.application.followup import run_followup
from galecore_ai.application.knowledge import KnowledgeBase, KnowledgeError
from galecore_ai.contracts.followup import FollowupRecord
from galecore_ai.contracts.regime_record import RecordHost
from galecore_ai.contracts.task import MARKET_CLOSE, MARKET_OPEN, ScanRule, Schedule, TaskDefinition
from galecore_ai.harness.catalog import CatalogEntry, CatalogError, load_catalog

LOCK_STALE_MINUTES = 30
REPAIR_SECONDS = 240         # the correction round
LOCK_MARGIN_SECONDS = 120    # what a model run leaves free under the stale-lock age (saving, LATEST.md, commit)
STATE_LOCK_TIMEOUT_SECONDS = 15
STATE_LOCK_STALE_SECONDS = 120
SCHEDULER_FOLDER = "GaleCore-AI"
# GC-AI-0023: the task that applies the monitor's on/off requests and publishes the agents' state to GaleCore.
SYNC_TASK = f"{SCHEDULER_FOLDER}\\espacio-agentes"
SYNC_MINUTES = 5
_REPO = Path(__file__).resolve().parents[3]
RUNNER_HOST = RecordHost(provider="windows-task-scheduler", model="deterministic-runner")
# A run started by hand (`task run`) is the same code but must never pass for an automatic one (Codex C4 MAJOR).
MANUAL_HOST = RecordHost(provider="manual-cli", model="deterministic-runner")
INVOKERS = {"scheduler": RUNNER_HOST, "manual": MANUAL_HOST}
MODEL_PROVIDERS = {"scheduler": "windows-task-scheduler+claude-code", "manual": "manual-cli+claude-code"}


class TaskError(Exception):
    """A task operation was refused or the scheduler failed."""


# ── scheduler adapter (schtasks.exe) ─────────────────────────────


class WindowsScheduler:
    """Thin wrapper over schtasks.exe. Every call is an argument list; failures raise TaskError with its output."""

    def _run(self, args: list[str]) -> str:
        r = subprocess.run(["schtasks", *args], capture_output=True, check=False)
        out = (r.stdout + r.stderr).decode(errors="replace")
        if r.returncode != 0:
            raise TaskError(f"schtasks {args[0]} failed: {out.strip()}")
        return out

    def create(self, name: str, command: list[str], schedule: Schedule, local_time: str | None) -> None:
        tr = subprocess.list2cmdline(command)
        if schedule.frequency == "every_minutes":
            sc = ["/sc", "minute", "/mo", str(schedule.minutes)]
        elif schedule.frequency == "market_hours":     # repeats every N minutes for the length of the session
            sc = ["/sc", "weekly", "/d", "MON,TUE,WED,THU,FRI", "/st", local_time, "/ri", str(schedule.minutes),
                  "/du", _session_length()]
        elif schedule.frequency == "weekdays":
            sc = ["/sc", "weekly", "/d", "MON,TUE,WED,THU,FRI", "/st", local_time]
        else:
            sc = ["/sc", "daily", "/st", local_time]
        self._run(["/create", "/tn", name, "/tr", tr, *sc, "/f"])
        self._settings(name)

    def create_every(self, name: str, command: list[str], minutes: int) -> None:
        """A plain every-N-minutes task (the space sync): no Schedule, it follows no market or timezone."""
        self._run(["/create", "/tn", name, "/tr", subprocess.list2cmdline(command), "/sc", "minute", "/mo", str(minutes),
                   "/f"])

    def _settings(self, name: str) -> None:
        """What `schtasks /create` cannot set (WS-0018): a run missed while the PC slept starts when it wakes, and
        running on battery is allowed. The defaults lost every run of 07/10 and 08/10 (PC asleep at the hour)."""
        path, _, leaf = ("\\" + name.strip("\\")).rpartition("\\")
        script = ("$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries "
                  "-DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew; "
                  "Set-ScheduledTask -TaskPath $env:GC_TASK_PATH -TaskName $env:GC_TASK_NAME -Settings $s | Out-Null")
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True,
                           check=False, env={**os.environ, "GC_TASK_PATH": path + "\\", "GC_TASK_NAME": leaf})
        if r.returncode != 0:
            raise TaskError(f"task settings for {name} failed: {(r.stdout + r.stderr).decode(errors='replace').strip()}")

    def delete(self, name: str) -> None:
        self._run(["/delete", "/tn", name, "/f"])

    def set_enabled(self, name: str, enabled: bool) -> None:
        self._run(["/change", "/tn", name, "/enable" if enabled else "/disable"])

    def query(self, name: str) -> dict:
        try:
            out = self._run(["/query", "/tn", name, "/fo", "csv", "/v"])
        except TaskError as exc:
            return {"registered": False, "error": str(exc)}
        rows = list(csv.DictReader(io.StringIO(out)))
        if not rows:
            return {"registered": False}
        row = rows[0]
        return {"registered": True, "status": row.get("Status"), "next_run": row.get("Next Run Time"),
                "last_run": row.get("Last Run Time"), "last_result": row.get("Last Result"),
                "schedule": row.get("Schedule Type"), "start_time": row.get("Start Time")}


# ── store ────────────────────────────────────────────────────────


def _dir(kb: KnowledgeBase, task_id: str) -> Path:
    return kb.base / "tasks" / task_id


def load(kb: KnowledgeBase, task_id: str) -> TaskDefinition:
    path = _dir(kb, task_id) / "task.json"
    if not path.is_file():
        raise TaskError(f"no task {task_id}")
    return TaskDefinition.model_validate(json.loads(path.read_text(encoding="utf-8")))


def _save(kb: KnowledgeBase, task: TaskDefinition) -> None:
    path = _dir(kb, task.id) / "task.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    # Absent optional fields stay out of the file: a checkout that predates them still reads the task.
    drop = {f for f in ("result_slug", "scan", "model") if getattr(task, f) is None}
    data = task.model_dump(mode="json", exclude=drop or None)
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def events(kb: KnowledgeBase, task_id: str) -> list[dict]:
    """The task's log, oldest first; a broken hash chain raises (an edited or removed line is visible)."""
    path = _dir(kb, task_id) / "events.jsonl"
    if not path.is_file():
        return []
    out, prev = [], None
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        ev = json.loads(line)
        if ev.get("prev") != prev:
            raise KnowledgeError(f"task {task_id}: events.jsonl line {n} breaks the hash chain (INTEGRITY_FAILED)")
        prev = hashlib.sha256(line.encode("utf-8")).hexdigest()
        out.append(ev)
    return out


@contextmanager
def _state_lock(kb: KnowledgeBase, task_id: str, timeout: float = STATE_LOCK_TIMEOUT_SECONDS):
    """Serializes every read-modify-write of task.json and events.jsonl (chat commands and scheduled runs)."""
    path = _dir(kb, task_id) / "state.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + timeout
    while True:
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            break
        except FileExistsError:
            if time.time() - path.stat().st_mtime > STATE_LOCK_STALE_SECONDS:
                path.unlink(missing_ok=True)       # a writer died holding it; its write never completed
                continue
            if time.monotonic() > deadline:
                raise TaskError(f"task {task_id} is being changed by another process; try again") from None
            time.sleep(0.05)
    try:
        os.close(fd)
        yield
    finally:
        path.unlink(missing_ok=True)


def _event(kb: KnowledgeBase, task_id: str, kind: str, now: datetime, **data) -> dict:
    with _state_lock(kb, task_id):
        return _append(kb, task_id, kind, now, **data)


def _append(kb: KnowledgeBase, task_id: str, kind: str, now: datetime, **data) -> dict:
    """Append one event; the caller holds the state lock."""
    path = _dir(kb, task_id) / "events.jsonl"
    existing = events(kb, task_id)
    prev = None
    if existing:
        prev = hashlib.sha256(path.read_text(encoding="utf-8").splitlines()[-1].encode("utf-8")).hexdigest()
    ev = {"at": now.isoformat(), "event": kind, "prev": prev, **data}
    with path.open("a", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(ev, ensure_ascii=False, sort_keys=True) + "\n")
    return ev


# ── schedule helpers ─────────────────────────────────────────────


def _session_length() -> str:
    o, c = ((int(h) * 60 + int(m)) for h, m in (t.split(":") for t in (MARKET_OPEN, MARKET_CLOSE)))
    minutes = c - o
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def local_time_for(schedule: Schedule, now: datetime) -> str | None:
    """The owner's HH:MM in their timezone, as this PC's local HH:MM for the next occurrence.

    A weekdays schedule whose conversion lands on another local calendar day would need a shifted day set; that is
    not supported, so it is refused instead of firing on the wrong days.
    """
    start = MARKET_OPEN if schedule.frequency == "market_hours" else schedule.time
    if start is None:
        return None
    tz = ZoneInfo(schedule.timezone)
    hh, mm = (int(x) for x in start.split(":"))
    day = now.astimezone(tz).date()
    target = datetime(day.year, day.month, day.day, hh, mm, tzinfo=tz)
    if target <= now:
        target += timedelta(days=1)
    local = target.astimezone()
    if schedule.frequency in ("weekdays", "market_hours") and local.date() != target.date():
        raise TaskError(f"{schedule.time} {schedule.timezone} is another calendar day on this PC "
                        f"({local:%a %H:%M}); a weekdays schedule would fire on the wrong days. Use daily or another time")
    return local.strftime("%H:%M")


def _pythonw() -> str:
    pyw = Path(sys.executable).with_name("pythonw.exe")
    return str(pyw if pyw.exists() else sys.executable)


def runner_command(code_path: Path, task_id: str) -> list[str]:
    return [_pythonw(), "-B", str(code_path / "tools" / "task_runner.py"), task_id]


def sync_command(code_path: Path = _REPO) -> list[str]:
    return [_pythonw(), "-B", str(code_path / "tools" / "space_sync.py")]


# How long after a due time a run may still be starting or in progress before it counts as missed.
MISSED_GRACE = timedelta(minutes=30)


def _fires_on(schedule: Schedule, day) -> bool:
    return schedule.frequency == "daily" or day.weekday() < 5


def _slots(schedule: Schedule, day) -> list[datetime]:
    """When the schedule fires on `day`: one time, or every N minutes of the session (market_hours)."""
    if not _fires_on(schedule, day):
        return []
    if schedule.frequency != "market_hours":
        return [_occurrence(schedule, day)]
    tz = ZoneInfo(schedule.timezone)
    (oh, om), (ch, cm) = ((int(x) for x in t.split(":")) for t in (MARKET_OPEN, MARKET_CLOSE))
    at, close = (datetime(day.year, day.month, day.day, h, m, tzinfo=tz) for h, m in ((oh, om), (ch, cm)))
    out = []
    while at < close:
        out.append(at)
        at += timedelta(minutes=schedule.minutes)
    return out


def in_session(schedule: Schedule, now: datetime) -> bool:
    """Inside 09:30-16:00 New York on a weekday (holidays are not known: a declared limit)."""
    ny = now.astimezone(ZoneInfo(schedule.timezone))
    return ny.weekday() < 5 and MARKET_OPEN <= ny.strftime("%H:%M") < MARKET_CLOSE


def _occurrence(schedule: Schedule, day) -> datetime:
    hh, mm = (int(x) for x in schedule.time.split(":"))
    return datetime(day.year, day.month, day.day, hh, mm, tzinfo=ZoneInfo(schedule.timezone))


def last_due(schedule: Schedule, now: datetime) -> datetime | None:
    """The most recent time the schedule should have fired at or before `now` (UTC); None for every_minutes."""
    if schedule.frequency == "every_minutes":
        return None
    day = now.astimezone(ZoneInfo(schedule.timezone)).date()
    for back in range(8):
        past = [at for at in _slots(schedule, day - timedelta(days=back)) if at <= now]
        if past:
            return past[-1].astimezone(UTC)
    return None


def next_due(schedule: Schedule, now: datetime) -> datetime | None:
    """The next time the schedule should fire after `now` (UTC)."""
    if schedule.frequency == "every_minutes":
        return (now + timedelta(minutes=schedule.minutes)).astimezone(UTC)
    day = now.astimezone(ZoneInfo(schedule.timezone)).date()
    for ahead in range(8):
        future = [at for at in _slots(schedule, day + timedelta(days=ahead)) if at > now]
        if future:
            return future[0].astimezone(UTC)
    return None


def freshness(task: TaskDefinition, log: list[dict], now: datetime) -> dict:
    """Whether the newest result is the current one, or a due run was missed or failed.

    Only runs the Scheduler started count (a manual `task run` does not cover a missed automatic one), and a due
    time before the schedule was last set (created, resumed, frequency changed) is not expected.
    """
    if task.status != "active":
        return {"state": task.status.upper(), "detail": f"task is {task.status}: no run is expected"}
    since = max((datetime.fromisoformat(e["at"]) for e in log
                 if e["event"] in ("created", "resumed", "frequency_changed")), default=task.created_at)
    if task.schedule.frequency == "every_minutes":
        # No wall-clock anchor: the last scheduler start (or when the schedule was set) plus one period is when the
        # next run was due (Codex C4 recheck: `now - period` never let an omission turn into MISSED).
        period = timedelta(minutes=task.schedule.minutes)
        starts = [datetime.fromisoformat(e["at"]) for e in log
                  if e.get("invoked_by") == "scheduler" and e["event"] == "run_started"]
        anchor = max([since, *starts])
        due = anchor + period if now >= anchor + period else (anchor if starts and anchor > since else None)
    else:
        due = last_due(task.schedule, now)
    out = {"expected_at": due.isoformat() if due else None, "next_expected_at": next_due(task.schedule, now).isoformat()}
    if due is None or due < since:
        return {**out, "state": "NOT_DUE_YET", "detail": "no scheduled time has passed since the schedule was set"}
    runs = [i for i, e in enumerate(log) if e.get("invoked_by") == "scheduler" and e["event"] == "run_started"
            and datetime.fromisoformat(e["at"]) >= due - timedelta(minutes=1)]
    if not runs:
        late = now - due
        if late <= MISSED_GRACE:
            return {**out, "state": "DUE_NOW", "detail": f"due {int(late.total_seconds() // 60)} min ago; not started yet"}
        return {**out, "state": "MISSED",
                "detail": "the scheduler did not run it at the expected time (PC off, user logged off or scheduler "
                          "error): the latest result is older than it should be"}
    last = runs[-1]                                   # the log is append-only: what follows it is that run's outcome
    after = [e for e in log[last + 1:] if e["event"] in ("run_finished", "run_failed")]
    if not after:
        return {**out, "state": "RUNNING", "detail": f"started {log[last]['at']}"}
    if after[0]["event"] == "run_failed":
        return {**out, "state": "FAILED", "detail": after[0].get("error", "")[:300]}
    what = after[0].get("followup") or after[0].get("research")
    return {**out, "state": "CURRENT", "detail": f"result {after[0].get('result')} of {what}"}


# ── conversation-facing operations ───────────────────────────────


def schedulable_entry(capability: str) -> CatalogEntry:
    """The catalog entry of a capability a task may run; refused when it is not declared schedulable."""
    try:
        catalog = load_catalog()
        entry = catalog.get(capability)
    except CatalogError as exc:
        raise TaskError(str(exc)) from exc
    if entry.schedulable is None:
        schedulable = [e.id for e in catalog.entries if e.schedulable]
        raise TaskError(f"{capability} is not schedulable (the catalog declares: {', '.join(schedulable)})")
    if entry.schedulable.runs == "code" and capability not in CODE_RUNNERS:
        raise TaskError(f"{capability}: no code runner")
    return entry


def create(*, kb: KnowledgeBase, scheduler, task_id: str, strategy: str | None, objective: str, expected_result: str,
           sources: list[str], schedule: Schedule, prompt: str, code_path: Path | None = None,
           now: datetime | None = None, capability: str = "strategy_followup",
           result_slug: str | None = None) -> TaskDefinition:
    now = now or datetime.now(UTC)
    if (_dir(kb, task_id) / "task.json").exists():
        raise TaskError(f"task {task_id} already exists (a cancelled task keeps its id and history)")
    entry = schedulable_entry(capability)
    if strategy is None and entry.schedulable.runs == "code":
        raise TaskError(f"{capability} follows one strategy: --strategy is required")
    if strategy is not None and not any(k.split("/")[0] == strategy for k in kb.strategies.versions()):
        raise TaskError(f"no strategy named {strategy} in the knowledge base")
    code_path = code_path or _REPO
    extra: dict = {}
    if entry.schedulable.runs == "model":
        extra = {"result_slug": result_slug or f"{capability}-{strategy or task_id}".replace("_", "-"),
                 "allowed": [(f"{capability} por el modelo: sólo comandos de lectura de su flujo, hasta "
                              f"{entry.schedulable.max_turns} turnos y {entry.schedulable.timeout_minutes} min; "
                              "guarda su resultado y la evidencia que usó")]}
    elif result_slug:
        raise TaskError(f"{capability} runs as code; it has no result_slug")
    task = TaskDefinition(kind=capability, id=task_id, objective=objective, strategy=strategy,
                          sources=sources, expected_result=expected_result, schedule=schedule, created_at=now,
                          updated_at=now, created_by_prompt=prompt, scheduler_name=f"{SCHEDULER_FOLDER}\\{task_id}",
                          local_time=local_time_for(schedule, now), code_path=str(code_path), **extra)
    scheduler.create(task.scheduler_name, runner_command(code_path, task_id), schedule, task.local_time)
    with _state_lock(kb, task_id):
        _save(kb, task)
        _append(kb, task_id, "created", now, schedule=schedule.model_dump(), local_time=task.local_time, prompt=prompt,
                capability=capability)
    return task


def _scheduler_call(kb: KnowledgeBase, task_id: str, now: datetime, what: str, fn, *args) -> None:
    """A scheduler failure is appended to the log before it propagates, so status explains a mismatch."""
    try:
        fn(*args)
    except TaskError as exc:
        _append(kb, task_id, "scheduler_error", now, operation=what, error=str(exc)[:500])
        raise


def set_frequency(*, kb: KnowledgeBase, scheduler, task_id: str, schedule: Schedule, prompt: str,
                  now: datetime | None = None) -> TaskDefinition:
    now = now or datetime.now(UTC)
    local = local_time_for(schedule, now)
    with _state_lock(kb, task_id):
        task = load(kb, task_id)
        if task.status == "cancelled":
            raise TaskError(f"task {task_id} is cancelled; create a new one")
        # `schtasks /create /f` replaces the task in place: if it fails, the previous schedule is still registered.
        _scheduler_call(kb, task_id, now, "set_frequency", scheduler.create, task.scheduler_name,
                        runner_command(Path(task.code_path), task_id), schedule, local)
        old = task.schedule.describe()
        task = task.model_copy(update={"schedule": schedule, "local_time": local, "updated_at": now})
        pause_error = None
        if task.status == "paused":
            try:
                _scheduler_call(kb, task_id, now, "keep_paused", scheduler.set_enabled, task.scheduler_name, False)
            except TaskError as exc:
                pause_error = exc
        # The new schedule is registered either way, so the state records it; if re-disabling failed the task
        # stays paused here and every run it fires is skipped (run() checks this status), until `task pause`.
        _save(kb, task)
        _append(kb, task_id, "frequency_changed", now, before=old, after=schedule.describe(), local_time=local,
                prompt=prompt, **({"scheduler_left_enabled": True} if pause_error else {}))
    if pause_error:
        raise TaskError(f"frequency changed, but the scheduler task could not be disabled again ({pause_error}); "
                        "it stays paused and its runs are skipped - repeat `task pause`") from pause_error
    return task


def set_settings(*, kb: KnowledgeBase, task_id: str, settings: dict, prompt: str,
                 expected_updated_at: datetime, now: datetime | None = None) -> TaskDefinition:
    """Apply an owner edit without changing schedule, tools, budgets or task status."""
    now = now or datetime.now(UTC)
    if not settings or set(settings) - {"objective", "model"}:
        raise TaskError("sólo se pueden editar instrucciones y modelo")
    with _state_lock(kb, task_id):
        task = load(kb, task_id)
        if task.status == "cancelled" or task.updated_at != expected_updated_at:
            raise TaskError("la tarea cambió; actualizá la pantalla antes de editar")
        if "model" in settings and task.kind in CODE_RUNNERS:
            raise TaskError("esta tarea corre por código, sin modelo")
        if "objective" in settings and (not isinstance(settings["objective"], str)
                                        or len(settings["objective"]) > 12000):
            raise TaskError("las instrucciones deben tener entre 1 y 12000 caracteres")
        updated = TaskDefinition.model_validate({**task.model_dump(), **settings, "updated_at": now})
        _save(kb, updated)
        _append(kb, task_id, "settings_changed", now, before={k: getattr(task, k) for k in settings},
                after=settings, prompt=prompt)
    return updated


def set_scan(*, kb: KnowledgeBase, task_id: str, rule: ScanRule | None, prompt: str,
             now: datetime | None = None) -> TaskDefinition:
    """Give a market agent its screen by code (P1-05), or take it away (None). The status is not touched."""
    now = now or datetime.now(UTC)
    with _state_lock(kb, task_id):
        task = load(kb, task_id)
        if task.status == "cancelled":
            raise TaskError(f"task {task_id} is cancelled; create a new one")
        if task.strategy is not None:
            raise TaskError("a screen is for an agent that watches the market (no strategy)")
        before = task.scan.model_dump() if task.scan else None
        task = task.model_copy(update={"scan": rule, "updated_at": now})
        _save(kb, task)
        _append(kb, task_id, "scan_changed", now, before=before, after=rule.model_dump() if rule else None,
                prompt=prompt)
    return task


def rebind(*, kb: KnowledgeBase, scheduler, task_id: str, code_path: Path, prompt: str,
           now: datetime | None = None) -> TaskDefinition:
    """Point the task at another checkout (e.g. from a work-item worktree to the stable one), keeping id and history.

    The new checkout must contain the runner. The scheduler registration is replaced in place (a failure leaves the
    previous one registered and is logged); a paused task stays disabled.
    """
    now = now or datetime.now(UTC)
    code_path = Path(code_path).resolve()
    if not (code_path / "tools" / "task_runner.py").is_file():
        raise TaskError(f"{code_path} has no tools/task_runner.py: not a GaleCore-AI checkout")
    with _state_lock(kb, task_id):
        task = load(kb, task_id)
        if task.status == "cancelled":
            raise TaskError(f"task {task_id} is cancelled; create a new one")
        before = task.code_path
        _scheduler_call(kb, task_id, now, "rebind", scheduler.create, task.scheduler_name,
                        runner_command(code_path, task_id), task.schedule, task.local_time)
        pause_error = None
        if task.status == "paused":
            try:
                _scheduler_call(kb, task_id, now, "keep_paused", scheduler.set_enabled, task.scheduler_name, False)
            except TaskError as exc:
                pause_error = exc
        # The scheduler already points at the new checkout, so the state records it (same rule as set_frequency).
        task = task.model_copy(update={"code_path": str(code_path), "updated_at": now})
        _save(kb, task)
        _append(kb, task_id, "code_path_changed", now, before=before, after=str(code_path), prompt=prompt,
                **({"scheduler_left_enabled": True} if pause_error else {}))
    if pause_error:
        raise TaskError(f"task moved, but the scheduler task could not be disabled again ({pause_error}); "
                        "it stays paused and its runs are skipped - repeat `task pause`") from pause_error
    return task


def _set_status(kb: KnowledgeBase, scheduler, task_id: str, status: str, prompt: str, now: datetime | None):
    now = now or datetime.now(UTC)
    with _state_lock(kb, task_id):
        task = load(kb, task_id)
        if task.status == "cancelled":
            raise TaskError(f"task {task_id} is already cancelled")
        if status == "cancelled":
            _scheduler_call(kb, task_id, now, "cancel", scheduler.delete, task.scheduler_name)
        else:
            _scheduler_call(kb, task_id, now, status, scheduler.set_enabled, task.scheduler_name, status == "active")
        task = task.model_copy(update={"status": status, "updated_at": now})
        _save(kb, task)
        _append(kb, task_id, {"active": "resumed", "paused": "paused", "cancelled": "cancelled"}[status], now,
                prompt=prompt)
    return task


def pause(*, kb, scheduler, task_id, prompt, now=None):
    return _set_status(kb, scheduler, task_id, "paused", prompt, now)


def resume(*, kb, scheduler, task_id, prompt, now=None):
    return _set_status(kb, scheduler, task_id, "active", prompt, now)


def cancel(*, kb, scheduler, task_id, prompt, now=None):
    return _set_status(kb, scheduler, task_id, "cancelled", prompt, now)


def runs(kb: KnowledgeBase, task: TaskDefinition, limit: int | None = None) -> list[FollowupRecord]:
    """The follow-up records a code task left (a model task's runs are its run_finished events)."""
    if task.kind not in CODE_RUNNERS:
        return []
    return [r for r in followup_history(kb, task.strategy) if r.task_id == task.id][:limit]


def status(*, kb: KnowledgeBase, scheduler, task_id: str, now: datetime | None = None) -> dict:
    task = load(kb, task_id)
    log = events(kb, task_id)
    problems = [e for e in log if e["event"] in ("run_failed", "run_skipped")][-3:]
    outcomes = [e for e in log if e["event"] in ("run_finished", "run_failed")]
    if task.kind in CODE_RUNNERS:
        last = runs(kb, task, limit=1)
        last_result = last[0].model_dump(mode="json") if last else None
        readable = kb.base / "followups" / task.strategy / "LATEST.md"
    else:
        last_result = next((e for e in reversed(log) if e["event"] == "run_finished"), None)
        readable = _dir(kb, task_id) / "LATEST.md"
    return {
        "freshness": freshness(task, log, now or datetime.now(UTC)),
        "task": task.model_dump(mode="json"), "schedule": task.schedule.describe(),
        "scheduler": scheduler.query(task.scheduler_name) if task.status != "cancelled" else {"registered": False},
        "last_result": last_result,
        "last_run": ({k: outcomes[-1].get(k) for k in ("at", "event", "result", "invoked_by", "duration_s", "turns",
                                                       "max_turns", "model", "route", "tokens", "reason", "error")
                      if k in outcomes[-1]}
                     if outcomes else None),
        "runs": sum(1 for e in log if e["event"] == "run_finished"),
        "recent_problems": problems, "recent_events": log[-5:],
        "latest_readable": str(readable),
    }


def list_tasks(kb: KnowledgeBase) -> list[dict]:
    base = kb.base / "tasks"
    if not base.is_dir():
        return []
    out = []
    for d in sorted(p for p in base.iterdir() if (p / "task.json").is_file()):
        t = load(kb, d.name)
        out.append({"id": t.id, "capability": t.kind, "status": t.status, "strategy": t.strategy, "schedule": t.schedule.describe(),
                    "objective": t.objective})
    return out


# ── the scheduled run ────────────────────────────────────────────


def _commit_knowledge(kb: KnowledgeBase, paths: list[Path], message: str) -> str:
    rel = [str(p.relative_to(kb.base)) for p in paths if p.exists()]
    if not rel or not (kb.base / ".git").exists():
        return "not committed (no git in the knowledge base)"
    add = subprocess.run(["git", "-C", str(kb.base), "add", "--", *rel], capture_output=True, check=False)
    com = subprocess.run(["git", "-C", str(kb.base), "commit", "-q", "-m", message, "--", *rel],
                         capture_output=True, check=False)
    return "committed" if add.returncode == 0 and com.returncode == 0 else \
        f"commit failed: {(com.stderr or add.stderr).decode(errors='replace').strip()[:200]}"


def _mark_validity(latest: Path, task: TaskDefinition, now: datetime) -> None:
    """LATEST.md cannot update itself when a run is missed, so it says until when it is the current result."""
    nxt = next_due(task.schedule, now)
    if nxt is None or not latest.exists():
        return
    note = (f"\n\n> **Vigencia:** resultado de la tarea `{task.id}` ({task.schedule.describe()}). La próxima corrida "
            f"esperada es **{nxt:%Y-%m-%d %H:%M} UTC** (+{int(MISSED_GRACE.total_seconds() // 60)} min de margen): si esa "
            f"hora ya pasó y esto no cambió, **la corrida se omitió** y este resultado no es el vigente "
            f"(`task status {task.id}` lo confirma).\n")
    with latest.open("a", encoding="utf-8", newline="\n") as fh:
        fh.write(note)


def _scratch(task_id: str, now: datetime) -> Path:
    """Where a model run's scripts write what they fetch (outside the knowledge base: only evidence is kept)."""
    base = Path(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()) / "GaleCore-AI" / "runs" / task_id
    return base / now.strftime("%Y%m%dT%H%M%SZ")


def _latest_research(kb: KnowledgeBase, task: TaskDefinition) -> str | None:
    """The investigation a model task revises: the newest research:<date>-<result_slug>, if any."""
    found = [i for i in kb.research.ids() if i[11:] == task.result_slug]
    return f"research:{found[-1]}" if found else None


def _write_latest(path: Path, task: TaskDefinition, outcome: dict, now: datetime) -> None:
    """The task's readable latest result: what ran, how it ended, where the result is, and what was missing."""
    saved = outcome.get("research") or outcome.get("followup") or "—"
    if outcome.get("revision"):
        saved += f" rev {outcome['revision']}"
    lines = [f"# {task.objective}", "",
             f"Tarea `{task.id}` · capacidad `{task.kind}` · estrategia `{task.strategy or '—'}` · {task.schedule.describe()}",
             "", "| Corrida | Resultado | Guardado | Duración | Turnos |", "|---|---|---|---|---|",
             (f"| {now:%Y-%m-%d %H:%M} UTC ({outcome.get('invoked_by')}) | **{outcome['result']}** | {saved} | "
              f"{outcome.get('duration_s', '—')} s | {outcome.get('turns') or '—'} de {outcome.get('max_turns')} |"), ""]
    if outcome.get("scan"):
        lines += ["Escaneo por código (sin modelo): " + (outcome.get("reason") or "—"), ""]
    elif outcome["result"] == "OK" and outcome.get("model") is None and outcome.get("reason"):
        lines += ["Sin modelo: " + outcome["reason"], ""]
    elif outcome["result"] != "OK":
        lines += ["**No se pudo completar.** Motivo: " + (outcome.get("reason") or outcome.get("error") or "—"), ""]
    if outcome["result"] == "FAILED":
        lines += ["No hay resultado de esta corrida; el último guardado sigue siendo el anterior.", ""]
    if outcome.get("research"):
        rid = outcome["research"].removeprefix("research:")
        lines += [f"Resultado completo: `kb show {outcome['research']}` (`knowledge/research/{rid}.md`).", ""]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8", newline="\n")


def _repair_if_refused(kb: KnowledgeBase, task: TaskDefinition, target: str | None, reply, base: dict, client,
                       scratch: Path):
    """When the validators would refuse the output, one correction round without tools, inside the turn cap."""
    try:
        problems = model_run.check_refs(kb, model_run.parse_output(reply.structured), target, capability=task.kind)
    except model_run.RunRefused as exc:
        problems = [str(exc)]
    left = base["max_turns"] - (reply.turns or 0)
    if not problems or left < 2:
        return reply, base
    fixed = client.run(prompt=model_run.repair_prompt(reply.structured, problems), allowed=[],
                       max_turns=min(model_run.REPAIR_TURNS, left), schema=model_run.output_schema(), cwd=_REPO,
                       timeout_s=REPAIR_SECONDS, add_dir=scratch)
    (scratch / "repair.json").write_text(json.dumps({"problems": problems, "reply": vars(fixed)}, ensure_ascii=False,
                                                    indent=1, default=str), encoding="utf-8")
    base = {**base, "turns": (reply.turns or 0) + (fixed.turns or 0), "repaired": problems[:5],
            "duration_model_s": round((reply.duration_s or 0) + (fixed.duration_s or 0), 1),
            **_tokens(model_run.add_tokens(reply.tokens, fixed.tokens))}
    if not fixed.ok:
        fixed.error = f"correction round failed ({fixed.error}) after: {'; '.join(problems)[:400]}"
    return fixed, base


def _tokens(tokens: dict | None) -> dict:
    return {"tokens": tokens} if tokens else {}


def _story_pack(kb: KnowledgeBase, invoked_by: str, now: datetime) -> tuple[str, str, str | None]:
    """Gather and keep the day's market pack; the model gets it in the prompt and cites its ref."""
    from galecore_ai.adapters.cli import _build_dispatcher  # lazy: the CLI imports this module
    from galecore_ai.application import story

    coro = story.gather(_build_dispatcher(), today=now.date())
    try:
        asyncio.get_running_loop()
    except RuntimeError:                       # the Scheduler's runner: no loop yet
        pack = asyncio.run(coro)
    else:                                      # `task run` from the CLI already runs inside a loop
        with ThreadPoolExecutor(max_workers=1) as pool:
            pack = pool.submit(asyncio.run, coro).result()
    if not pack["prices"] and not pack["options"]:
        raise RuntimeError(f"GaleCore did not answer: {'; '.join(pack['missing'])[:300]}")
    ref, pack = story.save_pack(kb, pack, prompt=f"Tarea {invoked_by}: historia del mercado",
                                host=RecordHost(provider=f"{INVOKERS[invoked_by]} story pack", model=None))
    note = (f"The runner already gathered today's market pack from GaleCore and stored it as {ref} (cite it with that "
            f"exact ref; do not fetch these data again). The pack, verbatim:\n```json\n"
            f"{json.dumps(pack, ensure_ascii=False)}\n```")
    return ref, note, story.escalation_reason(pack, now.date())


def _screen(task: TaskDefinition, now: datetime) -> dict:
    """The agent's screen by code (P1-05): IV rank per symbol and the quiet window, no model."""
    from galecore_ai.adapters.cli import _build_dispatcher  # lazy: the CLI imports this module
    from galecore_ai.application import scan

    coro = scan.screen(_build_dispatcher(), task.scan, now.date())
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


def _run_model(*, kb: KnowledgeBase, task: TaskDefinition, entry: CatalogEntry, now: datetime, invoked_by: str,
               client: model_run.ModelClient, followup, written: list[Path]) -> dict:
    """One model run. The runner first keeps the day's data (the code follow-up), then the model reads and returns the
    result, and the runner validates and saves it. Without a valid result the run is INCOMPLETE with the day's data;
    FAILED only when there is neither."""
    from galecore_ai.adapters.cli import build_parser  # lazy: the CLI imports this module

    t0 = time.monotonic()
    caps = entry.schedulable
    if isinstance(client, model_run.ClaudeCodeClient):
        client.model = task.model or caps.model  # owner's explicit selection; otherwise the catalog policy
    rec = kept = screened = escalated = None
    followup_error = None
    try:
        if entry.id == "market_story":       # the day's market pack, gathered by code before the model (GC-AI-0024)
            kept, note, escalated = _story_pack(kb, invoked_by, now)
            if escalated and task.model is None and isinstance(client, model_run.ClaudeCodeClient):
                client.model = "opus"            # Sonnet by policy; Opus only for the reason the code found
            written.append(kb.evidence.path_for(kept.removeprefix("evidence:")))
        elif entry.id == "knowledge_curator":   # new items by domain, by code; the model only where it crossed the threshold
            from galecore_ai.application import curation
            latest = _latest_research(kb, task)
            last = kb.research.load(latest.split(":", 1)[1]).current.recorded_at if latest else None
            found = curation.screen(kb, last_run=last, now=now)
            if not found["domains"]:
                return {"invoked_by": invoked_by, "max_turns": caps.max_turns, "model": None, "result": "OK",
                        "reason": f"sin material nuevo que curar, sin modelo: {curation.summary(found)}"[:800],
                        "screen": found, "duration_s": round(time.monotonic() - t0, 1)}
            note = (f"The runner screened the memory by code. Curate ONLY these domains: {', '.join(found['domains'])}; "
                    "read with `kb show` only the refs listed for them, and name the stale pending feedback to the "
                    "owner as listed. Do not search for more. The screen, verbatim:\n```json\n"
                    f"{json.dumps(found, ensure_ascii=False)}\n```")
            followup_error = "sin estrategia: no hay seguimiento"
        elif task.scan is not None:  # screened by code first; the model only with a finding (P1-05)
            from galecore_ai.application import scan
            screened = _screen(task, now)
            if not screened["findings"]:
                evaluated = [c for c in screened["checked"] if c["result"] != "sin evaluar"]
                return {"invoked_by": invoked_by, "max_turns": caps.max_turns, "model": None,
                        "result": "OK" if evaluated and len(evaluated) == len(screened["checked"]) else "INCOMPLETE",
                        "reason": f"escaneo por código sin hallazgo, sin modelo: {scan.summary(screened)}"[:800],
                        "scan": screened, "duration_s": round(time.monotonic() - t0, 1)}
            note = ("The runner screened the symbols by code (IV rank and the quiet window of releases). Only these "
                    f"are findings: {', '.join(screened['findings'])}; build and check the candidate only for them, "
                    "and report the others as the screen left them. The screen, verbatim:\n```json\n"
                    f"{json.dumps(screened, ensure_ascii=False)}\n```")
            followup_error = "sin estrategia: no hay seguimiento"
        elif task.strategy is None:  # an agent that watches the market: no strategy, no runtime follow-up (GC-AI-0020)
            followup_error = "sin estrategia: no hay seguimiento"
            note = "This agent follows no strategy: there is no runtime follow-up; read the market with your commands."
        else:
            rec, path = followup(kb=kb, strategy=task.strategy, prompt=task.objective, host=INVOKERS[invoked_by],
                                 task_id=task.id, now=now)
            written += [path, path.parent / "LATEST.md",
                        *(kb.base / "evidence" / f"{s.split(':', 1)[1]}.json" for s in rec.sources)]
            if entry.id == "daily_attention" and invoked_by == "scheduler" and not followup_news(rec):
                return {"invoked_by": invoked_by, "max_turns": caps.max_turns, "model": None, "result": "OK",
                        "followup": rec.id, "reason": "sin novedades en SHADOW (sin posición abierta, aviso ni "
                        "evento nuevo), sin modelo; los datos del día quedaron guardados",
                        "duration_s": round(time.monotonic() - t0, 1)}
            note = (f"The runner already ran the follow-up for today: record {rec.id} (status {rec.status}); read it "
                    f"with `followup history --strategy {task.strategy}` and use it as the runtime data of step 3.")
    except Exception as exc:  # noqa: BLE001 - recorded; the model still reads what it can
        followup_error = f"{type(exc).__name__}: {exc}"
        note = f"The runner could not gather today's data ({followup_error[:200]}): that data is missing."
    if task.scan is not None and screened is None:   # the screen itself failed: no finding, so no model
        return {"invoked_by": invoked_by, "max_turns": caps.max_turns, "model": None, "result": "INCOMPLETE",
                "duration_s": round(time.monotonic() - t0, 1),
                "reason": f"el escaneo por código no corrió ({followup_error}); sin modelo"[:800]}
    if entry.id == "market_story" and kept is None:   # no pack: no data to read, the model is not called
        return {"invoked_by": invoked_by, "max_turns": caps.max_turns, "result": "FAILED",
                "duration_s": round(time.monotonic() - t0, 1), "error": f"sin paquete del día: {followup_error}"[:800]}
    target = _latest_research(kb, task)
    scratch = _scratch(task.id, now)
    scratch.mkdir(parents=True, exist_ok=True)
    allowed = model_run.allowed_tools(entry, cli_commands(build_parser()))
    prompt = model_run.build_prompt(entry=entry, task=task, target=target, run_dir=scratch, now=now, allowed=allowed,
                                    followup_note=note)
    (scratch / "prompt.txt").write_text(prompt, encoding="utf-8")
    # The model gets its cap or what is left under the stale-lock age after the follow-up (a slow GaleCore can take
    # minutes), keeping room for the correction round: one run never outlives its lock (internal recheck 30/09).
    left = LOCK_STALE_MINUTES * 60 - (time.monotonic() - t0) - REPAIR_SECONDS - LOCK_MARGIN_SECONDS
    if left < 60:
        raise TaskError(f"the follow-up took {int(time.monotonic() - t0)} s: no time left for the model under the lock")
    reply = client.run(prompt=prompt, allowed=allowed, max_turns=caps.max_turns, schema=model_run.output_schema(),
                       cwd=_REPO, timeout_s=int(min(caps.timeout_minutes * 60, left)), add_dir=scratch)
    base = {"invoked_by": invoked_by, "turns": reply.turns, "max_turns": caps.max_turns, "model": reply.model,
            "route": (f"modelo elegido por el owner: {task.model}" if task.model else
                      caps.route_reason() if not escalated else f"escalada a opus: {escalated}"),
            "duration_model_s": reply.duration_s, **_tokens(reply.tokens), **({"followup": rec.id} if rec else {}),
            **({"pack": kept} if kept else {})}
    if reply.ok:
        reply, base = _repair_if_refused(kb, task, target, reply, base, client, scratch)
    (scratch / "reply.json").write_text(json.dumps(vars(reply), ensure_ascii=False, indent=1, default=str),
                                        encoding="utf-8")
    problem = reply.error
    if reply.ok:
        host = RecordHost(provider=MODEL_PROVIDERS[invoked_by], model=reply.model)
        try:
            out = model_run.parse_output(reply.structured)
            # Saved at the time of saving: the model fetched its evidence after the run started.
            ref, revision, paths = model_run.save_output(kb=kb, output=out, task=task, target=target, host=host,
                                                         now=now + timedelta(seconds=time.monotonic() - t0))
        except model_run.RunRefused as exc:
            problem = f"output refused: {exc}"
        else:
            written += paths
            return {**base, "result": out.status, "research": ref, "revision": revision,
                    "evidence_saved": len(paths) - 1, **({"reason": out.reason} if out.reason else {}),
                    "duration_s": round(time.monotonic() - t0, 1)}
    if rec is None and kept is None:
        return {**base, "result": "FAILED", "duration_s": round(time.monotonic() - t0, 1),
                "error": f"model: {problem}; follow-up: {followup_error}"[:800]}
    return {**base, "result": "INCOMPLETE", "duration_s": round(time.monotonic() - t0, 1),
            "reason": f"sin resultado del modelo ({problem}); se guardaron los datos del día "
                      f"({rec.status if rec else kept})"[:800]}


def run(*, kb: KnowledgeBase, task_id: str, scheduler=None, now: datetime | None = None,
        followup: Callable[..., tuple[FollowupRecord, Path]] = run_followup, commit: bool = True,
        invoked_by: str = "manual", client: model_run.ModelClient | None = None) -> dict:
    """What the scheduler invokes. Never raises for a failed run: the failure is the recorded result.

    `invoked_by` is "scheduler" only from tools/task_runner.py (the registered command); then the Scheduler's own
    view of the task (Last Run Time/Result) is stored in run_started, so an automatic run can be told from a manual one.
    """
    if invoked_by not in INVOKERS:
        raise TaskError(f"invoked_by must be one of {sorted(INVOKERS)}")
    now = now or datetime.now(UTC)
    d = _dir(kb, task_id)
    with _state_lock(kb, task_id):
        task = load(kb, task_id)
        if task.status != "active":
            ev = _append(kb, task_id, "run_skipped", now, reason=f"task is {task.status}")
            return {"status": "SKIPPED", **ev}
        if invoked_by == "scheduler" and task.schedule.frequency == "market_hours" and not in_session(task.schedule, now):
            ev = _append(kb, task_id, "run_skipped", now, reason="outside the US session (09:30-16:00 New York, Mon-Fri)")
            return {"status": "SKIPPED", **ev}
    lock = d / "run.lock"
    note = None
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        age = now - datetime.fromtimestamp(lock.stat().st_mtime, UTC)
        if age < timedelta(minutes=LOCK_STALE_MINUTES):
            ev = _event(kb, task_id, "run_skipped", now, reason=f"another run is in progress ({age.seconds}s)")
            return {"status": "SKIPPED", **ev}
        lock.unlink()
        note = f"stale lock of {int(age.total_seconds() // 60)} min broken"
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    try:
        os.write(fd, f"{os.getpid()} {now.isoformat()}".encode())
        os.close(fd)
        seen = None
        if invoked_by == "scheduler" and scheduler is not None:
            q = scheduler.query(task.scheduler_name)     # the Scheduler updates Last Run Time when it launches us
            seen = {k: q.get(k) for k in ("registered", "status", "last_run", "last_result", "next_run", "error")
                    if q.get(k) is not None}
        _event(kb, task_id, "run_started", now, pid=os.getpid(), note=note, invoked_by=invoked_by,
               **({"scheduler_seen": seen} if seen is not None else {}))
        written = [d / "task.json", d / "events.jsonl"]
        if scheduler is not None and task.local_time is not None:
            with _state_lock(kb, task_id):
                task = load(kb, task_id)           # fresh: a chat command may have changed it meanwhile
                local = local_time_for(task.schedule, now) if task.status == "active" else task.local_time
                if local != task.local_time:       # the owner's timezone changed offset against this PC (DST)
                    _scheduler_call(kb, task_id, now, "resync", scheduler.create, task.scheduler_name,
                                    runner_command(Path(task.code_path), task_id), task.schedule, local)
                    task = task.model_copy(update={"local_time": local, "updated_at": now})
                    _save(kb, task)
                    _append(kb, task_id, "local_time_resynced", now, local_time=local)
        try:
            entry = schedulable_entry(task.kind)       # again at every run: the catalog may have changed
        except TaskError as exc:
            ev = _event(kb, task_id, "run_failed", datetime.now(UTC), error=f"not run: {exc}")
            if commit:
                _commit_knowledge(kb, written, f"task {task_id}: run failed")
            return {"status": "FAILED", **ev}
        if entry.schedulable.runs == "model":
            paths: list[Path] = []                 # filled as files are saved: kept even if the run fails later
            try:
                outcome = _run_model(kb=kb, task=task, entry=entry, now=now, invoked_by=invoked_by,
                                     client=client or model_run.ClaudeCodeClient(), followup=followup, written=paths)
            except Exception as exc:  # noqa: BLE001 - an unexpected error is still the run's recorded result
                outcome = {"invoked_by": invoked_by, "result": "FAILED", "max_turns": entry.schedulable.max_turns,
                           "route": entry.schedulable.route_reason(), "error": f"{type(exc).__name__}: {exc}"[:800], "trace": traceback.format_exc()[-800:]}
            latest = d / "LATEST.md"
            _write_latest(latest, task, outcome, now)
            if invoked_by == "scheduler":
                _mark_validity(latest, task, now)
            ev = _event(kb, task_id, "run_failed" if outcome["result"] == "FAILED" else "run_finished",
                        datetime.now(UTC), **outcome)
            written += [latest, *paths]
            summary = outcome.get("research") or outcome.get("followup") or outcome.get("error", "")[:60]
            committed = (_commit_knowledge(kb, written, f"task {task_id}: {outcome['result']} {summary}")
                         if commit else "skipped")
            if committed.startswith("commit failed"):
                _event(kb, task_id, "commit_failed", datetime.now(UTC), error=committed)
            return {"status": outcome["result"], "knowledge": committed, **ev}
        try:
            rec, path = followup(kb=kb, strategy=task.strategy, prompt=task.objective, host=INVOKERS[invoked_by],
                                 task_id=task_id, now=now)
        except Exception as exc:  # noqa: BLE001 - any failure is the run's result, recorded, never silent
            ev = _event(kb, task_id, "run_failed", datetime.now(UTC), error=f"{type(exc).__name__}: {exc}",
                        trace=traceback.format_exc()[-800:])
            if commit:
                _commit_knowledge(kb, written, f"task {task_id}: run failed")
            return {"status": "FAILED", **ev}
        evidence = [kb.base / "evidence" / f"{s.split(':', 1)[1]}.json" for s in rec.sources]
        written += [path, path.parent / "LATEST.md", *evidence]
        if invoked_by == "scheduler":
            _mark_validity(path.parent / "LATEST.md", task, now)
        ev = _event(kb, task_id, "run_finished", datetime.now(UTC), followup=rec.id, result=rec.status,
                    strategy_ref=rec.strategy_ref, spec_hash=rec.spec_hash, attention=rec.attention[:5])
        committed = _commit_knowledge(kb, written, f"task {task_id}: {rec.status} {rec.id}") if commit else "skipped"
        if committed.startswith("commit failed"):
            _event(kb, task_id, "commit_failed", datetime.now(UTC), error=committed)
        return {"status": rec.status, "followup": rec.id, "knowledge": committed, **ev}
    finally:
        lock.unlink(missing_ok=True)
