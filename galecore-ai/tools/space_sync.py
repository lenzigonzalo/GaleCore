r"""Entry point of the `GaleCore-AI\espacio-agentes` Windows task (GC-AI-0023), every few minutes.

    pythonw.exe -B <checkout>\tools\space_sync.py

Applies the on/off requests the trader made in the monitor's Agentes screen and publishes each agent's state, last
run and findings to their space in GaleCore. It also runs the supervisor of SHADOW (WS-0007): records the answers the
trader gave to its alerts in the monitor, checks the open positions against the existing rules and publishes the alerts. Nothing is printed (no console): a failure (GaleCore down, no login)
is appended to %LOCALAPPDATA%\GaleCore-AI\space_sync.log and the next run tries again.
"""

import json
import logging
import os
import sys
import traceback
from datetime import UTC, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))


def _user_env(name: str) -> str | None:
    """Windows user variable (registry), like start-lab.ps1 reads them; None elsewhere or if unset."""
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
            return winreg.QueryValueEx(key, name)[0] or None
    except (ImportError, OSError):
        return None


def apply_lab_connection(env: dict | None = None, user_env=_user_env) -> bool:
    """BF-0004: same connection as the production Lab (start-lab.ps1): GALECORE_LAB_* overrides GALECORE_*.

    Only when GALECORE_LAB_BASE_URL is defined (process or user variable). Dev credentials are never mixed with
    the production URL: the Dev key/login are dropped if the LAB ones do not replace them.
    """
    env = os.environ if env is None else env

    def lab(name: str) -> str | None:
        return env.get(f"GALECORE_LAB_{name}") or user_env(f"GALECORE_LAB_{name}")

    url = lab("BASE_URL")
    if not url:
        return False
    for name in ("API_KEY", "USERNAME", "PASSWORD"):
        env.pop(f"GALECORE_{name}", None)
        if value := lab(name):
            env[f"GALECORE_{name}"] = value
    env["GALECORE_BASE_URL"] = url
    env["GALECORE_ALLOWED_BASE_URL"] = url
    return True


def main() -> int:
    try:
        apply_lab_connection()
        from galecore_ai.adapters.galecore_space import SpaceClient
        from galecore_ai.adapters.knowledge_base import knowledge_dir
        from galecore_ai.adapters.record_store import FileRecordStore, default_records_dir
        from galecore_ai.adapters.research_store import FileResearchStore
        from galecore_ai.application.knowledge import KnowledgeBase
        from galecore_ai.application.space import publish_agents
        from galecore_ai.application.supervisor import api_reader
        from galecore_ai.application.tasks import WindowsScheduler

        logdir = Path(os.environ.get("LOCALAPPDATA", str(REPO))) / "GaleCore-AI"
        logdir.mkdir(parents=True, exist_ok=True)
        handler = logging.FileHandler(logdir / "space_sync.log", encoding="utf-8")
        logging.getLogger("galecore_ai.application.space").addHandler(handler)
        base = knowledge_dir()
        kb = KnowledgeBase(base=base, records=FileRecordStore(default_records_dir()), research=FileResearchStore(base))
        publish_agents(SpaceClient(), kb, WindowsScheduler(), supervise=api_reader())
        return 0
    except Exception:  # noqa: BLE001 - last resort: never fail silently
        log = Path(os.environ.get("LOCALAPPDATA", str(REPO))) / "GaleCore-AI" / "space_sync.log"
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"at": datetime.now(UTC).isoformat(), "error": traceback.format_exc()[-1500:]}) + "\n")
        return 2


if __name__ == "__main__":
    sys.exit(main())
