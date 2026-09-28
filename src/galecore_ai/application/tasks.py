"""Recurring tasks (GC-AI-0009): create, inspect, change, pause, cancel and run a delegated follow-up.

Execution is the Windows Task Scheduler of the owner's PC (verified 27/09: a task runs as the user, with the
user's environment, even with no Claude session open). It needs the PC on, the user logged on, GaleCore Dev's API
up and its development credentials; when any is missing the run is still recorded, with the error.

Controls: one run at a time per task (exclusive lock file; a stale lock older than LOCK_STALE_MINUTES is broken
and noted), a paused or cancelled task never runs even if the scheduler fires, every change and run is appended
to a hash-chained events log, and the only thing a run can do is the read-only strategy follow-up.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import subprocess
import sys
import time
import traceback
from collections.abc import Callable
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from galecore_ai.application.followup import history as followup_history
from galecore_ai.application.followup import run_followup
from galecore_ai.application.knowledge import KnowledgeBase, KnowledgeError
from galecore_ai.contracts.followup import FollowupRecord
from galecore_ai.contracts.regime_record import RecordHost
from galecore_ai.contracts.task import Schedule, TaskDefinition

LOCK_STALE_MINUTES = 30
STATE_LOCK_TIMEOUT_SECONDS = 15
STATE_LOCK_STALE_SECONDS = 120
SCHEDULER_FOLDER = "GaleCore-AI"
_REPO = Path(__file__).resolve().parents[3]
RUNNER_HOST = RecordHost(provider="windows-task-scheduler", model="deterministic-runner")
# A run started by hand (`task run`) is the same code but must never pass for an automatic one (Codex C4 MAJOR).
MANUAL_HOST = RecordHost(provider="manual-cli", model="deterministic-runner")
INVOKERS = {"scheduler": RUNNER_HOST, "manual": MANUAL_HOST}


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
        elif schedule.frequency == "weekdays":
            sc = ["/sc", "weekly", "/d", "MON,TUE,WED,THU,FRI", "/st", local_time]
        else:
            sc = ["/sc", "daily", "/st", local_time]
        self._run(["/create", "/tn", name, "/tr", tr, *sc, "/f"])

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
    tmp.write_text(json.dumps(task.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
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


def local_time_for(schedule: Schedule, now: datetime) -> str | None:
    """The owner's HH:MM in their timezone, as this PC's local HH:MM for the next occurrence.

    A weekdays schedule whose conversion lands on another local calendar day would need a shifted day set; that is
    not supported, so it is refused instead of firing on the wrong days.
    """
    if schedule.time is None:
        return None
    tz = ZoneInfo(schedule.timezone)
    hh, mm = (int(x) for x in schedule.time.split(":"))
    day = now.astimezone(tz).date()
    target = datetime(day.year, day.month, day.day, hh, mm, tzinfo=tz)
    if target <= now:
        target += timedelta(days=1)
    local = target.astimezone()
    if schedule.frequency == "weekdays" and local.date() != target.date():
        raise TaskError(f"{schedule.time} {schedule.timezone} is another calendar day on this PC "
                        f"({local:%a %H:%M}); a weekdays schedule would fire on the wrong days. Use daily or another time")
    return local.strftime("%H:%M")


def runner_command(code_path: Path, task_id: str) -> list[str]:
    pyw = Path(sys.executable).with_name("pythonw.exe")
    return [str(pyw if pyw.exists() else sys.executable), "-B", str(code_path / "tools" / "task_runner.py"), task_id]


# How long after a due time a run may still be starting or in progress before it counts as missed.
MISSED_GRACE = timedelta(minutes=30)


def _fires_on(schedule: Schedule, day) -> bool:
    return schedule.frequency == "daily" or day.weekday() < 5


def _occurrence(schedule: Schedule, day) -> datetime:
    hh, mm = (int(x) for x in schedule.time.split(":"))
    return datetime(day.year, day.month, day.day, hh, mm, tzinfo=ZoneInfo(schedule.timezone))


def last_due(schedule: Schedule, now: datetime) -> datetime | None:
    """The most recent time the schedule should have fired at or before `now` (UTC); None for every_minutes."""
    if schedule.time is None:
        return None
    day = now.astimezone(ZoneInfo(schedule.timezone)).date()
    for back in range(8):
        d = day - timedelta(days=back)
        if _fires_on(schedule, d) and (at := _occurrence(schedule, d)) <= now:
            return at.astimezone(UTC)
    return None


def next_due(schedule: Schedule, now: datetime) -> datetime | None:
    """The next time the schedule should fire after `now` (UTC)."""
    if schedule.frequency == "every_minutes":
        return (now + timedelta(minutes=schedule.minutes)).astimezone(UTC)
    day = now.astimezone(ZoneInfo(schedule.timezone)).date()
    for ahead in range(8):
        d = day + timedelta(days=ahead)
        if _fires_on(schedule, d) and (at := _occurrence(schedule, d)) > now:
            return at.astimezone(UTC)
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
    return {**out, "state": "CURRENT", "detail": f"result {after[0].get('result')} of {after[0].get('followup')}"}


# ── conversation-facing operations ───────────────────────────────


def create(*, kb: KnowledgeBase, scheduler, task_id: str, strategy: str, objective: str, expected_result: str,
           sources: list[str], schedule: Schedule, prompt: str, code_path: Path | None = None,
           now: datetime | None = None) -> TaskDefinition:
    now = now or datetime.now(UTC)
    if (_dir(kb, task_id) / "task.json").exists():
        raise TaskError(f"task {task_id} already exists (a cancelled task keeps its id and history)")
    if not any(k.split("/")[0] == strategy for k in kb.strategies.versions()):
        raise TaskError(f"no strategy named {strategy} in the knowledge base")
    code_path = code_path or _REPO
    task = TaskDefinition(kind="strategy_followup", id=task_id, objective=objective, strategy=strategy,
                          sources=sources, expected_result=expected_result, schedule=schedule, created_at=now,
                          updated_at=now, created_by_prompt=prompt, scheduler_name=f"{SCHEDULER_FOLDER}\\{task_id}",
                          local_time=local_time_for(schedule, now), code_path=str(code_path))
    scheduler.create(task.scheduler_name, runner_command(code_path, task_id), schedule, task.local_time)
    with _state_lock(kb, task_id):
        _save(kb, task)
        _append(kb, task_id, "created", now, schedule=schedule.model_dump(), local_time=task.local_time, prompt=prompt)
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
        if task.status == "paused":
            _scheduler_call(kb, task_id, now, "keep_paused", scheduler.set_enabled, task.scheduler_name, False)
        task = task.model_copy(update={"code_path": str(code_path), "updated_at": now})
        _save(kb, task)
        _append(kb, task_id, "code_path_changed", now, before=before, after=str(code_path), prompt=prompt)
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
    return [r for r in followup_history(kb, task.strategy) if r.task_id == task.id][:limit]


def status(*, kb: KnowledgeBase, scheduler, task_id: str, now: datetime | None = None) -> dict:
    task = load(kb, task_id)
    log = events(kb, task_id)
    last = runs(kb, task, limit=1)
    problems = [e for e in log if e["event"] in ("run_failed", "run_skipped")][-3:]
    return {
        "freshness": freshness(task, log, now or datetime.now(UTC)),
        "task": task.model_dump(mode="json"), "schedule": task.schedule.describe(),
        "scheduler": scheduler.query(task.scheduler_name) if task.status != "cancelled" else {"registered": False},
        "last_result": last[0].model_dump(mode="json") if last else None,
        "runs": sum(1 for e in log if e["event"] == "run_finished"),
        "recent_problems": problems, "recent_events": log[-5:],
        "latest_readable": str(kb.base / "followups" / task.strategy / "LATEST.md"),
    }


def list_tasks(kb: KnowledgeBase) -> list[dict]:
    base = kb.base / "tasks"
    if not base.is_dir():
        return []
    out = []
    for d in sorted(p for p in base.iterdir() if (p / "task.json").is_file()):
        t = load(kb, d.name)
        out.append({"id": t.id, "status": t.status, "strategy": t.strategy, "schedule": t.schedule.describe(),
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


def run(*, kb: KnowledgeBase, task_id: str, scheduler=None, now: datetime | None = None,
        followup: Callable[..., tuple[FollowupRecord, Path]] = run_followup, commit: bool = True,
        invoked_by: str = "manual") -> dict:
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
