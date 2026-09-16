# GaleCore-AI engineering workflow

All coding agents must read these files before changing the repository:

1. `docs/engineering/ACTIVE_WORK_ITEM`
2. The referenced work item in `docs/engineering/work-items/`
3. `docs/engineering/OPERATING-MODEL.md`

## Mandatory rules

- Work only on the active work item's objective and acceptance criteria.
- When `feature_freeze: true`, do not add unrelated features or begin another backlog item.
- Do not declare a phase, milestone, or work item closed while `closure_blocked: true`.
- The implementer records a structured handoff. A different reviewer verifies the diff, reruns the required checks, and records the review result.
- Tests passing are evidence for listed criteria only; they do not prove milestone closure by themselves.
- Never fabricate an E2E run, model evaluation, timestamp, metric, or evidence artifact.
- Preserve user changes and the existing dirty worktree. Do not commit unless the user asks.
- Run `python tools/engineering_gate.py` before presenting a work item as ready for review or closed.
- Independent reviews are written to `docs/engineering/reviews/` (see its README); the implementer records resolutions in the work item, never edits a review.

The user is the product owner and final approver. `docs/engineering/OPERATING-MODEL.md` defines states, handoffs, evidence, and role boundaries.
