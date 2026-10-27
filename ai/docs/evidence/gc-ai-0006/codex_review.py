"""Driver de /review-codex para GC-AI-0006 (worktree): reusa run_review y lo apunta a este checkout.

Uso, desde el workspace:
    python .worktrees/galecore-ai/GC-AI-0006/docs/evidence/gc-ai-0006/codex_review.py --base 24fdf00 --model gpt-5.6-sol
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
    f"""2. This deliverable is a strategy PROPOSAL (documentation), not code. Check that every number in
   docs/engineering/pilots/strategy-design/propuesta-pcs-spy-2026-09-25.md matches its cited source
   (internal sources are under the workspace {WS.as_posix()}: GaleCore/docs/rpf/*.md,
   GaleCore/source/galecore-datafeed/DataFeed.Api/Files/Rpf/galecore_rules_rpf.json,
   GaleCore/decisiones/D-0001-*.md, GaleCore/docs/evidence/gc-0004/run1-en-sesion.json,
   knowledge/research/*.md); recompute every "cálculo propio"; RPF's current rules (4.A), new
   recommendations (4.B) and pending parameters (4.C) are separated; no invented thresholds; no claim
   that profitability is demonstrated; external web sources are attributed and hedged (you may lack
   network: say so rather than verify from memory). The method applied is SKILL.md + coverage.md in the
   same folder; the evaluation of that method is the dated section at the end of evaluation.md.""",
).replace(
    "5. Documentation coherence between architecture, alignment, handoff, validation guide and CLAUDE.md.",
    "5. Coherence between the work item (AC-01..AC-06), the proposal, the evaluation and ../roadmap/README.md (I4).",
)

if __name__ == "__main__":
    sys.exit(rr.main(sys.argv[1:]))
