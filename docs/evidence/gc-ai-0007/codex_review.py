"""Driver de /review-codex para GC-AI-0007 (worktree): reusa run_review y lo apunta a este checkout.

Uso, desde el workspace:
    python .worktrees/galecore-ai/GC-AI-0007/docs/evidence/gc-ai-0007/codex_review.py --base e7dd338 --model gpt-5.6-sol
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
    f"""2. Correctness of the new evidence store and its controls (src/galecore_ai/contracts/evidence.py,
   adapters/evidence_store.py, evidence: refs in knowledge_base.py and application/knowledge.py, CLI
   `evidence add` and `research save/revise --capability`, tools/fred_query.py): create-only, hash checked
   on read, edited evidence cannot be cited, provenance always HOST_DECLARED, credentials refused in params
   and payload, the FRED key never written. Then the real run: every number in
   {WS.as_posix()}/knowledge/research/2026-09-27-spy-contexto-prima-30-60d.md (3 revisions) must match its
   cited evidence in {WS.as_posix()}/knowledge/evidence/2026-09-27-spy-ctx-*.json; run
   docs/evidence/gc-ai-0007/recompute.py; observations, implied expectations, consensus and hypotheses are
   separated; no single causal narrative presented as fact; nothing external labelled GaleCore-verified;
   the continuity from a new session is NOT claimed as executed.""",
).replace(
    "5. Documentation coherence between architecture, alignment, handoff, validation guide and CLAUDE.md.",
    "5. Coherence between the work item (AC-01..AC-07), docs/evidence/gc-ai-0007/README.md, the skill and "
    "catalog entry, CLAUDE.md and ../roadmap/README.md (partner delivery section).",
)

if __name__ == "__main__":
    sys.exit(rr.main(sys.argv[1:]))
