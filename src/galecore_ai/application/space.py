"""The trader's space (GC-AI-0021): bring what GaleCore-AI already knows into GaleCore, and read it back at the start.

`local_pieces` turns the local sources into pieces of the space: the scheduled agents (tasks) and the catalog's skills (shared: they are the team's methods). `sync` writes
only what changed (the version in GaleCore goes up only then). `context` is the short summary a session starts with.

Agents (GC-AI-0023): each agent piece also carries what the monitor's Agentes screen shows: whether its latest
result is current, the last run and its findings. The monitor cannot reach this PC, so turning an agent on or off
there is a request written into the piece (`request: {status, at}`); `apply_requests` carries it out here (pause or
resume through the scheduler, recorded in the task's events) before the pieces are published again.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, date, datetime, timedelta

from galecore_ai.adapters.galecore_space import SpaceClient
from galecore_ai.application.knowledge import KnowledgeBase, KnowledgeError
from galecore_ai.contracts.task import Schedule
from galecore_ai.harness.assets import load_asset
from galecore_ai.harness.catalog import load_catalog
from galecore_ai.harness.definitions import SkillDefinition


def _slug(text: str, limit: int = 48) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower().translate(str.maketrans("áéíóúñü", "aeiounu"))).strip("-")
    return (s[:limit].rstrip("-") or "x")


FINDINGS_LIMIT = 12_000          # characters of the latest result shown in the monitor; the full one stays here
HISTORY_LIMIT = 20
HISTORY_FINDINGS_LIMIT = 6000   # bounded publication, never grows with the lifetime of a task


def _research_findings(kb: KnowledgeBase, ref: str, revision: int | None = None) -> str | None:
    """A research result as short markdown for the monitor: what was found, what is missing, what follows."""
    doc = kb.research.load(ref.removeprefix("research:"))
    if doc is None:
        return None
    rev = next((r for r in doc.revisions if r.revision == revision), None) if revision is not None else doc.current
    if rev is None:
        return None
    c = rev.content
    lines = [f"**{c.title}**", "", *(f"- {s.text}" for s in c.statements)]
    for title, items in (("Falta", c.missing), ("Próximos pasos", c.next_steps), ("Límites", c.limitations)):
        if items:
            lines += ["", f"**{title}**", "", *(f"- {i}" for i in items)]
    return "\n".join(lines)


def _agent_history(kb: KnowledgeBase, task, outcomes: list[dict]) -> list[dict]:
    """Each row refers to its own stored revision, never the most recent successful result."""
    from galecore_ai.application import tasks as t

    followups = {r.id: r for r in t.runs(kb, task, limit=HISTORY_LIMIT)} if task.kind in t.CODE_RUNNERS else {}
    rows = []
    for e in reversed(outcomes[-HISTORY_LIMIT:]):
        findings = None
        if e.get("research") and e.get("revision") is not None:
            findings = _research_findings(kb, e["research"], e["revision"])
        elif rec := followups.get(e.get("followup")):
            lines = []
            for title, items in (("Atención", rec.attention), ("Funcionamiento", rec.operation),
                                 ("Resultados SHADOW", rec.shadow), ("Hipótesis", rec.hypothesis)):
                lines += [f"## {title}", *(f"- {x}" for x in items), ""]
            findings = "\n".join(lines)
        trimmed = bool(findings and len(findings) > HISTORY_FINDINGS_LIMIT)
        rows.append({**{k: e[k] for k in ("at", "result", "invoked_by", "duration_s", "model", "reason", "error")
                        if e.get(k) is not None}, "failed": e["event"] == "run_failed",
                     "findings": findings[:HISTORY_FINDINGS_LIMIT] if findings else None, "truncated": trimmed})
    return rows


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
        "model": task.model, "model_default": (t.schedulable_entry(task.kind).schedulable.model
                                                if task.kind not in t.CODE_RUNNERS else None),
        "editable": True, "model_editable": task.kind not in t.CODE_RUNNERS,
        "schedule_spec": task.schedule.model_dump(exclude_none=True), "delivery": task.delivery,
        "tools": ((task.tools if task.tools is not None else t.available_tools(task.kind))
                  if task.kind not in t.CODE_RUNNERS else None),
        "tools_available": t.available_tools(task.kind) if task.kind not in t.CODE_RUNNERS else None,
        "history": _agent_history(kb, task, outcomes), "history_total": len(outcomes),
        "state": fresh["state"], "state_detail": fresh.get("detail"), "next_expected_at": fresh.get("next_expected_at"),
        "last_run": ({k: last[k] for k in ("at", "result", "invoked_by", "duration_s", "model", "reason", "error")
                      if last.get(k) is not None} | {"failed": last["event"] == "run_failed"}) if last else None,
        "runs": sum(1 for e in log if e["event"] == "run_finished"),
        "findings": findings,
        "result_ref": ((last or {}).get("research") or (last or {}).get("followup")),
    }


def local_pieces(kb: KnowledgeBase, now: datetime | None = None) -> list[dict]:
    """Every piece the local sources hold today (agents and skills; no profile since WS-0058), as {kind, key, title, content, format, visibility}."""
    from galecore_ai.application import tasks as t  # lazy: tasks imports the CLI side lazily too

    pieces: list[dict] = []
    for task in (x for x in t.list_tasks(kb) if x["status"] != "cancelled"):   # a cancelled task is history
        pieces.append({"kind": "agent", "key": _slug(task["id"]), "title": f"{task['id']} ({task['capability']})",
                       "content": json.dumps({"id": task["id"], **agent_state(kb, task["id"], now)},
                                             ensure_ascii=False),
                       "format": "json", "visibility": "private"})
    for entry in load_catalog().entries:
        if entry.skill.endswith(".md"):  # the skill itself, as written (WS-0054), not a summary of the catalog
            skill = load_asset(entry.skill, SkillDefinition)
            content, title = f"{skill.description.strip()}\n\n{skill.system_prompt}", skill.display_name
            if skill.answer:
                content += f"\n\n## Cómo responder\n{skill.answer}"
        else:
            lines = [entry.serves.strip(), "", "Pedidos de ejemplo:", *(f"- {r}" for r in entry.example_requests)]
            content, title = "\n".join(lines), entry.id
        pieces.append({"kind": "skill", "key": _slug(entry.id.replace("_", "-")), "title": title,
                       "content": content, "format": "markdown", "visibility": "shared"})
    return pieces


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


def _create_agent(kb: KnowledgeBase, scheduler, item: dict, content: dict, create, req: dict, user, now) -> dict:
    """A new agent asked for in the monitor (WS-0055): the piece's key is the slug of its id; only skills that run
    through the model, read-only, from the catalog's schedulable ones."""
    from galecore_ai.application import tasks as t

    out = {"agent": item["key"], "status": None, "result": "refused"}
    try:
        at = datetime.fromisoformat(str(req.get("at", "")))
        if at.tzinfo is None or at > datetime.now(UTC) + timedelta(minutes=10):
            raise ValueError("pedido sin hora válida")
        if not isinstance(create, dict) or _slug(str(create.get("id", ""))) != item["key"] or set(create) - {"id", "kind", "objective", "schedule", "strategy", "model", "tools", "delivery"}:
            raise ValueError("pedido de alta inválido")
        kind = str(create.get("kind", ""))
        if t.schedulable_entry(kind).schedulable.runs != "model":
            raise t.TaskError("sólo se crean agentes de skills que corren por el modelo")
        t.create(kb=kb, scheduler=scheduler, task_id=item["key"], strategy=create.get("strategy"),
                 objective=str(create.get("objective", "")), sources=["GaleCore"],
                 expected_result=f"Una corrida completa de {kind} con su resultado guardado",
                 schedule=Schedule.model_validate(create.get("schedule") or {}), capability=kind,
                 prompt=f"Alta desde el monitor por {user} ({req['at']})", now=now, model=create.get("model"),
                 tools=create.get("tools"), delivery=create.get("delivery"))
        out["result"] = "applied"
    except (t.TaskError, OSError, ValueError) as exc:
        out["error"] = str(exc)[:300]
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
        if not isinstance(req, dict):
            continue
        wanted = req.get("status")
        settings = req.get("settings")
        create = req.get("create")
        if wanted not in ("active", "paused") and settings is None and create is None:
            continue
        if create is not None and item["key"] not in known:
            done.append(_create_agent(kb, scheduler, item, content, create, req, client.user, now))
            continue
        if create is not None:
            done.append({"agent": item["key"], "status": wanted, "result": "refused", "error": "el agente ya existe"})
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
        if settings is None and task.status == wanted:
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
            prompt = f"Pedido desde el monitor por {client.user} ({req['at']})"
            if settings is not None:
                if wanted is not None or not isinstance(settings, dict):
                    raise t.TaskError("pedido de configuración inválido; enviá instrucciones/modelo por separado del estado")
                settings = dict(settings)
                schedule = Schedule.model_validate(settings.pop("schedule")) if "schedule" in settings else None
                if settings:
                    t.set_settings(kb=kb, task_id=task_id, settings=settings, prompt=prompt,
                                   expected_updated_at=task.updated_at, now=now)
                if schedule is not None:
                    t.set_frequency(kb=kb, scheduler=scheduler, task_id=task_id, schedule=schedule, prompt=prompt,
                                    now=now)
            else:
                change = t.resume if wanted == "active" else t.pause
                change(kb=kb, scheduler=scheduler, task_id=task_id, now=now, prompt=prompt)
            done.append({"agent": item["key"], "status": wanted, "result": "applied"})
        except (t.TaskError, OSError, ValueError) as exc:
            done.append({"agent": item["key"], "status": wanted, "result": "refused", "error": str(exc)[:300]})
    return done


