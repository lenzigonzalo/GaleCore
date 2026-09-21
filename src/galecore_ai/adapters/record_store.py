"""File store for evaluable records: one Markdown file per symbol and trading day.

Layout (``GALECORE_RECORDS_DIR``, default ``../GaleCore/research/regime`` next to
this checkout):

    <records_dir>/<SYMBOL>/<YYYY-MM-DD>.md

Each file is Markdown whose YAML frontmatter IS the authoritative document
(``RegimeRecordDocument``: schema version, symbol, date and every entry with its
request, snapshot identity, facts and hashes, effective assets, host metadata,
accepted payload, trace summary, entry_hash, outcomes and human reviews). A
human-readable summary follows the frontmatter; it is derived deterministically
from the document on every write and, on every read, re-rendered and compared so
the summary a human sees cannot disagree with the authoritative record.

Trust boundary: the same cooperative local protocol as the snapshot store.
Anyone with filesystem access can edit a file; integrity hashes make an edit
detectable (``INTEGRITY_FAILED``), they do not prevent it.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

import yaml
from pydantic import ValidationError

from galecore_ai.contracts.prepared_analysis import compute_facts_hash
from galecore_ai.contracts.regime_record import (
    RegimeRecordDocument,
    RegimeRecordEntry,
    compute_entry_hash,
)

# A symbol needs at least one letter or digit: "." and ".." are directories.
_SYMBOL_RE = re.compile(r"^(?=.*[A-Z0-9])[A-Z0-9.\-]{1,12}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# Frontmatter: from the first line to the first "---" line at column 0. PyYAML
# never emits "---" at column 0 inside a scalar (continuation lines are indented).
_FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
RECORDS_DIR_ENV = "GALECORE_RECORDS_DIR"


class RecordStoreError(Exception):
    """The record store cannot be used (bad path, bad identifiers, I/O failure)."""


class RecordIntegrityError(Exception):
    """A record file exists but cannot be trusted."""

    def __init__(self, path: Path, problems: list[str]) -> None:
        super().__init__(f"{path}: " + "; ".join(problems))
        self.path = path
        self.problems = problems


def default_records_dir() -> Path:
    """``GALECORE_RECORDS_DIR`` or the sibling GaleCore checkout's research folder."""
    configured = os.environ.get(RECORDS_DIR_ENV)
    if configured:
        return Path(configured).expanduser().resolve()
    repo_root = Path(__file__).resolve().parents[3]
    sibling = repo_root.parent / "GaleCore" / "research"
    if not sibling.is_dir():
        raise RecordStoreError(
            f"Cannot locate GaleCore/research next to this checkout ({sibling}); "
            f"set {RECORDS_DIR_ENV}"
        )
    return (sibling / "regime").resolve()


def verify_entry(entry: RegimeRecordEntry) -> list[str]:
    """Problems that make an entry untrustworthy (empty list = intact)."""
    problems: list[str] = []
    if compute_entry_hash(entry.hashable_content()) != entry.entry_hash:
        problems.append(f"entry {entry.entry_id}: entry_hash mismatch")
    if compute_facts_hash(entry.facts) != entry.snapshot.facts_hash:
        problems.append(f"entry {entry.entry_id}: facts_hash mismatch")
    if entry.entry_id != entry.snapshot.run_id:
        problems.append(f"entry {entry.entry_id}: entry_id differs from run_id")
    for i, outcome in enumerate(entry.outcomes):
        if compute_facts_hash(outcome.facts) != outcome.facts_hash:
            problems.append(f"entry {entry.entry_id}: outcome[{i}] facts_hash mismatch")
    return problems


class FileRecordStore:
    def __init__(self, base_dir: Path) -> None:
        self._base_dir = base_dir.resolve()
        self._base_dir.mkdir(parents=True, exist_ok=True)

    @property
    def base_dir(self) -> Path:
        return self._base_dir

    # ── paths ─────────────────────────────────────────────────────

    def path_for(self, symbol: str, date: str) -> Path:
        symbol = symbol.upper()
        if not _SYMBOL_RE.match(symbol):
            raise RecordStoreError(f"Invalid symbol for record path: {symbol!r}")
        if not _DATE_RE.match(date):
            raise RecordStoreError(f"Invalid date for record path: {date!r}")
        path = (self._base_dir / symbol / f"{date}.md").resolve()
        if not str(path).startswith(str(self._base_dir)):
            raise RecordStoreError("Path traversal detected")
        return path

    def symbols(self) -> list[str]:
        """Symbol folders present in the store (sorted). Read-only; no file is opened."""
        if not self._base_dir.is_dir():
            return []
        return sorted(p.name for p in self._base_dir.iterdir() if p.is_dir() and _SYMBOL_RE.match(p.name))

    def dates(self, symbol: str) -> list[str]:
        symbol = symbol.upper()
        if not _SYMBOL_RE.match(symbol):
            raise RecordStoreError(f"Invalid symbol for record path: {symbol!r}")
        folder = self._base_dir / symbol
        if not folder.is_dir():
            return []
        return sorted(p.stem for p in folder.glob("*.md") if _DATE_RE.match(p.stem))

    # ── read ──────────────────────────────────────────────────────

    def load(self, symbol: str, date: str) -> RegimeRecordDocument | None:
        """The day's document, or None if there is none. Raises RecordIntegrityError."""
        path = self.path_for(symbol, date)
        if not path.is_file():
            return None
        return self.load_path(path)

    def load_path(self, path: Path) -> RegimeRecordDocument:
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            raise RecordIntegrityError(path, [f"unreadable: {exc}"]) from exc
        document = parse_document(text, path)
        problems = [p for entry in document.entries for p in verify_entry(entry)]
        if text != render_markdown(document):
            problems.append("markdown body disagrees with the frontmatter record")
        expected = f"{document.symbol.upper()}/{document.date}.md"
        if not str(path).replace("\\", "/").endswith(expected):
            problems.append(f"document identity {expected} does not match file location")
        if problems:
            raise RecordIntegrityError(path, problems)
        return document

    # ── write ─────────────────────────────────────────────────────

    def save(self, document: RegimeRecordDocument) -> Path:
        """Atomically (re)write the day's file from the document. Entries are hashed first."""
        problems = [p for entry in document.entries for p in verify_entry(entry)]
        if problems:
            raise RecordStoreError("Refusing to write an inconsistent document: " + "; ".join(problems))
        path = self.path_for(document.symbol, document.date)
        text = render_markdown(document)
        # The rendered text must read back as the same document before it replaces
        # the file: prose that happens to contain "---" or YAML syntax cannot brick the day.
        if parse_document(text, path) != document:
            raise RecordStoreError("Rendered record does not round-trip; refusing to write")
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".md.tmp")
        try:
            tmp.write_text(text, encoding="utf-8", newline="\n")
            tmp.replace(path)
        except OSError:
            tmp.unlink(missing_ok=True)
            raise
        return path


