"""WS-0079: a cloud routine reports its run to GaleCore (``POST /App/GaleCore/Agents/{agent_key}/Runs``).

Two credentials travel as headers and are never printed: the global ApiKey (``X-Api-Key``) and the user's agents key
(``X-GaleCore-Agent-Key``, prefix ``gca_``). The summary is cut to ``SUMMARY_MAX`` instead of failing: a routine must
not lose its report because it wrote too much.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote

import httpx

from galecore_ai.application.skill_run import MANIFEST

SUMMARY_MAX = 4000
RESULT_MAX = 50_000
ALERTS_MAX = 10
STATUSES = ("ok", "error", "skipped")
_transport: httpx.BaseTransport | None = None   # tests inject a fake GaleCore here


class AgentReportError(Exception):
    """The report did not go through; the message is safe to print (no credential)."""

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


def clip_summary(text: str) -> str:
    text = text.strip()
    return text if len(text) <= SUMMARY_MAX else text[: SUMMARY_MAX - 1] + "…"


def check_iso(value: str, *, flag: str) -> str:
    try:
        datetime.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{flag} debe ser una fecha ISO-8601, recibí {value!r}") from exc
    return value


def build_body(*, status: str, summary: str, reason_code: str | None, trigger_id: str | None,
               fired_at: str | None, finished_at: str | None) -> dict:
    body: dict = {"status": status, "summary": clip_summary(summary)}
    for key, value in (("reason_code", reason_code), ("trigger_id", trigger_id), ("fired_at", fired_at)):
        if value:
            body[key] = value
    body["finished_at"] = finished_at or datetime.now(UTC).isoformat()
    return body


def read_results(folder: str) -> tuple[dict | None, list[dict], list[str]]:
    """What the skills left in GALECORE_RESULTS_DIR as (result, alerts, unevaluated) for the report body.

    ``result`` is ``{"corridas": [{skill, script, version, ok, error, salida}]}`` or None when nothing was to be
    calculated (only markdown skills were pulled). ``alerts`` are the valid ``avisos`` of the corridas that were ok (id
    <= 100, title <= 200, at most ALERTS_MAX in all). ``unevaluated`` says what stayed without a calculation: a corrida
    that failed, or no corrida at all when a skill with scripts (or none) was pulled.
    """
    base = Path(folder)
    corridas: list[dict] = []
    for path in sorted(base.glob("*.json")) if base.is_dir() else []:
        if path.name == MANIFEST:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            data = None
        if not isinstance(data, dict):
            corridas.append({"skill": path.stem, "script": None, "version": None, "ok": False, "error": "salida ilegible", "salida": None})
            continue
        ok = data.get("ok") is True
        error = data.get("error") or (None if ok else ((data.get("stderr") or "").strip().splitlines() or ["falló sin detalle"])[-1][:300])
        corridas.append({"skill": data.get("skill"), "script": data.get("script"), "version": data.get("version"), "ok": ok,
                         "error": error, "salida": data.get("result")})
    unevaluated = [f"{c['skill']}/{c['script']}: {c['error']}" for c in corridas if not c["ok"]]
    if not corridas:
        try:
            pulled = json.loads((base / MANIFEST).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pulled = None
        if pulled and not any(r.get("scripts") for r in pulled):
            return None, [], []                       # only markdown skills: nothing to calculate
        return {"corridas": [], "error": "sin resultado del cálculo"}, [], ["sin resultado del cálculo"]
    result = {"corridas": corridas}
    if len(json.dumps(result, ensure_ascii=False)) > RESULT_MAX:
        raise ValueError(f"El resultado del cálculo pesa más de {RESULT_MAX} caracteres: no se manda")
    alerts: list[dict] = []
    for c in corridas:
        salida = c["salida"]
        if c["ok"] and isinstance(salida, dict) and isinstance(salida.get("avisos"), list):
            for a in salida["avisos"]:
                if (isinstance(a, dict) and isinstance(a.get("id"), str) and isinstance(a.get("titulo"), str)
                        and 0 < len(a["id"]) <= 100 and 0 < len(a["titulo"]) <= 200):
                    alerts.append({"id": a["id"], "titulo": a["titulo"]})
    return result, alerts[:ALERTS_MAX], unevaluated


def get_skill(*, base_url: str, api_key: str | None, agent_secret: str, skill_key: str, timeout: float = 30.0) -> dict:
    """The space piece of a skill (own or shared) as the agents key sees it; the only thing that key can read."""
    headers = {"X-GaleCore-Agent-Key": agent_secret}
    if api_key:
        headers["X-Api-Key"] = api_key
    url = f"{base_url.rstrip('/')}/App/GaleCore/Agents/Skills/{quote(skill_key, safe='')}"
    try:
        with httpx.Client(timeout=timeout, transport=_transport) as http:
            r = http.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise AgentReportError(f"GaleCore no respondió en {base_url}: {type(exc).__name__}") from exc
    if r.status_code == 404:
        raise AgentReportError(f"La skill «{skill_key}» no existe o no es tuya ni compartida", status=404)
    if r.status_code >= 400:
        raise AgentReportError(f"GaleCore rechazó la lectura de la skill (HTTP {r.status_code})", status=r.status_code)
    try:
        return r.json()
    except ValueError as exc:
        raise AgentReportError("GaleCore respondió algo que no es JSON") from exc


def post_run(*, base_url: str, api_key: str | None, agent_secret: str, agent_key: str, body: dict,
             timeout: float = 30.0) -> dict:
    headers = {"X-GaleCore-Agent-Key": agent_secret, "Content-Type": "application/json"}
    if api_key:
        headers["X-Api-Key"] = api_key
    url = f"{base_url.rstrip('/')}/App/GaleCore/Agents/{agent_key}/Runs"
    try:
        with httpx.Client(timeout=timeout, transport=_transport) as http:
            r = http.post(url, headers=headers, json=body)
    except httpx.HTTPError as exc:
        raise AgentReportError(f"GaleCore no respondió en {base_url}: {type(exc).__name__}") from exc
    if r.status_code >= 400:
        try:
            detail = r.json()
        except ValueError:
            detail = None
        message = detail.get("error") if isinstance(detail, dict) else None
        code = detail.get("code") if isinstance(detail, dict) else None
        text = f"{message or 'respuesta sin detalle'}" + (f" ({code})" if code else "")
        for secret in (agent_secret, api_key):   # never echo a credential, even if the API did
            if secret:
                text = text.replace(secret, "***")
        raise AgentReportError(f"GaleCore rechazó el reporte (HTTP {r.status_code}): {text}", status=r.status_code)
    try:
        return r.json()
    except ValueError as exc:
        raise AgentReportError("GaleCore respondió algo que no es JSON") from exc
