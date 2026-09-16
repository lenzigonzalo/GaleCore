from pathlib import Path

from tools.engineering_gate import evaluate_repository


def _write_work_item(root: Path, *, status: str, blocked: bool, checked: bool = False) -> None:
    engineering = root / "docs" / "engineering"
    items = engineering / "work-items"
    items.mkdir(parents=True)
    (engineering / "ACTIVE_WORK_ITEM").write_text("item.md\n", encoding="utf-8")
    mark = "x" if checked else " "
    pending = "" if checked else "PENDING"
    (items / "item.md").write_text(
        f"""---
id: TEST-001
title: Test
status: {status}
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: true
closure_blocked: {str(blocked).lower()}
review_result: {"APPROVED" if checked else "PENDING"}
approval_result: {"APPROVED" if status == "CLOSED" and checked else "PENDING"}
---

## Acceptance criteria

- [{mark}] **AC-01 — Test:** result.

## Evidence

{pending}
""",
        encoding="utf-8",
    )


def test_active_incomplete_item_passes_with_warnings(tmp_path):
    _write_work_item(tmp_path, status="CHANGES_REQUESTED", blocked=True)

    result = evaluate_repository(tmp_path)

    assert result.passed
    assert any("criteria remain open" in warning for warning in result.warnings)
    assert any("feature freeze" in warning for warning in result.warnings)


def test_blocked_item_rejects_phase_closure_claim(tmp_path):
    _write_work_item(tmp_path, status="CHANGES_REQUESTED", blocked=True)
    architecture = tmp_path / "docs" / "architecture"
    architecture.mkdir()
    (architecture / "SESSION_HANDOFF.md").write_text("Phase 3 cerrada", encoding="utf-8")

    result = evaluate_repository(tmp_path)

    assert not result.passed
    assert any("closure claim conflicts" in error for error in result.errors)


def test_validated_item_requires_independent_complete_evidence(tmp_path):
    _write_work_item(tmp_path, status="VALIDATED", blocked=False, checked=True)

    result = evaluate_repository(tmp_path)

    assert result.passed


def test_validated_item_rejects_pending_criteria(tmp_path):
    _write_work_item(tmp_path, status="VALIDATED", blocked=False)

    result = evaluate_repository(tmp_path)

    assert not result.passed
    assert any("all acceptance criteria" in error for error in result.errors)


def test_repository_active_work_item_is_consistent():
    repository_root = Path(__file__).resolve().parents[2]

    result = evaluate_repository(repository_root)

    assert result.passed, "\n".join(result.errors)
