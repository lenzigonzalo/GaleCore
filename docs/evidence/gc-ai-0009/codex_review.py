"""Driver de /review-codex para GC-AI-0009 (worktree): reusa run_review y lo apunta a este checkout.

Uso, desde el workspace:
    python .worktrees/galecore-ai/GC-AI-0009/docs/evidence/gc-ai-0009/codex_review.py --base 76e9958 --model gpt-5.6-sol
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
REPO = HERE.parents[3]  # el worktree de GaleCore-AI
WS = REPO.parents[2]  # workspace (…/.worktrees/galecore-ai/<item> → …)
sys.path.insert(0, str(WS / ".claude" / "skills" / "review-codex"))
import run_review as rr

rr.AI_REPO = REPO
rr.ENGINEERING = REPO / "docs" / "engineering"
rr.REVIEWS = rr.ENGINEERING / "reviews"
rr.INSTRUCTIONS = rr.INSTRUCTIONS.replace(
    """2. Correctness of the deterministic assurance: fail-closed guardrails, no invented numbers,
   trading recommendations never reaching SUCCESS, freshness and snapshot trust boundary.""",
    f"""2. This range closes GC-AI-0008 (the C3 fix of the version guard, the strategy follow-up read from GaleCore
   through its API: contracts/followup.py, application/followup.py, CLI `followup`) and implements GC-AI-0009
   (recurring follow-up on the Windows Task Scheduler: contracts/task.py, application/tasks.py,
   tools/task_runner.py, CLI `task`, catalog entry recurring_followup). Check: a task can only run the
   read-only follow-up (never write strategy versions, approvals, deployments or stop instances); no
   overlapping runs; pause/cancel/set-frequency are effective and consistent with the scheduler even on
   failure; every change and run is recorded (hash-chained events, hashed follow-up records naming strategy,
   version, hash, method, commit and sources); failures are visible, never silent; follow-up analysis never
   mixes other versions nor presents simulated fills as executions nor claims economic evidence.
   A REAL task exists in the Windows Task Scheduler (GaleCore-AI\\seguimiento-spy-prima-varianza) with real data in
   {WS.as_posix()}/knowledge/tasks and /followups: do NOT run `task create|set-frequency|pause|resume|cancel|run`,
   `followup run` or `schtasks /create|/change|/delete`; reading `schtasks /query` and the files is fine. Also
   review the GaleCore commit `git -C {WS.as_posix()}/GaleCore log -1 -p -- dev/galecore_dev.py` (UTF-8 report).""",
).replace(
    "5. Documentation coherence between architecture, alignment, handoff, validation guide and CLAUDE.md.",
    "5. Coherence between work items GC-AI-0008 and GC-AI-0009 (criteria, matrix, findings), the catalog and skills, "
    "and ../roadmap/README.md (secuencia activa). The owner approved 1.0.3 and its deployment to SHADOW in GaleCore Dev "
    "on 2026-09-27 20:20 local (quoted in GC-AI-0008 'Decisión del owner y despliegue'; the approval file is "
    "HOST_DECLARED by design: the host records the owner's words). Check that every matrix row and the roadmap agree "
    "with that; closure of GC-AI-0008/0009 is still the owner's and must not be claimed.",
)

if __name__ == "__main__":
    sys.exit(rr.main(sys.argv[1:]))
