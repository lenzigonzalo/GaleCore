"""Commitea en el git de knowledge/ lo que cambió en el turno. Lo corre el Lab al terminar cada turno, para cualquier
motor (D-0014). Después lo sube a su remoto `origin` si tiene uno: el respaldo privado de quien usa esta PC
(owner 26/10: «si pierdo la compu pierdo todo»). Sin remoto o sin conexión, queda local hasta el próximo turno."""
import datetime
import os
import subprocess
import sys

KB = os.environ.get("GALECORE_KNOWLEDGE_DIR") or os.path.join(os.path.expanduser("~"), "GaleCore-datos", "knowledge")


def git(*args):
    return subprocess.run(["git", "-C", KB, *args], capture_output=True, text=True, encoding="utf-8", errors="replace")


def main():
    if git("rev-parse", "--is-inside-work-tree").returncode != 0:
        return
    if git("status", "--porcelain").stdout.strip():
        project = os.path.basename(os.getcwd().rstrip("\/")) or "knowledge"
        git("add", "-A")
        result = git("commit", "-m", f"lab({project}): {datetime.date.today().isoformat()}")
        if result.returncode != 0:
            print(result.stdout + result.stderr, file=sys.stderr)
    if git("remote", "get-url", "origin").returncode == 0:
        try:
            pushed = subprocess.run(["git", "-C", KB, "push", "-q", "origin", "main"], capture_output=True, text=True,
                                    encoding="utf-8", errors="replace", timeout=50)
            if pushed.returncode != 0:
                print(pushed.stderr, file=sys.stderr)
        except subprocess.TimeoutExpired:
            print("respaldo de knowledge/: el envío tardó más de 50 s; sigue en el próximo turno", file=sys.stderr)


main()
