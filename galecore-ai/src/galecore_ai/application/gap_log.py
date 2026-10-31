"""Registro de faltantes hacia el desarrollo de GaleCore (BL-022).

Cuando el usuario pide algo que GaleCore no cubre (dato, cálculo, análisis, cruce, acción) o la API falla, el harness lo
anota acá sin pedir permiso: una pieza por necesidad, con contador. `gap list` dice qué construir primero; `gap close`
lo marca resuelto con su causa (queda el registro) y, si se vuelve a pedir, se reabre.
"""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import UTC, datetime
from pathlib import Path

KINDS = ("data", "calc", "analysis", "cross", "action", "api_error")
MAX_OCCURRENCES = 20
BUGFIX_AFTER = 3            # server faults (HTTP 5xx) of the same request before it becomes a bugfix to attend
_SERVER_FAULT = re.compile(r"HTTP 5\d\d")   # a 4xx is the caller's mistake (bad range, missing parameter), not a bug


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
    if kind == "api_error":                 # one gap per capability: «option_greeks» is not «option_chains» reworded
        return None
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
    reopened = "closed_at" in item
    if reopened:                            # asked again after being closed: it can be raised again
        item.pop("bugfix", None)
    item.pop("closed_at", None)
    item.pop("resolution", None)
    item["count"] += 1
    item["last_seen"] = now
    occurrence = {"at": now, "why": why, "instead": instead, "project": project}
    item["occurrences"] = (item["occurrences"] + [occurrence])[-MAX_OCCURRENCES:]
    faults = sum(1 for o in item["occurrences"] if _SERVER_FAULT.search(o.get("why", "")))
    if reopened and not _SERVER_FAULT.search(why or ""):
        faults = 0                          # the old faults were closed: only a new 5xx raises it again
    if kind == "api_error" and "bugfix" not in item and faults >= BUGFIX_AFTER:
        item["bugfix"] = {"raised_at": now, "state": "open"}   # GaleCore is failing, not the caller: to be fixed first
    _write(path, item)
    return item


def bugfixes(kb: Path) -> list[dict]:
    """The open server faults to fix before new work, most repeated first."""
    return [i for i in items(kb) if "bugfix" in i]


def close(kb: Path, gap_id: str, *, resolution: str) -> dict:
    path = gap_dir(kb) / f"{gap_id}.json"
    if not path.exists():
        raise ValueError(f"no gap {gap_id}")
    if not resolution.strip():
        raise ValueError("resolution is required")
    item = json.loads(path.read_text(encoding="utf-8"))
    item["closed_at"] = datetime.now(UTC).isoformat(timespec="seconds")
    item["resolution"] = resolution.strip()
    _write(path, item)
    return item


def _write(path: Path, item: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(item, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def items(kb: Path, *, include_closed: bool = False) -> list[dict]:
    out = []
    for f in sorted(gap_dir(kb).glob("*.json")) if gap_dir(kb).exists() else []:
        try:
            item = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if include_closed or "closed_at" not in item:
            out.append(item)
    return sorted(out, key=lambda i: (-i["count"], i["first_seen"]))


def summary(item: dict) -> dict:
    return {k: item[k] for k in ("id", "need", "kind", "count", "first_seen", "last_seen", "bugfix") if k in item}
