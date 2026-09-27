"""Strategy follow-up read from GaleCore and tied to the exact version (GC-AI-0008).

The GaleCore report here is a test fixture produced by a stub command, never market evidence.
"""

from __future__ import annotations

import json
import sys
from datetime import timedelta
from pathlib import Path

import pytest

from galecore_ai.application.followup import history, run_followup
from galecore_ai.application.knowledge import KnowledgeError
from galecore_ai.application.strategy import approve
from tests.unit.test_knowledge import HOST, NOW, kb, save  # noqa: F401  (kb is a fixture)
from tests.unit.test_strategy import (  # noqa: F401  (research_ref is a fixture)
    KEY,
    NAME,
    research_ref,
    stored,
)

OTHER_HASH = "sha256:" + "c" * 64


def report(spec_hash: str, *, mine: bool, positions=(), events=()) -> dict:
    other = {"instanceId": "other-1", "versionHash": OTHER_HASH, "lifecycleState": "RUNNING",
             "schedulerState": "PAUSED", "specName": "shadow_runtime_test_v2"}
    inst = {"instanceId": "mine-1", "versionHash": spec_hash, "lifecycleState": "RUNNING",
            "schedulerState": "IN_SESSION", "specName": NAME}
    instances = [other] + ([inst] if mine else [])
    return {
        "spec_name": NAME, "spec_content_hash": spec_hash,
        "status": {"http": 200, "body": {"persistence": {"available": True, "recoveredAt": "2026-09-23T20:00:00Z"},
                                         "switch": {"enabled": False, "source": "platform"}, "instances": instances}},
        "instances": ([{"instance": inst, "detail": {"http": 200, "body": {"instance": inst, "positions": list(positions)}},
                        "evaluations": {"http": 200, "body": []}, "events": {"http": 200, "body": list(events)}}]
                      if mine else []),
        "metrics": {"http": 200, "body": []},
    }


def stub(tmp_path: Path, payload: dict | None, exit_code: int = 0) -> list[str]:
    script = tmp_path / "stub_report.py"
    body = json.dumps(payload) if payload is not None else ""
    script.write_text(f"import sys\nsys.stdout.write({body!r})\nsys.stderr.write('boom')\nsys.exit({exit_code})\n",
                      encoding="utf-8")
    return [sys.executable, str(script)]


def run(kb, tmp_path, payload, exit_code=0, now=NOW, task=None):  # noqa: F811
    return run_followup(kb=kb, strategy=NAME, prompt="Mostrame mi estrategia", host=HOST, task_id=task,
                        report_command=stub(tmp_path, payload, exit_code), now=now)


def test_unapproved_undeployed_strategy_is_reported_as_such(kb, research_ref, tmp_path):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    rec, path = run(kb, tmp_path, report(doc.spec_hash, mine=False))
    assert rec.strategy_ref == f"strategy:{KEY}" and rec.spec_hash == doc.spec_hash and not rec.approved
    assert rec.status == "DEGRADED"
    assert any("no está aprobada" in a for a in rec.attention)
    assert any("ocupa el único lugar RUNNING" in a for a in rec.attention)
    assert any("no está desplegada" in o for o in rec.operation)
    assert rec.other_versions and "no se mezcla" in rec.other_versions[0]
    assert rec.sources[0].startswith("evidence:") and rec.research_ref == research_ref
    assert any(h.startswith(f"Hipótesis según {research_ref} (revisión 1") for h in rec.hypothesis)
    assert (path.parent / "LATEST.md").read_text(encoding="utf-8").startswith(f"# Seguimiento de {NAME}")


def test_the_report_is_kept_verbatim_as_evidence(kb, research_ref, tmp_path):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    payload = report(doc.spec_hash, mine=False)
    rec, _ = run(kb, tmp_path, payload)
    ev = json.loads((kb.base / "evidence" / f"{rec.sources[0].split(':', 1)[1]}.json").read_text(encoding="utf-8"))
    assert json.loads(ev["content"]["payload"]) == payload
    assert "Captura directa" in ev["content"]["access_notes"][0]


def test_only_the_approved_hash_counts_and_since_last_review(kb, research_ref, tmp_path):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    approve(kb=kb, key=KEY, spec_hash=doc.spec_hash, owner_words="Apruebo", host=HOST, now=NOW)
    first, _ = run(kb, tmp_path, report(doc.spec_hash, mine=True))
    assert first.approved and first.since is None
    later = NOW + timedelta(days=1)
    events = [{"timestamp": (NOW - timedelta(hours=1)).isoformat(), "eventType": "GATES_NOT_PASSED",
               "payload": {"gates": ["vix"]}},
              {"timestamp": (NOW + timedelta(hours=2)).isoformat(), "eventType": "CANDIDATE_NOT_VIABLE",
               "payload": {"reason": "crédito menor al mínimo"}}]
    positions = [{"status": "OPEN", "entryCredit": 0.44, "lastSpreadValue": 0.3, "unrealizedPnl": 14.0,
                  "currentDte": 22, "lastValuedAt": later.isoformat()}]
    second, _ = run(kb, tmp_path, report(doc.spec_hash, mine=True, positions=positions, events=events), now=later)
    assert second.since == first.recorded_at
    assert any("CANDIDATE_NOT_VIABLE 1" in o for o in second.operation)       # only the event after the review
    assert not any("GATES_NOT_PASSED" in o for o in second.operation)
    assert any("crédito menor al mínimo" in s for s in second.shadow)
    assert any("cerca de la salida por tiempo" in a for a in second.attention)
    assert any("0 de 60" in h for h in second.hypothesis)
    assert [r.id for r in history(kb, NAME)] == [second.id, first.id]


def test_galecore_down_is_recorded_as_an_error_not_skipped(kb, research_ref, tmp_path):  # noqa: F811
    stored(kb, research_ref)
    rec, _ = run(kb, tmp_path, None, exit_code=1)
    assert rec.status == "ERROR"
    assert any("no respondió" in a for a in rec.attention)
    assert history(kb, NAME)[0].id == rec.id


def test_a_followup_never_writes_strategy_versions_or_approvals(kb, research_ref, tmp_path):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    before = sorted(p.name for p in (kb.base / "strategies" / NAME).iterdir())
    run(kb, tmp_path, report(doc.spec_hash, mine=False))
    assert sorted(p.name for p in (kb.base / "strategies" / NAME).iterdir()) == before


def test_an_edited_record_is_integrity_failed(kb, research_ref, tmp_path):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    _, path = run(kb, tmp_path, report(doc.spec_hash, mine=False))
    path.write_text(path.read_text(encoding="utf-8").replace("DEGRADED", "OK"), encoding="utf-8")
    with pytest.raises(KnowledgeError, match="INTEGRITY_FAILED"):
        history(kb, NAME)
