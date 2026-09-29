"""Driver de /review-codex para GC-AI-0013 (worktree): reusa run_review y lo apunta a este checkout.

Uso, desde el workspace:
    python .worktrees/galecore-ai/GC-AI-0013/docs/evidence/gc-ai-0013/codex_review.py --uncommitted
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
REPO = HERE.parents[3]  # el worktree de GaleCore-AI (GC-AI-0013)
WS = REPO.parents[2]  # workspace (…/.worktrees/galecore-ai/<item> → …)
sys.path.insert(0, str(WS / ".claude" / "skills" / "review-codex"))
import run_review as rr

rr.AI_REPO = REPO
rr.ENGINEERING = REPO / "docs" / "engineering"
rr.REVIEWS = rr.ENGINEERING / "reviews"

if __name__ == "__main__":
    sys.exit(rr.main(sys.argv[1:]))
