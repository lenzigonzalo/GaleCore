"""Markdown files whose YAML frontmatter is the authoritative document.

Shared by every store of the knowledge base (regime records, investigations):
the frontmatter is the data, the Markdown body is a deterministic summary derived
from it, and a file is replaced atomically only after the rendered text reads
back as the same data.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

# From the first line to the first "---" line at column 0. PyYAML never emits
# "---" at column 0 inside a scalar (continuation lines are indented).
_FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)


class FrontmatterError(Exception):
    """The file has no readable frontmatter mapping."""


def read_frontmatter(text: str) -> dict:
    match = _FRONTMATTER_RE.match(text)
    if match is None:
        raise FrontmatterError("frontmatter missing or malformed")
    try:
        data = yaml.safe_load(match.group(1))
    except yaml.YAMLError as exc:
        raise FrontmatterError(f"frontmatter YAML invalid: {exc}") from exc
    if not isinstance(data, dict):
        raise FrontmatterError("frontmatter is not a mapping")
    return data


def render_frontmatter(data: dict) -> str:
    """YAML frontmatter that round-trips exactly through read_frontmatter.

    Timestamps must already be ISO strings (PyYAML quotes them so they stay
    strings), floats keep their repr, unicode is kept as is, and long strings are
    never folded so no line can start at column 0 inside a scalar.
    """
    body = yaml.safe_dump(data, allow_unicode=True, sort_keys=True, width=10**9, default_flow_style=False)
    return "---\n" + body + "---\n"


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".md.tmp")
    try:
        tmp.write_text(text, encoding="utf-8", newline="\n")
        tmp.replace(path)
    except OSError:
        tmp.unlink(missing_ok=True)
        raise