SUPERVISOR_KEY = "supervisor"
ALERTS_SHOWN = 20


def supervisor_piece(kb: KnowledgeBase, scan: dict, response_errors: dict[str, str] | None = None,
                     now: datetime | None = None, unwatch_errors: dict[str, str] | None = None) -> dict:
    """The supervisor (WS-0007) as an agent piece: its last pass and the latest alerts with their decision.

    The monitor sounds for an alert it has not seen and shows its options; the owner's answer comes back in
    ``responses`` (alert id -> {choice, words, expected, review_by, at}) and `apply_responses` records it.
    ``analyses`` carries the stored analyses of the shown alerts (WS-0008); «Analizá este aviso» opens Claude Code in
    the monitor since P1-01c, so nothing comes back from the button.
    ``watches`` lists the active price rules (a price alert is not an agent; the pass just evaluates it) so the monitor
    draws them; deleting one comes back in ``unwatch`` (rule id -> {at}) and `apply_unwatch` cancels it.
    """
    from galecore_ai.application import alert_analysis, watch
    from galecore_ai.application import supervisor as sv

    shown = sv.view(kb, ALERTS_SHOWN, today=(now or datetime.now(UTC)).astimezone(sv.NEW_YORK).date(), today_only=True)
    analyses = alert_analysis.view(kb, [a["id"] for a in shown], now)
    pending = [a for a in shown if a["decision"] is None and a["needs_decision"]]
    failed = "error" in scan or bool(scan.get("problems"))
    lines = [f"**{len(pending)} aviso(s) para decidir.**" if pending else "Nada para decidir.", ""]
    lines += [f"- {a['motivo']} — {a['propuesta']}" for a in pending]
    met = watch._met(kb)
    watches = [{"id": r.id, "symbol": r.symbol, "metric": r.metric.value, "condition": r.condition.value,
                "threshold": r.threshold, "words": r.words, "created_at": r.created_at.isoformat()}
               for r in watch.rules(kb) if watch.status(kb, r, now, met=met) == "active"]   # newest first
    content = {
        "id": SUPERVISOR_KEY, "capability": "supervisor", "status": "active", "schedule": "cada 5 minutos",
        "strategy": None,
        "objective": "Vigilar tus avisos de precio y las reglas de lo abierto en SHADOW (stop, cierres, precio, límite) y guardar tus decisiones",
        "state": "FAILED" if failed else "CURRENT",
        "state_detail": scan.get("error") or ("; ".join(scan["problems"]) if scan.get("problems") else None),
        "next_expected_at": None,
        "last_run": {"at": scan["at"], "result": scan.get("error") or
                     (f"{scan.get('checked', 0)} posición(es) revisadas, {len(scan.get('new', []))} aviso(s) nuevo(s)"
                      + (f"; sin leer: {'; '.join(scan['problems'])}" if scan.get("problems") else "")),
                     "invoked_by": "espacio-agentes", "failed": failed},
        "runs": 0, "findings": "\n".join(lines), "result_ref": None,
        "alerts": shown, "analyses": analyses, "watches": watches,
        **({"response_errors": response_errors} if response_errors else {}),
        **({"unwatch_errors": unwatch_errors} if unwatch_errors else {}),
    }
    return {"kind": "agent", "key": SUPERVISOR_KEY, "title": "Avisos y supervisión de estrategias",
            "content": json.dumps(content, ensure_ascii=False), "format": "json", "visibility": "private"}


