"""The trader's space (GC-AI-0021): bring what GaleCore-AI already knows into GaleCore, and read it back at the start.

`local_pieces` turns the local sources into pieces of the space: the profile in force (and each objective), the
conventions, the scheduled agents (tasks) and the catalog's skills (shared: they are the team's methods). `sync` writes
only what changed (the version in GaleCore goes up only then). `context` is the short summary a session starts with.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import yaml

from galecore_ai.adapters.galecore_space import SpaceClient
from galecore_ai.application.knowledge import KnowledgeBase
from galecore_ai.harness.catalog import load_catalog

CONVENTIONS = Path(__file__).resolve().parents[3] / "config" / "conventions"


def _slug(text: str, limit: int = 48) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower().translate(str.maketrans("áéíóúñü", "aeiounu"))).strip("-")
    return (s[:limit].rstrip("-") or "x")


def local_pieces(kb: KnowledgeBase) -> list[dict]:
    """Every piece the local sources hold today, as {kind, key, title, content, format, visibility}."""
    from galecore_ai.application import tasks as t   # lazy: tasks imports the CLI side lazily too

    pieces: list[dict] = []
    profile = kb.profile.latest()
    if profile is not None:
        content = profile.content.model_dump(mode="json")
        pieces.append({"kind": "profile", "key": "perfil", "title": f"Perfil (profile:v{profile.version})",
                       "content": json.dumps({"version": profile.version, **content}, ensure_ascii=False, indent=1),
                       "format": "json", "visibility": "private"})
        for text in profile.content.objectives:
            key = _slug(text)
            if len(_slug(text, 200)) > len(key):          # truncated: the full text's hash keeps it unique and stable
                key = f"{key[:40]}-{hashlib.sha256(text.encode()).hexdigest()[:7]}"
            pieces.append({"kind": "objective", "key": key, "title": text[:200], "content": text,
                           "format": "markdown", "visibility": "private"})
    for path in sorted(CONVENTIONS.glob("*.yaml")):
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        entries = {e["key"]: e.get("value") for e in doc.get("entries", [])}
        pieces.append({"kind": "convention", "key": _slug(doc.get("convention_id", path.stem)),
                       "title": doc.get("display_name", path.stem), "content": json.dumps(entries, ensure_ascii=False),
                       "format": "json", "visibility": "shared"})
    for task in (x for x in t.list_tasks(kb) if x["status"] != "cancelled"):   # a cancelled task is history
        pieces.append({"kind": "agent", "key": _slug(task["id"]), "title": f"{task['id']} ({task['capability']})",
                       "content": json.dumps({"capability": task["capability"], "status": task["status"],
                                              "schedule": task["schedule"], "strategy": task["strategy"],
                                              "objective": task["objective"]}, ensure_ascii=False),
                       "format": "json", "visibility": "private"})
    for entry in load_catalog().entries:
        lines = [entry.serves.strip(), "", "Pedidos de ejemplo:", *(f"- {r}" for r in entry.example_requests)]
        pieces.append({"kind": "skill", "key": _slug(entry.id.replace("_", "-")), "title": entry.id,
                       "content": "\n".join(lines), "format": "markdown", "visibility": "shared"})
    return pieces


def sync(client: SpaceClient, pieces: list[dict]) -> dict:
    """Write the pieces that are new or changed; return what was created, updated and left alone."""
    current = {(i["kind"], i["key"]): i for i in client.items()["items"]}
    out = {"created": [], "updated": [], "unchanged": []}
    for p in pieces:
        before = current.get((p["kind"], p["key"]))
        same = before is not None and all(before.get(k) == p[k] for k in ("title", "content", "format", "visibility"))
        if same:
            out["unchanged"].append(f"{p['kind']}/{p['key']}")
            continue
        client.put(p["kind"], p["key"], title=p["title"], content=p["content"], fmt=p["format"],
                   visibility=p["visibility"])
        out["created" if before is None else "updated"].append(f"{p['kind']}/{p['key']}")
    return out


def context(client: SpaceClient, max_lines: int = 25) -> str:
    """The session's opening summary: who the trader is and what they have, in a few lines."""
    space = client.items()
    own, shared = space["items"], space["shared"]
    by_kind: dict[str, list[dict]] = {}
    for i in own:
        by_kind.setdefault(i["kind"], []).append(i)
    lines = [f"[espacio] {client.user}: {len(own)} piezas propias, {len(shared)} compartidas por el equipo"]
    for p in by_kind.get("profile", []):
        try:
            prof = json.loads(p["content"])
            cap = prof.get("reference_capital") or {}
            capital = f"{cap.get('amount', 0):,.0f} {cap.get('currency', '')}".replace(",", ".") if cap else "sin definir"
            lines.append(f"  perfil v{prof.get('version')}: capital {capital}, "
                         f"horizonte {prof.get('horizon')}, límites {'; '.join(prof.get('risk_limits', []))[:160]}")
        except (json.JSONDecodeError, TypeError):
            lines.append(f"  perfil: {p['title']}")
    labels = {"objective": "objetivos", "convention": "convenciones", "memory": "memoria", "agent": "agentes",
              "skill": "skills", "data": "datos"}
    for kind, label in labels.items():
        items = by_kind.get(kind, [])
        if items:
            n_shared = sum(1 for i in items if i.get("visibility") == "shared")
            tag = f" ({n_shared} compartidas por vos)" if n_shared else ""
            lines.append(f"  {label}{tag}: " + " · ".join(i["title"] for i in items)[:300])
    shared_kinds = sorted({i["kind"] for i in shared})
    if shared_kinds:
        lines.append("  compartido: " + ", ".join(f"{k} ({sum(1 for i in shared if i['kind'] == k)})" for k in shared_kinds))
    lines.append("  detalle: `space list [--kind K]` · `space show K/clave`")
    return "\n".join(lines[:max_lines])
