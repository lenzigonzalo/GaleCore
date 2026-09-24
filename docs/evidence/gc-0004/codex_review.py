"""Driver de /review-codex para GC-0004 (repo GaleCore): reusa run_review y redirige repo e item.

Uso, desde el workspace: python GaleCore/docs/evidence/gc-0004/codex_review.py --recheck --model gpt-5.6-sol
"""
import sys
from pathlib import Path

WS = Path(__file__).resolve().parents[4]  # workspace, padre del repo GaleCore
sys.path.insert(0, str(WS / ".claude" / "skills" / "review-codex"))
import run_review as rr  # noqa: E402

REPO = WS / "GaleCore"
rr.AI_REPO = REPO
rr.ENGINEERING = REPO / "docs" / "engineering"
rr.REVIEWS = rr.ENGINEERING / "reviews"
ITEM = rr.ENGINEERING / "work-items" / "GC-0004-shadow-durable-visible.md"
rr.active_item = lambda: ("GC-0004", ITEM)
rr.GATE_COMMANDS = [
    "dotnet test source/galecore-datafeed/DataFeed.Tests/DataFeed.Tests.csproj (if NuGet is unreachable from your "
    "sandbox, run `dotnet vstest` on the already-built DataFeed.Tests.dll and say so; 3 Postgres tests are expected "
    "to be Skipped because Docker/Supabase local is not installed on this machine)",
    "in source/galecore-monitor: `CI=true npx react-scripts test --watchAll=false src/pages/Shadow.test.tsx` and "
    "`npx tsc --noEmit -p .`",
    "python -m ruff check --line-length 120 dev/galecore_dev.py docs/evidence/gc-0004/restart_demo.py",
    "git diff --check gc-0002-closed..HEAD",
]
rr.INSTRUCTIONS = rr.INSTRUCTIONS.replace(
    """2. Correctness of the deterministic assurance: fail-closed guardrails, no invented numbers,
   trading recommendations never reaching SUCCESS, freshness and snapshot trust boundary.""",
    """2. Correctness of the SHADOW runtime persistence: nothing in memory that is not saved (write-through),
   no position opened if the database fails, restart recovery without duplicates or lost state, one RUNNING
   instance, SHADOW never persisting to a non-local (production) database, no invented data (null vs 0 in
   metrics), gates/spec unchanged, the monitor not computing metrics. Live evidence (Docker, AC-01/07/08) does
   not exist yet: check that the work item says so honestly and does not claim it.""",
).replace(
    "5. Documentation coherence between architecture, alignment, handoff, validation guide and CLAUDE.md.",
    "5. Documentation coherence between the work item, ../roadmap/README.md (I3) and ../ENGINEERING.md.",
)

if __name__ == "__main__":
    sys.exit(rr.main(sys.argv[1:]))
