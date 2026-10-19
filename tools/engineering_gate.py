"""Validate the active engineering work item and closure claims.

The active item is the one in the workspace `ACTIVE_WORK_ITEM` (the first ancestor of this checkout that has one:
the main checkout and its worktrees under `.worktrees/` share it). It is the only pointer (WS-0018).
"""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

ACTIVE_STATES = {
    "DRAFT",
    "APPROVED",
    "IN_PROGRESS",
    "READY_FOR_REVIEW",
    "CHANGES_REQUESTED",
    "BLOCKED",
}
FINAL_STATES = {"VALIDATED", "CLOSED"}
ALL_STATES = ACTIVE_STATES | FINAL_STATES
CANONICAL_STATUS_DOCS = ("docs/architecture/GaleCore-AI-arquitectura-v5.md",)  # the rest went to docs/archive/ (F0-1)
PHASE_IN_TITLE = re.compile(r"phase\s+(\d+)", re.IGNORECASE)


def _closure_claim(title: str) -> re.Pattern[str]:
    """Closure-claim pattern for the phase named in the active item's title.

    A closed earlier phase (e.g. "Phase 3 cerrada" once GC-AI-0001 is CLOSED) is a legitimate
    statement; only claims about the phase the active item is still working on conflict with
    ``closure_blocked``. A title without a phase number keeps matching any phase.
    """
    match = PHASE_IN_TITLE.search(title)
    phase = re.escape(match.group(1)) if match else r"\d+"
    return re.compile(rf"phase\s+{phase}\s+(?:cerrada|closed)", re.IGNORECASE)


@dataclass
class GateResult:
    work_item: Path | None = None
    metadata: dict[str, str] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.errors


def _parse_front_matter(text: str) -> tuple[dict[str, str], str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError("work item must start with YAML-style front matter")
    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise ValueError("work item front matter is not closed") from exc

    metadata: dict[str, str] = {}
    for line in lines[1:end]:
        if not line.strip():
            continue
        if ":" not in line:
            raise ValueError(f"invalid front matter line: {line}")
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip()
    return metadata, "\n".join(lines[end + 1 :])


def _is_true(value: str | None) -> bool:
    return (value or "").lower() == "true"


def evaluate_repository(root: Path) -> GateResult:
    result = GateResult()
    pointer = next((d / "ACTIVE_WORK_ITEM" for d in (root, *root.parents) if (d / "ACTIVE_WORK_ITEM").is_file()), None)
    if pointer is None:
        result.errors.append("missing the workspace ACTIVE_WORK_ITEM")
        return result

    # `GALECORE_WORK_ITEM` fixes the item of one session (parallel sessions, owner 15/10), as the workspace hooks do.
    raw = os.environ.get("GALECORE_WORK_ITEM", "").strip() or pointer.read_text(encoding="utf-8").strip()
    if not raw or len(raw.splitlines()) != 1:
        result.errors.append("ACTIVE_WORK_ITEM must contain one path")
        return result

    work_item = pointer.parent / raw
    result.work_item = work_item
    if not work_item.is_file():
        result.errors.append(f"active work item does not exist: {work_item}")
        return result

    try:
        metadata, body = _parse_front_matter(work_item.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as exc:
        result.errors.append(str(exc))
        return result
    result.metadata = metadata

    required = {
        "id",
        "status",
        "implementer",
        "reviewer",
        "approver",
        "closure_blocked",
        "review_result",
        "approval_result",
    }
    missing = sorted(required - metadata.keys())
    if missing:
        result.errors.append(f"missing work item metadata: {', '.join(missing)}")

    status = metadata.get("status", "")
    if status not in ALL_STATES:
        result.errors.append(f"invalid work item status: {status or '<empty>'}")

    unchecked = re.findall(r"^- \[ \] \*\*AC-\d+", body, flags=re.MULTILINE)
    if not re.search(r"^- \[[ xX]\] \*\*AC-\d+", body, flags=re.MULTILINE):
        result.errors.append("work item must contain at least one acceptance criterion")

    closure_blocked = _is_true(metadata.get("closure_blocked"))
    if closure_blocked:
        closure_claim = _closure_claim(metadata.get("title", ""))
        for relative in CANONICAL_STATUS_DOCS:
            path = root / relative
            if path.is_file() and closure_claim.search(path.read_text(encoding="utf-8")):
                result.errors.append(f"closure claim conflicts with closure_blocked=true: {relative}")

    if status in FINAL_STATES:
        if closure_blocked:
            result.errors.append(f"{status} requires closure_blocked=false")
        if unchecked:
            result.errors.append(f"{status} requires all acceptance criteria checked")
        if metadata.get("review_result") != "APPROVED":
            result.errors.append(f"{status} requires review_result=APPROVED")
        implementer = metadata.get("implementer", "").lower()
        reviewer = metadata.get("reviewer", "").lower()
        if not implementer or implementer == reviewer:
            result.errors.append(f"{status} requires a reviewer different from the implementer")
        evidence_body = body
        if status == "VALIDATED":
            evidence_body = body.split("### Product-owner decision", 1)[0]
        if re.search(r"\b(?:PENDING|TBD|UNASSIGNED)\b", evidence_body):
            result.errors.append(f"{status} work item still contains pending placeholders")
        if status == "CLOSED" and metadata.get("approval_result") != "APPROVED":
            result.errors.append("CLOSED requires approval_result=APPROVED")
    elif unchecked:
        result.warnings.append(f"{len(unchecked)} acceptance criteria remain open")

    # Owner 04/10 (GC-AI-0025): every item says in 3-4 lines what it does and what for; a warning, not a failure.
    if not re.search(r"^## Qué y para qué\s*$", body, flags=re.MULTILINE):
        result.warnings.append("missing section '## Qué y para qué' (qué hacemos, para qué, cómo veremos que sirve, "
                               "qué queda fuera)")

    return result


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    result = evaluate_repository(root)
    label = result.metadata.get("id", result.work_item.name if result.work_item else "UNKNOWN")
    print(f"Engineering gate: {label}")
    print(f"Status: {result.metadata.get('status', 'UNKNOWN')}")
    for warning in result.warnings:
        print(f"WARNING: {warning}")
    for error in result.errors:
        print(f"ERROR: {error}")
    print("PASS" if result.passed else "FAIL")
    return 0 if result.passed else 1


if __name__ == "__main__":
    sys.exit(main())
