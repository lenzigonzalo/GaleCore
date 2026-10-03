"""GC-AI-0018 AC-03: the session-start hook says how many ideas wait, and never breaks the session start.

Runs the workspace hook (`.claude/hooks/session_start.py`) against a temporary knowledge base with one pending idea,
one reviewed idea, a corrupt file and a valid JSON that is not an object (the case the internal review found
crashing it). Checks the exit code and the output, and appends the result to hook_check_runs.jsonl.

    python docs/evidence/gc-ai-0018/hook_check.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
# The workspace is the first ancestor with the hook (a worktree today, GaleCore-AI/ after the merge).
WORKSPACE = next(p for p in HERE.parents if (p / ".claude" / "hooks" / "session_start.py").is_file())
HOOK = WORKSPACE / ".claude" / "hooks" / "session_start.py"


def main() -> int:
    inbox = Path(tempfile.mkdtemp(prefix="gc18-hook-")) / "knowledge" / "inbox"
    inbox.mkdir(parents=True)
    (inbox / "2026-09-30-probar-avisos.json").write_text(json.dumps(
        {"recorded_at": "2026-09-30T22:00:00Z", "words": "Probar el supervisor con avisos", "resolutions": []}),
        encoding="utf-8")
    (inbox / "2026-09-30-ya-revisada.json").write_text(json.dumps(
        {"recorded_at": "2026-09-30T21:00:00Z", "words": "Ya revisada", "resolutions": [{"to": "discarded"}]}),
        encoding="utf-8")
    (inbox / "2026-09-30-rota.json").write_text("{bad", encoding="utf-8")
    (inbox / "2026-09-30-lista.json").write_text("[]", encoding="utf-8")
    (inbox / "2026-09-30-varias-lineas.json").write_text(json.dumps(
        {"recorded_at": "2026-09-30T23:00:00Z", "words": "una idea\nen dos líneas", "resolutions": []}),
        encoding="utf-8")
    env = {**os.environ, "GALECORE_KNOWLEDGE_DIR": str(inbox.parent)}
    proc = subprocess.run([sys.executable, str(HOOK)], cwd=WORKSPACE, env=env, capture_output=True, text=True,
                          encoding="utf-8", check=False)
    out = proc.stdout
    checks = {
        "exit_code_0": proc.returncode == 0,
        "one_line_per_idea": "una idea en dos líneas" in out,
        "counts_2_pending": "[buzón] 2 idea(s)" in out and "2 archivo(s) ilegible(s)" in out,
        "reviewed_not_listed": "Ya revisada" not in out,
        "unreadable_named": "2026-09-30-lista.json" in out and "2026-09-30-rota.json" in out,
        "active_item_still_shown": "[active work item]" in out or "NO ACTIVE WORK ITEM" in out,
    }
    record = {"at": datetime.now(UTC).isoformat(), "hook": str(HOOK), "checks": checks,
              "stdout_head": out.splitlines()[:6], "stderr_tail": proc.stderr[-300:]}
    with (HERE / "hook_check_runs.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(json.dumps(record, ensure_ascii=False, indent=1))
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
