"""Validate the repository's active engineering work item and closure claims."""

from __future__ import annotations

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
CANONICAL_STATUS_DOCS = (
    "docs/architecture/GaleCore-AI-arquitectura-v5.md",
    "docs/architecture/PHASE3-ALIGNMENT.md",
    "docs/architecture/SESSION_HANDOFF.md",
    "docs/architecture/ARCHITECTURE-EXECUTIVE-SUMMARY.md",
)
CLOSURE_CLAIM = re.compile(r"phase\s+3\s+(?:cerrada|closed)", re.IGNORECASE)


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
    pointer = root / "docs" / "engineering" / "ACTIVE_WORK_ITEM"
    if not pointer.is_file():
        result.errors.append("missing docs/engineering/ACTIVE_WORK_ITEM")
        return result

    filename = pointer.read_text(encoding="utf-8").strip()
    if not filename or Path(filename).name != filename:
        result.errors.append("ACTIVE_WORK_ITEM must contain one filename")
        return result

    work_item = root / "docs" / "engineering" / "work-items" / filename
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
        "feature_freeze",
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
        for relative in CANONICAL_STATUS_DOCS:
            path = root / relative
            if path.is_file() and CLOSURE_CLAIM.search(path.read_text(encoding="utf-8")):
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

    if _is_true(metadata.get("feature_freeze")):
        result.warnings.append("feature freeze is active; only the active work item is authorized")

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
