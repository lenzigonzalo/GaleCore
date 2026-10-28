"""WS-0063: what was left abandoned is proposed for archiving, never deleted by itself.

``tidy`` only reads: it lists what looks abandoned, each item with the exact command that resolves it. ``archive``
moves a path to ``archive/<same path>`` (out of the model's search by ``knowledge/.ignore``; moving it back undoes it)
and commits it in the knowledge base.
"""

from __future__ import annotations

import json
import re
import subprocess
import unicodedata
from datetime import UTC, datetime, timedelta
from pathlib import Path

from galecore_ai.application.knowledge import KnowledgeBase, KnowledgeError

IDLE_DAYS = 21               # a project with no file changed and no Lab conversation in this long is proposed
KEEP = {"personal"}          # never proposed
GAP_WORDS = 6                # gaps whose first words match are the same need said twice
PROJECT_DIRS = ("strategies", "workspaces")
CHATS = Path("tools") / "terminal" / ".local" / "chats"


def _newest(path: Path) -> float:
    files = [path, *path.rglob("*")] if path.is_dir() else [path]
    return max((f.stat().st_mtime for f in files if f.exists()), default=0.0)


def _chat_times(kb: KnowledgeBase) -> dict[str, float]:
    """Newest Lab conversation per project (the Lab keeps them next to the workspace, not in the knowledge base)."""
    out: dict[str, float] = {}
    for f in (kb.base.parent / CHATS).glob("*.json") if (kb.base.parent / CHATS).is_dir() else []:
        try:
            project = json.loads(f.read_text(encoding="utf-8")).get("project")
        except (OSError, ValueError):
            continue
        if isinstance(project, str):
            out[project] = max(out.get(project, 0.0), f.stat().st_mtime)
    return out


def _normalize(text: str) -> str:
    plain = unicodedata.normalize("NFD", text.lower())
    words = re.sub(r"[^a-z0-9 ]+", " ", "".join(c for c in plain if unicodedata.category(c) != "Mn")).split()
    return " ".join(words[:GAP_WORDS])


def tidy(kb: KnowledgeBase, *, now: datetime | None = None, space_agents: list[dict] | None = None) -> dict:
    """The four groups; `space_agents` are the agent pieces listed in the trader's space (None: not looked at)."""
    now = now or datetime.now(UTC)
    base = kb.base
    projects = {d.name: d for sub in PROJECT_DIRS if (base / sub).is_dir() for d in (base / sub).iterdir() if d.is_dir()}
    chats = _chat_times(kb)
    limit = (now - timedelta(days=IDLE_DAYS)).timestamp()
    idle = []
    for sub in PROJECT_DIRS:
        for d in sorted((base / sub).iterdir()) if (base / sub).is_dir() else []:
            if not d.is_dir() or d.name in KEEP:
                continue
            last = max(_newest(d), chats.get(d.name, 0.0))
            if last < limit:
                idle.append({"item": f"{sub}/{d.name}", "last_activity": datetime.fromtimestamp(last, UTC).date().isoformat(),
                             "command": f"kb archive {sub}/{d.name}"})
    orphans = [{"item": f"followups/{d.name}", "why": "its strategy or project no longer exists",
                "command": f"kb archive followups/{d.name}"}
               for d in sorted((base / "followups").iterdir()) if d.is_dir() and d.name not in projects] \
        if (base / "followups").is_dir() else []
    from galecore_ai.application import tasks as t
    orphans += [{"item": f"task {x['id']}", "why": f"follows «{x['strategy']}», which no longer exists",
                 "command": f'task cancel {x["id"]} --prompt "su estrategia ya no existe"'}
                for x in t.list_tasks(kb) if x["status"] != "cancelled" and x["strategy"] and x["strategy"] not in projects]
    cancelled = [{"item": f"agent/{i['key']}", "command": f"space delete agent/{i['key']}"}
                 for i in space_agents or [] if _status(i) == "cancelled"]
    groups: dict[str, list[Path]] = {}
    for f in sorted((base / "gaps").glob("*.json")) if (base / "gaps").is_dir() else []:
        try:
            need = json.loads(f.read_text(encoding="utf-8")).get("need") or ""
        except (OSError, ValueError):
            continue
        if key := _normalize(need):
            groups.setdefault(key, []).append(f)
    similar = [{"item": key, "files": [f"gaps/{f.name}" for f in files],
                "command": " ; ".join(f"kb archive gaps/{f.name}" for f in files[1:])}
               for key, files in groups.items() if len(files) > 1]
    found = {"idle_projects": idle, "orphans": orphans, "cancelled_in_space": cancelled, "similar_gaps": similar}
    return {**found, "count": sum(len(v) for v in found.values()), "idle_days": IDLE_DAYS}


