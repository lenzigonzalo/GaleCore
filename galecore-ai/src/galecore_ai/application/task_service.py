"""The VPS runner of recurring tasks (WS-0079): one per Linux user, over that user's knowledge base.

Every minute `tick` looks at the active tasks with `runs_on="vps"`, finds the schedule slot each one owes and runs it
through `tasks.run(invoked_by="vps", slot=...)`, one at a time. The slot (the due time, ISO) is written in the
run_started/run_skipped event, so a slot already served is never run twice. There is no second scheduler: the due
times are `tasks.last_due` and the period of `every_minutes`.

The VPS has little memory, so the runs of all the users share a few places (`GALECORE_TASKS_MAX_PARALLEL`, default 1):
each is a file created with O_EXCL in `GALECORE_TASKS_SLOTS_DIR`, broken when older than LOCK_STALE_MINUTES like
run.lock. A slot that waited VPS_BUSY_MINUTES for a place is not run late: it is recorded as «VPS ocupado». If the
runner itself was down nothing is recorded: `tasks.freshness` says MISSED.
"""

from __future__ import annotations

import os
import tempfile
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

from galecore_ai.application import tasks as t
from galecore_ai.application.knowledge import KnowledgeBase

MAX_PARALLEL_ENV = "GALECORE_TASKS_MAX_PARALLEL"
SLOTS_DIR_ENV = "GALECORE_TASKS_SLOTS_DIR"
TICK_SECONDS = 60


def slots_dir() -> Path:
    return Path(os.environ.get(SLOTS_DIR_ENV) or Path(tempfile.gettempdir()) / "galecore-tasks-slots")


def max_parallel() -> int:
    try:
        return max(1, int(os.environ.get(MAX_PARALLEL_ENV, "1")))
    except ValueError:
        return 1


def acquire_place(directory: Path, places: int, now: datetime) -> Path | None:
    """One of the `places` shared by every user's runner, or None when all are taken (a stale one is broken)."""
    directory.mkdir(parents=True, exist_ok=True)
    for n in range(places):
        path = directory / f"place-{n}.lock"
        for _ in range(2):
            try:
                os.close(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
                return path
            except FileExistsError:
                try:
                    age = now - datetime.fromtimestamp(path.stat().st_mtime, UTC)
                except FileNotFoundError:      # released between the two calls: try again
                    continue
                if age < timedelta(minutes=t.LOCK_STALE_MINUTES):
                    break
                path.unlink(missing_ok=True)   # its run died holding it
    return None


def _anchor(task: t.TaskDefinition, log: list[dict]) -> datetime:
    """When the schedule was last set (created, resumed, changed, moved): earlier due times are not owed."""
    return max((datetime.fromisoformat(e["at"]) for e in log
                if e["event"] in ("created", "resumed", "frequency_changed", "moved")), default=task.created_at)


def pending_slot(task: t.TaskDefinition, log: list[dict], now: datetime) -> datetime | None:
    """The due time this task owes and nobody served yet (a run started or skipped for it), or None."""
    since = _anchor(task, log)
    served = {e["slot"] for e in log if e["event"] in ("run_started", "run_skipped") and e.get("slot")}
    if task.schedule.frequency == "every_minutes":
        period = timedelta(minutes=task.schedule.minutes)
        last = max([since, *(datetime.fromisoformat(s) for s in served)])
        if now < last + period:
            return None
        return last + ((now - last) // period) * period    # the newest period boundary: a long outage is not replayed
    due = t.last_due(task.schedule, now)
    if due is None or due < since or due.isoformat() in served:
        return None
    return due


def _wait_marker(kb: KnowledgeBase, task_id: str) -> Path:
    return t._dir(kb, task_id) / "slot-wait.txt"


def tick(kb: KnowledgeBase, now: datetime | None = None, *, directory: Path | None = None, places: int | None = None,
         runner: Callable[..., dict] = t.run) -> list[dict]:
    """One pass: runs what is owed, one task at a time, and records what could not wait. Returns what it did."""
    now = now or datetime.now(UTC)
    directory = directory or slots_dir()
    places = places or max_parallel()
    base = kb.base / "tasks"
    ids = sorted(p.name for p in base.iterdir() if (p / "task.json").is_file()) if base.is_dir() else []
    owed = []
    for task_id in ids:
        task = t.load(kb, task_id)
        if task.runs_on != "vps" or task.status != "active":
            continue
        slot = pending_slot(task, t.events(kb, task_id), now)
        if slot is not None:
            owed.append((slot, task_id))
    done = []
    for slot, task_id in sorted(owed):
        iso = slot.isoformat()
        marker = _wait_marker(kb, task_id)
        if now - slot > timedelta(minutes=t.VPS_BUSY_MINUTES):
            if marker.is_file() and marker.read_text(encoding="utf-8") == iso:    # it did wait for a place
                marker.unlink(missing_ok=True)
                ev = t._event(kb, task_id, "run_skipped", now, reason=t.REASON_TEXT["vps_busy"], reason_code="vps_busy",
                              slot=iso)
                done.append({"task": task_id, "slot": iso, "status": "SKIPPED", "reason_code": "vps_busy", **ev})
            continue                                                               # else the runner was down: MISSED
        place = acquire_place(directory, places, now)
        if place is None:
            marker.write_text(iso, encoding="utf-8")
            continue
        try:
            marker.unlink(missing_ok=True)
            result = runner(kb=kb, task_id=task_id, now=now, invoked_by="vps", slot=iso)
        finally:
            place.unlink(missing_ok=True)
        done.append({"task": task_id, "slot": iso, "status": result["status"]})
    return done


def serve(kb: KnowledgeBase, *, once: bool = False, interval: int = TICK_SECONDS) -> list[dict]:
    """The runner's loop: `tick` every minute until stopped (or once). A failing pass is reported and the loop goes on."""
    out: list[dict] = []
    while True:
        try:
            out += tick(kb)
        except Exception as exc:  # noqa: BLE001 - one bad task must not stop every other one
            out.append({"status": "ERROR", "error": f"{type(exc).__name__}: {exc}"[:300]})
        if once:
            return out
        time.sleep(interval)
