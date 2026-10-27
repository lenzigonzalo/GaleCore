"""Copy the regime records into the knowledge base and prove nothing changed (GC-AI-0005).

    python tools/migrate_regime_to_knowledge.py --source <GaleCore/research/regime> --dest <knowledge/regime>

Byte-for-byte copy, then for every file: same sha256 at source and destination,
the record loads from the destination with no integrity problem, and ``query``
over both directories returns the same records (paths aside). The source is
never modified or deleted: reverting is pointing ``GALECORE_RECORDS_DIR`` back at
it. A destination file that already exists with different bytes stops the run.
Prints a JSON report; exit 1 on any mismatch.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from galecore_ai.adapters.record_store import FileRecordStore, RecordIntegrityError
from galecore_ai.application.record_regime import query_records


def sha256(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def comparable(records: list[dict]) -> list[dict]:
    return [{k: v for k, v in r.items() if k != "path"} for r in records]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--dest", required=True, type=Path)
    args = parser.parse_args()
    source, dest = args.source.resolve(), args.dest.resolve()
    if not source.is_dir():
        print(json.dumps({"error": f"source does not exist: {source}"}))
        return 1

    report: dict = {"source": str(source), "dest": str(dest), "files": [], "problems": []}
    for src in sorted(source.glob("*/*.md")):
        rel = src.relative_to(source)
        dst = dest / rel
        if dst.exists() and dst.read_bytes() != src.read_bytes():
            report["problems"].append(f"{rel}: destination exists with different content; not overwritten")
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        if not dst.exists():
            shutil.copyfile(src, dst)
        item = {"file": rel.as_posix(), "sha256_source": sha256(src), "sha256_dest": sha256(dst)}
        if item["sha256_source"] != item["sha256_dest"]:
            report["problems"].append(f"{rel}: sha256 differs after copy")
        try:
            doc = FileRecordStore(dest).load(rel.parts[0], rel.stem)
            item["entries"] = [e.entry_id for e in doc.entries] if doc else []
        except RecordIntegrityError as exc:
            report["problems"].append(f"{rel}: INTEGRITY_FAILED at destination: {exc.problems}")
        report["files"].append(item)

    since = date(2000, 1, 1)
    for symbol in FileRecordStore(source).symbols():
        before = query_records(store=FileRecordStore(source), symbol=symbol, since=since, until=None)
        after = query_records(store=FileRecordStore(dest), symbol=symbol, since=since, until=None)
        same = comparable(before) == comparable(after)
        report.setdefault("query_equal", {})[symbol] = same
        if not same:
            report["problems"].append(f"{symbol}: query differs between source and destination")

    report["result"] = "OK" if not report["problems"] else "FAILED"
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report["result"] == "OK" else 1


if __name__ == "__main__":
    sys.exit(main())