def _status(piece: dict) -> str | None:
    try:
        return json.loads(piece["content"]).get("status")
    except (ValueError, TypeError, KeyError, AttributeError):
        return None


def report_section(found: dict) -> str:
    """«Para limpiar» for the curator's report: title and command per item, nothing applied. Empty if nothing to clean."""
    titles = {"idle_projects": f"Sin actividad hace más de {found.get('idle_days', IDLE_DAYS)} días",
              "orphans": "Cuelgan de algo que ya no existe", "cancelled_in_space": "Canceladas aún en el espacio",
              "similar_gaps": "Faltantes repetidos (se deja el primero)"}
    lines = []
    for group, title in titles.items():
        for item in found.get(group, []):
            lines.append(f"| {title} | `{item['item']}` | `{item['command']}` |")
    if not lines:
        return ""
    return "\n".join(["", "## Para limpiar", "", "Nada se aplicó: cada fila trae el comando para hacerlo.", "",
                      "| Qué | Ítem | Comando |", "|---|---|---|", *lines, ""])


def archive(kb: KnowledgeBase, rel: str) -> dict:
    """Move `rel` (relative to the knowledge base) to ``archive/<rel>`` and commit it."""
    clean = rel.replace("\\", "/").strip("/")
    parts = clean.split("/")
    if not clean or ".." in parts or Path(clean).is_absolute() or len(parts) < 2 or parts[0] in {"archive", ".git"}:
        raise KnowledgeError(f"cannot archive «{rel}»: use a path inside a knowledge folder, e.g. workspaces/<name>")
    source, target = kb.base / clean, kb.base / "archive" / clean
    if not source.exists() or source.is_symlink():
        raise KnowledgeError(f"nothing to archive at «{clean}»")
    if target.exists():
        raise KnowledgeError(f"«archive/{clean}» already exists")
    target.parent.mkdir(parents=True, exist_ok=True)
    source.rename(target)
    committed = "not committed (no git in the knowledge base)"
    if (kb.base / ".git").exists():
        paths = [clean, f"archive/{clean}"]
        add = subprocess.run(["git", "-C", str(kb.base), "add", "-A", "--", *paths], capture_output=True, check=False)
        com = subprocess.run(["git", "-C", str(kb.base), "commit", "-q", "-m", f"archive: {clean}", "--", *paths],
                             capture_output=True, check=False)
        committed = "committed" if add.returncode == 0 and com.returncode == 0 else \
            f"commit failed: {(com.stderr or add.stderr).decode(errors='replace').strip()[:200]}"
    return {"status": "ARCHIVED", "from": clean, "to": f"archive/{clean}", "knowledge": committed}


def space_agents() -> list[dict] | None:
    """The agent pieces in the trader's space, or None when the space cannot be read (then that group is skipped)."""
    from galecore_ai.adapters.galecore_space import SpaceClient

    try:
        return SpaceClient(timeout=8.0).items("agent")["items"]
    except Exception:  # noqa: BLE001 - tidy only reads; no space (no credentials, API down) is not an error
        return None
