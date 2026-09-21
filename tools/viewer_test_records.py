"""Write clearly identified SYNTHETIC records for inspecting the regime viewer's states.

Usage:
    python -B tools/viewer_test_records.py <empty-or-new-directory>
    GALECORE_RECORDS_DIR=<that directory> python -B -m galecore_ai.adapters.regime_viewer

Writes, under symbol ``TEST`` (never a real symbol), three days built with the test fixtures:
one entry with outcome and review, one entry with both pending, and one file tampered after
writing so ``query`` reports ``INTEGRITY_FAILED``. Every prompt says "SYNTHETIC TEST RECORD".
The target directory must be empty or absent: this tool never writes next to real records.
Dev-only: it reuses the builders of ``tests/unit/regime_support.py`` and so needs the repo checkout.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(REPO / "src"), str(REPO)]

from galecore_ai.adapters.record_store import FileRecordStore
from galecore_ai.adapters.snapshot_store import FileSnapshotStore
from galecore_ai.application.accept_interpretation import accept_interpretation
from galecore_ai.application.prepare_regime import fetch_regime_facts
from galecore_ai.application.record_regime import (
    record_accepted,
    record_outcome,
    record_review,
)
from galecore_ai.contracts.agent_run import RunStatus
from galecore_ai.contracts.prepared_analysis import AcceptanceRequest, seal_snapshot
from galecore_ai.contracts.regime_record import ReviewVerdict
from tests.unit.regime_support import (
    RegimeFakeDispatcher,
    gex_payload,
    put_skew_payload,
    regime_facts,
    regime_snapshot,
    trade_payload,
    valid_regime_interpretation,
)

SYMBOL = "TEST"
PROMPT = "SYNTHETIC TEST RECORD (tools/viewer_test_records.py) — not a real analysis"


def _write_day(records: FileRecordStore, snapshots: FileSnapshotStore, prepared_at: datetime):
    facts = regime_facts(symbol=SYMBOL)
    snapshot = seal_snapshot(regime_snapshot(facts=facts, prepared_at=prepared_at).model_copy(update={"symbol": SYMBOL}))
    snapshots.save(snapshot)
    result = accept_interpretation(
        store=snapshots,
        request=AcceptanceRequest(run_id=snapshot.run_id, interpretation=valid_regime_interpretation(),
                                  host_provider="test-fixture", host_model="none"),
        allow_unknown_freshness=True,
    )
    assert result.status == RunStatus.SUCCESS, result.error_detail
    entry, path = record_accepted(store=records, snapshot=snapshot, result=result, prompt=PROMPT)
    return entry, Path(path)


async def _outcome(records: FileRecordStore, day: str) -> None:
    now = datetime.now(UTC)
    gex = gex_payload(net_gex=-1200.0, spot=759.9, timestamp=now)
    gex["symbol"] = SYMBOL
    skew = put_skew_payload()
    skew["symbol"] = SYMBOL
    dispatcher = RegimeFakeDispatcher(responses={
        ("compute.gex_analysis", SYMBOL): gex,
        ("compute.put_skew", SYMBOL): skew,
        ("market_data.trade", "VIX"): trade_payload("VIX", price=18.2, at=now),
        ("market_data.trade", "VVIX"): trade_payload("VVIX", price=101.0, at=now),
    })
    fetched = await fetch_regime_facts(symbol=SYMBOL, dispatcher=dispatcher, max_staleness_seconds=600)
    record_outcome(store=records, symbol=SYMBOL, day=day, fetched=fetched)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    target = Path(argv[1]).resolve()
    if target.exists() and any(target.iterdir()):
        print(f"Refusing to write: {target} is not empty (this tool never writes next to real records)")
        return 1
    records = FileRecordStore(target)
    snapshots = FileSnapshotStore(base_dir=target / "_synthetic_snapshots")

    base = datetime.now(UTC).replace(hour=21, minute=0, second=0, microsecond=0)
    # Day 1: outcome + review present.
    entry1, _ = _write_day(records, snapshots, base - timedelta(days=3))
    day1 = records.dates(SYMBOL)[0]
    asyncio.run(_outcome(records, day1))
    record_review(store=records, symbol=SYMBOL, day=day1, run_id=entry1.entry_id, verdict=ReviewVerdict.PARTIAL,
                  comment="SYNTHETIC review written by tools/viewer_test_records.py; not an owner verdict.")
    # Day 2: outcome and review pending.
    _write_day(records, snapshots, base - timedelta(days=2))
    # Day 3: tampered after writing -> INTEGRITY_FAILED.
    _, path3 = _write_day(records, snapshots, base - timedelta(days=1))
    text = path3.read_text(encoding="utf-8")
    path3.write_text(text.replace("gamma_regime: negative_gamma", "gamma_regime: positive_gamma"), encoding="utf-8")

    print(f"Synthetic records written under {target / SYMBOL} (symbol {SYMBOL}): {records.dates(SYMBOL)}")
    print(f"Run:  GALECORE_RECORDS_DIR={target}  python -B -m galecore_ai.adapters.regime_viewer")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
