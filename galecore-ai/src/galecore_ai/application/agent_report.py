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


def read_result(path: str) -> tuple[dict, list[dict], bool]:
    """The output of `skill run` as (result, alerts, ok) for the report body.

    A missing or non-JSON file is still a report: the calculation just was not evaluated. Alerts only count when the
    run was ok; they are the valid `avisos` of the script's output (id <= 100, title <= 200, at most ALERTS_MAX).
    """
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        data = None
    if not isinstance(data, dict):
        return {"ok": False, "error": "sin resultado del cálculo"}, [], False
    ok = data.get("ok") is True
    result = {"skill": data.get("skill"), "version": data.get("version"), "ok": ok,
              "error": data.get("error"), "salida": data.get("result")}
    if len(json.dumps(result, ensure_ascii=False)) > RESULT_MAX:
        raise ValueError(f"El resultado del cálculo pesa más de {RESULT_MAX} caracteres: no se manda")
    alerts: list[dict] = []
    salida = data.get("result")
    if ok and isinstance(salida, dict) and isinstance(salida.get("avisos"), list):
        for a in salida["avisos"]:
            if (isinstance(a, dict) and isinstance(a.get("id"), str) and isinstance(a.get("titulo"), str)
                    and 0 < len(a["id"]) <= 100 and 0 < len(a["titulo"]) <= 200):
                alerts.append({"id": a["id"], "titulo": a["titulo"]})
        alerts = alerts[:ALERTS_MAX]
    return result, alerts, ok


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
