r"""Entry point of the `GaleCore-AI\espacio-agentes` Windows task (GC-AI-0023), every few minutes.

    pythonw.exe -B <checkout>\tools\space_sync.py

Applies the on/off requests the trader made in the monitor's Agentes screen and publishes each agent's state, last
run and findings to their space in GaleCore. Nothing is printed (no console): a failure (GaleCore down, no login)
is appended to %LOCALAPPDATA%\GaleCore-AI\space_sync.log and the next run tries again.
"""

import json
import os
import sys
import traceback
from datetime import UTC, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))


def main() -> int:
    try:
        from galecore_ai.adapters.galecore_space import SpaceClient
        from galecore_ai.adapters.knowledge_base import knowledge_dir
        from galecore_ai.adapters.record_store import FileRecordStore, default_records_dir
        from galecore_ai.adapters.research_store import FileResearchStore
        from galecore_ai.application.knowledge import KnowledgeBase
        from galecore_ai.application.space import publish_agents
        from galecore_ai.application.tasks import WindowsScheduler

        base = knowledge_dir()
        kb = KnowledgeBase(base=base, records=FileRecordStore(default_records_dir()), research=FileResearchStore(base))
        publish_agents(SpaceClient(), kb, WindowsScheduler())
        return 0
    except Exception:  # noqa: BLE001 - last resort: never fail silently
        log = Path(os.environ.get("LOCALAPPDATA", str(REPO))) / "GaleCore-AI" / "space_sync.log"
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"at": datetime.now(UTC).isoformat(), "error": traceback.format_exc()[-1500:]}) + "\n")
        return 2


if __name__ == "__main__":
    sys.exit(main())
