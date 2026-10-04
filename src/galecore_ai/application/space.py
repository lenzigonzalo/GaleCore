"""The trader's space (GC-AI-0021): bring what GaleCore-AI already knows into GaleCore, and read it back at the start.

`local_pieces` turns the local sources into pieces of the space: the profile in force (and each objective), the
conventions, the scheduled agents (tasks) and the catalog's skills (shared: they are the team's methods). `sync` writes
only what changed (the version in GaleCore goes up only then). `context` is the short summary a session starts with.

Agents (GC-AI-0023): each agent piece also carries what the monitor's Agentes screen shows: whether its latest
result is current, the last run and its findings. The monitor cannot reach this PC, so turning an agent on or off
there is a request written into the piece (`request: {status, at}`); `apply_requests` carries it out here (pause or
resume through the scheduler, recorded in the task's events) before the pieces are published again.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

import yaml

from galecore_ai.adapters.galecore_space import SpaceClient
from galecore_ai.application.knowledge import KnowledgeBase
from galecore_ai.harness.catalog import load_catalog

CONVENTIONS = Path(__file__).resolve().parents[3] / "config" / "conventions"


def _slug(text: str, limit: int = 48) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower().translate(str.maketrans("áéíóúñü", "aeiounu"))).strip("-")
    return (s[:limit].rstrip("-") or "x")


FINDINGS_LIMIT = 12_000          # characters of the latest result shown in the monitor; the full one stays here


def _research_findings(kb: KnowledgeBase, ref: str) -> str | None:
    """A research result as short markdown for the monitor: what was found, what is missing, what follows."""
    doc = kb.research.load(ref.removeprefix("research:"))
    if doc is None:
        return None
    c = doc.current.content
    lines = [f"**{c.title}**", "", *(f"- {s.text}" for s in c.statements)]
    for title, items in (("Falta", c.missing), ("Próximos pasos", c.next_steps), ("Límites", c.limitations)):
        if items:
            lines += ["", f"**{title}**", "", *(f"- {i}" for i in items)]
    return "\n".join(lines)


def agent_state(kb: KnowledgeBase, task_id: str, now: datetime | None = None) -> dict:
    """What the Agentes screen shows of one agent: definition, freshness, last run and its findings."""
    from galecore_ai.application import tasks as t  # lazy: tasks imports the CLI side lazily too

    task = t.load(kb, task_id)
    log = t.events(kb, task_id)
    fresh = t.freshness(task, log, now or datetime.now(UTC))
    outcomes = [e for e in log if e["event"] in ("run_finished", "run_failed")]
    last = outcomes[-1] if outcomes else None
    findings = None
    if task.kind in t.CODE_RUNNERS and task.strategy:
        latest = kb.base / "followups" / task.strategy / "LATEST.md"
        findings = latest.read_text(encoding="utf-8") if latest.is_file() else None
    else:
        done = next((e for e in reversed(log) if e["event"] == "run_finished" and e.get("research")), None)
        findings = _research_findings(kb, done["research"]) if done else None
    if findings and len(findings) > FINDINGS_LIMIT:
        findings = findings[:FINDINGS_LIMIT].rstrip() + "\n\n… (recortado: el resultado completo queda en GaleCore-AI)"
    return {
        "capability": task.kind, "status": task.status, "schedule": task.schedule.describe(),
        "strategy": task.strategy, "objective": task.objective,
        "state": fresh["state"], "state_detail": fresh.get("detail"), "next_expected_at": fresh.get("next_expected_at"),
        "last_run": ({k: last[k] for k in ("at", "result", "invoked_by", "duration_s", "model", "reason", "error")
                      if last.get(k) is not None} | {"failed": last["event"] == "run_failed"}) if last else None,
        "runs": sum(1 for e in log if e["event"] == "run_finished"),
        "findings": findings,
        "result_ref": ((last or {}).get("research") or (last or {}).get("followup")),
    }


def local_pieces(kb: KnowledgeBase, now: datetime | None = None) -> list[dict]:
    """Every piece the local sources hold today, as {kind, key, title, content, format, visibility}."""
    from galecore_ai.application import tasks as t  # lazy: tasks imports the CLI side lazily too

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
                       "content": json.dumps({"id": task["id"], **agent_state(kb, task["id"], now)},
                                             ensure_ascii=False),
                       "format": "json", "visibility": "private"})
    for entry in load_catalog().entries:
        lines = [entry.serves.strip(), "", "Pedidos de ejemplo:", *(f"- {r}" for r in entry.example_requests)]
        pieces.append({"kind": "skill", "key": _slug(entry.id.replace("_", "-")), "title": entry.id,
                       "content": "\n".join(lines), "format": "markdown", "visibility": "shared"})
    return pieces


def profile_state(client: SpaceClient, kb: KnowledgeBase) -> dict:
    """Which profile is in force (GC-AI-0026, owner decision D-2: GaleCore's space rules).

    coherent: the space and the local version hold the same content. edited_in_monitor: the space differs and is not
    older than the local version (someone edited it there): `space pull-profile` brings it as a new local version and
    `import` does not overwrite it. local_newer: a local version not yet imported. not_published: nothing in the space.
    """
    local = kb.profile.latest()
    piece = next((i for i in client.items("profile")["items"] if i["key"] == "perfil"), None)
    out = {"local_ref": local.ref if local else None, "source": "galecore"}
    if piece is None:
        return {**out, "state": "not_published", "source": "knowledge (local)", "ref": out["local_ref"]}
    try:
        remote = json.loads(piece["content"])
        if not isinstance(remote, dict):
            raise TypeError("not an object")
    except (json.JSONDecodeError, TypeError) as exc:
        return {**out, "state": "unreadable", "ref": None, "detail": f"la pieza del perfil no es JSON válido ({exc})"}
    version = remote.pop("version", None)
    out |= {"space_version": version, "space_piece_version": piece.get("version")}
    if local is None:
        return {**out, "state": "edited_in_monitor", "ref": None, "remote": remote}
    if remote == local.content.model_dump(mode="json"):
        return {**out, "state": "coherent", "ref": local.ref}
    if isinstance(version, int) and version < local.version:
        return {**out, "state": "local_newer", "ref": local.ref,
                "detail": f"profile:v{local.version} todavía no se importó al espacio (`space import`)"}
    return {**out, "state": "edited_in_monitor", "ref": None, "remote": remote,
            "detail": "el perfil se editó en el monitor; `space pull-profile` lo trae como versión nueva"}


def pull_profile(client: SpaceClient, kb: KnowledgeBase, host) -> dict:
    """Bring the monitor's edit as a new local version, so methods and monitor use the same content."""
    from galecore_ai.application.profile import set_profile

    state = profile_state(client, kb)
    if state["state"] != "edited_in_monitor":
        return {"status": "NOTHING_TO_PULL", **{k: v for k, v in state.items() if k != "remote"}}
    doc, path = set_profile(kb.profile, changes=state["remote"], note="edición del perfil hecha en el monitor",
                            prompt=f"space pull-profile ({client.user})", host=host)
    return {"status": "PULLED" if path else "UNCHANGED", "ref": doc.ref, "path": str(path) if path else None}


def guard_profile(client: SpaceClient, kb: KnowledgeBase, pieces: list[dict]) -> tuple[list[dict], list[str]]:
    """Drop the profile and objective pieces from an import while the monitor holds an edit not pulled yet."""
    if profile_state(client, kb)["state"] != "edited_in_monitor":
        return pieces, []
    kept = [p for p in pieces if p["kind"] not in ("profile", "objective")]
    return kept, ["profile/perfil y objetivos: el monitor tiene una edición sin traer; correr `space pull-profile`"]


def sync(client: SpaceClient, pieces: list[dict], seen: dict[tuple, int] | None = None) -> dict:
    """Write the pieces that are new or changed; return what was created, updated and left alone.

    `seen` (kind, key) -> version read before deciding: a piece whose version moved since (the monitor wrote a new
    request meanwhile) is not overwritten; the next pass picks it up.
    """
    current = {(i["kind"], i["key"]): i for i in client.items()["items"]}
    out = {"created": [], "updated": [], "unchanged": [], "deferred": []}
    for p in pieces:
        before = current.get((p["kind"], p["key"]))
        same = before is not None and all(before.get(k) == p[k] for k in ("title", "content", "format", "visibility"))
        if same:
            out["unchanged"].append(f"{p['kind']}/{p['key']}")
            continue
        if seen is not None and before is not None and before.get("version") != seen.get((p["kind"], p["key"])):
            out["deferred"].append(f"{p['kind']}/{p['key']}")
            continue
        client.put(p["kind"], p["key"], title=p["title"], content=p["content"], fmt=p["format"],
                   visibility=p["visibility"])
        out["created" if before is None else "updated"].append(f"{p['kind']}/{p['key']}")
    return out


def _agent_items(client: SpaceClient) -> list[tuple[dict, dict]]:
    out = []
    for item in client.items("agent")["items"]:
        try:
            content = json.loads(item["content"])
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(content, dict):
            out.append((item, content))
    return out


def apply_requests(client: SpaceClient, kb: KnowledgeBase, scheduler, now: datetime | None = None,
                   items: list[tuple[dict, dict]] | None = None) -> list[dict]:
    """Carry out the on/off requests the monitor wrote into the agent pieces; return what was done or refused.

    Only an agent of this PC whose slug is the piece's key is touched (the id comes from GaleCore). A request older
    than the agent's last change is refused: the owner decided something later (on this PC or by chat).
    """
    from galecore_ai.application import tasks as t

    known = {_slug(x["id"]): x["id"] for x in t.list_tasks(kb)}
    done = []
    for item, content in (items if items is not None else _agent_items(client)):
        req = content.get("request") or {}
        wanted = req.get("status")
        if wanted not in ("active", "paused"):
            continue
        task_id = known.get(item["key"])
        if task_id is None or task_id != content.get("id"):
            done.append({"agent": item["key"], "status": wanted, "result": "refused",
                         "error": "este agente no existe en la PC donde corren los agentes"})
            continue
        try:
            task = t.load(kb, task_id)
            at = datetime.fromisoformat(str(req.get("at", "")))
            if at.tzinfo is None:
                raise ValueError("naive")
        except ValueError:
            done.append({"agent": item["key"], "status": wanted, "result": "refused", "error": "pedido sin hora válida"})
            continue
        if task.status == "cancelled":
            done.append({"agent": item["key"], "status": wanted, "result": "refused",
                         "error": "el agente está cancelado; se vuelve a crear desde el chat"})
            continue
        if task.status == wanted:
            done.append({"agent": item["key"], "status": wanted, "result": "already"})
            continue
        if at > datetime.now(UTC) + timedelta(minutes=10):
            done.append({"agent": item["key"], "status": wanted, "result": "refused",
                         "error": "pedido con hora futura (¿reloj del navegador adelantado?)"})
            continue
        if at < task.updated_at:
            done.append({"agent": item["key"], "status": wanted, "result": "refused",
                         "error": f"superado por un cambio posterior ({task.updated_at:%Y-%m-%d %H:%M} UTC)"})
            continue
        try:
            change = t.resume if wanted == "active" else t.pause
            change(kb=kb, scheduler=scheduler, task_id=task_id, now=now,
                   prompt=f"Pedido desde el monitor por {client.user} ({req['at']})")
            done.append({"agent": item["key"], "status": wanted, "result": "applied"})
        except (t.TaskError, OSError) as exc:
            done.append({"agent": item["key"], "status": wanted, "result": "refused", "error": str(exc)[:300]})
    return done


def publish_agents(client: SpaceClient, kb: KnowledgeBase, scheduler, now: datetime | None = None) -> dict:
    """Apply the monitor's requests, then publish every agent's state (only the ones that changed are written).

    A refusal stays in the piece (`request_error`) until the next request. A piece whose agent is cancelled or gone
    from this PC is published as cancelled, so the monitor stops showing it as running.
    """
    items = _agent_items(client)
    # Every agent piece, readable or not: one with broken content must not stay deferred forever.
    seen = {("agent", i["key"]): i["version"] for i in client.items("agent")["items"]}
    requests = apply_requests(client, kb, scheduler, now, items)
    refused = {r["agent"]: r["error"] for r in requests if r["result"] == "refused"}
    kept = {i["key"]: c["request_error"] for i, c in items if c.get("request_error") and not c.get("request")}
    pieces = [p for p in local_pieces(kb, now) if p["kind"] == "agent"]
    for p in pieces:
        error = refused.get(p["key"]) or kept.get(p["key"])
        if error:                                # the monitor shows why it did not happen
            p["content"] = json.dumps({**json.loads(p["content"]), "request_error": error}, ensure_ascii=False)
    live = {p["key"] for p in pieces}
    for item, content in items:
        if item["key"] not in live and content.get("status") != "cancelled":
            gone = {k: content[k] for k in ("id", "capability", "schedule", "strategy", "objective") if k in content}
            pieces.append({"kind": "agent", "key": item["key"], "title": item["title"], "format": "json",
                           "visibility": item.get("visibility", "private"),
                           "content": json.dumps({**gone, "status": "cancelled", "state": "CANCELLED",
                                                  "request_error": refused.get(item["key"])}, ensure_ascii=False)})
    return {"requests": requests, **sync(client, pieces, seen)}


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
