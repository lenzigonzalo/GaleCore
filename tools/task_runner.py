"""Entry point that the Windows Task Scheduler runs for a recurring task (GC-AI-0009).

    pythonw.exe -B <checkout>\\tools\\task_runner.py <task-id>

The scheduler starts it in C:\\Windows\\system32 with no console, so every path is absolute and nothing is
printed: the result goes to the task's events log and follow-up record in the knowledge base. If even that is
impossible (no knowledge base, broken install), the error is appended to %LOCALAPPDATA%\\GaleCore-AI\\task_runner.log.
"""

import json
import os
import sys
import traceback
from datetime import UTC, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))


def main(argv: list[str]) -> int:
    task_id = argv[0] if argv else ""
    try:
        from galecore_ai.adapters.knowledge_base import knowledge_dir
        from galecore_ai.adapters.record_store import FileRecordStore, default_records_dir
        from galecore_ai.adapters.research_store import FileResearchStore
        from galecore_ai.application.knowledge import KnowledgeBase
        from galecore_ai.application.tasks import WindowsScheduler, run

        base = knowledge_dir()
        kb = KnowledgeBase(base=base, records=FileRecordStore(default_records_dir()), research=FileResearchStore(base))
        result = run(kb=kb, task_id=task_id, scheduler=WindowsScheduler())
        return 0 if result["status"] in ("OK", "DEGRADED", "SKIPPED") else 1
    except Exception:  # noqa: BLE001 - last resort: never fail silently
        log = Path(os.environ.get("LOCALAPPDATA", str(REPO))) / "GaleCore-AI" / "task_runner.log"
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"at": datetime.now(UTC).isoformat(), "task": task_id,
                                 "error": traceback.format_exc()[-1500:]}) + "\n")
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
