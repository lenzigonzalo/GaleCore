from pathlib import Path

import pytest

from tools.engineering_gate import evaluate_repository


@pytest.fixture(autouse=True)
def _no_session_item(request, monkeypatch):
    """Tests on a temporary workspace ignore this session's item; the repository check keeps it."""
    if "tmp_path" in request.fixturenames:
        monkeypatch.delenv("GALECORE_WORK_ITEM", raising=False)


def _write_work_item(
    root: Path, *, status: str, blocked: bool, checked: bool = False, title: str = "Test"
) -> None:
    engineering = root / "docs" / "engineering"
    items = engineering / "work-items"
    items.mkdir(parents=True)
    (root / "ACTIVE_WORK_ITEM").write_text("docs/engineering/work-items/item.md\n", encoding="utf-8")
    mark = "x" if checked else " "
    pending = "" if checked else "PENDING"
    (items / "item.md").write_text(
        f"""---
id: TEST-001
title: {title}
status: {status}
implementer: claude-code
reviewer: codex
approver: user
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
    assert not any("feature freeze" in warning for warning in result.warnings)   # retired rule


def test_blocked_item_rejects_phase_closure_claim(tmp_path):
    _write_work_item(tmp_path, status="CHANGES_REQUESTED", blocked=True)
    architecture = tmp_path / "docs" / "architecture"
    architecture.mkdir()
    (architecture / "GaleCore-AI-arquitectura-v5.md").write_text("Phase 3 cerrada", encoding="utf-8")

    result = evaluate_repository(tmp_path)

    assert not result.passed
    assert any("closure claim conflicts" in error for error in result.errors)


def test_blocked_item_ignores_closure_claim_of_an_earlier_phase(tmp_path):
    _write_work_item(tmp_path, status="IN_PROGRESS", blocked=True, title="Phase 4 — harness")
    architecture = tmp_path / "docs" / "architecture"
    architecture.mkdir()
    (architecture / "GaleCore-AI-arquitectura-v5.md").write_text(
        "Phase 3 cerrada. Phase 4 en curso.", encoding="utf-8"
    )

    result = evaluate_repository(tmp_path)

    assert result.passed, "\n".join(result.errors)


def test_blocked_item_rejects_closure_claim_of_its_own_phase(tmp_path):
    _write_work_item(tmp_path, status="IN_PROGRESS", blocked=True, title="Phase 4 — harness")
    architecture = tmp_path / "docs" / "architecture"
    architecture.mkdir()
    (architecture / "GaleCore-AI-arquitectura-v5.md").write_text("Phase 4 closed", encoding="utf-8")

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


def test_an_item_without_que_y_para_que_warns_and_one_with_it_does_not(tmp_path):
    _write_work_item(tmp_path, status="IN_PROGRESS", blocked=True)
    result = evaluate_repository(tmp_path)
    assert result.passed and any("Qué y para qué" in w for w in result.warnings)

    item = tmp_path / "docs" / "engineering" / "work-items" / "item.md"
    item.write_text(item.read_text(encoding="utf-8").replace(
        "## Acceptance criteria", "## Qué y para qué\n\n- Qué: x.\n\n## Acceptance criteria"), encoding="utf-8")
    assert not any("Qué y para qué" in w for w in evaluate_repository(tmp_path).warnings)


def test_the_active_item_is_the_workspace_pointer_seen_from_a_worktree(tmp_path):
    """WS-0018: a single pointer, at the workspace root; a checkout under .worktrees/ finds it too."""
    _write_work_item(tmp_path, status="IN_PROGRESS", blocked=True)
    checkout = tmp_path / ".worktrees" / "galecore-ai" / "X"
    checkout.mkdir(parents=True)
    result = evaluate_repository(checkout)
    assert result.passed and result.metadata["id"] == "TEST-001"

    (tmp_path / "ACTIVE_WORK_ITEM").unlink()
    assert any("ACTIVE_WORK_ITEM" in e for e in evaluate_repository(checkout).errors)


def test_a_session_item_set_by_the_environment_wins_over_the_pointer(tmp_path, monkeypatch):
    """Parallel sessions (owner 15/10): GALECORE_WORK_ITEM names this session's item, as the workspace hooks do."""
    _write_work_item(tmp_path, status="IN_PROGRESS", blocked=True)
    (tmp_path / "ACTIVE_WORK_ITEM").write_text("docs/engineering/work-items/otro.md", encoding="utf-8")
    assert not evaluate_repository(tmp_path).passed
    monkeypatch.setenv("GALECORE_WORK_ITEM", "docs/engineering/work-items/item.md")
    assert evaluate_repository(tmp_path).passed
