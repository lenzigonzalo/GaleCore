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
import shlex
from datetime import UTC, date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from galecore_ai.adapters.galecore_space import SpaceClient, SpaceError
from galecore_ai.adapters.knowledge_base import PRODUCT_ROOT
from galecore_ai.application import space
from galecore_ai.contracts.task import WEEKDAYS, Schedule

REPO_URL = "https://github.com/lenzigonzalo/GaleCore"
DEFAULT_MODEL = "claude-sonnet-5"
ALLOWED_TOOLS = ["Bash", "Read", "Glob", "Grep"]
CLOUD_FREQUENCIES = ("daily", "weekdays", "days")      # the form offers once a day at most
NO_ENVIRONMENT = "Falta configurar el entorno de los agentes en la nube (pasale al Lab el link del entorno de claude.ai)."
ENV_ID = re.compile(r"env_[A-Za-z0-9]+")
REQUEST_KEYS = ("create", "settings", "status", "run", "delete")


class AgentCloudError(Exception):
    """Something the trader or the Lab can fix; the message is safe to show."""


def lab_local() -> Path:
    """The Lab's local config folder: GALECORE_LAB_LOCAL, else galecore-lab/.local (as lab-server.js)."""
    var = os.environ.get("GALECORE_LAB_LOCAL")
    return Path(var).resolve() if var else PRODUCT_ROOT / "galecore-lab" / ".local"


