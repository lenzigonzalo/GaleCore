"""The trader's space in GaleCore (GC-0007 / GC-AI-0021): GaleCore-AI reads and writes it as the trader.

GaleCore keeps one row per piece (profile, objective, convention, memory, skill, agent, data), owned by a user and
private or shared. The endpoints need the user's login, not the API key alone: this client logs in with
GALECORE_USERNAME / GALECORE_PASSWORD, or, on GaleCore Dev only, with the demo user of `galecore-app/dev/.local/env.json`.
Nothing here stores a credential; the session token is cached (see ``session_file``) so each CLI call does not log in
again: the API allows 10 logins per 5 minutes.
"""

from __future__ import annotations

import base64
import json
import os
import time
from pathlib import Path

import httpx

from galecore_ai.adapters.knowledge_base import PRODUCT_ROOT

KINDS = ("profile", "objective", "convention", "memory", "skill", "agent", "data", "idea")


class SpaceError(Exception):
    """GaleCore refused or did not answer; the message says why (never a credential)."""

    def __init__(self, message: str, *, status: int | None = None, body: dict | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.body = body or {}


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


SESSION_MARGIN = 60          # seconds: a token is reused until 60 s before it expires
SESSION_FALLBACK_TTL = 300   # seconds, when the token carries no exp and the login gave no expires_in


def session_file() -> Path:
    """``%LOCALAPPDATA%/GaleCore/session.json`` (``~/.galecore/session.json`` without LOCALAPPDATA)."""
    local = os.environ.get("LOCALAPPDATA")
    return (Path(local) / "GaleCore" if local else Path.home() / ".galecore") / "session.json"


def _token_expiry(token: str, expires_in: object = None) -> float:
    """Epoch seconds when the token stops being valid: its JWT ``exp``, else ``expires_in`` from the login, else a short TTL."""
    try:
        payload = token.split(".")[1]
        exp = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))).get("exp")
        if isinstance(exp, (int, float)):
            return float(exp)
    except (IndexError, ValueError, TypeError):
        pass
    ttl = expires_in if isinstance(expires_in, (int, float)) and expires_in > 0 else SESSION_FALLBACK_TTL
    return time.time() + ttl


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

    # -- session token cache (per user + base URL); a failure to read or write it never breaks a call.

    def _session_key(self, username: str) -> str:
        return f"{username}@{self.base_url}"

    def _cached_token(self, username: str) -> str | None:
        try:
            entry = json.loads(session_file().read_text(encoding="utf-8")).get(self._session_key(username))
            if entry and entry["exp"] - SESSION_MARGIN > time.time():
                return entry["token"]
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            pass
        return None

    def _store_token(self, username: str, token: str | None, exp: float = 0.0) -> None:
        """Save (or, with ``token=None``, drop) this user's token; other users' entries stay. User-only permissions."""
        path = session_file()
        try:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                data = data if isinstance(data, dict) else {}
            except (OSError, ValueError):
                data = {}
            now = time.time()
            data = {k: v for k, v in data.items() if isinstance(v, dict) and v.get("exp", 0) > now}   # expired ones go
            data.pop(self._session_key(username), None)
            if token:
                data[self._session_key(username)] = {"token": token, "exp": exp}
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(path.name + ".tmp")
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(data, fh)
            os.replace(tmp, path)
            try:
                path.chmod(0o600)
            except OSError:
                pass
        except OSError:
            pass

    def login(self, username: str | None = None, password: str | None = None, *, fresh: bool = False) -> None:
        """Reuse the cached token for this user when it is still valid; ``fresh`` forces a real login."""
        if username is None or password is None:
            username, password, self.source = credentials()
        if not fresh and (token := self._cached_token(username)):
            self._headers["Authorization"] = f"Bearer {token}"
            self.user = username
            return
        r = self._call("POST", "/App/GaleCore/Auth/Login", json={"username": username, "password": password},
                       auth=False)
        self._headers["Authorization"] = f"Bearer {r['accessToken']}"
        self.user = username
        self._store_token(username, r["accessToken"], _token_expiry(r["accessToken"], r.get("expires_in", r.get("expiresIn"))))

    def _call(self, method: str, path: str, *, auth: bool = True, **kw):
        if auth and "Authorization" not in self._headers:
            self.login()
        try:
            r = self._http.request(method, self.base_url + path, headers=self._headers, **kw)
            if r.status_code == 401 and auth and self.user and "Authorization" in self._headers:
                # The token expired or was revoked: drop it and log in once more.
                self._store_token(self.user, None)
                self._headers.pop("Authorization")
                self.login(fresh=True)
                r = self._http.request(method, self.base_url + path, headers=self._headers, **kw)
        except httpx.HTTPError as exc:
            raise SpaceError(f"GaleCore did not answer at {self.base_url}: {type(exc).__name__}") from exc
        if r.status_code == 204:
            return None
        if r.status_code >= 400:
            conflict = r.status_code == 409   # carries the other side's file (`latest`): parsed, never echoed
            detail = "conflict" if conflict else (r.text[:300] if "password" not in r.text.lower() else "(detail omitted)")
            try:
                body = r.json() if conflict or "password" not in r.text.lower() else None
            except ValueError:
                body = None
            raise SpaceError(f"{method} {path} -> HTTP {r.status_code}: {detail}", status=r.status_code,
                             body=body if isinstance(body, dict) else None)
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

    # -- Shared projects (WS-0064): the API only exchanges changes between members; the files live on each PC.

    def users_search(self, q: str) -> list[dict]:
        """Suggestions to share with: [{'username', 'displayName'}], at most 10, never the caller or an email."""
        return self._call("GET", "/App/GaleCore/Users/Search", params={"q": q})["users"]

    def shared_projects(self) -> list[dict]:
        return self._call("GET", "/App/GaleCore/SharedProjects")["projects"]

    def shared_create(self, name: str, kind: str, local_key: str) -> dict:
        return self._call("POST", "/App/GaleCore/SharedProjects", json={"name": name, "kind": kind, "localKey": local_key})

    def shared_set_access(self, project_id: str, access: str) -> dict:
        """Owner only. ``access`` is 'restricted' or 'everyone'; answers the project row."""
        return self._call("PATCH", f"/App/GaleCore/SharedProjects/{project_id}", json={"access": access})

    def shared_join(self, project_id: str) -> dict:
        """Add myself as a member of an 'everyone' project (idempotent); 404 when it is restricted and I am not a member."""
        return self._call("POST", f"/App/GaleCore/SharedProjects/{project_id}/join")

    def shared_delete(self, project_id: str) -> None:
        self._call("DELETE", f"/App/GaleCore/SharedProjects/{project_id}")

    def shared_add_member(self, project_id: str, username: str) -> dict:
        return self._call("POST", f"/App/GaleCore/SharedProjects/{project_id}/members", json={"username": username})

    def shared_remove_member(self, project_id: str, username: str) -> None:
        self._call("DELETE", f"/App/GaleCore/SharedProjects/{project_id}/members/{username}")

    def shared_changes(self, project_id: str, after: int) -> dict:
        return self._call("GET", f"/App/GaleCore/SharedProjects/{project_id}/changes", params={"after": after})

    def shared_push(self, project_id: str, change: dict) -> dict:
        """201/200 -> {'seq', 'contentHash'}. A 409 raises SpaceError(status=409) with the server's ``latest`` in .body."""
        return self._call("POST", f"/App/GaleCore/SharedProjects/{project_id}/changes", json=change)
