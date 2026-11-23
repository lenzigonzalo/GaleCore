r"""Entry point of the VPS supervisor — the Linux equivalent of space_sync.py (WS-0093).

    /srv/galecore/ai/venv/bin/python -B /srv/galecore/ai/galecore-ai/tools/vps_supervisor.py

Runs as a systemd oneshot (galecore-supervisor@<user>.timer, every 5 min). Does the same as the
Windows ``espacio-agentes`` task without the Windows bits (winreg, %LOCALAPPDATA%, schtasks):

1. Builds a KnowledgeBase from $GALECORE_KNOWLEDGE_DIR (per-user on the VPS).
2. Calls supervisor.scan() — reads SHADOW positions from the local API, applies rules, writes alerts.
3. Calls publish_agents() — publishes the supervisor state to the Space (the monitor polls it).
4. Applies responses the trader made in the monitor (apply_requests inside publish_agents).

Errors go to stderr (journald captures them via the systemd unit).
"""

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))

from galecore_ai.adapters.galecore_space import SpaceClient
from galecore_ai.adapters.knowledge_base import knowledge_dir
from galecore_ai.adapters.record_store import FileRecordStore, default_records_dir
from galecore_ai.adapters.research_store import FileResearchStore
from galecore_ai.application.knowledge import KnowledgeBase
from galecore_ai.application.space import publish_agents
from galecore_ai.application.supervisor import api_reader
from galecore_ai.application.tasks import VpsScheduler


def main() -> int:
    base = knowledge_dir()
    kb = KnowledgeBase(
        base=base,
        records=FileRecordStore(default_records_dir()),
        research=FileResearchStore(base),
    )
    publish_agents(SpaceClient(), kb, VpsScheduler(), supervise=api_reader(), side="vps")
    return 0


if __name__ == "__main__":
    sys.exit(main())
