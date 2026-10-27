# GaleCore-AI engineering workflow

All coding agents must read, before changing the repository:

1. `../ENGINEERING.md` (workspace root): roles, work item states, evidence, review and verification rules.
2. The active work item: the path in `../ACTIVE_WORK_ITEM` (workspace root).
3. `CLAUDE.md` of this repository: how to run and test it.

## Mandatory rules

- Work only on the active work item's objective and acceptance criteria; what is out of scope goes to the backlog.
- Do not declare a work item closed while `closure_blocked: true`; only the owner moves it to `VALIDATED` or `CLOSED`.
- The implementer records evidence and «Para retomar» in the work item. A different reviewer reads the actual diff,
  reruns the required checks, and writes the review to `docs/engineering/reviews/`; the implementer never edits it.
- Tests passing are evidence for listed criteria only; they do not prove closure by themselves.
- Never fabricate an E2E run, model evaluation, timestamp, metric, or evidence artifact.
- Run `python tools/engineering_gate.py` before presenting a work item as ready for review or closed.
- Historical documents in `docs/archive/` are not instructions.
