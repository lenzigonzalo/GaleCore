"""Commitea en el git de knowledge/ lo que cambió en el turno. Lo corre el Lab al terminar cada turno, para cualquier
motor (D-0014). Local; nunca push."""
import datetime
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
KB = os.environ.get("GALECORE_KNOWLEDGE_DIR") or os.path.join(ROOT, "knowledge")


def git(*args):
    return subprocess.run(["git", "-C", KB, *args], capture_output=True, text=True, encoding="utf-8", errors="replace")


def main():
    if git("rev-parse", "--is-inside-work-tree").returncode != 0:
        return
    status = git("status", "--porcelain").stdout.strip()
    if not status:
        return
    project = os.path.basename(os.getcwd().rstrip("\/")) or "knowledge"
    git("add", "-A")
    message = f"lab({project}): {datetime.date.today().isoformat()}"
    result = git("commit", "-m", message)
    if result.returncode != 0:
        print(result.stdout + result.stderr, file=sys.stderr)


main()
