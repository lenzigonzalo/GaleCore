"""Driver de /review-codex para GC-AI-0008 (worktree): reusa run_review y lo apunta a este checkout.

Uso, desde el workspace:
    python .worktrees/galecore-ai/GC-AI-0008/docs/evidence/gc-ai-0008/codex_review.py --base 778201b --model gpt-5.6-sol
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
    f"""2. Correctness of the strategy path (src/galecore_ai/contracts/strategy.py, adapters/strategy_store.py,
   application/strategy.py, strategy: refs in knowledge_base.py and application/knowledge.py, CLI `strategy`):
   (a) check_proposal is fail-closed against GaleCore's SHADOW runtime - compare the support table with the real
   code in {WS.as_posix()}/GaleCore/source/galecore-datafeed/DataFeed.Application/App/Runtime (engine, gate
   evaluator, metric resolver, PCS builder, risk validator, exits, tick); a field the runtime executes or ignores
   must not pass without a rule or declaration; (b) galecore_spec_hash reproduces StrategySpecHasher.cs;
   (c) nothing but the approved version and hash can be deployed (create-only files, hash on read,
   deploy-check, and GaleCore's dev/galecore_dev.py `deploy --expect-hash`). Also review the GaleCore side:
   `git -C {WS.as_posix()}/GaleCore show feature/GC-AI-0008-estrategia-shadow` (spec file, StrategySpecVersionTests,
   galecore_dev.py). The real stored version is {WS.as_posix()}/knowledge/strategies/spy_prima_varianza_30_45d/
   1.0.0.proposal.json: its rules must be complete, honest about basis, and not claim approval or deployment.""",
).replace(
    "5. Documentation coherence between architecture, alignment, handoff, validation guide and CLAUDE.md.",
    "5. Coherence between the work item (AC-01..AC-08, findings), the skills and catalog entries, CLAUDE.md and "
    "../roadmap/README.md (secuencia activa). AC-06/07 are not executed yet (owner approval pending): must not be "
    "claimed.",
)

if __name__ == "__main__":
    sys.exit(rr.main(sys.argv[1:]))
