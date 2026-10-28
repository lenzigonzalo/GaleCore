"""The trader's space in GaleCore (GC-0007 / GC-AI-0021): GaleCore-AI reads and writes it as the trader.

GaleCore keeps one row per piece (profile, objective, convention, memory, skill, agent, data), owned by a user and
private or shared. The endpoints need the user's login, not the API key alone: this client logs in with
GALECORE_USERNAME / GALECORE_PASSWORD, or, on GaleCore Dev only, with the demo user of `galecore-app/dev/.local/env.json`.
Nothing here stores a credential.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import httpx

from galecore_ai.adapters.knowledge_base import PRODUCT_ROOT

KINDS = ("profile", "objective", "convention", "memory", "skill", "agent", "data")


class SpaceError(Exception):
    """GaleCore refused or did not answer; the message says why (never a credential)."""


def _dev_env() -> Path | None:
    """GaleCore Dev's local config, found from this file upwards (``<root>/app/dev/.local/env.json``, root = parent of galecore-ai/)."""
    candidate = PRODUCT_ROOT / "galecore-app" / "dev" / ".local" / "env.json"
    return candidate if candidate.is_file() else None


def credentials() -> tuple[str, str, str]:
    """(username, password, where they came from)."""
    user, password = os.environ.get("GALECORE_USERNAME"), os.environ.get("GALECORE_PASSWORD")
    if user and password:
        return user, password, "GALECORE_USERNAME"
    env_file = _dev_env()
    if env_file:
        env = json.loads(env_file.read_text(encoding="utf-8"))
        if env.get("demo_password"):
            return "demo", env["demo_password"], "GaleCore Dev (usuario demo)"
    raise SpaceError("no credentials: set GALECORE_USERNAME and GALECORE_PASSWORD (or run GaleCore Dev locally)")


class SpaceClient:
    def __init__(self, base_url: str | None = None, api_key: str | None = None, *, timeout: float = 20.0,
                 transport: httpx.BaseTransport | None = None) -> None:
        self.base_url = (base_url or os.environ.get("GALECORE_BASE_URL", "http://localhost:7001")).rstrip("/")
        self._headers = {"Accept": "application/json"}
        if key := (api_key or os.environ.get("GALECORE_API_KEY")):
            self._headers["X-Api-Key"] = key
        self._http = httpx.Client(timeout=timeout, transport=transport)
        self.user: str | None = None
        self.source: str | None = None

    def login(self, username: str | None = None, password: str | None = None) -> None:
        if username is None or password is None:
            username, password, self.source = credentials()
        r = self._call("POST", "/App/GaleCore/Auth/Login", json={"username": username, "password": password},
                       auth=False)
        self._headers["Authorization"] = f"Bearer {r['accessToken']}"
        self.user = username

    def _call(self, method: str, path: str, *, auth: bool = True, **kw):
        if auth and "Authorization" not in self._headers:
            self.login()
        try:
            r = self._http.request(method, self.base_url + path, headers=self._headers, **kw)
        except httpx.HTTPError as exc:
            raise SpaceError(f"GaleCore did not answer at {self.base_url}: {type(exc).__name__}") from exc
        if r.status_code == 204:
            return None
        if r.status_code >= 400:
            detail = r.text[:300] if "password" not in r.text.lower() else "(detail omitted)"
            raise SpaceError(f"{method} {path} -> HTTP {r.status_code}: {detail}")
        return r.json()

    def items(self, kind: str | None = None) -> dict:
        """{'items': [...own...], 'shared': [...shared by others...]}."""
        return self._call("GET", "/App/GaleCore/Space", params={"kind": kind} if kind else None)

    def put(self, kind: str, key: str, *, title: str, content: str, fmt: str = "markdown",
            visibility: str = "private") -> dict:
        body = {"title": title, "content": content, "format": fmt, "visibility": visibility}
        return self._call("PUT", f"/App/GaleCore/Space/{kind}/{key}", json=body)

    def delete(self, kind: str, key: str) -> None:
        self._call("DELETE", f"/App/GaleCore/Space/{kind}/{key}")
