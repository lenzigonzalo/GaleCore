"""Where the knowledge base lives and how references into it are written.

The knowledge base is a plain directory of Markdown files with YAML frontmatter,
outside the code checkout, so its content never depends on which branch the code
has checked out:

    <data dir>/
        regime/<SYMBOL>/<YYYY-MM-DD>.md   daily regime records (record_store)
        research/<id>.md                  investigations (research_store)
        evidence/<id>.json                source responses with provenance (evidence_store)
        strategies/<name>/<version>.*.json  strategy proposals and approvals (strategy_store)
        profile/v<N>.json                 the user profile, one file per version (profile_store)
        feedback/<id>.json                the user's comments on a result (feedback_store)

``GALECORE_KNOWLEDGE_DIR`` overrides the location. Without it, the directory is
``~/GaleCore-datos/knowledge`` (the user's data dir; the Lab creates it from
``config/knowledge-template`` on first start). The directory is never created
implicitly here: a missing base is an error, not an empty result.

References are how one piece of work cites another:

    regime:SPY/2026-09-23      a regime record (one symbol, one day)
    research:<id>              an investigation
    evidence:<id>              a source response kept with its provenance
    strategy:<name>/<version>  a strategy proposal version (with its spec and approval)
    profile:v<N>               a version of the user profile
    feedback:<id>              the user's comment on a result
    file:<path>                a local file, relative to the parent of the knowledge directory

``file:`` paths resolve against the parent of the knowledge directory.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

KNOWLEDGE_DIR_ENV = "GALECORE_KNOWLEDGE_DIR"
# The product root: the monorepo, parent of galecore-ai/, galecore-app/ and galecore-lab/ (this file is galecore-ai/src/galecore_ai/adapters/...).
PRODUCT_ROOT = Path(__file__).resolve().parents[4]

_REGIME_KEY_RE = re.compile(r"^(?P<symbol>[A-Za-z0-9.\-]{1,12})/(?P<date>\d{4}-\d{2}-\d{2})$")
RESEARCH_ID_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$")
REF_KINDS = ("regime", "research", "evidence", "strategy", "profile", "feedback", "project", "file")
_PROJECT_KEY_RE = re.compile(r"^(portfolio|[a-z][a-z0-9_]{2,63})$")  # a strategy name or the portfolio
_STRATEGY_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{2,63}/\d+\.\d+\.\d+$")
_PROFILE_KEY_RE = re.compile(r"^v[1-9]\d*$")


class KnowledgeBaseError(Exception):
    """The knowledge base cannot be located or a reference is malformed."""


def default_knowledge_dir() -> Path:
    return Path.home() / "GaleCore-datos" / "knowledge"


def knowledge_dir() -> Path:
    """``GALECORE_KNOWLEDGE_DIR`` or ``~/GaleCore-datos/knowledge``. Must already exist."""
    configured = os.environ.get(KNOWLEDGE_DIR_ENV)
    path = Path(configured).expanduser().resolve() if configured else default_knowledge_dir().resolve()
    if not path.is_dir():
        raise KnowledgeBaseError(
            f"Knowledge base directory does not exist: {path} (not created; set {KNOWLEDGE_DIR_ENV} "
            "or start the Lab once, which creates it)"
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
            "evidence:<id>, strategy:<name>/<version>, profile:v<N>, feedback:<id>, project:<name> or file:<path>"
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
    if kind == "feedback":
        if not RESEARCH_ID_RE.fullmatch(key):
            raise KnowledgeBaseError(f"Malformed feedback reference {text!r}: expected feedback:<YYYY-MM-DD-slug>")
        return Ref("feedback", key)
    if kind == "strategy":
        if not _STRATEGY_KEY_RE.fullmatch(key):
            raise KnowledgeBaseError(f"Malformed strategy reference {text!r}: expected strategy:<name>/<MAJOR.MINOR.PATCH>")
        return Ref("strategy", key)
    if kind == "profile":
        if not _PROFILE_KEY_RE.fullmatch(key):
            raise KnowledgeBaseError(f"Malformed profile reference {text!r}: expected profile:v<N>")
        return Ref("profile", key)
    if kind == "project":
        if not _PROJECT_KEY_RE.fullmatch(key):
            raise KnowledgeBaseError(f"Malformed project reference {text!r}: expected project:<strategy name>|portfolio")
        return Ref("project", key)
    posix = PurePosixPath(key.replace("\\", "/"))
    if posix.is_absolute() or ".." in posix.parts or key.startswith(("/", "\\")) or ":" in key:
        raise KnowledgeBaseError(f"file reference must be a relative path inside the workspace: {text!r}")
    return Ref("file", str(posix))


def project_log_path(base: Path, name: str) -> Path:
    """Where a project's log lives: inside its folder (``workspaces|strategies/<name>/memory/registro.json``) when the
    folder exists, else the old ``projects/<name>.json`` (the portfolio and names without a folder)."""
    if name != "portfolio":
        for sub in ("workspaces", "strategies"):
            if (base / sub / name).is_dir():
                return base / sub / name / "memory" / "registro.json"
    return base / "projects" / f"{name}.json"


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
    if ref.kind == "profile":
        return base / "profile" / f"{ref.key}.json"
    if ref.kind == "feedback":
        return base / "feedback" / f"{ref.key}.json"
    if ref.kind == "project":
        new = project_log_path(base, ref.key)
        old = base / "projects" / f"{ref.key}.json"
        return old if not new.exists() and old.exists() else new
    return (base.parent / ref.key).resolve()
