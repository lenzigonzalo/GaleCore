"""Run a script of a skill folder (WS-0073): ``skill run <skill> <script> [args]``.

Only files directly inside the skill's ``scripts/`` run, with this interpreter and no shell, the skill folder as cwd
and a time cap. The model gets the JSON result, not the code.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from galecore_ai.harness.assets import asset_root
from galecore_ai.harness.catalog import load_catalog

DEFAULT_TIMEOUT_S = 180
SCRIPT_SUFFIXES = (".py",)
STDERR_MAX = 2000
RUNS_FILE = "skill_runs.jsonl"   # in the knowledge base: one line per `skill run` (WS-0073)
RUN_DIR_ENV = "GALECORE_AI_RUN_DIR"   # set by a scheduled run (model_run.py); its parent folder is the task id
ERROR_MAX = 300


class SkillRunError(Exception):
    """The skill or the script cannot be run; the message says why."""


class SkillNotInCatalog(SkillRunError):
    """The skill is not in the catalog (it may be one saved in the trader's space)."""


def find_skill_dir(ref: str) -> Path | None:
    """Folder of a catalog skill, by capability id or by skill name (hyphens or underscores); None if not there."""
    wanted = ref.replace("-", "_")
    for entry in load_catalog().entries:
        if entry.id == wanted or Path(entry.skill).parent.name.replace("-", "_") == wanted:
            return (asset_root() / entry.skill).parent
    return None


def skill_dir(ref: str) -> Path:
    """Folder of a catalog skill, by capability id or by skill name (hyphens or underscores)."""
    found = find_skill_dir(ref)
    if found is None:
        raise SkillNotInCatalog(f"No skill {ref!r} in the catalog")
    return found


def script_path(folder: Path, script: str) -> Path:
    """The script as a file directly inside ``<folder>/scripts``; anything else is refused."""
    if not script or Path(script).name != script or "\\" in script or script in (".", ".."):
        raise SkillRunError(f"{script!r}: a script is a file name inside scripts/ (no paths)")
    if not script.endswith(SCRIPT_SUFFIXES):
        raise SkillRunError(f"{script!r}: only {', '.join(SCRIPT_SUFFIXES)} scripts run")
    scripts = (folder / "scripts").resolve()
    path = scripts / script
    if not path.is_file():
        raise SkillRunError(f"{script!r}: not found in scripts/ of the skill")
    if path.resolve().parent != scripts:   # a symlink leaving scripts/
        raise SkillRunError(f"{script!r}: resolves outside scripts/")
    return path.resolve()


def run_script(folder: Path, script: str, args: list[str], timeout_s: float = DEFAULT_TIMEOUT_S) -> dict:
    """Run it and report: ``ok`` is exit code 0 within the time cap; stdout JSON is parsed into ``result``."""
    path = script_path(folder, script)
    out = {"skill": folder.name, "script": script, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    started = time.monotonic()
    try:
        proc = subprocess.run([sys.executable, "-B", str(path), *args], cwd=folder, capture_output=True,
                              text=True, encoding="utf-8", errors="replace", timeout=timeout_s, check=False,
                              env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    except subprocess.TimeoutExpired:
        return {"ok": False, **out, "exit_code": None, "error": f"timeout after {timeout_s:g}s",
                "duration_ms": round((time.monotonic() - started) * 1000)}
    result = {"ok": proc.returncode == 0, **out, "exit_code": proc.returncode, "stdout": proc.stdout,
              "stderr": proc.stderr[-STDERR_MAX:], "duration_ms": round((time.monotonic() - started) * 1000)}
    try:
        result["result"] = json.loads(proc.stdout)
    except ValueError:
        pass
    return result


def who() -> str:
    """``agent:<task id>`` inside a scheduled run (its scratch folder is ``.../runs/<task id>/<stamp>``), else ``chat``."""
    run_dir = os.environ.get(RUN_DIR_ENV)
    return f"agent:{Path(run_dir).parent.name}" if run_dir else "chat"


def record_run(base: Path, result: dict, args: list[str], by: str | None = None) -> dict:
    """Append one line to ``<base>/skill_runs.jsonl``: skill, script, sha256 of the file, args, ok, exit_code,
    duration_ms, a trimmed error, who ran it and when. A refused run (no sha256) is recorded too."""
    error = result.get("error") or ("" if result.get("ok") else (result.get("stderr") or "").strip())
    row = {"at": datetime.now(UTC).isoformat(), "by": by or who(), "skill": result.get("skill"),
           "script": result.get("script"), "sha256": result.get("sha256"), "args": args, "ok": bool(result.get("ok")),
           "exit_code": result.get("exit_code"), "duration_ms": result.get("duration_ms"),
           "source": result.get("source"), "version": result.get("version"), "error": error[-ERROR_MAX:] or None}
    base.mkdir(parents=True, exist_ok=True)
    with (base / RUNS_FILE).open("a", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    return row


def last_runs(base: Path, by: str) -> dict[str, dict]:
    """The latest recorded run of each script by ``by`` (``chat`` or ``agent:<id>``), newest wins."""
    path = base / RUNS_FILE
    out: dict[str, dict] = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if row.get("by") == by:
                out[f"{row.get('skill')}/{row.get('script')}"] = row
    return out