def apply_responses(kb: KnowledgeBase, content: dict, user: str | None) -> tuple[list[dict], dict[str, str]]:
    """Record the answers the owner gave in the monitor; return (what was done, alert id -> why it was refused)."""
    from galecore_ai.application import supervisor as sv

    done, errors = [], {}
    answered = sv.decisions(kb)
    for alert_id, r in (content.get("responses") or {}).items():
        if alert_id in answered or not isinstance(r, dict):
            continue
        try:
            review_by = date.fromisoformat(r["review_by"]) if r.get("review_by") else None
            sv.decide(kb=kb, alert_id=alert_id, choice=str(r.get("choice", "")), words=str(r.get("words") or ""),
                      expected=str(r.get("expected") or ""), review_by=review_by, source="monitor",
                      prompt=f"Respuesta desde el monitor por {user} ({r.get('at', 'sin hora')})")
            done.append({"alert": alert_id, "result": "recorded"})
        except (KnowledgeError, ValueError) as exc:
            errors[alert_id] = str(exc)[:300]
            done.append({"alert": alert_id, "result": "refused", "error": errors[alert_id]})
    return done, errors


def apply_unwatch(kb: KnowledgeBase, content: dict, user: str | None) -> dict[str, str]:
    """Cancel the price rules the owner deleted in the monitor; return rule id -> why it failed (gone = idempotent)."""
    from galecore_ai.application import watch

    errors = {}
    met = watch._met(kb)
    active = {r.id for r in watch.rules(kb) if watch.status(kb, r, met=met) == "active"}
    for rule_id, r in (content.get("unwatch") or {}).items():
        if rule_id not in active:
            continue
        at = r.get("at", "sin hora") if isinstance(r, dict) else "sin hora"
        try:
            watch.cancel(kb, rule_id, words="borrado desde el gráfico",
                         prompt=f"Borrado desde el monitor por {user} ({at})")
        except KnowledgeError as exc:
            errors[rule_id] = str(exc)[:300]
    return errors


