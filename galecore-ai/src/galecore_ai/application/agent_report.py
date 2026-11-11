"""WS-0079: a cloud routine reports its run to GaleCore (``POST /App/GaleCore/Agents/{agent_key}/Runs``).

Two credentials travel as headers and are never printed: the global ApiKey (``X-Api-Key``) and the user's agents key
(``X-GaleCore-Agent-Key``, prefix ``gca_``). The summary is cut to ``SUMMARY_MAX`` instead of failing: a routine must
not lose its report because it wrote too much.
"""

from __future__ import annotations

from datetime import UTC, datetime
from urllib.parse import quote

import httpx

SUMMARY_MAX = 4000
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
