"""Run a script of a skill folder (WS-0073): ``skill run <skill> <script> [args]``.

Only files directly inside the skill's ``scripts/`` run, with this interpreter and no shell, the skill folder as cwd
and a time cap. The model gets the JSON result, not the code.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

from galecore_ai.harness.assets import asset_root
from galecore_ai.harness.catalog import load_catalog

DEFAULT_TIMEOUT_S = 60
SCRIPT_SUFFIXES = (".py",)
STDERR_MAX = 2000


class SkillRunError(Exception):
    """The skill or the script cannot be run; the message says why."""


def skill_dir(ref: str) -> Path:
    """Folder of a catalog skill, by capability id or by skill name (hyphens or underscores)."""
    wanted = ref.replace("-", "_")
    for entry in load_catalog().entries:
        if entry.id == wanted or Path(entry.skill).parent.name.replace("-", "_") == wanted:
            return (asset_root() / entry.skill).parent
    raise SkillRunError(f"No skill {ref!r} in the catalog")


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
    out = {"skill": folder.name, "script": script}
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
