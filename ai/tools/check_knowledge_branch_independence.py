"""Show that the knowledge base does not change when a code repository changes branch (GC-AI-0005 AC-07).

    python tools/check_knowledge_branch_independence.py --other-branch <branch>

Hashes every file of the knowledge base, switches this GaleCore-AI checkout to another branch,
hashes again, switches back and hashes a third time. Also records which GaleCore branches carry
``research/regime`` records at all (the old location, which disappeared on branch switches).
Refuses to run with uncommitted changes (the switch would carry or lose them). Prints JSON.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

AI = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI / "src"))

from galecore_ai.adapters.knowledge_base import knowledge_dir


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=True).stdout.strip()


def manifest(base: Path) -> dict[str, str]:
    return {p.relative_to(base).as_posix(): "sha256:" + hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(base.rglob("*")) if p.is_file() and ".git" not in p.relative_to(base).parts}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--other-branch", required=True)
    args = parser.parse_args()
    if git(AI, "status", "--porcelain"):
        print(json.dumps({"error": "GaleCore-AI has uncommitted changes; commit them first"}))
        return 1
    kb = knowledge_dir()
    galecore = kb.parent / "GaleCore"
    original = git(AI, "rev-parse", "--abbrev-ref", "HEAD")
    report: dict = {
        "knowledge_base": kb.name, "knowledge_git_toplevel_is_itself": Path(git(kb, "rev-parse", "--show-toplevel"))
        .resolve() == kb.resolve(), "knowledge_branch": git(kb, "rev-parse", "--abbrev-ref", "HEAD"),
        "galecore_ai_branch_original": original, "galecore_ai_branch_other": args.other_branch,
    }
    before = manifest(kb)
    git(AI, "switch", "-q", args.other_branch)
    try:
        during = manifest(kb)
    finally:
        git(AI, "switch", "-q", original)
    after = manifest(kb)
    report["files"] = len(before)
    report["manifest"] = before
    report["unchanged_after_switch"] = before == during
    report["unchanged_after_switch_back"] = before == after
    report["galecore_research_regime_md_per_branch"] = {
        b: len([f for f in git(galecore, "ls-tree", "-r", "--name-only", b, "--", "research/regime").splitlines()
                if f.endswith(".md") and not f.endswith("README.md")])
        for b in git(galecore, "for-each-ref", "--format=%(refname:short)", "refs/heads").splitlines()
    }
    report["result"] = "OK" if report["unchanged_after_switch"] and report["unchanged_after_switch_back"] else "FAILED"
    print(json.dumps(report, indent=2))
    return 0 if report["result"] == "OK" else 1


if __name__ == "__main__":
    sys.exit(main())