def publish_agents(client: SpaceClient, kb: KnowledgeBase, scheduler, now: datetime | None = None,
                   supervise=None) -> dict:
    """Apply the monitor's requests, then publish every agent's state (only the ones that changed are written).

    A refusal stays in the piece (`request_error`) until the next request. A piece whose agent is cancelled or gone
    from this PC is removed from the space (WS-0063), unless a refused request must still be explained: then it is published as cancelled once.
    """
    items = _agent_items(client)
    # Every agent piece, readable or not: one with broken content must not stay deferred forever.
    seen = {("agent", i["key"]): i["version"] for i in client.items("agent")["items"]}
    requests = apply_requests(client, kb, scheduler, now, items)
    refused = {r["agent"]: r["error"] for r in requests if r["result"] == "refused"}
    kept = {i["key"]: c["request_error"] for i, c in items if c.get("request_error") and not c.get("request")}
    pieces = [p for p in local_pieces(kb, now) if p["kind"] == "agent"]
    responses: list[dict] = []
    if supervise is not None:                    # WS-0007: answers first, then a pass, then the piece
        from galecore_ai.application import supervisor as sv

        mine = next((c for i, c in items if i["key"] == SUPERVISOR_KEY), {})
        at = (now or datetime.now(UTC)).isoformat()
        try:
            responses, errors = apply_responses(kb, mine, client.user)
            unwatch_errors = apply_unwatch(kb, mine, client.user)
            try:
                scan = sv.scan(kb, supervise, now)
            except sv.SupervisorError as exc:
                scan = {"at": at, "error": str(exc)}
            pieces.append(supervisor_piece(kb, scan, errors, now, unwatch_errors))
        except (KnowledgeError, ValueError) as exc:   # a damaged alert or log: the other agents still publish
            responses = [{"result": "refused", "error": str(exc)[:300]}]
            keep = {k: mine[k] for k in ("alerts", "responses", "analyses", "unwatch") if k in mine}
            pieces.append({"kind": "agent", "key": SUPERVISOR_KEY, "title": "Avisos y supervisión de estrategias",
                           "format": "json", "visibility": "private",
                           "content": json.dumps({**mine, **keep, "id": SUPERVISOR_KEY, "capability": "supervisor",
                                                  "status": "active", "state": "FAILED",
                                                  "state_detail": f"registro de avisos dañado: {str(exc)[:200]}",
                                                  "last_run": {"at": at, "result": "falló", "failed": True}},
                                                 ensure_ascii=False)})
    for p in pieces:
        error = refused.get(p["key"]) or kept.get(p["key"])
        if error:                                # the monitor shows why it did not happen
            p["content"] = json.dumps({**json.loads(p["content"]), "request_error": error}, ensure_ascii=False)
    live = {p["key"] for p in pieces}
    for item, content in items:
        if item["key"] == SUPERVISOR_KEY:          # not a task: only a pass with `supervise` rewrites it
            continue
        if item["key"] not in live and not refused.get(item["key"]):
            client.delete("agent", item["key"])    # WS-0063: a cancelled or gone task is history, not a piece in the space
            continue
        if item["key"] not in live and content.get("status") != "cancelled":
            gone = {k: content[k] for k in ("id", "capability", "schedule", "strategy", "objective") if k in content}
            pieces.append({"kind": "agent", "key": item["key"], "title": item["title"], "format": "json",
                           "visibility": item.get("visibility", "private"),
                           "content": json.dumps({**gone, "status": "cancelled", "state": "CANCELLED",
                                                  "request_error": refused.get(item["key"])}, ensure_ascii=False)})
    return {"requests": requests, "responses": responses, **sync(client, pieces, seen)}