def _config() -> dict:
    try:
        data = json.loads((lab_local() / "agents.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _save_config(data: dict) -> None:
    folder = lab_local()
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "agents.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def environment_id() -> str:
    env = _config().get("environment_id")
    if not isinstance(env, str) or not ENV_ID.fullmatch(env):
        raise AgentCloudError(NO_ENVIRONMENT)
    return env


def set_environment(text: str) -> str:
    """Save the cloud environment (its id, or the claude.ai link that contains it) in the Lab's local config."""
    found = ENV_ID.search(text or "")
    if not found:
        raise AgentCloudError("No encontré el id del entorno (empieza con env_) en lo que pegaste.")
    _save_config({**_config(), "environment_id": found.group(0)})
    return found.group(0)


def routine_variables(client: SpaceClient, key: str | None = None) -> tuple[dict[str, str], bool]:
    """The four variables the routine's instruction exports, and whether the agent key was just generated.

    The first three come from the environment of this process (the Lab has them pointing at production); the agent
    key is the one saved in the Lab's config, generated here if missing. Generating one invalidates the previous: the
    other cloud routines get an update request so the Lab rewrites their instruction with the new key. Never printed."""
    env = {n: os.environ.get(n, "").strip() for n in ("GALECORE_BASE_URL", "GALECORE_ALLOWED_BASE_URL", "GALECORE_API_KEY")}
    for name, value in env.items():
        if not value:
            raise AgentCloudError(f"Falta {name} en el entorno del Lab: arrancalo con start-lab.ps1 (apunta a producción).")
    config = _config()
    secret = config.get("agent_key")
    fresh = not isinstance(secret, str) or not secret.strip()
    if fresh:
        try:
            secret = client.agent_key_generate()
        except SpaceError as exc:
            raise AgentCloudError(f"No pude generar la clave de los agentes: {str(exc)[:200]}") from exc
        _save_config({**config, "agent_key": secret})
        _ask_update(client, except_key=key)
    return {**env, "GALECORE_AGENT_KEY": secret}, fresh


def _ask_update(client: SpaceClient, except_key: str | None = None, only_key: str | None = None) -> None:
    """Leave an (empty) settings request in the created cloud pieces so `body` rewrites their routine."""
    for item, content in space._agent_items(client, cloud=True):
        if item["key"] == except_key or (only_key and item["key"] != only_key) or not content.get("trigger_id"):
            continue
        req = content.get("request") if isinstance(content.get("request"), dict) else {}
        piece = {**content, "request": {**req, "settings": req.get("settings") or {},
                                        "at": req.get("at") or datetime.now(UTC).isoformat()}}
        client.put("agent", item["key"], title=item["title"], content=json.dumps(piece, ensure_ascii=False), fmt="json",
                   visibility=item.get("visibility", "private"))


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


def _asked(req: dict, name: str) -> bool:
    """A request key is asked when it is present, even as an empty `settings` ("rewrite the routine")."""
    return req.get(name) not in (None, False)


def instruction(piece: dict, variables: dict[str, str] | None = None) -> str:
    key = piece.get("key") or space._slug(str(piece["id"]))     # the piece's key is what the API validates
    data = ("con GaleCore como fuente de datos (`python3 -m galecore_ai.adapters.cli galecore list` dice qué hay y "
            "`galecore get <capacidad>` lo trae). No inventes ni redondees números: si un dato no está en GaleCore, decilo.")
    write = ("Al final, siempre, también si algo falló: escribí el resultado en markdown (corto, con las cifras y su "
             "fuente) en `resumen.md` con `cat > resumen.md <<'EOF'` y corré:")
    status = ("(`ok` si terminó, `error` si falló y por qué, `skipped` si no había nada para hacer). Si el mensaje de "
              "inicio trae el trigger_id y la hora del disparo, agregá `--trigger-id <id> --fired-at <hora ISO>`.")
    exports = "".join(f"export {n}={shlex.quote(v)}; " for n, v in (variables or {}).items())
    step1 = ("1. Instalá el harness: `" + exports + "cd galecore-ai && python3 -m pip install -q -e .` (desde la raíz del repo)."
             + (" Esas variables valen para los pasos siguientes (consultas a GaleCore y `agent report`): si un comando "
                "no las ve, volvé a exportarlas antes de correrlo." if variables else ""))
    return "\n".join([
        "Sos un agente de GaleCore que corre solo en la nube. Seguí estos pasos en orden.",
        "",
        step1,
        f"2. Hacé esta tarea del usuario, {data}",
        "",
        f"Tarea: {str(piece.get('objective', '')).strip()}",
        "",
        f"3. {write}",
        f"`python3 -m galecore_ai.adapters.cli agent report {key} --status ok|error|skipped --summary-file resumen.md`",
        status,
    ])


def routine_body(piece: dict, environment_id: str, today: date | None = None,
                 variables: dict[str, str] | None = None) -> dict:
    """The `body` of a RemoteTrigger create / update for this agent piece; deterministic."""
    schedule = Schedule.model_validate(piece.get("schedule_spec") or {})
    return {
        "name": f"GaleCore - {piece['id']}",
        "cron_expression": cron_utc(schedule, today),
        "enabled": piece.get("status") != "paused",
        "job_config": {"ccr": {
            "environment_id": environment_id,
            "events": [{"data": {"type": "user", "role": "user", "message": {"role": "user", "content": instruction(piece, variables)}}}],
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
    return [{"key": item["key"], "name": c.get("id"), "requests": [k for k in REQUEST_KEYS if _asked(c["request"], k)],
             "at": c["request"].get("at")}
            for item, c in space._agent_items(client, cloud=True)
            if isinstance(c.get("request"), dict) and any(_asked(c["request"], k) for k in REQUEST_KEYS)]


def body(client: SpaceClient, key: str, today: date | None = None) -> dict:
    """What the Lab sends to RemoteTrigger for this piece: create / update (with the environment), or run."""
    _, content = _find(client, key)
    req = content.get("request") if isinstance(content.get("request"), dict) else {}
    trigger_id = content.get("trigger_id")
    if req.get("delete"):
        if not trigger_id:
            raise AgentCloudError("La rutina todavía no se creó: no hay nada para pausar.")
        return {"action": "update", "trigger_id": trigger_id, "body": {"enabled": False}}
    changes = any(_asked(req, k) for k in ("create", "settings", "status"))
    if req.get("run") and not changes:
        if not trigger_id:
            raise AgentCloudError("La rutina todavía no se creó: no hay nada para ejecutar.")
        _, fresh = routine_variables(client, key)
        if not fresh:
            return {"action": "run", "trigger_id": trigger_id}
        _ask_update(client, only_key=key)        # a new key: this routine is rewritten first and runs on the next pass
        return body(client, key, today)
    env_id = environment_id()
    variables, _ = routine_variables(client, key)
    piece = effective(content) | {"key": key}
    try:
        routine = routine_body(piece, env_id, today, variables)
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
    req = content.get("request") if isinstance(content.get("request"), dict) else {}
    if req.get("delete") and not error:
        client.delete("agent", key)
        return {"agent": key, "deleted": True}
    if error:
        piece = {k: v for k, v in content.items() if k not in ("request", "request_error")} | {"request_error": error[:300]}
    else:
        piece = effective(content)
        if piece.get("status") == "pending":
            piece["status"] = "active"
        for k, v in (("trigger_id", trigger_id), ("routine_url", url)):
            if v:
                piece[k] = v
        if req.get("run") and any(_asked(req, k) for k in ("create", "settings", "status")):
            piece["request"] = {"run": True, "at": req.get("at")}     # the run was asked too: the next pass runs it
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
