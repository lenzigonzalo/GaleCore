"""Registro de faltantes hacia el desarrollo de GaleCore (BL-022).

Cuando el usuario pide algo que GaleCore no cubre (dato, cálculo, análisis, cruce, acción) o la API falla, el harness lo
anota acá sin pedir permiso: una pieza por necesidad, con contador. `gap list` dice qué construir primero.
"""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import UTC, datetime
from pathlib import Path

KINDS = ("data", "calc", "analysis", "cross", "action", "api_error")
MAX_OCCURRENCES = 20


def _slug(text: str) -> str:
    plain = unicodedata.normalize("NFD", text.lower())
    plain = "".join(c for c in plain if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", plain).strip("-")[:80] or "faltante"


def gap_dir(kb: Path) -> Path:
    return kb / "gaps"


_STOP = {"de", "del", "la", "el", "los", "las", "un", "una", "para", "por", "con", "en", "y", "a", "al", "que", "sobre",
         "the", "of", "for", "and", "to", "next", "proximo", "proxima", "trimestre"}


def _tokens(text: str) -> set[str]:
    return {t for t in _slug(text).split("-") if len(t) > 1 and t not in _STOP}


def _tickers(text: str) -> set[str]:
    return set(re.findall(r"(?<![A-Za-z])[A-Z]{2,5}(?![A-Za-z])", text))


def _similar(a: str, b: str) -> bool:
    """The same need worded differently: same tickers and most of the shorter one's words are in the other."""
    ta, tb = _tokens(a), _tokens(b)
    return (bool(ta and tb) and _tickers(a) == _tickers(b) and len(ta & tb) >= 2
            and len(ta & tb) / min(len(ta), len(tb)) >= 0.7)


def _existing(kb: Path, need: str, kind: str) -> Path | None:
    exact = gap_dir(kb) / f"{_slug(need)}.json"
    if exact.exists():
        return exact
    for f in sorted(gap_dir(kb).glob("*.json")) if gap_dir(kb).exists() else []:
        try:
            other = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if other.get("kind") == kind and _similar(need, other.get("need", "")):
            return f
    return None


def add(kb: Path, *, need: str, kind: str, why: str = "", instead: str = "", project: str = "") -> dict:
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {', '.join(KINDS)}")
    need = need.strip()
    if not need:
        raise ValueError("need is required")
    path = _existing(kb, need, kind) or gap_dir(kb) / f"{_slug(need)}.json"
    now = datetime.now(UTC).isoformat(timespec="seconds")
    item = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {
        "id": path.stem, "need": need, "kind": kind, "first_seen": now, "count": 0, "occurrences": []}
    item["count"] += 1
    item["last_seen"] = now
    occurrence = {"at": now, "why": why, "instead": instead, "project": project}
    item["occurrences"] = (item["occurrences"] + [occurrence])[-MAX_OCCURRENCES:]
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(item, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)
    return item


def items(kb: Path) -> list[dict]:
    out = []
    for f in sorted(gap_dir(kb).glob("*.json")) if gap_dir(kb).exists() else []:
        try:
            out.append(json.loads(f.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
    return sorted(out, key=lambda i: (-i["count"], i["first_seen"]))


def summary(item: dict) -> dict:
    return {k: item[k] for k in ("id", "need", "kind", "count", "first_seen", "last_seen")}
