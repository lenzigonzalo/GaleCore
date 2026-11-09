"""WS-0079: agents that run in the cloud (a claude.ai routine), registered in the trader's space.

The registry is the `agent` piece itself, marked ``runs_on: "cloud"``: the PC's ``publish_agents`` / ``apply_requests``
never touch it (see ``space``). The monitor writes a ``request`` into the piece (create, settings, status, run); the
Lab applies it with the `RemoteTrigger` tool and tells us the result with ``applied``. This module only builds what the
Lab needs (``routine_body``) and keeps the piece; it never talks to claude.ai.
"""

from __future__ import annotations

import json
import os
import re
from datetime import UTC, date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from galecore_ai.adapters.galecore_space import SpaceClient
from galecore_ai.adapters.knowledge_base import PRODUCT_ROOT
from galecore_ai.application import space
from galecore_ai.contracts.task import WEEKDAYS, Schedule

REPO_URL = "https://github.com/lenzigonzalo/GaleCore"
DEFAULT_MODEL = "claude-sonnet-5"
ALLOWED_TOOLS = ["Bash", "Read", "Glob", "Grep"]
CLOUD_FREQUENCIES = ("daily", "weekdays", "days")      # the form offers once a day at most
NO_ENVIRONMENT = "Falta configurar el entorno de los agentes en la nube (pasale al Lab el link del entorno de claude.ai)."
ENV_ID = re.compile(r"env_[A-Za-z0-9]+")
REQUEST_KEYS = ("create", "settings", "status", "run")


class AgentCloudError(Exception):
    """Something the trader or the Lab can fix; the message is safe to show."""


def lab_local() -> Path:
    """The Lab's local config folder: GALECORE_LAB_LOCAL, else galecore-lab/.local (as lab-server.js)."""
    var = os.environ.get("GALECORE_LAB_LOCAL")
    return Path(var).resolve() if var else PRODUCT_ROOT / "galecore-lab" / ".local"


def environment_id() -> str:
    try:
        env = json.loads((lab_local() / "agents.json").read_text(encoding="utf-8")).get("environment_id")
    except (OSError, ValueError, AttributeError):
        env = None
    if not isinstance(env, str) or not ENV_ID.fullmatch(env):
        raise AgentCloudError(NO_ENVIRONMENT)
    return env


def set_environment(text: str) -> str:
    """Save the cloud environment (its id, or the claude.ai link that contains it) in the Lab's local config."""
    found = ENV_ID.search(text or "")
    if not found:
        raise AgentCloudError("No encontré el id del entorno (empieza con env_) en lo que pegaste.")
    folder = lab_local()
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "agents.json").write_text(json.dumps({"environment_id": found.group(0)}), encoding="utf-8")
    return found.group(0)


def cron_utc(schedule: Schedule, today: date | None = None) -> str:
    """5-field cron in UTC for a daily / weekdays / days schedule. The routine API takes no time zone, so the local
    time is converted with the offset of `today`: across a daylight-saving change the run moves one hour (accepted)."""
    if schedule.frequency not in CLOUD_FREQUENCIES:
        raise AgentCloudError("Un agente en la nube corre una vez por día como máximo: diario, de lunes a viernes o días elegidos.")
    hour, minute = (int(x) for x in str(schedule.time).split(":"))
    zone = ZoneInfo(schedule.timezone)
    local = datetime.combine(today or datetime.now(zone).date(), datetime.min.time(), zone).replace(hour=hour, minute=minute)
    utc = local.astimezone(UTC)
    shift = (utc.date() - local.date()).days            # -1, 0 or +1 day: the weekdays move with it
    if schedule.frequency == "daily":
        dow = "*"
    else:
        days = ["mon", "tue", "wed", "thu", "fri"] if schedule.frequency == "weekdays" else schedule.days
        dow = ",".join(str((WEEKDAYS.index(d) + 1 + shift) % 7) for d in days)    # cron: 0 = Sunday, 1 = Monday
    return f"{utc.minute} {utc.hour} * * {dow}"


def instruction(piece: dict) -> str:
    key = piece.get("key") or space._slug(str(piece["id"]))     # the piece's key is what the API validates
    data = ("con GaleCore como fuente de datos (`python3 -m galecore_ai.adapters.cli galecore list` dice qué hay y "
            "`galecore get <capacidad>` lo trae). No inventes ni redondees números: si un dato no está en GaleCore, decilo.")
    write = ("Al final, siempre, también si algo falló: escribí el resultado en markdown (corto, con las cifras y su "
             "fuente) en `resumen.md` con `cat > resumen.md <<'EOF'` y corré:")
    status = ("(`ok` si terminó, `error` si falló y por qué, `skipped` si no había nada para hacer). Si el mensaje de "
              "inicio trae el trigger_id y la hora del disparo, agregá `--trigger-id <id> --fired-at <hora ISO>`.")
    return "\n".join([
        "Sos un agente de GaleCore que corre solo en la nube. Seguí estos pasos en orden.",
        "",
        "1. Instalá el harness: `cd galecore-ai && python3 -m pip install -q -e .` (desde la raíz del repo).",
        f"2. Hacé esta tarea del usuario, {data}",
        "",
        f"Tarea: {str(piece.get('objective', '')).strip()}",
        "",
        f"3. {write}",
        f"`python3 -m galecore_ai.adapters.cli agent report {key} --status ok|error|skipped --summary-file resumen.md`",
        status,
    ])


