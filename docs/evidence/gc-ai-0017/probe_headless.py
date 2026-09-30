"""AC-01 (GC-AI-0017): can the Windows Task Scheduler run Claude Code without an interactive session?

Runs `claude -p` once with read-only tools limited to one CLI command, a turn cap and a JSON schema, and appends
what happened (exit code, duration, whether the output validates) to probe_runs.jsonl next to this file. No
secrets are written: only the structured result and the CLI's own metadata fields listed below.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
OUT = HERE / "probe_runs.jsonl"
SCHEMA = {
    "type": "object",
    "properties": {"capability_count": {"type": "integer"}, "first_capability": {"type": "string"}},
    "required": ["capability_count", "first_capability"],
    "additionalProperties": False,
}
PROMPT = ("Corré exactamente `python -B -m galecore_ai.adapters.cli catalog` y respondé cuántas capacidades lista "
          "y el id de la primera. No hagas nada más.")
KEEP = ("type", "subtype", "is_error", "num_turns", "duration_ms", "total_cost_usd", "structured_output", "result")


def main() -> int:
    claude = os.environ.get("CLAUDE_BIN") or shutil.which("claude") or shutil.which("claude.cmd")
    record: dict = {"at": datetime.now(UTC).isoformat(), "invoked_by": sys.argv[1] if len(sys.argv) > 1 else "manual",
                    "claude_bin": claude}
    if not claude:
        record["outcome"] = "FAILED: claude not found on PATH"
    else:
        cmd = [claude, "-p", PROMPT, "--output-format", "json", "--max-turns", "8", "--no-session-persistence",
               "--allowedTools", "Bash(python -B -m galecore_ai.adapters.cli catalog)",
               "--json-schema", json.dumps(SCHEMA)]
        env = {**os.environ, "PYTHONPATH": str(REPO / "src")}
        t0 = time.monotonic()
        try:
            proc = subprocess.run(cmd, cwd=REPO, env=env, capture_output=True, text=True, encoding="utf-8",
                                  timeout=600, check=False)
            record["exit_code"] = proc.returncode
            record["stderr_tail"] = proc.stderr[-500:]
            try:
                out = json.loads(proc.stdout)
                record["cli"] = {k: out.get(k) for k in KEEP if k in out}
                so = out.get("structured_output")
                ok = isinstance(so, dict) and isinstance(so.get("capability_count"), int)
                record["outcome"] = "OK" if proc.returncode == 0 and ok and not out.get("is_error") else "FAILED: output"
            except json.JSONDecodeError:
                record["stdout_tail"] = proc.stdout[-500:]
                record["outcome"] = "FAILED: stdout is not JSON"
        except subprocess.TimeoutExpired:
            record["outcome"] = "FAILED: timeout 600 s"
        record["wall_seconds"] = round(time.monotonic() - t0, 1)
    with OUT.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return 0 if record["outcome"] == "OK" else 1


if __name__ == "__main__":
    sys.exit(main())