def context(client: SpaceClient) -> str:
    """The session's opening summary: the trader's name, interests and memory (the whole profile, WS-0058), and what they have."""
    space = client.items()
    own, shared = space["items"], space["shared"]
    by_kind: dict[str, list[dict]] = {}
    for i in own:
        by_kind.setdefault(i["kind"], []).append(i)
    lines = [f"[espacio] {client.user}: {len(own)} piezas propias, {len(shared)} compartidas por el equipo"]
    conventions = {c["key"]: c for c in by_kind.get("convention", [])}
    for key, label in {"como-te-llamo": "nombre", "intereses": "intereses"}.items():
        if text := " ".join(str(conventions.get(key, {}).get("content", "")).split()):
            lines.append(f"  {label}: {text}")
    for m in by_kind.get("memory", []):  # title + one line each: short enough to go whole
        lines.append(f"  memoria — {m['title']}: " + " ".join(str(m.get("content", "")).split()))
    counts = [f"{len(by_kind[k])} {label}" for k, label in
              {"agent": "agentes", "skill": "skills", "data": "datos"}.items() if by_kind.get(k)]
    if counts:
        lines.append("  además: " + " · ".join(counts))
    # The trader's own skills (created in the monitor, private) are not in the catalog: name them so a request can
    # use one (WS-0054); the product's skills are shared and reached through the catalog.
    for s in (i for i in by_kind.get("skill", []) if i.get("visibility") == "private"):
        first = next((ln.strip() for ln in str(s.get("content", "")).splitlines() if ln.strip()), "")
        lines.append(f"  skill propia «{s['title']}» (`space show skill/{s['key']}`): {first[:140]}")
    shared_kinds = sorted({i["kind"] for i in shared})
    if shared_kinds:
        lines.append("  compartido: " + ", ".join(f"{k} ({sum(1 for i in shared if i['kind'] == k)})" for k in shared_kinds))
    lines.append("  detalle: `space list [--kind K]` · `space show K/clave`")
    return "\n".join(lines)
