"""Where the knowledge base lives and how references into it are written.

The knowledge base is a plain directory of Markdown files with YAML frontmatter,
outside every code checkout, so its content never depends on which branch a code
repository has checked out:

    <workspace>/knowledge/
        regime/<SYMBOL>/<YYYY-MM-DD>.md   daily regime records (record_store)
        research/<id>.md                  investigations (research_store)
        evidence/<id>.json                source responses with provenance (evidence_store)
        strategies/<name>/<version>.*.json  strategy proposals and approvals (strategy_store)

``GALECORE_KNOWLEDGE_DIR`` overrides the location. Without it, the directory is
found by walking up from this checkout to the workspace root (the directory that
holds ``ENGINEERING.md`` and ``GaleCore-AI/``), which also works from a worktree
under ``.worktrees/``. The directory is never created implicitly: a missing base
is an error, not an empty result.

References are how one piece of work cites another:

    regime:SPY/2026-09-23      a regime record (one symbol, one day)
    research:<id>              an investigation
    evidence:<id>              a source response kept with its provenance
    strategy:<name>/<version>  a strategy proposal version (with its spec and approval)
    file:<path>                a local file, relative to the workspace root

``file:`` paths resolve against the parent of the knowledge directory, which is
the workspace root in the default layout.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

KNOWLEDGE_DIR_ENV = "GALECORE_KNOWLEDGE_DIR"

_REGIME_KEY_RE = re.compile(r"^(?P<symbol>[A-Za-z0-9.\-]{1,12})/(?P<date>\d{4}-\d{2}-\d{2})$")
RESEARCH_ID_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$")
REF_KINDS = ("regime", "research", "evidence", "strategy", "file")
_STRATEGY_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{2,63}/\d+\.\d+\.\d+$")


class KnowledgeBaseError(Exception):
    """The knowledge base cannot be located or a reference is malformed."""


def _workspace_root(start: Path) -> Path | None:
    for candidate in [start, *start.parents]:
        if (candidate / "ENGINEERING.md").is_file() and (candidate / "GaleCore-AI").is_dir():
            return candidate
    return None


def knowledge_dir() -> Path:
    """``GALECORE_KNOWLEDGE_DIR`` or ``<workspace>/knowledge``. Must already exist."""
    configured = os.environ.get(KNOWLEDGE_DIR_ENV)
    if configured:
        path = Path(configured).expanduser().resolve()
    else:
        root = _workspace_root(Path(__file__).resolve())
        if root is None:
            raise KnowledgeBaseError(
                f"Cannot locate the workspace root from this checkout; set {KNOWLEDGE_DIR_ENV}"
            )
        path = (root / "knowledge").resolve()
    if not path.is_dir():
        raise KnowledgeBaseError(
            f"Knowledge base directory does not exist: {path} (not created; set {KNOWLEDGE_DIR_ENV} "
            "or create it — see knowledge/README.md)"
        )
    return path


@dataclass(frozen=True)
class Ref:
    kind: str
    key: str

    def __str__(self) -> str:
        return f"{self.kind}:{self.key}"


def parse_ref(text: str) -> Ref:
    """Parse and normalise a reference. Raises KnowledgeBaseError when malformed."""
    kind, sep, key = text.strip().partition(":")
    if not sep or kind not in REF_KINDS or not key:
        raise KnowledgeBaseError(
            f"Malformed reference {text!r}: expected regime:<SYMBOL>/<YYYY-MM-DD>, research:<id>, "
            "evidence:<id>, strategy:<name>/<version> or file:<path>"
        )
    if kind == "regime":
        m = _REGIME_KEY_RE.fullmatch(key)
        if not m:
            raise KnowledgeBaseError(f"Malformed regime reference {text!r}: expected regime:<SYMBOL>/<YYYY-MM-DD>")
        return Ref("regime", f"{m['symbol'].upper()}/{m['date']}")
    if kind == "research":
        if not RESEARCH_ID_RE.fullmatch(key):
            raise KnowledgeBaseError(f"Malformed research reference {text!r}: expected research:<YYYY-MM-DD-slug>")
        return Ref("research", key)
    if kind == "evidence":
        if not RESEARCH_ID_RE.fullmatch(key):
            raise KnowledgeBaseError(f"Malformed evidence reference {text!r}: expected evidence:<YYYY-MM-DD-slug>")
        return Ref("evidence", key)
    if kind == "strategy":
        if not _STRATEGY_KEY_RE.fullmatch(key):
            raise KnowledgeBaseError(f"Malformed strategy reference {text!r}: expected strategy:<name>/<MAJOR.MINOR.PATCH>")
        return Ref("strategy", key)
    posix = PurePosixPath(key.replace("\\", "/"))
    if posix.is_absolute() or ".." in posix.parts or key.startswith(("/", "\\")) or ":" in key:
        raise KnowledgeBaseError(f"file reference must be a relative path inside the workspace: {text!r}")
    return Ref("file", str(posix))


def ref_path(ref: Ref, base: Path) -> Path:
    """Filesystem location a reference points to (it may not exist)."""
    if ref.kind == "regime":
        symbol, date = ref.key.split("/")
        return base / "regime" / symbol / f"{date}.md"
    if ref.kind == "research":
        return base / "research" / f"{ref.key}.md"
    if ref.kind == "evidence":
        return base / "evidence" / f"{ref.key}.json"
    if ref.kind == "strategy":
        name, version = ref.key.split("/")
        return base / "strategies" / name / f"{version}.proposal.json"
    return (base.parent / ref.key).resolve()