def routine_body(piece: dict, environment_id: str, today: date | None = None) -> dict:
    """The `body` of a RemoteTrigger create / update for this agent piece; deterministic."""
    schedule = Schedule.model_validate(piece.get("schedule_spec") or {})
    return {
        "name": f"GaleCore - {piece['id']}",
        "cron_expression": cron_utc(schedule, today),
        "enabled": piece.get("status") != "paused",
        "job_config": {"ccr": {
            "environment_id": environment_id,
            "events": [{"data": {"type": "user", "role": "user", "message": {"role": "user", "content": instruction(piece)}}}],
            "session_context": {
                "allowed_tools": ALLOWED_TOOLS,
                "model": piece.get("model") or DEFAULT_MODEL,
                "sources": [{"git_repository": {"url": REPO_URL}}],
            },
        }},
    }


def effective(content: dict) -> dict:
    """The piece as it will be once its request is carried out (no request left in it)."""
    req = content.get("request") if isinstance(content.get("request"), dict) else {}
    out = {k: v for k, v in content.items() if k not in ("request", "request_error")}
    if isinstance(req.get("create"), dict):
        c = req["create"]
        out.update({k: c[k] for k in ("id", "objective", "schedule_spec", "model") if k in c})
    if isinstance(req.get("settings"), dict):
        out.update({k: v for k, v in req["settings"].items() if k in ("objective", "schedule_spec", "model")})
    if req.get("status") in ("active", "paused"):
        out["status"] = req["status"]
    if out.get("schedule_spec"):
        out["schedule"] = Schedule.model_validate(out["schedule_spec"]).describe()
    return out


def _find(client: SpaceClient, key: str) -> tuple[dict, dict]:
    for item, content in space._agent_items(client, cloud=True):
        if item["key"] == key:
            return item, content
    raise AgentCloudError(f"No hay un agente en la nube «{key}» en tu espacio.")


def pending(client: SpaceClient) -> list[dict]:
    """The cloud pieces with a request nobody applied yet."""
    return [{"key": item["key"], "name": c.get("id"), "requests": [k for k in REQUEST_KEYS if c["request"].get(k)]}
            for item, c in space._agent_items(client, cloud=True)
            if isinstance(c.get("request"), dict) and any(c["request"].get(k) for k in REQUEST_KEYS)]


def body(client: SpaceClient, key: str, today: date | None = None) -> dict:
    """What the Lab sends to RemoteTrigger for this piece: create / update (with the environment), or run."""
    _, content = _find(client, key)
    req = content.get("request") if isinstance(content.get("request"), dict) else {}
    trigger_id = content.get("trigger_id")
    changes = any(req.get(k) for k in ("create", "settings", "status"))
    if req.get("run") and not changes:
        if not trigger_id:
            raise AgentCloudError("La rutina todavía no se creó: no hay nada para ejecutar.")
        return {"action": "run", "trigger_id": trigger_id}
    piece = effective(content) | {"key": key}
    try:
        routine = routine_body(piece, environment_id(), today)
    except ValueError as exc:
        raise AgentCloudError(f"El agente tiene datos inválidos: {str(exc)[:200]}") from exc
    return {"action": "update", "trigger_id": trigger_id, "body": routine} if trigger_id else {"action": "create", "body": routine}


def applied(client: SpaceClient, key: str, trigger_id: str | None = None, url: str | None = None,
            error: str | None = None) -> dict:
    """The Lab did (or failed) what `body` said: store the routine's id and link and clear the request.

    With an error the piece keeps what it had and shows `request_error`. A piece that moved meanwhile (the monitor
    wrote a new request) is left for the next pass.
    """
    item, content = _find(client, key)
    seen = {("agent", key): item["version"]}
    if error:
        piece = {k: v for k, v in content.items() if k not in ("request", "request_error")} | {"request_error": error[:300]}
    else:
        piece = effective(content)
        if piece.get("status") == "pending":
            piece["status"] = "active"
        for k, v in (("trigger_id", trigger_id), ("routine_url", url)):
            if v:
                piece[k] = v
    out = space.sync(client, [{"kind": "agent", "key": key, "title": item["title"], "format": "json",
                               "visibility": item.get("visibility", "private"),
                               "content": json.dumps(piece, ensure_ascii=False)}], seen)
    if out["deferred"]:
        raise AgentCloudError("El agente cambió mientras se aplicaba; se vuelve a intentar en la próxima pasada.")
    return {"agent": key, "status": piece.get("status"), "trigger_id": piece.get("trigger_id"),
            "routine_url": piece.get("routine_url"), "error": error}


def new(client: SpaceClient, name: str, what: str, when: dict, now: datetime | None = None) -> dict:
    """An agent asked for in the chat: the same piece the monitor writes, with its `request.create`."""
    key = space._slug(name)
    if any(i["key"] == key for i in client.items("agent")["items"]):
        raise AgentCloudError(f"Ya hay un agente «{key}» en tu espacio.")
    try:
        schedule = Schedule.model_validate(when)
    except ValueError as exc:
        raise AgentCloudError(f"El «cuándo» no es válido: {str(exc)[:200]}") from exc
    if schedule.frequency not in CLOUD_FREQUENCIES:
        raise AgentCloudError("Un agente en la nube corre una vez por día como máximo: diario, de lunes a viernes o días elegidos.")
    at = (now or datetime.now(UTC)).isoformat()
    spec = schedule.model_dump(exclude_none=True)
    piece = {"id": name.strip(), "runs_on": "cloud", "capability": "routine", "status": "pending",
             "objective": what.strip(), "schedule_spec": spec, "schedule": schedule.describe(), "model": DEFAULT_MODEL,
             "trigger_id": None, "routine_url": None, "created_at": at,
             "request": {"create": {"id": name.strip(), "objective": what.strip(), "schedule_spec": spec}, "at": at}}
    client.put("agent", key, title=name.strip(), content=json.dumps(piece, ensure_ascii=False), fmt="json")
    return {"agent": key, "status": "pending"}