# ── parsing ──────────────────────────────────────────────────────


def parse_document(text: str, path: Path) -> RegimeRecordDocument:
    """The authoritative document: the YAML frontmatter."""
    match = _FRONTMATTER_RE.match(text)
    if match is None:
        raise RecordIntegrityError(path, ["frontmatter missing or malformed"])
    try:
        data = yaml.safe_load(match.group(1))
    except yaml.YAMLError as exc:
        raise RecordIntegrityError(path, [f"frontmatter YAML invalid: {exc}"]) from exc
    if not isinstance(data, dict):
        raise RecordIntegrityError(path, ["frontmatter is not a mapping"])
    try:
        return RegimeRecordDocument.model_validate(data)
    except ValidationError as exc:
        raise RecordIntegrityError(path, [f"frontmatter does not match the record contract: {exc}"]) from exc


# ── rendering ────────────────────────────────────────────────────


def render_frontmatter(document: RegimeRecordDocument) -> str:
    """YAML frontmatter that round-trips exactly through parse_document.

    Timestamps are ISO strings (PyYAML quotes them so they stay strings), floats
    keep their repr, unicode is kept as is, and long strings are never folded
    so no line can start at column 0 inside a scalar.
    """
    data = document.model_dump(mode="json")
    body = yaml.safe_dump(data, allow_unicode=True, sort_keys=True, width=10**9, default_flow_style=False)
    return "---\n" + body + "---\n"


def render_markdown(document: RegimeRecordDocument) -> str:
    """Frontmatter + a deterministic summary (no timestamps: the body is compared on load)."""
    lines = [
        render_frontmatter(document).rstrip("\n"),
        "",
        f"# Regime record — {document.symbol} — {document.date}",
        "",
        (f"_{len(document.entries)} entr{'y' if len(document.entries) == 1 else 'ies'}; summary derived by "
         "galecore-ai from the frontmatter above, which is the authoritative record._"),
        "",
    ]
    for entry in document.entries:
        payload = entry.accepted_payload
        lines += [
            f"## Entry `{entry.entry_id}` — accepted {entry.trace.accepted_at.isoformat()}",
            "",
            f"- **Prompt:** {entry.request.prompt}",
            f"- **Gamma regime:** {payload.get('gamma_regime')} · **Tail pricing:** {payload.get('tail_pricing')}",
            f"- **Facts hash:** `{entry.snapshot.facts_hash}` · **Entry hash:** `{entry.entry_hash}`",
            f"- **Host (declared):** {entry.host.provider} / {entry.host.model}",
            "",
            "**Observations**",
            "",
            *[f"- {o}" for o in payload.get("observations", [])],
            "",
            "**Implications**",
            "",
            *[f"- {o}" for o in payload.get("implications", [])],
            "",
            "**Quantitative claims (validated exactly against facts)**",
            "",
            *[
                f"- {c.get('metric')} = {c.get('value')} {c.get('unit')}"
                for c in payload.get("quantitative_claims", [])
            ],
            "",
            "**Limitations**",
            "",
            *[f"- {o}" for o in payload.get("limitations", [])],
            "",
        ]
        if entry.outcomes:
            lines += ["**Outcomes (observed later, GaleCore-verified)**", ""]
            for outcome in entry.outcomes:
                f = outcome.facts
                lines.append(
                    f"- {outcome.observed_at.isoformat()}: spot {f.get('spot')}, net_gex {f.get('net_gex')}, "
                    f"vix {f.get('vix')}, vvix {f.get('vvix')}, put_skew_ratio {f.get('put_skew_ratio')}"
                )
            lines.append("")
        if entry.human_reviews:
            lines += ["**Human review**", ""]
            for review in entry.human_reviews:
                lines.append(f"- {review.reviewed_at.isoformat()} — **{review.verdict.value}**: {review.comment}")
            lines.append("")
    return "\n".join(lines) + "\n"
